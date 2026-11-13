import {
  Prisma,
  prisma
} from "@ethio-commerce/database";

const MAX_RECOVERY_CANDIDATES = 20;
const MAX_DELIVERY_ATTEMPTS = 5;

type RecoveryCandidate = {
  id: string;
  merchantId: string;
};

type LockedDelivery = {
  id: string;
  status: string;
  claimId: string | null;
  attemptCount: number;
  notificationStatus: string;
  quarantined: boolean;
};

export type BillingRecoveryResult =
  | {
      recovered: true;
      deliveryId: string;
      action: "REQUEUED" | "REVIEW_REQUIRED" | "FAILED";
    }
  | {
      recovered: false;
      deliveryId: string;
    };

export type BillingRecoveryWorkerTimeouts = {
  statementTimeoutMs: 30_000;
  lockTimeoutMs: 5_000;
};

export async function recoverExpiredPlatformBillingNotificationDeliveries(
  deliveryId?: string,
  workerTimeouts?: BillingRecoveryWorkerTimeouts
): Promise<BillingRecoveryResult[]> {
  const selectCandidates = async (
    tx: Pick<typeof prisma, "$queryRaw">
  ): Promise<RecoveryCandidate[]> =>
    tx.$queryRaw<RecoveryCandidate[]>`
    SELECT d."id", d."merchantId"
    FROM "PlatformBillingNotificationDelivery" AS d
    WHERE (${deliveryId}::text IS NULL OR d."id" = ${deliveryId})
      AND d."status" IN (
      'PROCESSING'::"PlatformBillingDeliveryStatus",
      'SENDING'::"PlatformBillingDeliveryStatus"
    )
      AND d."processingUntil" <=
        (clock_timestamp() AT TIME ZONE 'UTC')
    ORDER BY d."processingUntil", d."id"
    LIMIT ${MAX_RECOVERY_CANDIDATES}
  `;

  const candidates = workerTimeouts
    ? await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            SET LOCAL statement_timeout = '30s'
          `;
          await tx.$executeRaw`
            SET LOCAL lock_timeout = '5s'
          `;
          return selectCandidates(tx);
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.ReadCommitted
        }
      )
    : await selectCandidates(prisma);
  const results: BillingRecoveryResult[] = [];

  for (const candidate of candidates) {
    const result = await prisma.$transaction(
      async (tx): Promise<BillingRecoveryResult> => {
        if (workerTimeouts) {
          await tx.$executeRaw`
            SET LOCAL statement_timeout = '30s'
          `;
          await tx.$executeRaw`
            SET LOCAL lock_timeout = '5s'
          `;
        }

        const merchantLock = await tx.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT "id"
          FROM "Merchant"
          WHERE "id" = ${candidate.merchantId}
          FOR UPDATE SKIP LOCKED
        `;

        if (merchantLock.length !== 1) {
          return {
            recovered: false,
            deliveryId: candidate.id
          };
        }

        const locked = await tx.$queryRaw<LockedDelivery[]>`
          SELECT
            d."id",
            d."status"::text AS "status",
            d."claimId",
            d."attemptCount",
            n."status"::text AS "notificationStatus",
            EXISTS (
              SELECT 1
              FROM "PlatformBillingDeliveryQuarantine" AS q
              WHERE q."deliveryId" = d."id"
            ) AS "quarantined"
          FROM "PlatformBillingNotificationDelivery" AS d
          JOIN "PlatformBillingNotification" AS n
            ON n."id" = d."notificationId"
           AND n."merchantId" = d."merchantId"
          WHERE d."id" = ${candidate.id}
            AND d."merchantId" = ${candidate.merchantId}
            AND d."status" IN (
              'PROCESSING'::"PlatformBillingDeliveryStatus",
              'SENDING'::"PlatformBillingDeliveryStatus"
            )
            AND d."processingUntil" <=
              (clock_timestamp() AT TIME ZONE 'UTC')
          FOR UPDATE OF d SKIP LOCKED
        `;

        if (locked.length !== 1) {
          return {
            recovered: false,
            deliveryId: candidate.id
          };
        }

        const delivery = locked[0];

        const attempts =
          await tx.platformBillingNotificationAttempt.findMany({
            where: {
              deliveryId: candidate.id,
              merchantId: candidate.merchantId
            },
            select: {
              id: true,
              outcome: true,
              requestStartedAt: true,
              claimId: true,
              attemptNumber: true
            }
          });

        const prepared = attempts.filter(
          (attempt) => attempt.outcome === "PREPARED"
        );

        const consistentPrepared =
          delivery.status === "SENDING" &&
          delivery.claimId !== null &&
          prepared.length === 1 &&
          prepared[0].claimId === delivery.claimId &&
          prepared[0].attemptNumber === delivery.attemptCount &&
          prepared[0].requestStartedAt === null;

        const unsafeHistory = attempts.some(
          (attempt) =>
            attempt.requestStartedAt !== null ||
            (
              attempt.outcome !== "FAILED_PRE_SEND" &&
              attempt.outcome !== "PREPARED"
            ) ||
            (
              attempt.outcome === "PREPARED" &&
              !consistentPrepared
            )
        );

        const unsafe =
          unsafeHistory ||
          delivery.quarantined ||
          delivery.notificationStatus !== "PENDING";

        const action:
          "REQUEUED" | "REVIEW_REQUIRED" | "FAILED" =
          unsafe
            ? "REVIEW_REQUIRED"
            : delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS
              ? "FAILED"
              : "REQUEUED";

        if (
          action !== "REVIEW_REQUIRED" &&
          prepared.length === 1
        ) {
          await tx.platformBillingNotificationAttempt.update({
            where: { id: prepared[0].id },
            data: { outcome: "FAILED_PRE_SEND" }
          });
        }

        if (action === "REVIEW_REQUIRED") {
          await tx.platformBillingDeliveryQuarantine.upsert({
            where: { deliveryId: candidate.id },
            create: {
              deliveryId: candidate.id,
              merchantId: candidate.merchantId,
              reason: "EXPIRED_LEASE_REVIEW_REQUIRED"
            },
            update: {}
          });
        }

        await tx.platformBillingNotificationDelivery.update({
          where: { id: candidate.id },
          data: {
            status:
              action === "REQUEUED"
                ? "PENDING"
                : action,
            claimId: null,
            processingUntil: null,
            terminalReason:
              action === "REQUEUED"
                ? null
                : action === "FAILED"
                  ? "RECOVERY_ATTEMPTS_EXHAUSTED"
                  : "EXPIRED_LEASE_REVIEW_REQUIRED"
          }
        });

        return {
          recovered: true,
          deliveryId: candidate.id,
          action
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.ReadCommitted
      }
    );

    results.push(result);
  }

  return results;
}
