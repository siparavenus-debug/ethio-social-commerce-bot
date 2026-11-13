import {
  randomUUID
} from "node:crypto";

import {
  Prisma,
  prisma
} from "@ethio-commerce/database";


const PROCESSING_LEASE_MINUTES = 5;
const MAX_DELIVERY_ATTEMPTS = 5;

export type PlatformBillingClaimResult =
  | {
      claimed: true;
      deliveryId: string;
      claimId: string;
      processingUntil: Date;
    }
  | {
      claimed: false;
    };

type Candidate = {
  id: string;
  merchantId: string;
};

type ClaimedDelivery = {
  id: string;
  processingUntil: Date;
};

export async function claimNextPlatformBillingNotificationDelivery(deliveryId?: string | string[]): Promise<PlatformBillingClaimResult> {
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT d."id", d."merchantId"
    FROM "PlatformBillingNotificationDelivery" AS d
    JOIN "PlatformBillingNotification" AS n
      ON n."id" = d."notificationId"
    WHERE d."status" = 'PENDING'::"PlatformBillingDeliveryStatus"
      AND (${deliveryId === undefined ? null : Array.isArray(deliveryId) ? deliveryId : [deliveryId]}::text[] IS NULL OR d."id" = ANY(${deliveryId === undefined ? null : Array.isArray(deliveryId) ? deliveryId : [deliveryId]}::text[]))
      AND d."nextAttemptAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
      AND d."attemptCount" < ${MAX_DELIVERY_ATTEMPTS}
      AND n."status" = 'PENDING'::"PlatformBillingNotificationStatus"
      AND NOT EXISTS (
        SELECT 1
        FROM "PlatformBillingDeliveryQuarantine" AS q
        WHERE q."deliveryId" = d."id"
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
    ORDER BY d."nextAttemptAt", d."createdAt", d."id"
    LIMIT 20
  `;

  for (const candidate of candidates) {
    const result = await prisma.$transaction(
      async (tx): Promise<PlatformBillingClaimResult> => {
        const merchantLock = await tx.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT "id"
          FROM "Merchant"
          WHERE "id" = ${candidate.merchantId}
          FOR UPDATE SKIP LOCKED
        `;

        if (merchantLock.length !== 1) {
          return { claimed: false };
        }

        const locked = await tx.$queryRaw<Candidate[]>`
          SELECT d."id", d."merchantId"
          FROM "PlatformBillingNotificationDelivery" AS d
          WHERE d."id" = ${candidate.id}
            AND d."merchantId" = ${candidate.merchantId}
          FOR UPDATE OF d SKIP LOCKED
        `;

        if (locked.length !== 1) {
          return { claimed: false };
        }

        const claimId = randomUUID();

        const claimed = await tx.$queryRaw<ClaimedDelivery[]>`
          UPDATE "PlatformBillingNotificationDelivery" AS d
          SET
            "status" = 'PROCESSING'::"PlatformBillingDeliveryStatus",
            "claimId" = ${claimId},
            "processingUntil" =
              (clock_timestamp() AT TIME ZONE 'UTC')
              + (${PROCESSING_LEASE_MINUTES} * INTERVAL '1 minute'),
            "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
          WHERE d."id" = ${candidate.id}
            AND d."merchantId" = ${candidate.merchantId}
            AND d."status" = 'PENDING'::"PlatformBillingDeliveryStatus"
            AND d."nextAttemptAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
            AND d."attemptCount" < ${MAX_DELIVERY_ATTEMPTS}
            AND EXISTS (
              SELECT 1
              FROM "PlatformBillingNotification" AS n
              WHERE n."id" = d."notificationId"
                AND n."status" = 'PENDING'::"PlatformBillingNotificationStatus"
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "PlatformBillingDeliveryQuarantine" AS q
              WHERE q."deliveryId" = d."id"
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
          RETURNING d."id", d."processingUntil"
        `;

        if (claimed.length !== 1) {
          return { claimed: false };
        }

        return {
          claimed: true,
          deliveryId: claimed[0].id,
          claimId,
          processingUntil: claimed[0].processingUntil
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.ReadCommitted
      }
    );

    if (result.claimed) {
      return result;
    }
  }

  return { claimed: false };
}
