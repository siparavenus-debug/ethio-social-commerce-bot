import { describe, expect, it } from "vitest";
import {
  extractReceipt
} from "../src/services/receipt-vision.js";
import {
  validateReceipt
} from "../src/services/receipt-validation.js";

function makeReceipt(
  overrides: Partial<
    Awaited<ReturnType<typeof extractReceipt>>
  > = {},
) {
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

describe("Day 8 - receipt quality and safety", () => {
  describe("receipt image boundary", () => {
    it("rejects an empty buffer", async () => {
      await expect(
        extractReceipt(
          Buffer.alloc(0),
          "image/jpeg",
        ),
      ).rejects.toThrow(
        "Receipt image is empty",
      );
    });

    it("rejects an oversized buffer", async () => {
      const image = Buffer.alloc(
        5 * 1024 * 1024 + 1,
      );

      await expect(
        extractReceipt(
          image,
          "image/jpeg",
        ),
      ).rejects.toThrow(
        "Receipt image exceeds the maximum allowed size",
      );
    });

    it("rejects unsupported MIME types", async () => {
      const image = Buffer.from(
        "not an image",
      );

      await expect(
        extractReceipt(
          image,
          "application/pdf",
        ),
      ).rejects.toThrow(
        "Unsupported receipt image type",
      );
    });

    it("rejects content that does not match the declared JPEG type", async () => {
      const image = Buffer.from(
        "this is not a jpeg",
      );

      await expect(
        extractReceipt(
          image,
          "image/jpeg",
        ),
      ).rejects.toThrow(
        "Receipt image content does not match the declared image type",
      );
    });

    it("rejects content that does not match the declared PNG type", async () => {
      const image = Buffer.from(
        "this is not a png",
      );

      await expect(
        extractReceipt(
          image,
          "image/png",
        ),
      ).rejects.toThrow(
        "Receipt image content does not match the declared image type",
      );
    });

    it("rejects content that does not match the declared WebP type", async () => {
      const image = Buffer.from(
        "this is not a webp",
      );

      await expect(
        extractReceipt(
          image,
          "image/webp",
        ),
      ).rejects.toThrow(
        "Receipt image content does not match the declared image type",
      );
    });
  });

  describe("deterministic receipt validation", () => {
    it("requires review when the amount is missing", () => {
      const result = validateReceipt({
        ...expectedPayment,
        receipt: makeReceipt({
          amount: null,
        }),
      });

      expect(result.status).toBe(
        "REVIEW_REQUIRED",
      );
      expect(result.amountMatches).toBe(false);
    });

    it("requires review when the currency is missing", () => {
      const result = validateReceipt({
        ...expectedPayment,
        receipt: makeReceipt({
          currency: null,
        }),
      });

      expect(result.status).toBe(
        "REVIEW_REQUIRED",
      );
      expect(result.currencyMatches).toBe(false);
    });

    it("requires review when the provider is missing", () => {
      const result = validateReceipt({
        ...expectedPayment,
        receipt: makeReceipt({
          provider: null,
        }),
      });

      expect(result.status).toBe(
        "REVIEW_REQUIRED",
      );
      expect(result.providerMatches).toBe(false);
    });

    it("requires review when confidence is low", () => {
      const result = validateReceipt({
        ...expectedPayment,
        receipt: makeReceipt({
          confidence: 0.79,
        }),
      });

      expect(result.status).toBe(
        "REVIEW_REQUIRED",
      );
    });

    it("requires review when multiple critical fields are missing", () => {
      const result = validateReceipt({
        ...expectedPayment,
        receipt: makeReceipt({
          amount: null,
          provider: null,
          transactionReference: null,
          confidence: 0.4,
        }),
      });

      expect(result.status).toBe(
        "REVIEW_REQUIRED",
      );
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          "Amount mismatch: expected 500, received unknown",
          "Provider mismatch: expected Telebirr, received unknown",
          "Transaction reference was not detected",
        ]),
      );
    });

    it("keeps a complete conflicting receipt as MISMATCH evidence", () => {
      const result = validateReceipt({
        ...expectedPayment,
        receipt: makeReceipt({
          amount: 450,
        }),
      });

      expect(result.status).toBe(
        "MISMATCH",
      );
      expect(result.amountMatches).toBe(false);
    });

    it("returns MATCH only when all critical payment evidence matches", () => {
      const result = validateReceipt({
        ...expectedPayment,
        receipt: makeReceipt(),
      });

      expect(result.status).toBe(
        "MATCH",
      );
    });
  });
});