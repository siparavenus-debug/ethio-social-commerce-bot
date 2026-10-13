
import { prisma } from "@ethio-commerce/database";

const PROCESSING_LEASE_MINUTES = 5;

export async function claimMerchantInvitationDelivery() {
  const now = new Date();

  const processingUntil = new Date(
    now.getTime() +
      PROCESSING_LEASE_MINUTES * 60 * 1000
  );

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<
      Array<{ id: string }>
    >`
      SELECT d."id"
      FROM "MerchantInvitationDelivery" d
      INNER JOIN "MerchantOwnerActivation" a
        ON a."id" = d."activationId"
WHERE (
    (
      d."status" = 'PENDING'
      AND d."nextAttemptAt" <= ${now}
    )
    OR (
      d."status" = 'PROCESSING'
      AND d."processingUntil" <= ${now}
    )
  )
  AND a."expiresAt" > ${now}
  AND a."consumedAt" IS NULL
  AND d."attemptCount" < ${MAX_DELIVERY_ATTEMPTS}
      ORDER BY d."nextAttemptAt" ASC, d."createdAt" ASC
      LIMIT 1
      FOR UPDATE OF d SKIP LOCKED
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return null;
    }

    return tx.merchantInvitationDelivery.update({
      where: {
        id: candidate.id
      },
      data: {
        status: "PROCESSING",
        attemptCount: {
          increment: 1
        },
        processingUntil
      }
    });
  });
}


export async function completeMerchantInvitationDelivery(
    input: {
      deliveryId: string;
      attemptCount: number;
    }
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.attemptCount) ||
      input.attemptCount < 1
    ) {
      return false;
    }

    const result =
      await prisma.merchantInvitationDelivery.updateMany({
        where: {
          id: input.deliveryId,
          status: "PROCESSING",
          attemptCount: input.attemptCount,
          processingUntil: {
            gt: new Date()
          }
        },
        data: {
          status: "SENT",
          sentAt: new Date(),
          processingUntil: null,
          encryptedToken: null,
          lastError: null
        }
      });

    return result.count === 1;
  }


  const MAX_DELIVERY_ATTEMPTS = 5;
  const RETRY_BASE_DELAY_MINUTES = 2;

  export async function failMerchantInvitationDelivery(
    input: {
      deliveryId: string;
      attemptCount: number;
      errorMessage: string;
    }
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.attemptCount) ||
      input.attemptCount < 1
    ) {
      return false;
    }

    const exhausted =
      input.attemptCount >= MAX_DELIVERY_ATTEMPTS;

    const retryDelayMinutes =
      RETRY_BASE_DELAY_MINUTES *
      2 ** (input.attemptCount - 1);

    const nextAttemptAt = new Date(
      Date.now() + retryDelayMinutes * 60 * 1000
    );

    // Store a generic diagnostic rather than an
    // untrusted provider error that could contain
    // activation links, tokens, or credentials.
    const safeError =
      "Merchant invitation email delivery failed";

    const result =
      await prisma.merchantInvitationDelivery.updateMany({
        where: {
          id: input.deliveryId,
          status: "PROCESSING",
          attemptCount: input.attemptCount,
          processingUntil: {
            gt: new Date()
          }
        },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          processingUntil: null,
          nextAttemptAt,
          lastError: safeError,
          ...(exhausted
            ? { encryptedToken: null }
            : {})
        }
      });

    return result.count === 1;
  }


export async function cleanupExpiredMerchantInvitations(): Promise<number> {
    const now = new Date();

    const result =
      await prisma.merchantInvitationDelivery.updateMany({
        where: {
          status: {
            in: ["PENDING", "PROCESSING"]
          },
          OR: [
            {
              activation: {
                expiresAt: {
                  lte: now
                }
              }
            },
            {
              activation: {
                consumedAt: {
                  not: null
                }
              }
            }
          ]
        },
        data: {
          status: "FAILED",
          encryptedToken: null,
          processingUntil: null,
          lastError:
            "Merchant activation invitation expired or was consumed"
        }
      });

    return result.count;
  }


  export async function isMerchantInvitationReadyToSend(
    input: {
      deliveryId: string;
      attemptCount: number;
    }
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.attemptCount) ||
      input.attemptCount < 1
    ) {
      return false;
    }

    const now = new Date();

    const delivery =
      await prisma.merchantInvitationDelivery.findFirst({
        where: {
          id: input.deliveryId,
          status: "PROCESSING",
          attemptCount: input.attemptCount,
          processingUntil: {
            gt: now
          },
          encryptedToken: {
            not: null
          },
          activation: {
            expiresAt: {
              gt: now
            },
            consumedAt: null
          }
        },
        select: {
          id: true
        }
      });

    return delivery !== null;
  }


export async function permanentlyFailMerchantInvitationDelivery(
    input: {
      deliveryId: string;
      attemptCount: number;
    }
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.attemptCount) ||
      input.attemptCount < 1
    ) {
      return false;
    }

    const result =
      await prisma.merchantInvitationDelivery.updateMany({
        where: {
          id: input.deliveryId,
          status: "PROCESSING",
          attemptCount: input.attemptCount,
          processingUntil: {
            gt: new Date()
          }
        },
        data: {
          status: "FAILED",
          encryptedToken: null,
          processingUntil: null,
          sentAt: null,
          lastError:
            "Merchant invitation token is invalid"
        }
      });

    return result.count === 1;
  }
