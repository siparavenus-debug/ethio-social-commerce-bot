import { describe, expect, it } from "vitest";
import {
  applyPaymentReview,
  type PaymentReviewState
} from "../src/domain/payment-state.js";

const reviewState: PaymentReviewState = {
  paymentStatus: "REVIEW_REQUIRED",
  orderStatus: "PAYMENT_REVIEW"
};

describe("payment review state machine", () => {
  it("moves a reviewed payment to VERIFIED and the order to PAID", () => {
    const result = applyPaymentReview(
      reviewState,
      "VERIFY"
    );

    expect(result).toEqual({
      paymentStatus: "VERIFIED",
      orderStatus: "PAID"
    });
  });

  it("moves a rejected payment to REJECTED and the order back to PENDING_PAYMENT", () => {
    const result = applyPaymentReview(
      reviewState,
      "REJECT"
    );

    expect(result).toEqual({
      paymentStatus: "REJECTED",
      orderStatus: "PENDING_PAYMENT"
    });
  });

  it("does not allow verification of an already verified payment", () => {
    expect(() =>
      applyPaymentReview(
        {
          paymentStatus: "VERIFIED",
          orderStatus: "PAID"
        },
        "VERIFY"
      )
    ).toThrow(
      "Payment cannot be verified because its current status is VERIFIED"
    );
  });

  it("does not allow review when the order is not in PAYMENT_REVIEW", () => {
    expect(() =>
      applyPaymentReview(
        {
          paymentStatus: "REVIEW_REQUIRED",
          orderStatus: "PAID"
        },
        "VERIFY"
      )
    ).toThrow(
      "Order cannot be updated because its current status is PAID"
    );
  });
});