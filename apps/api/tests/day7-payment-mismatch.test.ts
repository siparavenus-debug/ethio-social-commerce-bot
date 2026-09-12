import { describe, expect, it } from "vitest";
import type { ReceiptExtraction } from "../src/services/receipt-vision.js";
import { validateReceipt } from "../src/services/receipt-validation.js";

function makeReceipt(
  overrides: Partial<ReceiptExtraction> = {},
): ReceiptExtraction {
  return {
    provider: "Telebirr",
    transactionReference: "TXN-A",
    amount: 500,
    currency: "ETB",
    transactionDate: "2026-09-01",
    transactionTime: "12:00:00",
    senderName: "Test Customer",
    senderAccount: "0912345678",
    confidence: 0.95,
    ...overrides,
  };
}

const expectedPayment = {
  expectedAmount: 500,
  expectedCurrency: "ETB",
  expectedProvider: "Telebirr",
  expectedReference: "TXN-A",
};

describe("Day 7 - payment mismatch suite", () => {
  it("flags an amount mismatch", () => {
    const result = validateReceipt({
      ...expectedPayment,
      receipt: makeReceipt({
        amount: 450,
      }),
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.amountMatches).toBe(false);
    expect(result.currencyMatches).toBe(true);
    expect(result.providerMatches).toBe(true);
    expect(result.referenceMatches).toBe(true);
    expect(result.reasons).toContain(
      "Amount mismatch: expected 500, received 450",
    );
  });

  it("flags a provider mismatch", () => {
    const result = validateReceipt({
      ...expectedPayment,
      receipt: makeReceipt({
        provider: "CBE Birr",
      }),
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.amountMatches).toBe(true);
    expect(result.currencyMatches).toBe(true);
    expect(result.providerMatches).toBe(false);
    expect(result.referenceMatches).toBe(true);
    expect(result.reasons).toContain(
      "Provider mismatch: expected Telebirr, received CBE Birr",
    );
  });

  it("flags a currency mismatch", () => {
    const result = validateReceipt({
      ...expectedPayment,
      receipt: makeReceipt({
        currency: "USD",
      }),
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.amountMatches).toBe(true);
    expect(result.currencyMatches).toBe(false);
    expect(result.providerMatches).toBe(true);
    expect(result.referenceMatches).toBe(true);
    expect(result.reasons).toContain(
      "Currency mismatch: expected ETB, received USD",
    );
  });

  it("flags a transaction reference mismatch", () => {
    const result = validateReceipt({
      ...expectedPayment,
      receipt: makeReceipt({
        transactionReference: "TXN-B",
      }),
    });

    expect(result.status).toBe("MISMATCH");
    expect(result.amountMatches).toBe(true);
    expect(result.currencyMatches).toBe(true);
    expect(result.providerMatches).toBe(true);
    expect(result.referencePresent).toBe(true);
    expect(result.referenceMatches).toBe(false);
    expect(result.reasons).toContain(
      "Transaction reference mismatch: expected TXN-A, received TXN-B",
    );
  });

  it("returns MATCH when all payment evidence matches", () => {
    const result = validateReceipt({
      ...expectedPayment,
      receipt: makeReceipt(),
    });

    expect(result.status).toBe("MATCH");
    expect(result.amountMatches).toBe(true);
    expect(result.currencyMatches).toBe(true);
    expect(result.providerMatches).toBe(true);
    expect(result.referencePresent).toBe(true);
    expect(result.referenceMatches).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("returns REVIEW_REQUIRED when the transaction reference is missing", () => {
    const result = validateReceipt({
      ...expectedPayment,
      receipt: makeReceipt({
        transactionReference: null,
      }),
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.referencePresent).toBe(false);
    expect(result.referenceMatches).toBe(false);
    expect(result.reasons).toContain(
      "Transaction reference was not detected",
    );
  });
});
