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