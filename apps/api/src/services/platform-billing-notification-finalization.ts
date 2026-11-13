import {
  Prisma,
  prisma
} from "@ethio-commerce/database";

import {
  lockPlatformBillingMerchant
} from "./platform-billing-merchant-lock.js";

import type {
  BillingTelegramOutcome
} from "./platform-billing-notification-outcome.js";

export type BillingFinalizationResult =
  | {
      finalized: true;
      disposition: "SENT" | "FAILED" | "REVIEW_REQUIRED";
    }
  | {
      finalized: false;
      reason: string;
    };

export async function finalizePlatformBillingNotification(
  deliveryId: string,
  claimId: string,
  attemptId: string,
  outcome: BillingTelegramOutcome
): Promise<BillingFinalizationResult> {
  if (
    !deliveryId?.trim() ||
    !claimId?.trim() ||
    !attemptId?.trim()
  ) {
    return {
      finalized: false,
      reason: "INVALID_FINALIZATION_INPUT"
    };
  }

  return prisma.$transaction(
    async (tx): Promise<BillingFinalizationResult> => {
      const initial =
        await tx.platformBillingNotificationDelivery.findUnique({
          where: { id: deliveryId },
          select: { merchantId: true }
        });

      if (!initial) {
        return {
          finalized: false,
          reason: "DELIVERY_NOT_FOUND"
        };
      }

      await lockPlatformBillingMerchant(
        tx,
        initial.merchantId
      );

      const delivery =
        await tx.platformBillingNotificationDelivery.findUnique({
          where: { id: deliveryId },
          select: {
            merchantId: true,
            notificationId: true,
            status: true,
            claimId: true,
            processingUntil: true,
            attemptCount: true,
            notification: {
              select: { status: true }
            }
          }
        });

      if (
        !delivery ||
        delivery.merchantId !== initial.merchantId ||
        delivery.status !== "SENDING" ||
        delivery.claimId !== claimId ||
        delivery.notification.status !== "PENDING"
      ) {
        return {
          finalized: false,
          reason: "DELIVERY_CLAIM_NOT_CURRENT"
        };
      }

      const nowRows = await tx.$queryRaw<
        Array<{ now: Date }>
      >`
        SELECT
          (clock_timestamp() AT TIME ZONE 'UTC') AS "now"
      `;

      if (
        !delivery.processingUntil ||
        !nowRows[0] ||
        delivery.processingUntil <= nowRows[0].now
      ) {
        return {
          finalized: false,
          reason: "CLAIM_LEASE_EXPIRED"
        };
      }

      const attempt =
        await tx.platformBillingNotificationAttempt.findUnique({
          where: { id: attemptId }
        });

      if (
        !attempt ||
        attempt.deliveryId !== deliveryId ||
        attempt.merchantId !== initial.merchantId ||
        attempt.claimId !== claimId ||
        attempt.attemptNumber !== delivery.attemptCount ||
        attempt.outcome !== "REQUEST_STARTED" ||
        attempt.requestStartedAt === null ||
        attempt.responseReceivedAt !== null
      ) {
        return {
          finalized: false,
          reason: "ATTEMPT_NOT_CURRENT"
        };
      }

      if (
        outcome.kind === "AMBIGUOUS" ||
        outcome.kind === "TRANSIENT_FAILURE"
      ) {
        const reason =
          outcome.kind === "AMBIGUOUS"
            ? outcome.reason
            : outcome.reason;

        const attemptUpdate =
          await tx.platformBillingNotificationAttempt.updateMany({
            where: {
              id: attemptId,
              merchantId: initial.merchantId,
              deliveryId,
              claimId,
              attemptNumber: delivery.attemptCount,
              outcome: "REQUEST_STARTED",
              requestStartedAt: { not: null },
              responseReceivedAt: null
            },
            data: {
              outcome: "UNCERTAIN",
              responseReceivedAt: new Date(),
              sanitizedError: reason,
              retryAfterSeconds:
                outcome.kind === "TRANSIENT_FAILURE"
                  ? outcome.retryAfterSeconds
                  : null
            }
          });

        if (attemptUpdate.count !== 1) {
          throw new Error(
            "BILLING_FINALIZATION_ATTEMPT_OWNERSHIP_LOST"
          );
        }

        await tx.platformBillingDeliveryQuarantine.upsert({
          where: { deliveryId },
          create: {
            deliveryId,
            merchantId: initial.merchantId,
            reason: "TELEGRAM_OUTCOME_REVIEW_REQUIRED"
          },
          update: {}
        });

        const deliveryUpdate =
          await tx.platformBillingNotificationDelivery.updateMany({
            where: {
              id: deliveryId,
              merchantId: initial.merchantId,
              notificationId: delivery.notificationId,
              status: "SENDING",
              claimId,
              attemptCount: delivery.attemptCount,
              processingUntil: { gt: nowRows[0].now }
            },
            data: {
              status: "REVIEW_REQUIRED",
              claimId: null,
              processingUntil: null,
              terminalReason: reason
            }
          });

        if (deliveryUpdate.count !== 1) {
          throw new Error(
            "BILLING_FINALIZATION_DELIVERY_OWNERSHIP_LOST"
          );
        }

        const notificationUpdate =
          await tx.platformBillingNotification.updateMany({
            where: {
              id: delivery.notificationId,
              merchantId: initial.merchantId,
              status: "PENDING"
            },
            data: {
              status: "REVIEW_REQUIRED",
              terminalReason: reason
            }
          });

        if (notificationUpdate.count !== 1) {
          throw new Error(
            "BILLING_FINALIZATION_NOTIFICATION_STATE_LOST"
          );
        }

        return {
          finalized: true,
          disposition: "REVIEW_REQUIRED"
        };
      }

      const accepted = outcome.kind === "ACCEPTED";

      const attemptUpdate =
        await tx.platformBillingNotificationAttempt.updateMany({
          where: {
            id: attemptId,
            merchantId: initial.merchantId,
            deliveryId,
            claimId,
            attemptNumber: delivery.attemptCount,
            outcome: "REQUEST_STARTED",
            requestStartedAt: { not: null },
            responseReceivedAt: null
          },
          data: {
            outcome: accepted
              ? "SUCCEEDED"
              : "REQUEST_STARTED",
            responseReceivedAt: new Date(),
            telegramMessageId: accepted
              ? outcome.telegramMessageId
              : null,
            sanitizedError: accepted
              ? null
              : outcome.reason
          }
        });

      if (attemptUpdate.count !== 1) {
        throw new Error(
          "BILLING_FINALIZATION_ATTEMPT_OWNERSHIP_LOST"
        );
      }

      const deliveryUpdate =
        await tx.platformBillingNotificationDelivery.updateMany({
          where: {
            id: deliveryId,
            merchantId: initial.merchantId,
            notificationId: delivery.notificationId,
            status: "SENDING",
            claimId,
            attemptCount: delivery.attemptCount,
            processingUntil: { gt: nowRows[0].now }
          },
          data: {
            status: accepted ? "SENT" : "FAILED",
            claimId: null,
            processingUntil: null,
            terminalReason: accepted
              ? null
              : outcome.reason
          }
        });

      if (deliveryUpdate.count !== 1) {
        throw new Error(
          "BILLING_FINALIZATION_DELIVERY_OWNERSHIP_LOST"
        );
      }

      const notificationUpdate =
        await tx.platformBillingNotification.updateMany({
          where: {
            id: delivery.notificationId,
            merchantId: initial.merchantId,
            status: "PENDING"
          },
          data: {
            status: "COMPLETED",
            terminalReason: accepted
              ? null
              : outcome.reason
          }
        });

      if (notificationUpdate.count !== 1) {
        throw new Error(
          "BILLING_FINALIZATION_NOTIFICATION_STATE_LOST"
        );
      }

      return {
        finalized: true,
        disposition: accepted ? "SENT" : "FAILED"
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted
    }
  );
}
