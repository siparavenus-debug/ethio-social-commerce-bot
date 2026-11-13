
import {
    Prisma,
    prisma
  } from "@ethio-commerce/database";

  export type BillingTelegramUnlinkResult =
    | {
        ok: true;
        unlinked: boolean;
      }
    | {
        ok: false;
        reason: "NOT_ELIGIBLE" | "UNSAFE_IN_FLIGHT";
      };

  class UnlinkRejected extends Error {
    constructor(
      readonly reason: "NOT_ELIGIBLE" | "UNSAFE_IN_FLIGHT"
    ) {
      super("Billing Telegram unlink rejected");
    }
  }

  export async function unlinkBillingTelegramDestination(
    merchantId: string,
    ownerUserId: string,
    ownerTokenVersion: number
  ): Promise<BillingTelegramUnlinkResult> {
    try {
      return await prisma.$transaction(
        async (tx): Promise<BillingTelegramUnlinkResult> => {
          const merchant = await tx.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT "id"
            FROM "Merchant"
            WHERE "id" = ${merchantId}
              AND "accountStatus" = 'ACTIVE'
            FOR UPDATE
          `;

          if (merchant.length !== 1) {
            throw new UnlinkRejected("NOT_ELIGIBLE");
          }

          const lockedOwner = await tx.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT "id"
            FROM "MerchantUser"
            WHERE "id" = ${ownerUserId}
              AND "merchantId" = ${merchantId}
            FOR UPDATE
          `;

          if (lockedOwner.length !== 1) {
            throw new UnlinkRejected("NOT_ELIGIBLE");
          }

          const owner = await tx.merchantUser.findFirst({
            where: {
              id: ownerUserId,
              merchantId,
              role: "OWNER",
              tokenVersion: ownerTokenVersion
            },
            select: { id: true }
          });

          if (!owner) {
            throw new UnlinkRejected("NOT_ELIGIBLE");
          }

          const destinations =
            await tx.merchantBillingTelegramDestination.findMany({
              where: {
                merchantId,
                status: "ACTIVE",
                revokedAt: null
              },
              select: {
                id: true,
                linkVersion: true
              }
            });

          if (destinations.length > 1) {
            throw new UnlinkRejected("NOT_ELIGIBLE");
          }

          const destination = destinations[0];

          if (destination) {

            const unsafeCount =
            await tx.platformBillingNotificationDelivery.count({
              where: {
                merchantId,
                destinationId: destination.id,
                OR: [
                  {
                    status: {
                      in: ["PROCESSING", "SENDING", "REVIEW_REQUIRED"]
                    }
                  },
                  {
                    attempts: {
                      some: {
                        OR: [
  {
    outcome: {
      not: "FAILED_PRE_SEND"
    }
  },
  {
    requestStartedAt: {
      not: null
    }
  }
]
                      }
                    }
                  }
                ]
              }
            });

            if (unsafeCount > 0) {
              throw new UnlinkRejected("UNSAFE_IN_FLIGHT");
            }

            await tx.platformBillingNotificationDelivery.updateMany({
              where: {
                merchantId,
                destinationId: destination.id,
                status: {
                  in: ["PENDING", "FAILED"]
                },
                attempts: {
                  none: {
                    OR: [
                      {
                        outcome: {
                          not: "FAILED_PRE_SEND"
                        }
                      },
                      {
                        requestStartedAt: {
                          not: null
                        }
                      }
                    ]
                  }
                }
              },
              data: {
                status: "SUPPRESSED",
                terminalReason: "DESTINATION_UNLINKED",
                claimId: null,
                processingUntil: null
              }
            });

            const revoked =
              await tx.merchantBillingTelegramDestination.updateMany({
                where: {
                  id: destination.id,
                  merchantId,
                  status: "ACTIVE",
                  revokedAt: null
                },
                data: {
                  status: "REVOKED",
                  revokedAt: new Date()
                }
              });

            if (revoked.count !== 1) {
              throw new UnlinkRejected("NOT_ELIGIBLE");
            }

            await tx.platformBillingNotificationAudit.create({
              data: {
                merchantId,
                actorType: "MERCHANT_OWNER",
                actorMerchantUserId: ownerUserId,
                action: "BILLING_TELEGRAM_DESTINATION_UNLINKED",
                entityType: "MerchantBillingTelegramDestination",
                entityId: destination.id,
                sanitizedMetadata: {
                  destinationLinkVersion: destination.linkVersion
                }
              }
            });
          }

          await tx.platformTelegramLinkToken.updateMany({
            where: {
              merchantId,
              consumedAt: null,
              revokedAt: null
            },
            data: {
              revokedAt: new Date()
            }
          });

          return {
            ok: true,
            unlinked: Boolean(destination)
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    } catch (error) {
      if (error instanceof UnlinkRejected) {
        return {
          ok: false,
          reason: error.reason
        };
      }

      throw error;
    }
  }
