import { Prisma, prisma } from "@ethio-commerce/database";

import {
  lockPlatformBillingMerchant
} from "./platform-billing-merchant-lock.js";

import {
  validatePlatformBillingPreSend,
  validatePlatformBillingRequestStart
} from "./platform-billing-notification-pre-send.js";

export type BillingAttemptPreparationResult =
  | {
      prepared: true;
      sendAuthorized: false;
      attemptId: string;
      attemptNumber: number;
    }
  | {
      prepared: false;
      sendAuthorized: false;
      reason: string;
    };

function rejectPreparation(
  reason: string
): BillingAttemptPreparationResult {
  return {
    prepared: false,
    sendAuthorized: false,
    reason
  };
}

export async function preparePlatformBillingNotificationAttempt(
  deliveryId: string,
  claimId: string
): Promise<BillingAttemptPreparationResult> {
  if (!deliveryId?.trim() || !claimId?.trim()) {
    return rejectPreparation("INVALID_CLAIM_INPUT");
  }

  return prisma.$transaction(
    async (tx): Promise<BillingAttemptPreparationResult> => {
      const initial =
        await tx.platformBillingNotificationDelivery.findUnique({
          where: { id: deliveryId },
          select: { merchantId: true }
        });

      if (!initial) {
        return rejectPreparation("DELIVERY_NOT_FOUND");
      }

      await lockPlatformBillingMerchant(
        tx,
        initial.merchantId
      );

      const merchant = await tx.merchant.findUnique({
        where: { id: initial.merchantId },
        select: { id: true }
      });

      if (!merchant) {
        return rejectPreparation("MERCHANT_NOT_FOUND");
      }

      const delivery =
        await tx.platformBillingNotificationDelivery.findUnique({
          where: { id: deliveryId },
          select: {
            merchantId: true,
            status: true,
            claimId: true,
            processingUntil: true,
            attemptCount: true,
            notification: {
              select: { status: true }
            },
            attempts: {
              select: {
                outcome: true,
                requestStartedAt: true
              }
            }
          }
        });

      if (
        !delivery ||
        delivery.merchantId !== initial.merchantId
      ) {
        return rejectPreparation("DELIVERY_CHANGED");
      }

      if (delivery.status !== "PROCESSING") {
        return rejectPreparation("DELIVERY_NOT_PROCESSING");
      }

      if (delivery.claimId !== claimId) {
        return rejectPreparation("CLAIM_MISMATCH");
      }

      if (delivery.notification.status !== "PENDING") {
        return rejectPreparation("NOTIFICATION_NOT_PENDING");
      }

      const unsafeAttempt = delivery.attempts.some(
        (attempt) =>
          attempt.outcome !== "FAILED_PRE_SEND" ||
          attempt.requestStartedAt !== null
      );

      if (unsafeAttempt) {
        return rejectPreparation("PRIOR_ATTEMPT_NOT_SAFE");
      }

      const decision =
        await validatePlatformBillingPreSend(
          tx,
          deliveryId
        );

      if (!decision.eligible) {
        return rejectPreparation(
          `PRE_SEND_${decision.disposition}_${decision.reason}`
        );
      }

      const updated =
        await tx.$queryRaw<
          Array<{
            id: string;
            merchantId: string;
            attemptCount: number;
          }>
        >`
          UPDATE "PlatformBillingNotificationDelivery" AS d
          SET
            "status" = 'SENDING'::"PlatformBillingDeliveryStatus",
            "attemptCount" = d."attemptCount" + 1,
            "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
          WHERE d."id" = ${deliveryId}
            AND d."merchantId" = ${initial.merchantId}
            AND d."status" = 'PROCESSING'::"PlatformBillingDeliveryStatus"
            AND d."claimId" = ${claimId}
            AND d."processingUntil" > (clock_timestamp() AT TIME ZONE 'UTC')
            AND EXISTS (
              SELECT 1
              FROM "PlatformBillingNotification" AS n
              WHERE n."id" = d."notificationId"
                AND n."status" = 'PENDING'::"PlatformBillingNotificationStatus"
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "PlatformBillingNotificationAttempt" AS a
              WHERE a."deliveryId" = d."id"
                AND (
                  a."outcome" <> 'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
                  OR a."requestStartedAt" IS NOT NULL
                )
            )
          RETURNING
            d."id",
            d."merchantId",
            d."attemptCount"
        `;

      if (updated.length !== 1) {
        return rejectPreparation(
          "PREPARATION_CONDITIONAL_UPDATE_FAILED"
        );
      }

      const attempt =
        await tx.platformBillingNotificationAttempt.create({
          data: {
            merchantId: updated[0].merchantId,
            deliveryId,
            attemptNumber: updated[0].attemptCount,
            claimId,
            outcome: "PREPARED"
          },
          select: {
            id: true,
            attemptNumber: true
          }
        });

      return {
        prepared: true,
        sendAuthorized: false,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted
    }
  );
}

export type BillingRequestStartResult =
  | {
      started: true;
      sendAuthorized: false;
      attemptId: string;
      destinationId: string;
      platformBotId: string;
      botIdentityId: string;
    }
  | {
      started: false;
      sendAuthorized: false;
      reason: string;
    };

function rejectRequestStart(
  reason: string
): BillingRequestStartResult {
  return {
    started: false,
    sendAuthorized: false,
    reason
  };
}

export async function markPlatformBillingNotificationRequestStarted(
  deliveryId: string,
  claimId: string,
  attemptId: string
): Promise<BillingRequestStartResult> {
  if (
    !deliveryId?.trim() ||
    !claimId?.trim() ||
    !attemptId?.trim()
  ) {
    return rejectRequestStart("INVALID_REQUEST_START_INPUT");
  }

  return prisma.$transaction(
    async (tx): Promise<BillingRequestStartResult> => {
      const initial =
        await tx.platformBillingNotificationDelivery.findUnique({
          where: { id: deliveryId },
          select: { merchantId: true }
        });

      if (!initial) {
        return rejectRequestStart("DELIVERY_NOT_FOUND");
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
            status: true,
            claimId: true,
            attemptCount: true,
            notification: {
              select: { status: true }
            },
            attempts: {
              select: {
                id: true,
                claimId: true,
                attemptNumber: true,
                outcome: true,
                requestStartedAt: true
              }
            }
          }
        });

      if (
        !delivery ||
        delivery.merchantId !== initial.merchantId
      ) {
        return rejectRequestStart("DELIVERY_CHANGED");
      }

      if (delivery.status !== "SENDING") {
        return rejectRequestStart("DELIVERY_NOT_SENDING");
      }

      if (delivery.claimId !== claimId) {
        return rejectRequestStart("CLAIM_MISMATCH");
      }

      if (delivery.notification.status !== "PENDING") {
        return rejectRequestStart("NOTIFICATION_NOT_PENDING");
      }

      const attempt = delivery.attempts.find(
        (item) => item.id === attemptId
      );

      if (!attempt) {
        return rejectRequestStart("ATTEMPT_NOT_FOUND");
      }

      if (
        attempt.claimId !== claimId ||
        attempt.attemptNumber !== delivery.attemptCount ||
        attempt.outcome !== "PREPARED" ||
        attempt.requestStartedAt !== null
      ) {
        return rejectRequestStart("ATTEMPT_NOT_PREPARED");
      }

      const conflictingAttempt = delivery.attempts.some(
        (item) =>
          item.id !== attemptId &&
          (
            item.outcome !== "FAILED_PRE_SEND" ||
            item.requestStartedAt !== null
          )
      );

      if (conflictingAttempt) {
        return rejectRequestStart(
          "CONFLICTING_UNRESOLVED_ATTEMPT"
        );
      }

      const eligibility =
        await validatePlatformBillingRequestStart(
          tx,
          deliveryId
        );

      if (!eligibility.eligible) {
        return rejectRequestStart(
          `REQUEST_START_${eligibility.disposition}_${eligibility.reason}`
        );
      }

      const updated = await tx.$queryRaw<
        Array<{ id: string }>
      >`
        UPDATE "PlatformBillingNotificationAttempt" AS a
        SET
          "outcome" =
            'REQUEST_STARTED'::"PlatformBillingAttemptOutcome",
          "requestStartedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
        WHERE a."id" = ${attemptId}
          AND a."deliveryId" = ${deliveryId}
          AND a."merchantId" = ${initial.merchantId}
          AND a."claimId" = ${claimId}
          AND a."attemptNumber" = ${delivery.attemptCount}
          AND a."outcome" =
            'PREPARED'::"PlatformBillingAttemptOutcome"
          AND a."requestStartedAt" IS NULL
          AND EXISTS (
            SELECT 1
            FROM "PlatformBillingNotificationDelivery" AS d
            JOIN "PlatformBillingNotification" AS n
              ON n."id" = d."notificationId"
             AND n."merchantId" = d."merchantId"
            WHERE d."id" = a."deliveryId"
              AND d."merchantId" = a."merchantId"
              AND d."status" =
                'SENDING'::"PlatformBillingDeliveryStatus"
              AND d."claimId" = ${claimId}
              AND d."attemptCount" = a."attemptNumber"
              AND d."processingUntil" > (clock_timestamp() AT TIME ZONE 'UTC')
              AND n."status" =
                'PENDING'::"PlatformBillingNotificationStatus"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "PlatformBillingNotificationAttempt" AS other
            WHERE other."deliveryId" = a."deliveryId"
              AND other."id" <> a."id"
              AND (
                other."outcome" <>
                  'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
                OR other."requestStartedAt" IS NOT NULL
              )
          )
        RETURNING a."id"
      `;

      if (updated.length !== 1) {
        return rejectRequestStart(
          "REQUEST_START_CONDITIONAL_UPDATE_FAILED"
        );
      }

      return {
        started: true,
        sendAuthorized: false,
        attemptId: updated[0].id,
        destinationId: eligibility.destinationId,
        platformBotId: eligibility.platformBotId,
        botIdentityId: eligibility.botIdentityId
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted
    }
  );
}
