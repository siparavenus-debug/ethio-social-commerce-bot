import {
    MerchantSubscriptionStatus
  } from "@ethio-commerce/database";

  export type SubscriptionStatus =
    MerchantSubscriptionStatus;

  const allowedTransitions: Record<
    SubscriptionStatus,
    readonly SubscriptionStatus[]
  > = {
    [MerchantSubscriptionStatus.TRIAL]: [
      MerchantSubscriptionStatus.ACTIVE,
      MerchantSubscriptionStatus.CANCELLED
    ],

    [MerchantSubscriptionStatus.ACTIVE]: [
      MerchantSubscriptionStatus.PAST_DUE,
      MerchantSubscriptionStatus.CANCELLED
    ],

    [MerchantSubscriptionStatus.PAST_DUE]: [
      MerchantSubscriptionStatus.ACTIVE,
      MerchantSubscriptionStatus.SUSPENDED,
      MerchantSubscriptionStatus.CANCELLED
    ],

    [MerchantSubscriptionStatus.SUSPENDED]: [
      MerchantSubscriptionStatus.ACTIVE,
      MerchantSubscriptionStatus.CANCELLED
    ],

    [MerchantSubscriptionStatus.CANCELLED]: []
  };

  export function applySubscriptionStatusTransition(
    currentStatus: SubscriptionStatus,
    nextStatus: SubscriptionStatus
  ): SubscriptionStatus {
    if (currentStatus === nextStatus) {
      throw new Error(
        `Subscription is already ${currentStatus}`
      );
    }

    const allowed =
      allowedTransitions[currentStatus];

    if (!allowed.includes(nextStatus)) {
      throw new Error(
        `Subscription cannot move from ${currentStatus} to ${nextStatus}`
      );
    }

    return nextStatus;
  }
