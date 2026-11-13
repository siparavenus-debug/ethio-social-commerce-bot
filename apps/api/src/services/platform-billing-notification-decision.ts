import {
  Prisma,
  prisma
} from "@ethio-commerce/database";

import {
  lockPlatformBillingMerchant
} from "./platform-billing-merchant-lock.js";

import {
  validatePlatformBillingPreSend
} from "./platform-billing-notification-pre-send.js";

export type BillingClaimDecision =
  | {
      valid: true;
      sendAuthorized: false;
    }
  | {
      valid: false;
      sendAuthorized: false;
      reason: string;
    };

export type BillingDispositionDecision =
  | {
      applied: true;
      disposition: "SUPPRESS" | "DEFER" | "REVIEW_REQUIRED";
      sendAuthorized: false;
    }
  | {
      applied: false;
      sendAuthorized: false;
      reason: string;
    };

const reject = (reason: string): BillingClaimDecision => ({
  valid: false,
  sendAuthorized: false,
  reason
});

const rejectDisposition = (
  reason: string
): BillingDispositionDecision => ({
  applied: false,
  sendAuthorized: false,
  reason
});

const DEFER_SECONDS = 60;

async function validateClaimInTransaction(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  claimId: string
): Promise<BillingClaimDecision> {
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

  const merchant = await tx.merchant.findUnique({
    where: { id: initial.merchantId },
    select: { id: true }
  });

  if (!merchant) {
    return reject("MERCHANT_NOT_FOUND");
  }

  const delivery =
    await tx.platformBillingNotificationDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        merchantId: true,
        status: true,
        claimId: true,
        processingUntil: true,
        notification: {
          select: {
            status: true
          }
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
    return reject("DELIVERY_CHANGED");
  }

  if (delivery.status !== "PROCESSING") {
    return reject("DELIVERY_NOT_PROCESSING");
  }

  if (delivery.claimId !== claimId) {
    return reject("CLAIM_MISMATCH");
  }

  if (delivery.notification.status !== "PENDING") {
    return reject("NOTIFICATION_NOT_PENDING");
  }

  const decisionTime =
    await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"
    `;

  const now = decisionTime[0]?.now;

  if (
    !now ||
    !delivery.processingUntil ||
    delivery.processingUntil <= now
  ) {
    return reject("CLAIM_LEASE_EXPIRED");
  }

  const unsafeAttempt = delivery.attempts.some(
    (attempt) =>
      attempt.outcome !== "FAILED_PRE_SEND" ||
      attempt.requestStartedAt !== null
  );

  if (unsafeAttempt) {
    return reject("PRIOR_ATTEMPT_NOT_SAFE");
  }

  return {
    valid: true,
    sendAuthorized: false
  };
}

export async function evaluatePlatformBillingDeliveryClaim(
  deliveryId: string,
  claimId: string
): Promise<BillingClaimDecision> {
  if (!deliveryId?.trim() || !claimId?.trim()) {
    return reject("INVALID_CLAIM_INPUT");
  }

  return prisma.$transaction(
    (tx) =>
      validateClaimInTransaction(
        tx,
        deliveryId,
        claimId
      ),
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted
    }
  );
}

type BillingDisposition =
  "SUPPRESS" | "DEFER" | "REVIEW_REQUIRED";

async function applyClaimedBillingDisposition(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  claimId: string,
  disposition: BillingDisposition,
  reason: string,
  requireUnsafeAttempt: boolean
): Promise<BillingDispositionDecision> {
  const deliveryStatus =
    disposition === "SUPPRESS"
      ? "SUPPRESSED"
      : disposition === "DEFER"
        ? "PENDING"
        : "REVIEW_REQUIRED";

  const updated =
    await tx.$queryRaw<Array<{ notificationId: string }>>`
      UPDATE "PlatformBillingNotificationDelivery" AS d
      SET
        "status" = ${deliveryStatus}::"PlatformBillingDeliveryStatus",
        "claimId" = NULL,
        "processingUntil" = NULL,
        "terminalReason" = ${
          disposition === "DEFER" ? null : reason
        },
        "nextAttemptAt" = CASE
          WHEN ${disposition}::text = 'DEFER'
          THEN clock_timestamp() + INTERVAL '60 seconds'
          ELSE d."nextAttemptAt"
        END,
        "updatedAt" = clock_timestamp()
      WHERE d."id" = ${deliveryId}
        AND d."status" = 'PROCESSING'::"PlatformBillingDeliveryStatus"
        AND d."claimId" = ${claimId}
        AND d."processingUntil" > (clock_timestamp() AT TIME ZONE 'UTC')
        AND EXISTS (
          SELECT 1
          FROM "PlatformBillingNotification" AS n
          WHERE n."id" = d."notificationId"
            AND n."status" = 'PENDING'::"PlatformBillingNotificationStatus"
        )
        AND (
          (
            ${requireUnsafeAttempt}::boolean = TRUE
            AND EXISTS (
              SELECT 1
              FROM "PlatformBillingNotificationAttempt" AS a
              WHERE a."deliveryId" = d."id"
                AND (
                  a."outcome" <> 'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
                  OR a."requestStartedAt" IS NOT NULL
                )
            )
          )
          OR
          (
            ${requireUnsafeAttempt}::boolean = FALSE
            AND NOT EXISTS (
              SELECT 1
              FROM "PlatformBillingNotificationAttempt" AS a
              WHERE a."deliveryId" = d."id"
                AND (
                  a."outcome" <> 'FAILED_PRE_SEND'::"PlatformBillingAttemptOutcome"
                  OR a."requestStartedAt" IS NOT NULL
                )
            )
          )
        )
      RETURNING d."notificationId"
    `;

  if (updated.length !== 1) {
    return rejectDisposition(
      "DELIVERY_CONDITIONAL_UPDATE_FAILED"
    );
  }

  if (disposition !== "DEFER") {
    const notificationStatus =
      disposition === "SUPPRESS"
        ? "SUPPRESSED"
        : "REVIEW_REQUIRED";

    const result =
      await tx.platformBillingNotification.updateMany({
        where: {
          id: updated[0].notificationId,
          status: "PENDING"
        },
        data: {
          status: notificationStatus,
          terminalReason: reason
        }
      });

    if (result.count !== 1) {
      throw new Error(
        "Notification conditional update failed"
      );
    }
  }

  return {
    applied: true,
    disposition,
    sendAuthorized: false
  };
}

export async function applyPlatformBillingPreSendDecision(
  deliveryId: string,
  claimId: string
): Promise<BillingDispositionDecision> {
  if (!deliveryId?.trim() || !claimId?.trim()) {
    return rejectDisposition("INVALID_CLAIM_INPUT");
  }

  return prisma.$transaction(
    async (tx): Promise<BillingDispositionDecision> => {
      const claim = await validateClaimInTransaction(
        tx,
        deliveryId,
        claimId
      );

      if (!claim.valid) {
        if (claim.reason !== "PRIOR_ATTEMPT_NOT_SAFE") {
          return rejectDisposition(claim.reason);
        }

        return applyClaimedBillingDisposition(
          tx,
          deliveryId,
          claimId,
          "REVIEW_REQUIRED",
          "PRIOR_ATTEMPT_NOT_SAFE",
          true
        );
      }

      const decision = await validatePlatformBillingPreSend(
        tx,
        deliveryId
      );

      if (decision.eligible) {
        return rejectDisposition(
          "ELIGIBLE_AWAITING_ATTEMPT_FENCE"
        );
      }

      return applyClaimedBillingDisposition(
        tx,
        deliveryId,
        claimId,
        decision.disposition,
        decision.reason,
        false
      );
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted
    }
  );
}
