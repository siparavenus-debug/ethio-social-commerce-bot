
import {
    Prisma,
    prisma
  } from "@ethio-commerce/database";

  export type BillingTelegramPreferenceResult =
    | {
        ok: true;
        notificationsEnabled: boolean;
        suppressedDeliveries: number;
      }
    | {
        ok: false;
        reason:
          | "NOT_ELIGIBLE"
          | "UNSAFE_IN_FLIGHT";
      };

  class PreferenceRejected extends Error {
    constructor(
      readonly reason:
        | "NOT_ELIGIBLE"
        | "UNSAFE_IN_FLIGHT"
    ) {
      super("Billing Telegram preference change rejected");
    }
  }

  export async function updateBillingTelegramPreferences(
    merchantId: string,
    ownerUserId: string,
    ownerTokenVersion: number,
    notificationsEnabled: boolean
  ): Promise<BillingTelegramPreferenceResult> {
    if (typeof notificationsEnabled !== "boolean") {
      return {
        ok: false,
        reason: "NOT_ELIGIBLE"
      };
    }

    try {
      return await prisma.$transaction(
        async (tx): Promise<BillingTelegramPreferenceResult> => {
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
            throw new PreferenceRejected("NOT_ELIGIBLE");
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
            throw new PreferenceRejected("NOT_ELIGIBLE");
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
            throw new PreferenceRejected("NOT_ELIGIBLE");
          }

          const lockedDestinations = await tx.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT "id"
            FROM "MerchantBillingTelegramDestination"
            WHERE "merchantId" = ${merchantId}
              AND "status" = 'ACTIVE'
              AND "revokedAt" IS NULL
            FOR UPDATE
          `;

          if (lockedDestinations.length !== 1) {
            throw new PreferenceRejected("NOT_ELIGIBLE");
          }

          const destinationId = lockedDestinations[0].id;

          const destination =
            await tx.merchantBillingTelegramDestination.findFirst({
              where: {
                id: destinationId,
                merchantId,
                status: "ACTIVE",
                revokedAt: null
              },
              select: {
                id: true,
                linkVersion: true,
                notificationsEnabled: true
              }
            });

          if (!destination) {
            throw new PreferenceRejected("NOT_ELIGIBLE");
          }

          // Repeated requests with the same value do not
          // change delivery state or create duplicate audits.
          if (
            destination.notificationsEnabled ===
            notificationsEnabled
          ) {
            return {
              ok: true,
              notificationsEnabled,
              suppressedDeliveries: 0
            };
          }

          let suppressedDeliveries = 0;

          if (!notificationsEnabled) {
            const unsafeCount =
              await tx.platformBillingNotificationDelivery.count({
                where: {
                  merchantId,
                  destinationId,
                  OR: [
                    {
                      status: {
                        in: [
                          "PROCESSING",
                          "SENDING",
                          "REVIEW_REQUIRED"
                        ]
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
              throw new PreferenceRejected(
                "UNSAFE_IN_FLIGHT"
              );
            }

            const suppressed =
              await tx.platformBillingNotificationDelivery.updateMany({
                where: {
                  merchantId,
                  destinationId,
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
                  terminalReason:
                    "DESTINATION_NOTIFICATIONS_DISABLED",
                  claimId: null,
                  processingUntil: null
                }
              });

            suppressedDeliveries = suppressed.count;
          }

          const updated =
            await tx.merchantBillingTelegramDestination.updateMany({
              where: {
                id: destinationId,
                merchantId,
                status: "ACTIVE",
                revokedAt: null,
                notificationsEnabled:
                  destination.notificationsEnabled
              },
              data: {
                notificationsEnabled
              }
            });

          if (updated.count !== 1) {
            throw new PreferenceRejected("NOT_ELIGIBLE");
          }

          await tx.platformBillingNotificationAudit.create({
            data: {
              merchantId,
              actorType: "MERCHANT_OWNER",
              actorMerchantUserId: ownerUserId,
              action:
                "BILLING_TELEGRAM_PREFERENCES_UPDATED",
              entityType:
                "MerchantBillingTelegramDestination",
              entityId: destinationId,
              sanitizedMetadata: {
                destinationLinkVersion:
                  destination.linkVersion,
                previousNotificationsEnabled:
                  destination.notificationsEnabled,
                notificationsEnabled,
                suppressedDeliveries
              }
            }
          });

          return {
            ok: true,
            notificationsEnabled,
            suppressedDeliveries
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.ReadCommitted
        }
      );
    } catch (error) {
      if (error instanceof PreferenceRejected) {
        return {
          ok: false,
          reason: error.reason
        };
      }

      throw error;
    }
  }
