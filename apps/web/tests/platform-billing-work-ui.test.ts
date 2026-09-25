import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform billing work UI contract", () => {
  it("exposes the four operational billing queues", () => {
    expect(appSource).toContain(
      '"Billing Work"'
    );
    expect(appSource).toContain(
      '"Draft Invoices"'
    );
    expect(appSource).toContain(
      '"Awaiting Payment"'
    );
    expect(appSource).toContain(
      '"Payment Review"'
    );
    expect(appSource).toContain(
      '"Resolved"'
    );
  });

  it("uses the dedicated billing work read endpoints", () => {
    expect(appSource).toContain(
      'path: "/billing/invoices/draft"'
    );
    expect(appSource).toContain(
      'path: "/billing/invoices/awaiting-payment"'
    );
    expect(appSource).toContain(
      'path: "/billing/settlements/review"'
    );
    expect(appSource).toContain(
      'path: "/billing/settlements/resolved"'
    );
  });

  it("opens draft invoices through the existing merchant-scoped lifecycle endpoint", () => {
    expect(appSource).toContain(
      'billingWorkTab !== "draft"'
    );
    expect(appSource).toContain(
      'r.status !== "DRAFT"'
    );
    expect(appSource).toContain(
      "billing/invoices/${encodeURIComponent("
    );
    expect(appSource).toContain(
      ')}/open`'
    );
  });

  it("limits settlement decisions to the payment review queue", () => {
    expect(appSource).toContain(
      'billingWorkTab === "review"'
    );
    expect(appSource).toContain(
      'r.status ==='
    );
    expect(appSource).toContain(
      '"REVIEW_REQUIRED"'
    );
    expect(appSource).toContain(
      '["verify", "reject"].map('
    );
  });

  it("uses the settlement merchant identity for global evidence and review actions", () => {
    expect(appSource).toContain(
      "rowMerchantId(settlement) || selected"
    );
    expect(appSource).toContain(
      "const merchantId ="
    );
    expect(appSource).toContain(
      "rowMerchantId(r);"
    );
  });

  it("presents merchant and invoice identifiers without replacing authoritative row data", () => {
    expect(appSource).toContain(
      "function billingWorkRows("
    );
    expect(appSource).toContain(
      "...row,"
    );
    expect(appSource).toContain(
      "merchantName,"
    );
    expect(appSource).toContain(
      "invoiceNumber"
    );
    expect(appSource).toContain(
      "rows={billingWorkRows(rows)}"
    );
  });
});