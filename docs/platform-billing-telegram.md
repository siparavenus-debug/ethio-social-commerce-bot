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

Seven durable business events are required.

| Event | Authoritative source | Identity |
|---|---|---|
| INVOICE_ISSUED | `openMerchantInvoice()` | Invoice ID |
| INVOICE_FIRST_OVERDUE | `markMerchantInvoiceOverdueAttempt()` | First-overdue reminder ID |
| INVOICE_SECOND_OVERDUE | `createSecondOverdueReminderAttempt()` | Second-overdue reminder ID |
| SETTLEMENT_SUBMITTED | `submitSettlementAttempt()` | Settlement ID |
| SETTLEMENT_VERIFIED | `verifySettlementAttempt()` | Verified settlement ID |
| INVOICE_PAID | `verifySettlementAttempt()` | Paid invoice ID |
| SUBSCRIPTION_SUSPENDED | `suspendPastDueSubscriptionAttempt()` | Unique suspension transition occurrence |

All source locations were identified through read-only repository inspection.

The event must be inserted within the transaction that commits its authoritative business transition.

An idempotent replay that does not create a new transition must not create a new business event.

Subscription suspension requires an identity that distinguishes separate suspension occurrences for the same subscription.

## 5. Event-to-Notification Mapping

Seven business events map to six notification categories.

- INVOICE_ISSUED → invoice issued.
- INVOICE_FIRST_OVERDUE → first overdue reminder.
- INVOICE_SECOND_OVERDUE → second overdue reminder.
- SETTLEMENT_SUBMITTED → settlement submitted.
- SETTLEMENT_VERIFIED → no separate Telegram notification.
- INVOICE_PAID → payment confirmed.
- SUBSCRIPTION_SUSPENDED → subscription suspended.

SETTLEMENT_VERIFIED and INVOICE_PAID are distinct durable facts produced by one successful verification transaction.

Only INVOICE_PAID produces the merchant payment-confirmation notification.

Notification identities must be database-unique and tied to the authoritative transition.

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