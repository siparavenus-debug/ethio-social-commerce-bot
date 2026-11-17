import {
  Prisma,
  prisma
} from "@ethio-commerce/database";

import {
  lockPlatformBillingMerchant
} from "./platform-billing-merchant-lock.js";

const MAX_DELIVERY_ATTEMPTS = 5;

const CLEANUP_REASONS = [
  "MESSAGE_PREPARATION_FAILED",
  "DESTINATION_RESOLUTION_FAILED",
  "CREDENTIAL_DECRYPTION_FAILED",
  "PRE_SEND_VALIDATION_FAILED",
  "TRANSPORT_CONTEXT_FAILED"
] as const;

export type BillingPreSendCleanupReason =
  (typeof CLEANUP_REASONS)[number];

export type BillingPreSendCleanupResult =
  | {
      cleaned: true;
      action: "REQUEUED" | "FAILED";
      sendAuthorized: false;
    }
  | {
      cleaned: false;
      reason: string;
      sendAuthorized: false;
    };

function reject(
  reason: string
): BillingPreSendCleanupResult {
  return {
    cleaned: false,
    reason,
    sendAuthorized: false
  };
}

export async function cleanupPreparedPlatformBillingNotificationAttempt(
  deliveryId: string,
  claimId: string,
  attemptId: string,
  attemptNumber: number,
  reason: BillingPreSendCleanupReason
): Promise<BillingPreSendCleanupResult> {
  if (
    !deliveryId?.trim() ||
    !claimId?.trim() ||
    !attemptId?.trim() ||
    !Number.isSafeInteger(attemptNumber) ||
    attemptNumber < 1 ||
    !CLEANUP_REASONS.includes(reason)
  ) {
    return reject("INVALID_CLEANUP_INPUT");
  }

  return prisma.$transaction(
    async (tx): Promise<BillingPreSendCleanupResult> => {
      const initial =
        await tx.platformBillingNotificationDelivery.findUnique({
          where: { id: deliveryId },
          select: { merchantId: true }
        });

      if (!initial) {
        return reject("DELIVERY_NOT_FOUND");
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
            processingUntil: true,
            attemptCount: true,
            notification: {
              select: { status: true }
            },
            attempts: {
              select: {
                id: true,
                merchantId: true,
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
        return reject("DELIVERY_CHANGED");
      }

      if (delivery.status !== "SENDING") {
        return reject("DELIVERY_NOT_SENDING");
      }

      if (delivery.claimId !== claimId) {
        return reject("CLAIM_MISMATCH");
      }

      if (delivery.attemptCount !== attemptNumber) {
        return reject("ATTEMPT_NUMBER_MISMATCH");
      }

      if (delivery.notification.status !== "PENDING") {
        return reject("NOTIFICATION_NOT_PENDING");
      }

      const attempt = delivery.attempts.find(
        (item) => item.id === attemptId
      );

      if (
        !attempt ||
        attempt.merchantId !== initial.merchantId ||
        attempt.claimId !== claimId ||
        attempt.attemptNumber !== attemptNumber ||
        attempt.outcome !== "PREPARED" ||
        attempt.requestStartedAt !== null
      ) {
        return reject("ATTEMPT_NOT_PREPARED");
      }

      const conflicting = delivery.attempts.some(
        (item) =>
          item.id !== attemptId &&
          (
            item.outcome !== "FAILED_PRE_SEND" ||
            item.requestStartedAt !== null
          )
      );

      if (conflicting) {
        return reject("CONFLICTING_UNRESOLVED_ATTEMPT");
      }

      const quarantined =
        await tx.platformBillingDeliveryQuarantine.findUnique({
          where: { deliveryId },
          select: { deliveryId: true }
        });

      if (quarantined) {
        return reject("DELIVERY_QUARANTINED");
      }

      const updatedAttempt = await tx.$queryRaw<
        Array<{ id: string }>
      >`
        UPDATE "PlatformBillingNotificationAttempt" AS a
        SET
          "outcome" =
            'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
        WHERE a."id" = ${attemptId}
          AND a."deliveryId" = ${deliveryId}
          AND a."merchantId" = ${initial.merchantId}
          AND a."claimId" = ${claimId}
          AND a."attemptNumber" = ${attemptNumber}
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
              AND d."attemptCount" = ${attemptNumber}
              AND d."processingUntil" >
                (clock_timestamp() AT TIME ZONE 'UTC')
              AND n."status" =
                'PENDING'::"PlatformBillingNotificationStatus"
              AND NOT EXISTS (
                SELECT 1
                FROM "PlatformBillingDeliveryQuarantine" AS q
                WHERE q."deliveryId" = d."id"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "PlatformBillingNotificationAttempt" AS other
                WHERE other."deliveryId" = d."id"
                  AND other."id" <> a."id"
                  AND (
                    other."outcome" <>
                      'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
                    OR other."requestStartedAt" IS NOT NULL
                  )
              )
          )
        RETURNING a."id"
      `;

      if (updatedAttempt.length !== 1) {
        return reject("CLEANUP_CONDITIONAL_UPDATE_FAILED");
      }

      const exhausted =
        attemptNumber >= MAX_DELIVERY_ATTEMPTS;

      const action = exhausted ? "FAILED" : "REQUEUED";

      const updatedDelivery = await tx.$queryRaw<
        Array<{ id: string }>
      >`
        UPDATE "PlatformBillingNotificationDelivery" AS d
        SET
          "status" =
            ${exhausted ? "FAILED" : "PENDING"}::"PlatformBillingDeliveryStatus",
          "claimId" = NULL,
          "processingUntil" = NULL,
          "terminalReason" =
            ${exhausted ? "PRE_SEND_ATTEMPTS_EXHAUSTED" : null},
          "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
        WHERE d."id" = ${deliveryId}
          AND d."merchantId" = ${initial.merchantId}
          AND d."status" =
            'SENDING'::"PlatformBillingDeliveryStatus"
          AND d."claimId" = ${claimId}
          AND d."attemptCount" = ${attemptNumber}
          AND d."processingUntil" >
            (clock_timestamp() AT TIME ZONE 'UTC')
          AND EXISTS (
            SELECT 1
            FROM "PlatformBillingNotification" AS n
            WHERE n."id" = d."notificationId"
              AND n."merchantId" = d."merchantId"
              AND n."status" =
                'PENDING'::"PlatformBillingNotificationStatus"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "PlatformBillingDeliveryQuarantine" AS q
            WHERE q."deliveryId" = d."id"
          )
          AND EXISTS (
            SELECT 1
            FROM "PlatformBillingNotificationAttempt" AS a
            WHERE a."id" = ${attemptId}
              AND a."deliveryId" = d."id"
              AND a."merchantId" = d."merchantId"
              AND a."claimId" = ${claimId}
              AND a."attemptNumber" = ${attemptNumber}
              AND a."outcome" =
                'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
              AND a."requestStartedAt" IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "PlatformBillingNotificationAttempt" AS other
            WHERE other."deliveryId" = d."id"
              AND (
                other."outcome" <>
                  'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
                OR other."requestStartedAt" IS NOT NULL
              )
          )
        RETURNING d."id"
      `;

      if (updatedDelivery.length !== 1) {
        throw new Error(
          "PRE_SEND_CLEANUP_DELIVERY_UPDATE_FAILED"
        );
      }

      return {
        cleaned: true,
        action,
        sendAuthorized: false
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted
    }
  );
}
