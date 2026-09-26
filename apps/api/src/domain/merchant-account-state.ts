import {
  MerchantAccountStatus
} from "@ethio-commerce/database";

export type MerchantAccountState =
  MerchantAccountStatus;

const allowedTransitions: Record<
  MerchantAccountState,
  readonly MerchantAccountState[]
> = {
  [MerchantAccountStatus.ACTIVE]: [
    MerchantAccountStatus.SUSPENDED
  ],

  [MerchantAccountStatus.SUSPENDED]: [
    MerchantAccountStatus.ACTIVE
  ]
};

export function applyMerchantAccountStatusTransition(
  currentStatus: MerchantAccountState,
  nextStatus: MerchantAccountState
): MerchantAccountState {
  if (currentStatus === nextStatus) {
    throw new Error(
      `Merchant account is already ${currentStatus}`
    );
  }

  const allowed =
    allowedTransitions[currentStatus];

  if (!allowed.includes(nextStatus)) {
    throw new Error(
      `Merchant account cannot move from ${currentStatus} to ${nextStatus}`
    );
  }

  return nextStatus;
}
