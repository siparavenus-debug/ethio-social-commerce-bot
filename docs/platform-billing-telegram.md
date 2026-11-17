# Platform Billing Telegram — Architecture and Implementation Contract

**Project:** Ethio Social Commerce / Yagebeya
**Gate:** 15.6 Part B — B1
**Version:** 1.0 — Accepted B1 Baseline
**Date:** November 4, 2026
**Status:** Accepted — November 4, 2026
**Implementation status:** Not implemented

---

## 1. Purpose and Scope

Introduce a dedicated, platform-owned Telegram bot for merchant billing notifications.

The bot will notify authorized, explicitly opted-in merchant OWNER accounts about billing events. It will remain separate from merchant-operated Telegram commerce bots.

The system is notification-only.

It must never authorize, initiate, approve, or execute financial state transitions through Telegram.

Existing merchant commerce, customer messaging, order fulfillment, merchant billing, settlement verification, and platform administration boundaries must remain intact.

## 2. Existing System Baseline

The project is a TypeScript monorepo using an Express API, React/Vite web dashboard, Prisma, PostgreSQL, and Railway.

Existing financial workflows include:

- Merchant invoice creation, opening, overdue processing, and payment.
- Merchant settlement submission and authorized verification.
- Subscription delinquency and suspension.
- Merchant and platform audit logging.

The merchant invitation worker is operational independently of this project.

Gate B0 established fail-closed test database isolation.

The second-overdue reminder race was corrected through transactional eligibility revalidation before this architecture review.

No platform billing Telegram notification implementation has been introduced under B1.

## 3. Non-Negotiable Security Invariants

1. Financial transitions remain exclusively controlled by authorized existing backend workflows.
2. Telegram commands cannot modify invoices, settlements, subscriptions, or merchant account status.
3. Billing state changes and corresponding business events must commit atomically.
4. No external Telegram API request may occur inside a financial database transaction.
5. Merchant isolation must be enforced by application authorization and database relationships.
6. Enrollment requires authenticated merchant OWNER authorization and explicit consent.
7. Platform billing bot credentials must remain separate from merchant commerce bot credentials.
8. Ambiguous Telegram sends must never trigger blind automatic retries.
9. Replayed events, tokens, webhooks, and worker claims must not produce unauthorized duplicate actions.
10. Financial audit history and notification audit history remain distinguishable.

## 4. Authoritative Billing Business Events

Nine durable business event types are required under the B5.4 amendment.

| Event | Authoritative source | Identity |
|---|---|---|
| INVOICE_ISSUED | `openMerchantInvoice()` | Invoice ID |
| INVOICE_FIRST_OVERDUE | `markMerchantInvoiceOverdueAttempt()` | First-overdue reminder ID |
| INVOICE_SECOND_OVERDUE | `createSecondOverdueReminderAttempt()` | Second-overdue reminder ID |
| SETTLEMENT_SUBMITTED | `submitSettlementAttempt()` | Settlement ID |
| SETTLEMENT_VERIFIED | `verifySettlementAttempt()` | Verified settlement ID |
| SETTLEMENT_REJECTED | Authoritative settlement rejection transition | Rejected settlement ID, provided each settlement can be rejected only once |
| INVOICE_PAID | `verifySettlementAttempt()` | Paid invoice ID |
| SUBSCRIPTION_SUSPENDED | `suspendPastDueSubscriptionAttempt()` | Unique suspension transition occurrence |
| SUBSCRIPTION_RECOVERED | Authoritative subscription recovery transition | Unique recovery transition occurrence |

The original seven source locations were identified through read-only repository inspection. The two added source locations and their final occurrence-key construction must be verified against the implementation before B5.4 PASS.

The event must be inserted within the transaction that commits its authoritative business transition.

An idempotent replay that does not create a new transition must not create a new business event.

Subscription suspension and recovery require identities that distinguish separate transition occurrences for the same subscription.

Settlement rejection must not mark an invoice paid or imply that submitted evidence constitutes verified settlement.

## 5. Event-to-Notification Mapping

Nine business event types map to eight Telegram notification categories.

- INVOICE_ISSUED -> invoice issued.
- INVOICE_FIRST_OVERDUE -> first overdue reminder.
- INVOICE_SECOND_OVERDUE -> second overdue reminder.
- SETTLEMENT_SUBMITTED -> settlement submitted.
- SETTLEMENT_VERIFIED -> no separate Telegram notification.
- SETTLEMENT_REJECTED -> settlement rejected.
- INVOICE_PAID -> payment confirmed.
- SUBSCRIPTION_SUSPENDED -> subscription suspended.
- SUBSCRIPTION_RECOVERED -> subscription recovered.

SETTLEMENT_VERIFIED and INVOICE_PAID are distinct durable facts produced by one successful verification transaction.

Only INVOICE_PAID produces the merchant payment-confirmation notification.

SETTLEMENT_REJECTED must communicate rejection without disclosing sensitive evidence or internal review notes.

SUBSCRIPTION_RECOVERED must represent an actual recovery transition, not an unchanged active subscription.

Notification identities must be database-unique and tied to the authoritative transition.

Destination-specific delivery requires an eligible OWNER opt-in. Without eligible opt-in, the business event is retained for reconciliation, but no Telegram delivery is created.

Later opt-in must never trigger historical notification backfill. Suppressed historical notifications must not be reactivated or redirected to a newly linked destination.

This B5.4 amendment expands notification categories only. It does not authorize schema changes, migrations, deployments, or changes to financial verification rules.
## 6. Event and Delivery Architecture

The processing pipeline is:

**Authoritative billing transaction → durable business event → notification intent → recipient delivery → send attempt → dedicated Telegram worker → delivery outcome.**

Business events, notification intents, and recipient deliveries are separate durable records.

A committed business event does not prove that a Telegram message was delivered.

A successful Telegram API response does not prove that a merchant read the message.

Notification materialization and delivery must be idempotent.

The worker must recheck eligibility before contacting Telegram.

## 7. Merchant Recipient Policy

Each merchant may have at most one ACTIVE billing Telegram recipient.

A Telegram user may be ACTIVE for at most one merchant billing recipient relationship.

Only an authenticated merchant OWNER may enroll, replace, or revoke the merchant's billing recipient.

The merchant account must be ACTIVE for enrollment and delivery.

Subscription PAST_DUE or SUSPENDED status alone must not suppress billing notifications.

Merchant account SUSPENDED status must suppress delivery.

An OWNER losing the OWNER role becomes ineligible.

A replacement recipient must not inherit old pending notifications automatically.

A pending replacement must not revoke the existing ACTIVE recipient until the replacement is successfully verified and activated.

## 8. Recipient Lifecycle

Recipient states:

- UNLINKED — no active recipient relationship.
- PENDING — enrollment initiated but not verified.
- ACTIVE — verified identity and explicit consent.
- EXPIRED — incomplete enrollment expired.
- REVOKED — consent or authorization withdrawn.

UNLINKED may be represented by the absence of an ACTIVE recipient rather than a stored enum value.

Activation and replacement must be transactional.

Revocation must prevent new sends and must be rechecked against already-queued deliveries.

Merchant account suspension suppresses delivery but does not automatically revoke consent.

## 9. Secure Telegram Linking

Linking credentials must:

- Be generated using cryptographically secure randomness with at least 256 bits of entropy.
- Be stored as hashes, never plaintext.
- Expire after 10 minutes.
- Be single-use and atomically consumed.
- Be bound to the merchant, authenticated OWNER, and pending recipient.
- Require verified Telegram identity obtained from the dedicated webhook.
- Permit private Telegram chats only.
- Enforce rate limits and replay protection.
- Never appear in logs, audit metadata, or notification messages.
- Have no financial mutation authority.

## 10. Dedicated Platform Telegram Webhook

The platform billing bot must have a dedicated webhook endpoint and secret.

Webhook processing must include:

- Timing-safe secret verification.
- Strict payload validation.
- Bot identity verification.
- Private-chat enforcement.
- Unique bot ID and Telegram update ID.
- Durable acceptance before successful acknowledgment.
- Atomic worker claims with leases and fencing.
- Safe replay handling.
- Minimal retained payload data.
- Merchant and OWNER authorization checks.
- No financial state mutations.

The existing merchant commerce webhook must remain separate.

## 11. Notification Eligibility and Suppression

Before delivery, the system must verify:

1. The authoritative business event exists and is committed.
2. The notification intent is valid and unique.
3. The intended recipient remains the authorized OWNER.
4. Consent remains ACTIVE.
5. The merchant account remains ACTIVE.
6. The recipient's verified Telegram identity remains valid.
7. The billing event remains relevant under the notification policy.
8. The notification has not already been sent, suppressed, or placed into manual review.

Stale or ineligible deliveries must be suppressed with a recorded reason.

Suppressed notifications must not automatically transfer to replacement recipients.

Historical notifications must not automatically replay after consent restoration or account reactivation.

## 12. Delivery and Send-Attempt State Machines

Delivery states:

PENDING, PROCESSING, SENDING, SENT, FAILED, SUPPRESSED, REVIEW_REQUIRED.

Send-attempt states:

PREPARED, REQUEST_STARTED, SUCCEEDED, FAILED_PRE_SEND, UNCERTAIN.

Worker claims must be atomic, lease-based, and protected against stale workers.

A durable REQUEST_STARTED state must precede the external Telegram API call.

Definitely pre-send failures may be retried under bounded policy.

Timeouts, crashes, and other ambiguous outcomes after the request boundary require conservative REVIEW_REQUIRED handling.

No automatic resend is permitted when the previous send may have succeeded.

Manual recovery must be authorized, attributable, and audited.

## 13. Shared Telegram Bot Identity Ownership

Platform billing and merchant commerce bots must share an exclusive bot identity namespace.

Two supporting models are required:

**TelegramBotIdentityRegistry**

Stores the canonical Telegram bot ID.

**TelegramBotOwnershipReservation**

Stores historical and current ownership reservations, including owner type, owner reference, reservation status, and timestamps.

A partial unique index must prevent more than one current RESERVED reservation per bot ID.

Ownership types distinguish PLATFORM_BILLING from MERCHANT_COMMERCE.

Platform bot configuration must reference its reservation.

Existing merchant integration configuration must gain a reservation reference, initially nullable only as needed for safe legacy migration.

The system must prevent the same bot from being registered simultaneously as a platform billing bot and a merchant commerce bot.

Reservation release must be explicit, guarded, and verified.

Webhook cleanup uncertainty must not cause premature reservation release.

## 14. Legacy Merchant Bot Compatibility

Existing merchant Telegram integrations may have null Telegram bot IDs.

Such records must not receive fabricated identities.

Historical integrations and claims must be reconciled before strict ownership enforcement.

Existing merchant bot behavior includes:

- PROVISIONING, ACTIVE, and INACTIVE integration states.
- PENDING and ACTIVE bot claims.
- Bot replacement with external webhook setup and cleanup.
- Preservation of PENDING claims when cleanup is uncertain.
- Same-bot credential rotation.
- Status-only updates.
- Merchant OWNER and ADMIN configuration authorization.
- Commerce entitlement checks.

INACTIVE integration status does not mean ownership has been released.

Existing customer commerce and order fulfillment notifications must continue using merchant bot credentials.

The new platform billing notification worker must not replace existing commerce delivery workflows.

## 15. Required Data Models

Nine logical platform billing notification models are required:

1. PlatformBillingBusinessEvent
2. PlatformBillingNotificationIntent
3. PlatformBillingTelegramRecipient
4. PlatformBillingTelegramLinkToken
5. PlatformBillingTelegramWebhookEvent
6. PlatformBillingNotificationDelivery
7. PlatformBillingTelegramSendAttempt
8. PlatformBillingTelegramBotIdentity
9. PlatformBillingNotificationAudit

Two additional shared models are required:

10. TelegramBotIdentityRegistry
11. TelegramBotOwnershipReservation

Implementation must include appropriate reciprocal Prisma relations, composite tenant foreign keys, unique constraints, partial unique indexes, CHECK constraints, restrictive deletion behavior, and guarded lifecycle operations.

Exact Prisma definitions and PostgreSQL migration SQL remain B2 deliverables.

## 16. Concurrency and Failure Requirements

The design must address:

- Duplicate billing event insertion.
- Concurrent notification materialization.
- Simultaneous recipient enrollment.
- Expired or replayed linking tokens.
- Concurrent webhook deliveries.
- Stale worker leases.
- Duplicate Telegram send attempts.
- Ambiguous provider responses.
- Concurrent bot registration.
- Bot replacement failure.
- External webhook cleanup failure.
- Historical ownership conflicts.
- Merchant account suspension during delivery.

Database uniqueness and transactional state transitions are mandatory where applicable.

No exactly-once Telegram delivery guarantee is assumed.

## 17. Audit, Privacy, and Operational Monitoring

Notification audit records must be separate from authoritative financial audit records.

Audit records must identify the actor, action, relevant entity, timestamp, and sanitized reason.

Secrets, raw linking tokens, and unnecessary Telegram payload content must not be logged.

Operational monitoring must cover:

- Event and intent backlogs.
- Delivery backlog and age.
- Worker execution health.
- Lease expiry and stale claims.
- Retry and failure counts.
- REVIEW_REQUIRED cases.
- Suppression reasons.
- Webhook authentication failures.
- Ownership conflicts.
- Unexpected batch-processing errors.

Existing overdue subscription suspension processing has an identified observability gap: some unexpected failures may be counted as skipped rather than surfaced separately.

That gap must be addressed or explicitly dispositioned before relying on the relevant operational monitoring.

## 18. Migration and Deployment Safety

B2 must use additive schema migration and controlled backfill.

Migration must:

- Preserve historical merchant integrations and claims.
- Detect conflicts before enabling strict ownership enforcement.
- Avoid inventing Telegram identities.
- Avoid modifying existing bot secrets.
- Prevent conflicting registration paths during rollout.
- Preserve reservation history.
- Use isolated test databases.
- Define safe rollback limitations.
- Avoid premature platform bot activation.

Production bot registration and webhook changes require separate authorization.

## 19. Verification by Gate

**B2:** Schema, migrations, constraints, ownership, backfill, concurrency, rollback.

**B3:** OWNER authorization, consent, token security, linking, revocation, replacement.

**B4:** Dedicated webhook authentication, replay prevention, atomic processing, private chats.

**B5:** Billing event atomicity, notification mapping, idempotency, suppression.

**B6:** Worker claims, leases, send attempts, uncertain-send recovery.

**B7:** Dashboard consent management, audit, privacy, operator permissions.

**B8:** Staging, pilot, monitoring, controlled production rollout.

Each gate requires independent authorization and acceptance evidence.

## 20. B1 Acceptance and B2 Entry Conditions

B1 may be accepted when:

- This architecture contract is approved.
- ADR-012 is accepted.
- Authoritative billing event producers are traceable.
- The data-model specification is sufficient for B2 design.
- Security, concurrency, recovery, and compatibility requirements are explicit.
- Operational monitoring requirements are defined.
- B2–B8 verification obligations are recorded.
- Remaining implementation decisions are clearly assigned to B2 or later gates.

B1 acceptance does not authorize implementation.

B2 requires separate explicit approval before repository edits, migrations, test execution, commits, pushes, or deployment.

---

**Document status: Accepted November 4, 2026 — implementation pending.**

# Gate 15.6 Part B â€” B7.5 Privacy, Retention, and Operational Support Amendment

**Project:** Ethio Social Commerce / Yagebeya
**Applies to:** Dedicated Platform Billing Telegram Notification System
**Status:** B7.5 design approved; documentation and implementation acceptance pending
**Date:** November 16, 2026
**Scope:** B7.5 only

---

## 21. B7.5 Privacy and Data Minimization

The platform billing Telegram system must collect and retain only information necessary for authorized notification delivery, consent accountability, security, troubleshooting, and operational reconciliation.

The following requirements apply:

1. Raw linking tokens must never be persisted.
2. Bot credentials and webhook secrets must remain encrypted or otherwise securely protected under existing credential-management requirements.
3. Raw Telegram message content, unnecessary personal information, and internal financial review notes must not be retained in operational logs.
4. Telegram identifiers must not be unnecessarily exposed in merchant or platform administration interfaces.
5. Notification audit records must remain distinguishable from authoritative financial audit records.
6. Telegram delivery history must never become the authoritative record of invoice, settlement, or subscription state.
7. Telegram API acceptance must never be represented as confirmed human receipt.

These requirements supplement the existing architecture contract and do not weaken its security invariants.

## 22. B7.5 Data Retention Schedule

The following retention periods are provisionally approved for design, subject to legal review, database dependency verification, and applicable preservation requirements.


| Data category                          | Retention period                    | Retention trigger                   |
| -------------------------------------- | ----------------------------------- | ----------------------------------- |
| Raw linking tokens                     | No plaintext persistence            | Not applicable                      |
| Hashed linking tokens                  | 30 days                             | Expiry or consumption               |
| Webhook event metadata                 | 30 days                             | Terminal processing                 |
| Sanitized webhook payload              | 7 days                              | Terminal processing                 |
| Active recipient identifiers           | While authorized and linked         | Active recipient lifecycle          |
| Revoked recipient identifiers          | 30 days                             | Revocation, subject to dependencies |
| Terminal notification deliveries       | 90 days                             | Terminal resolution                 |
| Terminal Telegram send attempts        | 90 days                             | Terminal resolution                 |
| Operational logs                       | 30 days                             | Log creation                        |
| Consent and notification audit history | 365 days                            | Audit event creation                |
| Authoritative financial records        | Separate financial retention policy | Applicable financial requirements   |


### 22.1 Retention exceptions

Records must not be deleted automatically when:

- The delivery or send attempt remains unresolved.
- The record is required for an active investigation, dispute, or legal hold.
- Deletion would compromise replay prevention or idempotency.
- The record is required to preserve database integrity.
- The record supports an applicable financial or security audit obligation.

These exceptions must be documented, access-controlled, and reviewed periodically.

### 22.2 Unresolved send attempts

Records involving `REQUEST_STARTED`, `UNCERTAIN`, `REVIEW_REQUIRED`, or otherwise unresolved send outcomes must remain protected until safely resolved or placed under an authorized preservation exception.

An expired retention period must never trigger an automatic resend, reset a delivery fence, or erase evidence needed to investigate a possible duplicate notification.

### 22.3 Retention cleanup controls

Any future automated retention process must support:

- Dry-run evaluation.
- Bounded processing batches.
- Database constraint verification.
- Preservation of replay-prevention guarantees.
- Sanitized operational logging.
- Auditable cleanup outcomes.
- Isolated test coverage.
- Explicit authorization before activation.

This amendment does not authorize implementation or activation of a retention cleanup worker.

## 23. B7.5 Unlink, Deletion, and Anonymization

### 23.1 Merchant opt-out

Only an authenticated merchant OWNER may revoke or replace the active billing Telegram recipient through the authorized merchant workflow.

Opt-out must immediately make the destination ineligible for new sends.

Pending deliveries must be revalidated and suppressed where consent or authorization is no longer valid.

Unlinking must not:

- Delete authoritative financial records.
- Mark an invoice paid or unpaid.
- Modify settlement verification.
- Transfer historical notifications to another recipient.
- Trigger historical notification backfill.
- Depend on completion of a later retention cleanup operation.

### 23.2 Personal data deletion

A verified deletion request must be evaluated against the approved retention schedule, applicable legal obligations, and database integrity requirements.

Eligible Telegram personal data should be deleted or minimized when retention is no longer justified.

Where full deletion would undermine necessary audit or replay-prevention guarantees, the system may preserve a minimal, appropriately protected record under an approved exception.

### 23.3 Audit preservation

Consent changes, recipient revocation, replacement, and authorized operational actions must remain attributable without unnecessarily retaining Telegram personal information.

Financial audit history must remain separate and must not be removed through Telegram notification cleanup.

## 24. B7.5 Telegram Bot-Block Handling

### 24.1 Definitive bot block

When Telegram definitively rejects delivery because the merchant blocked the dedicated platform billing bot:

1. Record a sanitized permanent delivery failure.
2. Preserve relevant send-attempt evidence.
3. Prevent further sends to the blocked destination.
4. Preserve the distinction between a blocked destination and OWNER-authorized revocation.
5. Require verified recovery and eligibility revalidation before resuming delivery.

The exact blocked-destination representation must be compatible with the existing approved database model.

No new schema status is authorized by this amendment.

### 24.2 Other permanent delivery failures

Definitive Telegram responses indicating that the chat is unavailable or delivery is prohibited must be handled as permanent failures when the response reliably establishes that outcome.

The system must not repeatedly send to a destination known to be permanently unavailable.

### 24.3 Ambiguous outcomes

A timeout, lost response, worker crash, or other uncertainty after the external request boundary must not be treated as a confirmed bot block or confirmed failure.

Such outcomes require conservative `REVIEW_REQUIRED` handling.

No automatic resend is permitted when Telegram may already have accepted the message.

### 24.4 Recovery

Recovery must require:

- Confirmation that the blocking condition has been resolved.
- Current merchant and OWNER eligibility.
- Valid consent.
- Verified destination identity.
- Compliance with existing linking or relinking requirements.

Recovery must not automatically resend historical suppressed or failed notifications.

## 25. B7.5 Support and Operational Runbook

### 25.1 Missing notification

Authorized support personnel must:

1. Verify their permitted merchant scope.
2. Inspect masked recipient and consent status.
3. Inspect the relevant billing event and notification delivery.
4. Determine whether the notification was suppressed, failed, accepted, or placed under review.
5. Examine only sanitized diagnostic information.
6. Escalate unresolved delivery cases.

Support must never claim that Telegram API acceptance proves the merchant received or read a message.

### 25.2 Blocked bot

For a confirmed blocked destination:

1. Verify the definitive provider failure.
2. Confirm further delivery attempts are suppressed.
3. Inform the merchant of the authorized recovery procedure.
4. Do not automatically retry previously failed notifications.
5. Preserve the minimum necessary diagnostic history.

### 25.3 Ambiguous send

For `REVIEW_REQUIRED` outcomes:

1. Preserve the existing send-attempt fence.
2. Review sanitized attempt evidence.
3. Verify current eligibility.
4. Evaluate duplicate-notification risk.
5. Require separate operator authorization before any manual retry.
6. Audit the decision and its justification.

A manual retry must never be treated as an automatic or routine response to a timeout.

### 25.4 Merchant opt-out

Support must direct the merchant OWNER to the authorized unlink or preference workflow.

Support personnel must not bypass OWNER authorization, silently replace a recipient, or reactivate revoked consent.

Opt-out must not alter financial obligations.

### 25.5 Data deletion request

Support must:

1. Verify request authorization.
2. Identify Telegram notification data within scope.
3. Apply the approved retention schedule.
4. Check legal, security, and operational preservation requirements.
5. Preserve financial records and necessary audit evidence.
6. Record the authorized disposition.

Direct database deletion outside an approved procedure is prohibited.

## 26. B7.5 Monitoring and Escalation

Operational monitoring should cover:

- Permanent Telegram delivery failures.
- Confirmed blocked destinations.
- Suppressed deliveries.
- `REVIEW_REQUIRED` backlog and age.
- Unexpected retries.
- Consent and recipient eligibility failures.
- Retention cleanup errors.
- Unauthorized access attempts.
- Cross-merchant exposure.
- Delivery attempts involving revoked destinations.

### 26.1 Escalation priorities

**Security-critical:**

- Cross-merchant notification exposure.
- Telegram notification workflows modifying financial state.
- Delivery to a destination after confirmed revocation.
- Unauthorized disclosure of tokens, credentials, or sensitive information.

**High-priority operational:**

- Automatic retry after an ambiguous send.
- Unexpected duplicate delivery.
- Persistent unresolved delivery backlog.
- Failure of required eligibility revalidation.

**Routine operational review:**

- Confirmed blocked bot.
- Permanent chat-unavailable response.
- Merchant-reported missing notification.
- Authorized consent or unlink assistance.

## 27. B7.5 Implementation and Acceptance Boundaries

This amendment defines approved design requirements only.

It does not establish that all described behavior is implemented.

Before full B7.5 local acceptance:

1. Incorporate this amendment into the approved project documentation.
2. Verify compatibility with existing Prisma models and delivery-state handling.
3. Verify that current unlink and suppression behavior meets the documented requirements.
4. Identify any missing operational procedures or implementation controls.
5. Record unresolved legal-retention questions.
6. Complete any separately authorized focused validation.

No implementation changes are implicitly authorized.

B3, B4, and B5.5-G remain on HOLD.

No database migration, production change, commit, push, deployment, Telegram send, worker activation, or retention cleanup is authorized by this amendment.

---

**B7.5 status:** Policy design approved; documentation integration and full local acceptance pending.

**End of B7.5 amendment.**