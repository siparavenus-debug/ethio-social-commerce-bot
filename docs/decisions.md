# Ethio Social Commerce — Architecture Decisions

This document records important technical and architectural decisions made

during development.

Each decision should explain:

- what was decided

- why it was decided

- alternatives considered when relevant

- current status

---

# ADR-001 — Use TypeScript

Date: 2026-08-12

## Decision

Use TypeScript for both the frontend and backend.

## Reason

A single primary programming language reduces development complexity and is

well suited to AI-assisted development.

TypeScript also provides static typing that can reduce common runtime errors.

## Status

Accepted

---

# ADR-002 — Use PostgreSQL

Date: 2026-08-12

## Decision

Use PostgreSQL as the primary application database.

## Reason

The platform contains strongly related transactional data including:

- merchants

- products

- customers

- conversations

- orders

- payments

- audit records

PostgreSQL provides relational integrity and transactional guarantees that

are appropriate for commerce software.

## Status

Accepted

---

# ADR-003 — Use Prisma

Date: 2026-08-12

## Decision

Use Prisma as the database ORM.

## Reason

Prisma provides:

- type-safe database access

- schema management

- migrations

- good TypeScript integration

- useful developer tooling

It is also practical for AI-assisted development.

## Status

Accepted

---

# ADR-004 — Start With a Modular Monolith

Date: 2026-08-12

## Decision

The initial system will be implemented as a modular monolith rather than

microservices.

## Reason

The project has a 60-day MVP development target.

A modular monolith provides:

- simpler development

- simpler deployment

- easier debugging

- fewer infrastructure dependencies

- lower operational complexity

The architecture should still maintain clear internal module boundaries.

Microservices should only be introduced when a demonstrated requirement

justifies them.

## Status

Accepted

---

# ADR-005 — Telegram as the Initial Customer Commerce Channel

Date: 2026-08-12

## Decision

Telegram will be the primary customer conversation and checkout channel

for the initial MVP.

TikTok will primarily serve as a lead-acquisition channel where supported

by TikTok's official developer capabilities and applicable policies.

## Reason

Separating lead acquisition from commerce conversations reduces dependency

on a single social platform.

Telegram provides the initial controlled environment for:

- customer conversations

- product questions

- checkout

- order creation

- receipt submission

- order notifications

## Status

Accepted

---

# ADR-006 — AI Does Not Control Financial State

Date: 2026-08-12

## Decision

AI services must never directly approve, reject, or otherwise control

financial state.

## Reason

Financial decisions require deterministic business rules and auditability.

AI can:

- interpret customer language

- retrieve approved product information

- generate responses

- extract receipt information

The backend must determine:

- order totals

- payment status

- merchant ownership

- authorization

- financial state

## Status

Accepted

---

# ADR-007 — Separate Receipt Extraction From Payment Verification

Date: 2026-08-12

## Decision

Receipt image extraction and payment verification will be separate

operations.

## Reason

Vision AI can identify information from an image, but visual extraction

does not prove that a payment is legitimate.

The system will therefore use:

Receipt image

→ AI extraction

→ structured information

→ deterministic backend validation

→ VERIFIED / REVIEW_REQUIRED / REJECTED / DUPLICATE

## Status

Accepted

---

# ADR-008 — Fail Safely

Date: 2026-08-12

## Decision

When the system cannot confidently determine a business or payment state,

it must preserve a safe unresolved state rather than assume success.

## Reason

False payment confirmations can damage merchant trust and create financial

loss.

Examples:

If receipt verification is uncertain:

REVIEW_REQUIRED

If an AI service fails:

Do not assume success.

If an external webhook is duplicated:

Do not create another order.

## Status

Accepted

---

# ADR-009 — AI Services Are Restricted by Application Tools

Date: 2026-08-12

## Decision

AI agents will not receive unrestricted access to the database or backend.

AI will interact with application functionality through explicitly defined

tools.

## Reason

Tool boundaries reduce the impact of:

- hallucinations

- prompt injection

- accidental data access

- unauthorized operations

- incorrect AI decisions

The backend validates every tool operation.

## Status

Accepted

---

# ADR-010 — Build for Ethiopian Commerce Context

Date: 2026-08-12

## Decision

The application will be designed for Ethiopian merchants and customers

from the beginning.

## Initial considerations

The system should support:

- Amharic

- English

- mixed Amharic/English customer language

- Ethiopian commercial terminology

- ETB pricing

- Telebirr

- CBE Birr

- Telegram-based commerce workflows

Localization decisions must be based on real user behavior and validated

during testing.

## Status

Accepted

---

# ADR-011 — TikTok Integration Must Follow Current Platform Capabilities

Date: 2026-08-12

## Decision

TikTok functionality will only be implemented using capabilities officially

available through TikTok's current developer platform and applicable

permissions.

## Reason

Social-media platforms frequently change APIs, permissions, automation

rules, and developer requirements.

The system must not depend on:

- unofficial scraping

- browser automation designed to bypass restrictions

- credential sharing

- unsupported automation

- techniques intended to circumvent platform controls

If a desired TikTok capability is unavailable, the product architecture

must provide a compliant alternative.

## Status

Accepted

---

# Decision Log

Future decisions should be added below this section.

Recommended format:

# ADR-XXX — Decision Title

Date: YYYY-MM-DD

## Decision

What was decided?

## Reason

Why was it decided?

## Alternatives

What alternatives were considered?

## Consequences

What does this decision change?

## Status

Proposed / Accepted / Superseded / Rejected

# ADR-012 — Dedicated Platform Billing Telegram Notification Architecture

**Project:** Ethio Social Commerce / Yagebeya
**Date:** November 4, 2026
**Status:** Accepted — November 4, 2026
**Gate:** 15.6 Part B — B1

## Decision

Introduce a dedicated, platform-owned Telegram bot for merchant billing notifications.

The platform bot will operate independently of merchant-owned Telegram commerce bots.

Billing notifications will use a durable, transactionally produced business-event architecture with separate notification intents, recipient deliveries, and provider send attempts.

Only explicitly opted-in, authenticated merchant OWNER accounts may receive billing notifications.

Telegram will have no authority to mutate financial state.

A shared Telegram bot identity registry and historical ownership reservation mechanism will prevent conflicting ownership between platform and merchant bots.

## Reason

The existing application supports merchant commerce messaging, invoice processing, settlement verification, subscription management, and merchant account enforcement.

Billing notifications require a separate trust boundary because they communicate financial information to merchant account owners.

Reusing merchant commerce bots would introduce avoidable coupling between customer-facing commerce messaging and platform billing administration.

Sending Telegram messages directly inside billing transactions would couple financial state transitions to external provider availability and create inconsistent failure behavior.

A durable event-and-delivery architecture preserves authoritative billing state independently of notification outcomes.

Explicit consent, verified Telegram identity, and merchant OWNER authorization reduce the risk of financial information being sent to an unauthorized recipient.

A shared bot identity registry prevents accidental reuse of the same Telegram bot by competing platform and merchant integrations.

## Alternatives Considered

### 1. Reuse existing merchant commerce bots

Rejected because merchant-controlled commerce credentials and customer-facing messaging should not become the platform's billing notification channel.

### 2. Send Telegram notifications directly from billing transactions

Rejected because external provider calls must not participate in financial database transactions.

### 3. Use billing reminder records as Telegram delivery records

Rejected because authoritative billing reminders and provider delivery attempts represent different business facts and lifecycles.

### 4. Use one notification for every billing business event

Rejected because settlement verification and invoice payment are separate business facts that should produce only one payment-confirmation notification.

### 5. Automatically retry every failed Telegram request

Rejected because a timeout or crash may occur after Telegram accepts the message, making blind retries unsafe.

### 6. Maintain separate, uncoordinated bot ownership records

Rejected because database uniqueness inside separate tables cannot prevent the same Telegram bot ID from being claimed by both platform and merchant systems.

## Consequences

### Positive

- Strong separation between platform billing and merchant commerce.
- Durable, auditable notification processing.
- Explicit merchant OWNER consent.
- Reduced duplicate notification risk.
- Conservative handling of uncertain provider outcomes.
- Shared Telegram bot ownership enforcement.
- Improved operational visibility.
- Independent evolution of billing notifications.

### Costs and Tradeoffs

- Additional database models and migrations.
- Dedicated webhook and worker infrastructure.
- Historical merchant bot identity reconciliation.
- Additional authorization and lifecycle logic.
- Manual review for ambiguous Telegram sends.
- More extensive regression testing.
- No guarantee of exactly-once delivery or message readership.

## Security Requirements

The implementation must preserve:

- Existing financial authorization boundaries.
- Merchant and platform identity separation.
- Merchant-scoped database relationships.
- Dedicated webhook authentication.
- Cryptographically secure, short-lived linking credentials.
- Atomic single-use enrollment.
- Explicit consent and revocation.
- Private-chat-only linking.
- Independent recipient eligibility checks.
- Secure bot credential storage.
- Auditable operator recovery.
- No financial mutation authority for Telegram.

## Compatibility Requirements

Existing merchant Telegram integration registration, replacement, status changes, webhook authentication, customer conversations, and order fulfillment messaging must remain operational.

Legacy integrations without verified bot IDs require explicit reconciliation or compatibility handling.

INACTIVE merchant integrations must not automatically release bot ownership.

Uncertain webhook cleanup must not release ownership prematurely.

Existing integration test fixtures must be updated safely during B2 without weakening production database constraints.

## Implementation Boundaries

This ADR establishes the architecture only.

It does not approve:

- Prisma schema modifications.
- Database migrations.
- Historical data backfills.
- New routes or workers.
- Telegram bot registration.
- Webhook configuration.
- Test execution.
- Commits or pushes.
- Railway deployment.
- Production notification sends.

These activities require explicit authorization under subsequent gates.

## Acceptance

This ADR was formally accepted on November 4, 2026, as part of the Gate 15.6 Part B B1 architecture baseline. B2 implementation requires separate authorization.

The detailed implementation remains governed by the separately maintained Gate 15.6 Part B master plan.

**Status: ACCEPTED — November 4, 2026.**