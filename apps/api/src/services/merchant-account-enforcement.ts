import {
  MerchantAccountStatus,
  prisma
} from "@ethio-commerce/database";

import {
  applyMerchantAccountStatusTransition
} from "../domain/merchant-account-state.js";

export type TransitionMerchantAccountStatusInput = {
  merchantId: string;
  nextStatus: MerchantAccountStatus;
  reason: string;
  actorPlatformUserId: string;
};

export async function transitionMerchantAccountStatus(
  input: TransitionMerchantAccountStatusInput
) {
  const {
    merchantId,
    nextStatus,
    reason,
    actorPlatformUserId
  } = input;

  const normalizedReason =
    reason.trim();

  if (!normalizedReason) {
    throw new Error(
      "Merchant account status change reason is required"
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const merchant =
        await tx.merchant.findUnique({
          where: {
            id: merchantId
          }
        });

      if (!merchant) {
        throw new Error(
          "Merchant not found"
        );
      }

      const previousStatus =
        merchant.accountStatus;

      const resolvedNextStatus =
        applyMerchantAccountStatusTransition(
          previousStatus,
          nextStatus
        );

      const accountSuspendedAt =
        resolvedNextStatus ===
        MerchantAccountStatus.SUSPENDED
          ? new Date()
          : null;

      const claim =
        await tx.merchant.updateMany({
          where: {
            id: merchantId,
            accountStatus:
              previousStatus
          },
          data: {
            accountStatus:
              resolvedNextStatus,
            accountSuspensionReason:
              resolvedNextStatus ===
              MerchantAccountStatus.SUSPENDED
                ? normalizedReason
                : null,
            accountSuspendedAt
          }
        });

      if (claim.count !== 1) {
        throw new Error(
          "Merchant account status changed concurrently"
        );
      }

      const updatedMerchant =
        await tx.merchant.findUnique({
          where: {
            id: merchantId
          }
        });

      if (!updatedMerchant) {
        throw new Error(
          "Merchant not found after account status transition"
        );
      }

      await tx.platformAuditLog.create({
        data: {
          actorPlatformUserId,
          merchantId,
          action:
            "MERCHANT_ACCOUNT_STATUS_CHANGED",
          entityType:
            "MERCHANT",
          entityId:
            updatedMerchant.id,
          metadata: {
            previousStatus,
            nextStatus:
              updatedMerchant.accountStatus,
            reason:
              normalizedReason
          }
        }
      });

      return updatedMerchant;
    }
  );
}
