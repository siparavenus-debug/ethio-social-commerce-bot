
import {
    prisma,
    Prisma
  } from "@ethio-commerce/database";

  import {
    lockPlatformBillingMerchant
  } from "./platform-billing-merchant-lock.js";

  import {
    validatePlatformBillingRequestStart
  } from "./platform-billing-notification-pre-send.js";

  export type BillingPreSendFailureClassification =
    | "RECOVERABLE_PRE_SEND"
    | "PERMANENT_PRE_SEND";

  type ReconciliationStatus =
    | "PENDING"
    | "SUPPRESSED"
    | "REVIEW_REQUIRED";

  export type BillingPreSendReconciliationResult =
    | {
        reconciled: true;
        sendAuthorized: false;
        deliveryStatus: ReconciliationStatus;
      }
    | {
        reconciled: false;
        sendAuthorized: false;
        reason: string;
      };

  function reject(
    reason: string
  ): BillingPreSendReconciliationResult {
    return {
      reconciled: false,
      sendAuthorized: false,
      reason
    };
  }

  export async function reconcilePlatformBillingFailedPreSendAttempt(
    deliveryId: string,
    claimId: string,
    attemptId: string,
    classification: BillingPreSendFailureClassification
  ): Promise<BillingPreSendReconciliationResult> {
    if (
      !deliveryId?.trim() ||
      !claimId?.trim() ||
      !attemptId?.trim() ||
      (
        classification !== "RECOVERABLE_PRE_SEND" &&
        classification !== "PERMANENT_PRE_SEND"
      )
    ) {
      return reject("INVALID_RECONCILIATION_INPUT");
    }

    return prisma.$transaction(
      async (tx): Promise<BillingPreSendReconciliationResult> => {
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
              notificationId: true,
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

        if (delivery.notification.status !== "PENDING") {
          return reject("NOTIFICATION_NOT_PENDING");
        }

        const attempt = delivery.attempts.find(
          (item) => item.id === attemptId
        );

        if (!attempt) {
          return reject("ATTEMPT_NOT_FOUND");
        }

        if (
          attempt.merchantId !== delivery.merchantId ||
          attempt.claimId !== claimId ||
          attempt.attemptNumber !== delivery.attemptCount ||
          attempt.outcome !== "PREPARED" ||
          attempt.requestStartedAt !== null
        ) {
          return reject("ATTEMPT_NOT_PREPARED");
        }

        const conflict = delivery.attempts.some(
          (item) =>
            item.id !== attemptId &&
            (
              item.outcome !== "FAILED_PRE_SEND" ||
              item.requestStartedAt !== null
            )
        );

        if (conflict) {
          return reject("CONFLICTING_UNRESOLVED_ATTEMPT");
        }

        // This validator accepts SENDING deliveries.
        // It does not authorize Telegram sending.
        const eligibility =
          await validatePlatformBillingRequestStart(
            tx,
            deliveryId
          );

        let deliveryStatus: ReconciliationStatus;
        let reason: string;
        let defer = false;

        if (!eligibility.eligible) {
          reason = eligibility.reason;

          switch (eligibility.disposition) {
            case "SUPPRESS":
              deliveryStatus = "SUPPRESSED";
              break;

            case "DEFER":
              deliveryStatus = "PENDING";
              defer = true;
              break;

            default:
              deliveryStatus = "REVIEW_REQUIRED";
          }
        } else if (
          classification === "RECOVERABLE_PRE_SEND"
        ) {
          deliveryStatus = "PENDING";
          reason = "RECOVERABLE_PRE_SEND_FAILURE";
          defer = true;
        } else {
          deliveryStatus = "REVIEW_REQUIRED";
          reason = "PERMANENT_PRE_SEND_FAILURE";
        }

        const updatedAttempt =
          await tx.$queryRaw<Array<{ id: string }>>`
            UPDATE "PlatformBillingNotificationAttempt" AS a
            SET
              "outcome" =
                'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome",
              "sanitizedError" = ${reason}
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
                  AND d."processingUntil" >
                    (clock_timestamp() AT TIME ZONE 'UTC')
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

        if (updatedAttempt.length !== 1) {
          return reject("ATTEMPT_CONDITIONAL_UPDATE_FAILED");
        }

        const updatedDelivery =
          await tx.$queryRaw<Array<{ notificationId: string }>>`
            UPDATE "PlatformBillingNotificationDelivery" AS d
            SET
              "status" =
                ${deliveryStatus}::"PlatformBillingDeliveryStatus",
              "claimId" = NULL,
              "processingUntil" = NULL,
              "terminalReason" = ${
                deliveryStatus === "PENDING" ? null : reason
              },
              "nextAttemptAt" = CASE
                WHEN ${defer}::boolean
                THEN clock_timestamp() + INTERVAL '60 seconds'
                ELSE d."nextAttemptAt"
              END,
              "updatedAt" = clock_timestamp()
            WHERE d."id" = ${deliveryId}
              AND d."merchantId" = ${initial.merchantId}
              AND d."status" =
                'SENDING'::"PlatformBillingDeliveryStatus"
              AND d."claimId" = ${claimId}
              AND d."attemptCount" = ${delivery.attemptCount}
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
              AND EXISTS (
                SELECT 1
                FROM "PlatformBillingNotificationAttempt" AS a
                WHERE a."id" = ${attemptId}
                  AND a."deliveryId" = d."id"
                  AND a."merchantId" = d."merchantId"
                  AND a."claimId" = ${claimId}
                  AND a."attemptNumber" = d."attemptCount"
                  AND a."outcome" =
                    'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
                  AND a."requestStartedAt" IS NULL
              )
            RETURNING d."notificationId"
          `;

        if (updatedDelivery.length !== 1) {
          // Throw to roll back the earlier attempt update.
          throw new Error(
            "DELIVERY_RECONCILIATION_CONDITIONAL_UPDATE_FAILED"
          );
        }

        if (deliveryStatus !== "PENDING") {
          const notificationStatus =
            deliveryStatus === "SUPPRESSED"
              ? "SUPPRESSED"
              : "REVIEW_REQUIRED";

          const updatedNotification =
            await tx.platformBillingNotification.updateMany({
              where: {
                id: updatedDelivery[0].notificationId,
                merchantId: initial.merchantId,
                status: "PENDING"
              },
              data: {
                status: notificationStatus,
                terminalReason: reason
              }
            });

          if (updatedNotification.count !== 1) {
            throw new Error(
              "NOTIFICATION_RECONCILIATION_CONDITIONAL_UPDATE_FAILED"
            );
          }
        }

        return {
          reconciled: true,
          sendAuthorized: false,
          deliveryStatus
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.ReadCommitted
      }
    );
  }
