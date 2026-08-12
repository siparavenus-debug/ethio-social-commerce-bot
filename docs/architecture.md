# Ethio Social Commerce — Architecture

## 1. Project Purpose

Ethio Social Commerce is an AI-assisted social commerce platform designed for

Ethiopian merchants.

The system helps merchants convert permitted social-media leads into

conversations, orders, payment review, and fulfillment.

The initial customer conversation and checkout channel is Telegram.

TikTok is treated primarily as a lead-acquisition channel and will only use

capabilities permitted by TikTok's current developer policies and APIs.

---

## 2. Core Commerce Flow

TikTok

  ↓

Lead

  ↓

Telegram

  ↓

AI Sales Assistant

  ↓

Product Selection

  ↓

Order

  ↓

Payment Instructions

  ↓

Customer Receipt

  ↓

Receipt Information Extraction

  ↓

Deterministic Payment Review

  ↓

Merchant

  ↓

Fulfillment

---

## 3. Technology Stack

### Frontend

- Next.js
- TypeScript

### Backend

- Node.js
- TypeScript

### Database

- PostgreSQL
- Prisma ORM

### AI

- Claude — conversational sales assistant
- Gemini — receipt/image information extraction

### Integrations

- Telegram Bot API
- TikTok Developer Platform
- Telebirr
- CBE Birr

### Infrastructure

- Railway
- GitHub
- GitHub Actions
- Sentry

---

## 4. Architectural Principle

The system follows a controlled-AI architecture.

AI assists the application but does not have unrestricted authority over

business or financial operations.

### AI may:

- understand customer messages
- classify customer intent
- retrieve approved product information
- assist with product recommendations
- extract information from receipt images
- generate customer-facing responses

### AI may not independently:

- change product prices
- invent product availability
- approve payments
- reject payments
- modify financial records
- access another merchant's data
- access another customer's private information
- request payment PINs
- request OTPs
- request banking passwords
- execute arbitrary database operations

The backend remains the final authority for business rules and financial state.

---

## 5. Payment Architecture

Receipt images may be processed by a vision AI service.

The AI service extracts visible receipt information such as:

- transaction reference
- amount
- date/time
- sender information when visible
- recipient information when visible
- payment provider
- other relevant receipt fields

The backend then performs deterministic validation.

AI extraction and payment verification are separate operations.

### Payment states

- PENDING
- REVIEW_REQUIRED
- VERIFIED
- REJECTED
- DUPLICATE

AI extraction alone must never cause a payment to become VERIFIED.

---

## 6. Multi-Tenant Architecture

The platform is designed for multiple merchants.

Every merchant-owned resource must be associated with a merchant identifier.

Examples:

- products
- customers
- orders
- payments
- conversations
- settings

A merchant must never be able to access another merchant's data.

Merchant ownership must be enforced on the backend rather than trusted from

client-provided values.

---

## 7. Application Structure

The planned application structure is:

apps/

  api/

  web/

packages/

  database/

  types/

  config/

docs/

  [architecture.md](http://architecture.md)

  [security.md](http://security.md)

  [api.md](http://api.md)

  [decisions.md](http://decisions.md)

---

## 8. Major System Components

### Merchant Dashboard

Responsible for:

- products
- orders
- customers
- payment reviews
- merchant settings
- operational status

### Commerce API

Responsible for:

- authentication
- business logic
- product management
- order management
- payment state
- customer management
- authorization

### AI Sales Agent

Responsible for:

- understanding customer intent
- answering product questions
- guiding customers through checkout
- communicating in supported languages
- using approved application tools

### Telegram Integration

Responsible for:

- receiving customer messages
- sending responses
- receiving receipt uploads
- maintaining conversation context

### TikTok Integration

Responsible only for supported lead-generation and event capabilities.

TikTok capabilities must be verified against current official developer

documentation before implementation.

### Payment Review System

Responsible for:

- receipt ingestion
- receipt information extraction
- deterministic validation
- duplicate detection
- manual review
- auditability

---

## 9. Reliability Principles

The system must fail safely.

If an external service fails:

- do not assume success
- do not automatically confirm payment
- preserve the current transaction state
- provide a recoverable state for the merchant

External events must be processed idempotently where possible.

Duplicate webhooks must not create duplicate orders.

---

## 10. Observability

Production systems should provide:

- structured application logs
- error monitoring
- webhook processing logs
- payment review audit logs
- important merchant action logs

Sentry is planned for application error monitoring.

---

## 11. Development Strategy

The project will initially use a modular monolith rather than microservices.

Reason:

- faster development
- simpler deployment
- easier debugging
- lower operational complexity
- appropriate for the initial MVP

Services should only be separated when there is a demonstrated reason to do so.

---

## 12. Current Status

Phase:

Day 1 — Architecture Foundation

Status:

Initial architecture

Last updated:

2026-08-12