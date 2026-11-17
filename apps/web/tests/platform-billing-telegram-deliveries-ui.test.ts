import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/PlatformApp.tsx", import.meta.url),
  "utf8"
);

describe("platform billing Telegram deliveries UI contract", () => {
  it("defines a separate delivery view", () => {
    expect(source).toContain(
      '"Billing Telegram Deliveries"'
    );
    expect(source).toContain(
      "Billing Telegram Notification Deliveries"
    );
  });

  it("restricts navigation to non-STAFF platform operators", () => {
    expect(source).toMatch(
      /user\.role !== "STAFF"[\s\S]*?\["Billing Telegram Deliveries" as View\]/
    );
  });

  it("uses the authenticated read-only delivery endpoint", () => {
    expect(source).toContain(
      "/billing/telegram/deliveries?"
    );
    expect(source).toContain(
      "platformRequest<BillingTelegramDeliveryPage>"
    );
  });

  it("supports all delivery statuses", () => {
    for (const status of [
      "ALL",
      "REVIEW_REQUIRED",
      "PENDING",
      "PROCESSING",
      "SENDING",
      "SENT",
      "FAILED",
      "SUPPRESSED"
    ]) {
      expect(source).toContain(`"${status}"`);
    }
  });

  it("supports merchant filtering and cursor pagination", () => {
    expect(source).toMatch(
      /query\.set\(\s*"merchantId"\s*,\s*billingTelegramMerchantId\.trim\(\)\s*\)/
    );
    expect(source).toContain(
      'query.set("cursor", billingTelegramCursor)'
    );
    expect(source).toContain(
      "setBillingTelegramCursor(null)"
    );
    expect(source).toContain(
      "setBillingTelegramNextCursor(result.nextCursor)"
    );
  });

  it("uses an explicit privacy-safe table projection", () => {
    expect(source).toContain(
      "rows={billingTelegramDeliveries.map(delivery => ({"
    );

    const start = source.indexOf(
      "rows={billingTelegramDeliveries.map(delivery => ({"
    );
    const end = source.indexOf(
      "columns={[",
      start
    );

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const projection = source.slice(start, end);

    for (const forbidden of [
      "telegramMessageId",
      "telegramUserId",
      "chatId",
      "botToken",
      "sanitizedError",
      "terminalReason",
      "quarantineReason"
    ]) {
      expect(projection).not.toContain(forbidden);
    }
  });

  it("explains delivery acceptance and investigation", () => {
    expect(source).toContain(
      "acceptance, not confirmed human receipt"
    );
    expect(source).toContain(
      "not automatically safe to retry"
    );
  });

  it("shows attempt timing for operational investigation", () => {
    expect(source).toContain(
      "attempt.requestStartedAt"
    );
    expect(source).toContain(
      "attempt.responseReceivedAt"
    );
  });
});