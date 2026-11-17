import {
  Prisma,
  prisma
} from "@ethio-commerce/database";

export type BillingTelegramRedemptionRequest = {
  tokenHash: string;
  platformBotId: string;
  chatId: string;
  telegramUserId: string;
};

export type BillingTelegramWebhookClaim = {
  eventId: string;
  claimId: string;
};
export type BillingTelegramRedemptionResult =
  | {
      ok: true;
      value: {
        destinationId: string;
        merchantId: string;
        replacedPreviousDestination: boolean;
      };
    }
  | {
      ok: false;
      reason: "NOT_ELIGIBLE" | "REPLACEMENT_UNSAFE" | "DESTINATION_CONFLICT";
    };

class RedemptionRejected extends Error {
  constructor(
    readonly reason:
      | "NOT_ELIGIBLE"
      | "REPLACEMENT_UNSAFE"
      | "DESTINATION_CONFLICT"
  ) {
    super("Billing Telegram redemption rejected");
  }
}

const notEligible = {
  ok: false as const,
  reason: "NOT_ELIGIBLE" as const
};

function validTelegramId(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/.test(value)
  ) {
    return false;
  }

  return Number.isSafeInteger(Number(value));
}

export async function redeemBillingTelegramLink(
  input: BillingTelegramRedemptionRequest,
  webhookClaim?: BillingTelegramWebhookClaim
): Promise<BillingTelegramRedemptionResult> {
  if (
    !input ||
    typeof input.tokenHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.tokenHash) ||
    typeof input.platformBotId !== "string" ||
    input.platformBotId.length === 0 ||
    !validTelegramId(input.chatId) ||
    !validTelegramId(input.telegramUserId) ||
    input.chatId !== input.telegramUserId
  ) {
    return notEligible;
  }

  // Discovery only. This is not an authorization decision.
  const candidate = await prisma.platformTelegramLinkToken.findUnique({
    where: { tokenHash: input.tokenHash },
    select: {
      id: true,
      merchantId: true
    }
  });

  if (!candidate) {
    return notEligible;
  }

  try {
    return await prisma.$transaction(
      async (tx): Promise<BillingTelegramRedemptionResult> => {
        if (webhookClaim) {
          const lockedEvent = await tx.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT "id"
            FROM "PlatformBillingTelegramWebhookEvent"
            WHERE "id" = ${webhookClaim.eventId}
              AND "platformBotId" = ${input.platformBotId}
              AND "claimId" = ${webhookClaim.claimId}
              AND "status" = 'PROCESSING'
              AND "processingUntil" > NOW()
            FOR UPDATE
          `;

          if (lockedEvent.length !== 1) {
            throw new Error(
              "Billing Telegram webhook claim ownership lost"
            );
          }
        }
        // Coordinate with issuance and merchant suspension.
        const merchant = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "Merchant"
          WHERE "id" = ${candidate.merchantId}
            AND "accountStatus" = 'ACTIVE'
          FOR UPDATE
        `;

        if (merchant.length !== 1) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        // Coordinate with concurrent token revocation or redemption.
        const lockedToken = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "PlatformTelegramLinkToken"
          WHERE "id" = ${candidate.id}
            AND "merchantId" = ${candidate.merchantId}
            AND "tokenHash" = ${input.tokenHash}
          FOR UPDATE
        `;

        if (lockedToken.length !== 1) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        const token = await tx.platformTelegramLinkToken.findUnique({
          where: { id: candidate.id },
          select: {
            id: true,
            merchantId: true,
            createdByUserId: true,
            createdByTokenVersion: true,
            expiresAt: true,
            consumedAt: true,
            revokedAt: true
          }
        });

        if (!token) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        // Synchronize with password reset and OWNER role changes.
        const lockedOwner = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "MerchantUser"
          WHERE "id" = ${token.createdByUserId}
            AND "merchantId" = ${token.merchantId}
          FOR UPDATE
        `;

        if (lockedOwner.length !== 1) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        const owner = await tx.merchantUser.findFirst({
          where: {
            id: token.createdByUserId,
            merchantId: token.merchantId,
            role: "OWNER",
            tokenVersion: token.createdByTokenVersion
          },
          select: { id: true }
        });

        const now = new Date();

        if (
          !owner ||
          token.consumedAt !== null ||
          token.revokedAt !== null ||
          token.expiresAt.getTime() <= now.getTime()
        ) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        // Resolve the bot from a trusted server-supplied identifier.
        const bot = await tx.platformBillingTelegramBot.findUnique({
          where: { id: input.platformBotId },
          select: {
            id: true,
            botIdentityId: true
          }
        });

        if (!bot) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        // Coordinate with merchant-commerce ownership operations.
        const lockedIdentity = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "TelegramBotIdentityRegistry"
          WHERE "id" = ${bot.botIdentityId}
          FOR UPDATE
        `;

        if (lockedIdentity.length !== 1) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        const lockedBot = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "PlatformBillingTelegramBot"
          WHERE "id" = ${bot.id}
            AND "botIdentityId" = ${bot.botIdentityId}
            AND "status" = 'ACTIVE'
          FOR UPDATE
        `;

        if (lockedBot.length !== 1) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        const reservation =
          await tx.telegramBotOwnershipReservation.findFirst({
            where: {
              botIdentityId: bot.botIdentityId,
              platformBillingBotId: bot.id,
              ownerType: "PLATFORM_BILLING",
              status: "RESERVED",
              releasedAt: null,
              merchantId: null,
              merchantIntegrationId: null
            },
            select: { id: true }
          });

        if (!reservation) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        const previous =
          await tx.merchantBillingTelegramDestination.findMany({
            where: {
              merchantId: token.merchantId,
              status: "ACTIVE"
            },
            select: { id: true }
          });

        if (previous.length > 1) {
          throw new RedemptionRejected("DESTINATION_CONFLICT");
        }

        if (previous.length === 1) {
          // Only known terminal delivery states permit replacement.
          // FAILED and REVIEW_REQUIRED remain conservatively blocked.
          const unsafeDeliveries =
            await tx.platformBillingNotificationDelivery.count({
              where: {
                merchantId: token.merchantId,
                destinationId: previous[0].id,
                status: {
                  notIn: ["SENT", "SUPPRESSED"]
                }
              }
            });

          if (unsafeDeliveries > 0) {
            throw new RedemptionRejected("REPLACEMENT_UNSAFE");
          }

          const revoked =
            await tx.merchantBillingTelegramDestination.updateMany({
              where: {
                id: previous[0].id,
                merchantId: token.merchantId,
                status: "ACTIVE",
                revokedAt: null
              },
              data: {
                status: "REVOKED",
                revokedAt: now
              }
            });

          if (revoked.count !== 1) {
            throw new RedemptionRejected("DESTINATION_CONFLICT");
          }
        }

        const destination =
          await tx.merchantBillingTelegramDestination.create({
            data: {
              merchantId: token.merchantId,
              platformBotId: bot.id,
              chatId: input.chatId,
              telegramUserId: input.telegramUserId,
              linkedByUserId: token.createdByUserId,
              status: "ACTIVE",
              linkVersion: 1,
              consentedAt: now
            },
            select: { id: true }
          });

        const consumed = await tx.platformTelegramLinkToken.updateMany({
          where: {
            id: token.id,
            merchantId: token.merchantId,
            consumedAt: null,
            revokedAt: null,
            expiresAt: { gt: now }
          },
          data: { consumedAt: now }
        });

        if (consumed.count !== 1) {
          throw new RedemptionRejected("NOT_ELIGIBLE");
        }

        await tx.platformBillingNotificationAudit.create({
          data: {
            merchantId: token.merchantId,
            actorType: "MERCHANT_OWNER",
            actorMerchantUserId: token.createdByUserId,
            actorPlatformUserId: null,
            action: previous.length === 1
              ? "BILLING_TELEGRAM_DESTINATION_REPLACED"
              : "BILLING_TELEGRAM_DESTINATION_LINKED",
            entityType: "BILLING_TELEGRAM_DESTINATION",
            entityId: destination.id,
            sanitizedMetadata: {
              replacedPreviousDestination: previous.length === 1
            }
          }
        });

        if (webhookClaim) {
          const completed =
            await tx.platformBillingTelegramWebhookEvent.updateMany({
              where: {
                id: webhookClaim.eventId,
                platformBotId: input.platformBotId,
                claimId: webhookClaim.claimId,
                status: "PROCESSING",
                processingUntil: {
                  gt: new Date()
                }
              },
              data: {
                status: "PROCESSED",
                sanitizedPayload: {
                  confirmationStatus: "PENDING",
                  confirmationChatId: input.chatId
                },
                terminalReason: null,
                claimId: null,
                processingUntil: null,
                processedAt: new Date()
              }
            });

          if (completed.count !== 1) {
            throw new Error(
              "Billing Telegram webhook completion failed"
            );
          }
        }
        return {
          ok: true,
          value: {
            destinationId: destination.id,
            merchantId: token.merchantId,
            replacedPreviousDestination: previous.length === 1
          }
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
      }
    );
  } catch (error) {
    if (error instanceof RedemptionRejected) {
      return {
        ok: false,
        reason: error.reason
      };
    }

    // Database errors and uniqueness conflicts propagate.
    // Callers must not interpret them as successful redemption.
    throw error;
  }
}
