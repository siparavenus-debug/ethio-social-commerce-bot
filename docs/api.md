# Ethio Social Commerce — API

## 1. API Purpose

The API is the controlled interface between the web dashboard, Telegram,

TikTok integrations, AI services, database, and commerce logic.

All business rules must be enforced by the backend.

Clients must not be trusted to determine:

- merchant ownership

- payment status

- order totals

- authorization

- financial state

---

## 2. Base URLs

### Development

[http://localhost:3000](http://localhost:3000)

### Production

TBD

---

## 3. API Conventions

All API endpoints should:

- validate incoming data

- authenticate protected requests

- enforce authorization

- return predictable responses

- avoid exposing secrets

- avoid exposing unnecessary personal information

- return appropriate HTTP status codes

---

## 4. Authentication

Protected endpoints require an authenticated merchant session.

Authentication implementation:

TBD

The backend must identify the authenticated merchant from the authenticated

session rather than accepting a client-provided merchant ID as proof of

ownership.

---

# 5. Merchant API

## GET /api/merchant

Returns the authenticated merchant's profile.

### Authentication

Required.

### Response

TBD

---

## PATCH /api/merchant

Updates merchant settings.

### Authentication

Required.

### Request

TBD

### Response

TBD

---

# 6. Product API

## GET /api/products

Returns products belonging to the authenticated merchant.

### Authentication

Required.

### Query parameters

Potential parameters:

- search

- status

- page

- limit

### Response

TBD

---

## POST /api/products

Creates a product.

### Authentication

Required.

### Request

Potential fields:

- name

- description

- price

- currency

- stock

- status

- images

### Validation

The backend must validate:

- product name

- price

- stock

- currency

- required fields

### Response

TBD

---

## GET /api/products/:id

Returns a specific product belonging to the authenticated merchant.

### Authentication

Required.

### Authorization

The product must belong to the authenticated merchant.

---

## PATCH /api/products/:id

Updates a product.

### Authentication

Required.

### Authorization

The product must belong to the authenticated merchant.

---

## DELETE /api/products/:id

Deactivates or deletes a product according to the final product lifecycle

design.

### Authentication

Required.

### Authorization

The product must belong to the authenticated merchant.

---

# 7. Customer API

## GET /api/customers

Returns customers belonging to the authenticated merchant.

### Authentication

Required.

### Query parameters

Potential parameters:

- search

- page

- limit

---

## GET /api/customers/:id

Returns a specific customer belonging to the authenticated merchant.

### Authentication

Required.

### Authorization

The customer must belong to the authenticated merchant.

---

# 8. Order API

## GET /api/orders

Returns orders belonging to the authenticated merchant.

### Authentication

Required.

### Query parameters

Potential parameters:

- status

- payment_status

- date_from

- date_to

- page

- limit

---

## POST /api/orders

Creates an order.

### Authentication

Required for dashboard-created orders.

Orders created through approved customer channels may use controlled

server-side workflows.

### Important rules

The backend must calculate the authoritative order total.

The client must not be trusted to provide the final financial total.

---

## GET /api/orders/:id

Returns an order belonging to the authenticated merchant.

### Authentication

Required.

### Authorization

The order must belong to the authenticated merchant.

---

## PATCH /api/orders/:id

Updates an order according to permitted order-state transitions.

### Authentication

Required.

### Authorization

The order must belong to the authenticated merchant.

---

# 9. Payment API

## GET /api/payments

Returns payment records belonging to the authenticated merchant.

### Authentication

Required.

---

## POST /api/payments/:id/receipt

Associates a customer receipt submission with a payment.

### Authentication

Controlled customer workflow.

### Security

Uploaded files must be validated before processing.

---

## POST /api/payments/:id/review

Creates a merchant review action.

### Authentication

Required.

### Authorization

The payment must belong to the authenticated merchant.

### Important rule

AI must not be treated as the final payment authority.

---

## GET /api/payments/:id

Returns a payment record belonging to the authenticated merchant.

### Authentication

Required.

---

# 10. Telegram Webhook API

## POST /api/webhooks/telegram

Receives Telegram bot events.

### Authentication

Provider/webhook verification as supported by Telegram and the deployment

architecture.

### Processing

The endpoint should:

1. Validate the incoming event.

2. Identify the relevant conversation.

3. Deduplicate the event.

4. Persist the message.

5. Process the message.

6. Generate an appropriate response.

7. Send the response through Telegram.

Webhook processing must be idempotent.

Current local route: `POST /webhooks/telegram`. Configure `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_MERCHANT_ID`; Telegram must send the
secret in the `X-Telegram-Bot-Api-Secret-Token` header. Text messages create or
update the Telegram customer and conversation, persist inbound/outbound messages,
and receive a default acknowledgement. Non-text updates are acknowledged and ignored.

---

# 11. TikTok Webhook API

## POST /api/webhooks/tiktok

Receives supported TikTok events.

### Important rule

Only TikTok capabilities explicitly permitted by the current official

developer platform documentation may be implemented.

### Processing

The endpoint should:

1. Validate the event.

2. Verify authenticity where supported.

3. Deduplicate the event.

4. Identify the relevant merchant.

5. Create/update the lead.

6. Trigger the permitted lead-routing workflow.

---

# 12. AI Internal Tools

AI services must not have unrestricted API access.

AI should interact with the application through explicitly defined tools.

Potential tools include:

### search_products

Searches the merchant's available product catalog.

### get_product

Returns information about a specific product.

### create_order

Creates an order only after required information has been collected and

validated.

### get_order_status

Returns the status of an authorized order.

### request_payment

Provides approved payment instructions.

### submit_receipt

Accepts a customer receipt submission through the controlled workflow.

AI tool permissions must be enforced by the backend.

---

# 13. Error Format

API errors should use a consistent structure.

Example:

{

  "error": {

    "code": "ERROR_CODE",

    "message": "Human-readable message"

  }

}

Error responses must not expose:

- stack traces

- API keys

- database credentials

- internal secrets

- unnecessary implementation details

---

# 14. HTTP Status Codes

The API should use standard HTTP status codes.

Examples:

- 200 — successful request

- 201 — resource created

- 400 — invalid request

- 401 — authentication required

- 403 — insufficient permission

- 404 — resource not found

- 409 — conflict

- 422 — validation failure

- 429 — rate limit exceeded

- 500 — unexpected server error

- 503 — temporary service unavailable

---

# 15. API Versioning

Initial version:

TBD

The API should have a clear versioning strategy before production launch.

---

# 16. Idempotency

Operations that may be retried must be designed to prevent duplicate business

effects.

Important examples:

- webhook processing

- order creation

- payment receipt processing

- external API callbacks

Idempotency strategy:

TBD

---

# 17. Current Status

Status:

Initial API contract

Last updated:

2026-08-12
