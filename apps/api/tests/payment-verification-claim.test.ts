import { describe, expect, it } from "vitest";

type PaymentStatus =
  | "PENDING"
  | "REVIEW_REQUIRED"
  | "VERIFIED"
  | "REJECTED"
  | "DUPLICATE";

type Payment = {
  id: string;
  merchantId: string;
  status: PaymentStatus;
};

/*
 * This test models the important concurrency rule used by
 * payment verification:
 *
 * A payment can only be claimed when its current status is
 * REVIEW_REQUIRED.
 *
 * Once one verification attempt changes it to VERIFIED,
 * another verification attempt must not be able to claim it.
 */
function claimPayment(
  payment: Payment,
  merchantId: string
): boolean {
  if (
    payment.merchantId !== merchantId ||
    payment.status !== "REVIEW_REQUIRED"
  ) {
    return false;
  }

  payment.status = "VERIFIED";
  return true;
}

describe("payment verification claim", () => {
  it("allows the first verification attempt to claim the payment", () => {
    const payment: Payment = {
      id: "payment-1",
      merchantId: "merchant-1",
      status: "REVIEW_REQUIRED"
    };

    const claimed = claimPayment(
      payment,
      "merchant-1"
    );

    expect(claimed).toBe(true);
    expect(payment.status).toBe("VERIFIED");
  });

  it("prevents a second verification attempt from claiming the same payment", () => {
    const payment: Payment = {
      id: "payment-1",
      merchantId: "merchant-1",
      status: "REVIEW_REQUIRED"
    };

    const firstClaim = claimPayment(
      payment,
      "merchant-1"
    );

    const secondClaim = claimPayment(
      payment,
      "merchant-1"
    );

    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);
    expect(payment.status).toBe("VERIFIED");
  });

  it("prevents a merchant from claiming another merchant's payment", () => {
    const payment: Payment = {
      id: "payment-1",
      merchantId: "merchant-1",
      status: "REVIEW_REQUIRED"
    };

    const claimed = claimPayment(
      payment,
      "merchant-2"
    );

    expect(claimed).toBe(false);
    expect(payment.status).toBe("REVIEW_REQUIRED");
  });
});