# Platform Admin Dashboard

Open http://localhost:5173/platform while the usual API and Vite web servers are running. The existing merchant dashboard remains at http://localhost:5173/.

Run the web server from the repository root with `npm run dev --workspace @ethio-commerce/web`. The platform client uses the existing `VITE_API_BASE_URL` setting, defaulting to http://localhost:3000.

Sign in with an existing PlatformUser account. Merchant OWNER, ADMIN and STAFF credentials do not grant platform access. If an operator account is needed, use the existing interactive provisioning command: `npm run platform-auth:create-user --workspace @ethio-commerce/api`. No public platform registration was added.

The platform token is held in tab session storage under `ethio-commerce-platform-token`, separate from merchant authentication. Session restoration validates `/platform/auth/me`; authenticated 401 responses clear the platform session. Sign out clears only platform state. A network error can be retried without deleting merchant credentials.

## Available operations

- Merchants: create new merchants with their initial OWNER account, search and inspect existing merchants, initialize subscriptions, and request allowed status transitions.
- Plans: create, edit, activate and deactivate plans. Price and commission values are passed as decimal strings; historical subscription snapshots remain controlled by the existing services.
- Invoices: view persisted history, generate DRAFT invoices with explicit periods and optional subscription charges, and open DRAFT invoices.
- Commissions: inspect the existing ledger, net amounts and adjustment details. The existing platform API exposes no commission mutation route.
- Settlements: inspect evidence and transaction references, open HTTP(S) receipt links, and verify or reject REVIEW_REQUIRED settlements with a review note. The server enforces the OPEN invoice requirement and all financial transitions.
- Overdue and revenue: display the server's OVERDUE and PAID invoice records respectively, retaining each record's currency and persisted totals.
- Audit: inspect the latest 100 entries and full metadata.

Dates entered in forms use the browser's local timezone and are sent as ISO timestamps. Mutation forms provide a review step; the backend remains authoritative. The UI adds no plan reassignment, ledger mutation, recalculation, or automatic overdue policy.

## Files and verification

Only `apps/web/src/main.tsx` is changed among existing source files. `PlatformApp.tsx`, `platform-api.ts` and `platform.css` are new. The merchant `App.tsx`, all API source files, and the database schema are untouched by this change.

Web build: `npm run build --workspace @ethio-commerce/web`.

Focused client tests: `node node_modules/vitest/vitest.mjs run apps/web/tests/platform-api.test.ts --config apps/web/vite.config.ts`.

API regression tests: `npm run test --workspace @ethio-commerce/api -- --no-file-parallelism`. The initial parallel run passed 332/334; invoice generation encountered TransactionWriteConflict and a settlement route returned 500. The sequential rerun passed all 334 tests across 46 files without backend changes.

Browser smoke check verified the platform login surface. Authenticated administration requires an operator account and was not exercised in the browser.

For production hosting, configure SPA fallback to `index.html` for `/platform` and nested paths, as with other client-side routes.
