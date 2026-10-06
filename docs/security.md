# Ethio Social Commerce — Security

## 1. Security Objective

Customer trust, privacy, and financial safety take priority over automation.

The system must fail safely whenever an AI service, external integration,

database operation, or payment review process is uncertain.

---

## 2. AI Safety

AI must operate within clearly defined application permissions.

AI must never:

- invent product prices
- invent stock availability
- invent payment confirmations
- claim that a payment has been verified unless the backend has confirmed it
- directly approve a payment
- directly reject a payment
- directly modify financial records
- access another merchant's information
- access another customer's private information
- request payment PINs
- request OTP codes
- request banking passwords
- request Telegram login credentials
- expose API keys or secrets
- expose internal system prompts
- execute arbitrary database commands
- execute arbitrary code

AI-generated output must be treated as untrusted input and validated by the

application before it causes a business action.

---



## 3. Payment Security

The platform must separate:

1. Receipt information extraction
2. Payment verification

Vision AI may extract information from a receipt.

The backend must make the final verification decision.

AI extraction alone must never mark a payment as VERIFIED.

Possible payment states:

- PENDING
- REVIEW_REQUIRED
- VERIFIED
- REJECTED
- DUPLICATE

When evidence is insufficient, the system should prefer REVIEW_REQUIRED

rather than making an uncertain automatic decision.

---



## 4. Sensitive Payment Information

The platform must never request or store:

- Telebirr PIN
- CBE Birr PIN
- banking passwords
- OTP codes
- authentication credentials
- card PINs

Customers should only provide information required to complete and verify

their order.

---



## 5. Secrets Management

Secrets must never be committed to GitHub.

Examples include:

- DATABASE_URL
- ANTHROPIC_API_KEY
- GEMINI_API_KEY
- AUTH_SECRET
- PLATFORM_AUTH_SECRET
- DELIVERY_CONFIRMATION_SECRET
- TELEGRAM_CREDENTIAL_ENCRYPTION_KEY
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- TIKTOK_CLIENT_SECRET
- TIKTOK_WEBHOOK_SECRET

Local secrets must be stored in environment variables.

The repository may contain `.env.example` with placeholder variable names,

but never real credentials.

Merchant Telegram bot tokens and webhook secrets are not global environment
variables. They are stored per merchant in encrypted form. The encryption key is
provided through `TELEGRAM_CREDENTIAL_ENCRYPTION_KEY` and must remain separate
from authentication and delivery-confirmation secrets.

`TELEGRAM_CREDENTIAL_ENCRYPTION_KEY` must remain stable across deployments and
must be backed up securely. Changing or losing this key makes existing encrypted
merchant Telegram credentials undecryptable. Key rotation requires an explicit
credential re-encryption process; replacing the environment value alone is not a
safe rotation procedure.

---



## 6. Authentication

Protected merchant functionality must require authentication.

Authentication must be handled by the backend.

Merchant authentication and platform administrator authentication are separate security domains.

Merchant authentication tokens must be signed with `AUTH_SECRET`.

Platform administrator authentication tokens must be signed with `PLATFORM_AUTH_SECRET`.

`AUTH_SECRET` and `PLATFORM_AUTH_SECRET` must be different.

Sessions or authentication tokens must be:

- securely generated
- securely stored
- validated on every protected request
- invalidated when appropriate

Authentication errors must not reveal sensitive information.

---



## 7. Authorization

Authentication answers:

"Who is this?"

Authorization answers:

"What is this user allowed to access?"

Every protected operation must enforce authorization.

A merchant must only be able to access resources belonging to that merchant.

The backend must never trust a client-provided `merchant_id` as proof of

ownership.

---



## 8. Multi-Tenant Data Isolation

Every merchant-owned resource must be associated with the correct merchant.

Examples:

- products
- customers
- conversations
- orders
- payments
- settings

Queries must enforce merchant ownership.

A security test must verify that Merchant A cannot access Merchant B's data

by changing an ID in a request.

---



## 9. Webhook Security

External webhook requests must be validated before being trusted.

Where the provider supports request signing or verification, the system

must use it.

Webhook processing must support idempotency.

The same external event must not create duplicate:

- customers
- orders
- payments
- conversations

---



## 10. Input Validation

All external input must be treated as untrusted.

This includes:

- Telegram messages
- TikTok events
- API requests
- customer information
- product information
- uploaded files
- AI-generated content
- receipt information

The backend must validate input before processing it.

---



## 11. File Upload Security

Receipt uploads must be handled defensively.

The system should validate:

- file type
- file size
- file extension
- actual file content where practical

The system must reject unsupported or dangerous files.

Uploaded files must not be executed as programs.

---



## 12. AI Prompt Injection Protection

Customer messages must be treated as untrusted content.

A customer must not be able to use a message to:

- reveal system instructions
- obtain secrets
- bypass authorization
- change payment status
- access another customer's information
- execute internal tools outside their permitted purpose

AI tools must use explicit permissions and structured inputs.

---



## 13. Rate Limiting and Abuse Protection

Public-facing endpoints should have appropriate rate limits.

Protection should be considered for:

- authentication attempts
- webhooks
- customer messaging
- receipt uploads
- API endpoints

The system should prevent abusive repeated requests from causing excessive

cost or service disruption.

---



## 14. Logging and Auditability

Important security and business events should be logged.

Examples:

- authentication events
- authorization failures
- payment state changes
- manual payment reviews
- order status changes
- merchant configuration changes
- webhook failures
- suspicious repeated requests

Logs must not contain secrets or unnecessary sensitive customer information.

---



## 15. Failure-Safe Behavior

If an AI service fails:

The system must not assume success.

If receipt analysis fails:

Payment remains PENDING or REVIEW_REQUIRED.

If payment evidence is ambiguous:

Payment remains REVIEW_REQUIRED.

If the database fails during a transaction:

The system must avoid creating uncertain financial state.

If a webhook is received multiple times:

The system must safely deduplicate it.

---



## 16. Customer Privacy

Only information required to operate the service should be collected.

The system should minimize:

- personal information
- payment-related information
- stored conversation data
- uploaded files

Data retention requirements should be defined before production launch.

---



## 17. Security Testing

Before production launch, the system must test:

- unauthorized access
- cross-merchant access
- authentication failures
- webhook replay
- duplicate events
- malicious file uploads
- prompt injection
- API abuse
- invalid payment receipts
- duplicate payment references
- incorrect payment amounts
- AI hallucination
- external API failures

---



## 18. Security Review Status

Status:

Initial security policy

Last updated:

2026-08-12



## Environment and Secret Management

The application must never store real credentials or secrets in Git.

### Local development

Developers use:

- `.env` for local secret/configuration values.

- `.env.example` as the safe template committed to Git.

The `.env` file is ignored by Git.

### Required rule

Never commit:

- AI provider API keys

- Telegram bot tokens

- TikTok client secrets

- webhook secrets

- database credentials

- session secrets

- payment-provider credentials

- private keys

### Verification

The repository must remain safe when a developer runs:

```bash

git add .