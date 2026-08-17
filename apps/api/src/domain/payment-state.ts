export type PaymentReviewAction = "VERIFY" | "REJECT";

export type PaymentReviewState = {
  paymentStatus:
    | "PENDING"
    | "REVIEW_REQUIRED"
    | "VERIFIED"
    | "REJECTED"
    | "DUPLICATE";

  orderStatus:
    | "DRAFT"
    | "PENDING_PAYMENT"
    | "PAYMENT_REVIEW"
    | "PAID"
    | "FULFILLING"
    | "FULFILLED"
    | "CANCELLED";
};

export function applyPaymentReview(
  state: PaymentReviewState,
  action: PaymentReviewAction
): PaymentReviewState {
  if (state.paymentStatus !== "REVIEW_REQUIRED") {
    const actionText =
      action === "VERIFY"
        ? "verified"
        : "rejected";

    throw new Error(
      `Payment cannot be ${actionText} because its current status is ${state.paymentStatus}`
    );
  }

  if (state.orderStatus !== "PAYMENT_REVIEW") {
    throw new Error(
      `Order cannot be updated because its current status is ${state.orderStatus}`
    );
  }

  if (action === "VERIFY") {
    return {
      paymentStatus: "VERIFIED",
      orderStatus: "PAID"
    };
  }

  return {
    paymentStatus: "REJECTED",
    orderStatus: "PENDING_PAYMENT"
  };
}