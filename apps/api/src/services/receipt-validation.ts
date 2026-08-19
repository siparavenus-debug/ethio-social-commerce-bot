import type { ReceiptExtraction } from "./receipt-vision.js";

export type ReceiptValidationResult = {
  status:
    | "MATCH"
    | "MISMATCH"
    | "REVIEW_REQUIRED";

  amountMatches: boolean;
  currencyMatches: boolean;
  providerMatches: boolean;
  referencePresent: boolean;

  reasons: string[];
};

type ValidateReceiptInput = {
  receipt: ReceiptExtraction;

  expectedAmount: number;
  expectedCurrency: string;
  expectedProvider: string;
};

/**
 * Normalize provider names coming from:
 *
 * - Prisma
 * - merchant payment methods
 * - Gemini receipt extraction
 *
 * Examples:
 *
 * Telebirr
 * TELEBIRR
 * telebirr
 *
 * -> TELEBIRR
 *
 * CBE Birr
 * CBE_BIRR
 * Commercial Bank of Ethiopia
 * Commercial Bank of Ethiopia Birr
 *
 * -> CBE_BIRR
 */
export function normalizeProvider(
  provider: string | null
): string | null {
  if (!provider) {
    return null;
  }

  const value =
    provider
      .trim()
      .toUpperCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");

  /*
   * Telebirr
   */
  if (
    value.includes("TELEBIRR")
  ) {
    return "TELEBIRR";
  }

  /*
   * Commercial Bank of Ethiopia /
   * CBE / CBE Birr
   */
  if (
    value.includes(
      "COMMERCIAL BANK OF ETHIOPIA"
    ) ||
    value === "CBE" ||
    value.includes("CBE BIRR")
  ) {
    return "CBE_BIRR";
  }

  /*
   * Other is a valid configured
   * payment provider.
   */
  if (value === "OTHER") {
    return "OTHER";
  }

  return value.replace(
    /\s+/g,
    "_"
  );
}

export function validateReceipt({
  receipt,
  expectedAmount,
  expectedCurrency,
  expectedProvider
}: ValidateReceiptInput): ReceiptValidationResult {
  const reasons: string[] = [];

  /*
   * ---------------------------------------------
   * AMOUNT
   * ---------------------------------------------
   */
  const amountMatches =
    receipt.amount !== null &&
    receipt.amount !== undefined &&
    Number.isFinite(receipt.amount) &&
    Math.abs(
      receipt.amount - expectedAmount
    ) < 0.01;

  /*
   * ---------------------------------------------
   * CURRENCY
   * ---------------------------------------------
   */
  const currencyMatches =
    receipt.currency !== null &&
    receipt.currency !== undefined &&
    receipt.currency.trim().toUpperCase() ===
      expectedCurrency.trim().toUpperCase();

  /*
   * ---------------------------------------------
   * PROVIDER
   * ---------------------------------------------
   */
  const normalizedReceiptProvider =
    normalizeProvider(
      receipt.provider
    );

  const normalizedExpectedProvider =
    normalizeProvider(
      expectedProvider
    );

  const providerMatches =
    normalizedReceiptProvider !== null &&
    normalizedExpectedProvider !== null &&
    normalizedReceiptProvider ===
      normalizedExpectedProvider;

  /*
   * ---------------------------------------------
   * TRANSACTION REFERENCE
   * ---------------------------------------------
   */
  const referencePresent =
    Boolean(
      receipt.transactionReference?.trim()
    );

  /*
   * ---------------------------------------------
   * REASONS
   * ---------------------------------------------
   */
  if (!amountMatches) {
    reasons.push(
      `Amount mismatch: expected ${expectedAmount}, received ${receipt.amount ?? "unknown"}`
    );
  }

  if (!currencyMatches) {
    reasons.push(
      `Currency mismatch: expected ${expectedCurrency}, received ${receipt.currency ?? "unknown"}`
    );
  }

  if (!providerMatches) {
    reasons.push(
      `Provider mismatch: expected ${expectedProvider}, received ${receipt.provider ?? "unknown"}`
    );
  }

  if (!referencePresent) {
    reasons.push(
      "Transaction reference was not detected"
    );
  }

  /*
   * ---------------------------------------------
   * SAFE MATCH
   * ---------------------------------------------
   *
   * MATCH means the extracted evidence agrees
   * with the expected payment.
   *
   * It does NOT mean the payment is verified.
   *
   * Merchant verification remains mandatory.
   */
  if (
    amountMatches &&
    currencyMatches &&
    providerMatches &&
    referencePresent
  ) {
    return {
      status: "MATCH",
      amountMatches,
      currencyMatches,
      providerMatches,
      referencePresent,
      reasons
    };
  }

  /*
   * ---------------------------------------------
   * REVIEW REQUIRED
   * ---------------------------------------------
   *
   * Missing or uncertain information is never
   * automatically treated as fraud or rejection.
   */
  if (
    receipt.confidence < 0.8 ||
    receipt.amount === null ||
    receipt.amount === undefined ||
    receipt.currency === null ||
    receipt.provider === null ||
    receipt.transactionReference === null ||
    receipt.transactionReference === undefined
  ) {
    return {
      status: "REVIEW_REQUIRED",
      amountMatches,
      currencyMatches,
      providerMatches,
      referencePresent,
      reasons
    };
  }

  /*
   * ---------------------------------------------
   * MISMATCH
   * ---------------------------------------------
   */
  return {
    status: "MISMATCH",
    amountMatches,
    currencyMatches,
    providerMatches,
    referencePresent,
    reasons
  };
}