import {
    randomBytes
  } from "node:crypto";

  import { Router } from "express";

  import {
    MerchantTelegramIntegrationStatus,
    Prisma,
    prisma
  } from "@ethio-commerce/database";

  import {
    getPublicApiBaseUrl
  } from "../config/env.js";

  import {
    requireAuth,
    requireMerchantAccess,
    requireRole
  } from "../middleware/auth.js";

  import {
    requireMerchantEntitlement
  } from "../middleware/subscription-entitlement.js";

  import {
    decryptTelegramCredential,
    encryptTelegramCredential
  } from "../services/telegram-credential-encryption.js";

  import {
    deleteTelegramWebhook,
    getTelegramBotIdentity,
    setTelegramWebhook
  } from "../services/telegram.js";

  const router = Router();

  router.use(requireAuth);

  function createWebhookKey(): string {
    return randomBytes(32)
      .toString("base64url");
  }

  function createWebhookSecret(): string {
    return randomBytes(32)
      .toString("base64url");
  }

  type TelegramIntegrationResponse = {
    id: string;
    merchantId: string;
    telegramBotUsername: string | null;
    status:
      typeof MerchantTelegramIntegrationStatus[
        keyof typeof MerchantTelegramIntegrationStatus
      ];
    createdAt: Date;
    updatedAt: Date;
  };

  function toTelegramIntegrationResponse(
    integration: TelegramIntegrationResponse
  ): TelegramIntegrationResponse {
    return {
      id: integration.id,
      merchantId: integration.merchantId,
      telegramBotUsername:
        integration.telegramBotUsername,
      status: integration.status,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt
    };
  }

  router.get(
    "/:merchantId/telegram-integration",
    requireMerchantAccess,
    async (req, res) => {
      const merchantId =
        String(req.params.merchantId);

      const integration =
        await prisma.merchantTelegramIntegration.findUnique({
          where: {
            merchantId
          },
          select: {
            id: true,
            merchantId: true,
            telegramBotUsername: true,
            status: true,
            createdAt: true,
            updatedAt: true
          }
        });

      if (!integration) {
        res.status(404).json({
          error:
            "Telegram integration not found"
        });

        return;
      }

      res.json(
        toTelegramIntegrationResponse(
          integration
        )
      );
    }
  );

  router.post(
    "/:merchantId/telegram-integration",
    requireMerchantAccess,
    requireMerchantEntitlement(
      "MUTATE_COMMERCE_CONFIG"
    ),
    requireRole("OWNER", "ADMIN"),
    async (req, res) => {
      try {
        const merchantId =
          String(req.params.merchantId);

        const {
          botToken
        } = req.body;

        if (
          typeof botToken !== "string" ||
          botToken.trim().length === 0
        ) {
          res.status(400).json({
            error:
              "botToken is required"
          });

          return;
        }

        const existingIntegration =
          await prisma.merchantTelegramIntegration.findUnique({
            where: {
              merchantId
            },
            select: {
              id: true,
              webhookKey: true,
              telegramBotId: true,
              telegramBotUsername: true,
              botTokenEncrypted: true,
              webhookSecretEncrypted: true,
              status: true
            }
          });

        if (existingIntegration) {
          res.status(409).json({
            error:
              "Telegram integration already exists"
          });

          return;
        }

        const webhookKey =
          createWebhookKey();

        const webhookSecret =
          createWebhookSecret();

        const webhookUrl =
          `${getPublicApiBaseUrl()}/webhooks/telegram/${webhookKey}`;

        const botIdentity =
          await getTelegramBotIdentity(
            botToken.trim()
          );

        const telegramBotId =
          String(botIdentity.id);

          let provisioningIntegration: Awaited<ReturnType<typeof prisma.merchantTelegramIntegration.create>>;

          try {
            provisioningIntegration =
              await prisma.$transaction(
                async (tx) => {
                  const createdIntegration =
                    await tx.merchantTelegramIntegration.create({
                      data: {
                        merchantId,
                        webhookKey,
                        telegramBotId,
                        telegramBotUsername:
                          botIdentity.username ?? null,
                        botTokenEncrypted:
                          encryptTelegramCredential(
                            botToken.trim()
                          ),
                        webhookSecretEncrypted:
                          encryptTelegramCredential(
                            webhookSecret
                          ),
                        status:
                          MerchantTelegramIntegrationStatus.PROVISIONING
                      }
                    });

                  await tx.merchantTelegramBotClaim.create({
                    data: {
                      merchantId,
                      integrationId:
                        createdIntegration.id,
                      telegramBotId,
                      status:
                        "PENDING"
                    }
                  });

                  return createdIntegration;
                }
              );
          } catch (error) {
            if (
              error instanceof
                Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              res.status(409).json({
                error:
                  "Telegram integration already exists"
              });

              return;
            }

            throw error;
          }

          try {
            await setTelegramWebhook(
              botToken.trim(),
              webhookUrl,
              webhookSecret
            );
          } catch (webhookError) {
            await prisma.merchantTelegramIntegration.delete({
              where: {
                id:
                  provisioningIntegration.id
              }
            });

            throw webhookError;
          }

        let integration: Awaited<ReturnType<typeof prisma.merchantTelegramIntegration.update>>;

        try {
          integration =
            await prisma.$transaction(
              async (tx) => {
                const activatedIntegration =
                  await tx.merchantTelegramIntegration.update({
                    where: {
                      id:
                        provisioningIntegration.id
                    },
                    data: {
                      status:
                        MerchantTelegramIntegrationStatus.ACTIVE
                    }
                  });

                const promotedClaim =
                  await tx.merchantTelegramBotClaim.updateMany({
                    where: {
                      merchantId,
                      integrationId:
                        provisioningIntegration.id,
                      telegramBotId,
                      status:
                        "PENDING"
                    },
                    data: {
                      status:
                        "ACTIVE"
                    }
                  });

                if (
                  promotedClaim.count !== 1
                ) {
                  throw new Error(
                    "Telegram pending bot claim changed concurrently"
                  );
                }

                await tx.auditLog.create({
                  data: {
                    merchantId,
                    actorUserId:
                      req.auth!.id,
                    action:
                      "TELEGRAM_INTEGRATION_CREATED",
                    entityType:
                      "TELEGRAM_INTEGRATION",
                    entityId:
                      activatedIntegration.id
                  }
                });

                return activatedIntegration;
              }
            );
          } catch (persistenceError) {
            try {
              await deleteTelegramWebhook(
                botToken.trim()
              );

              await prisma.merchantTelegramIntegration.delete({
                where: {
                  id:
                    provisioningIntegration.id
                }
              });
            } catch (cleanupError) {
              console.error(
                "Failed to clean up Telegram integration after activation failure:",
                cleanupError
              );
            }

            throw persistenceError;
          }

        res.status(201).json(
          toTelegramIntegrationResponse(
            integration
          )
        );
      } catch (error) {
        console.error(
          "Failed to create Telegram integration:",
          error
        );

        if (
          error instanceof Error &&
          error.message.includes(
            "Unique constraint"
          )
        ) {
          res.status(409).json({
            error:
              "Telegram integration already exists"
          });

          return;
        }

        res.status(500).json({
          error:
            "Failed to create Telegram integration"
        });
      }
    }
  );

  router.patch(
    "/:merchantId/telegram-integration",
    requireMerchantAccess,
    requireMerchantEntitlement(
      "MUTATE_COMMERCE_CONFIG"
    ),
    requireRole("OWNER", "ADMIN"),
    async (req, res) => {
      try {
        const merchantId =
          String(req.params.merchantId);

        const {
          botToken,
          webhookSecret,
          status
        } = req.body;

        const existing =
          await prisma.merchantTelegramIntegration.findUnique({
            where: {
              merchantId
            },
            select: {
              id: true,
              webhookKey: true,
              telegramBotId: true,
              telegramBotUsername: true,
              botTokenEncrypted: true,
              webhookSecretEncrypted: true,
              status: true
            }
          });

        if (!existing) {
          res.status(404).json({
            error:
              "Telegram integration not found"
          });

          return;
        }

        if (
          botToken !== undefined &&
          (
            typeof botToken !== "string" ||
            botToken.trim().length === 0
          )
        ) {
          res.status(400).json({
            error:
              "botToken must be a non-empty string"
          });

          return;
        }

        if (webhookSecret !== undefined) {
          res.status(400).json({
            error:
              "webhookSecret is managed by the server"
          });

          return;
        }

        if (
          status !== undefined &&
          (
            status !==
              MerchantTelegramIntegrationStatus.ACTIVE &&
            status !==
              MerchantTelegramIntegrationStatus.INACTIVE
          )
        ) {
          res.status(400).json({
            error:
              "status must be ACTIVE or INACTIVE"
          });

          return;
        }

        let replacementBotIdentity:
          Awaited<
            ReturnType<
              typeof getTelegramBotIdentity
            >
          > | null = null;

        if (botToken !== undefined) {
          replacementBotIdentity =
            await getTelegramBotIdentity(
              botToken.trim()
            );
        }

        const replacementWebhookSecret =
          replacementBotIdentity
            ? createWebhookSecret()
            : null;

        const replacementWebhookUrl =
          replacementBotIdentity
            ? `${getPublicApiBaseUrl()}/webhooks/telegram/${existing.webhookKey}`
            : null;

        const isDifferentTelegramBot =
          replacementBotIdentity !== null &&
          String(
            replacementBotIdentity.id
        ) !== existing.telegramBotId;

        if (
          replacementBotIdentity &&
          isDifferentTelegramBot
        ) {
          try {
            await prisma.merchantTelegramBotClaim.create({
              data: {
                merchantId,
                integrationId:
                  existing.id,
                telegramBotId:
                  String(
                    replacementBotIdentity.id
                  ),
                status:
                  "PENDING"
              }
            });
          } catch (error) {
            if (
              error instanceof
                Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              res.status(409).json({
                error:
                  "Telegram bot is already connected"
              });

              return;
            }

            throw error;
          }
        }

        if (
          replacementBotIdentity &&
          replacementWebhookSecret &&
          replacementWebhookUrl
        ) {
          try {
            await setTelegramWebhook(
              botToken.trim(),
              replacementWebhookUrl,
              replacementWebhookSecret
            );
          } catch (webhookError) {
            await prisma.merchantTelegramBotClaim.deleteMany({
              where: {
                merchantId,
                integrationId:
                  existing.id,
                telegramBotId:
                  String(
                    replacementBotIdentity.id
                  ),
                status:
                  "PENDING"
              }
            });

            throw webhookError;
          }
        }

        const changedFields: string[] = [];

        if (botToken !== undefined) {
          changedFields.push(
            "botToken"
          );
        }

        if (replacementWebhookSecret) {
          changedFields.push(
            "webhookSecret"
          );
        }

        if (replacementBotIdentity) {
          changedFields.push(
            "telegramBotId",
            "telegramBotUsername"
          );
        }

        if (status !== undefined) {
          changedFields.push(
            "status"
          );
        }

        let integration: Awaited<ReturnType<typeof prisma.merchantTelegramIntegration.update>>;

        try {
          integration =
            await prisma.$transaction(
            async (tx) => {
              const updatedIntegration =
                await tx.merchantTelegramIntegration.update({
                  where: {
                    merchantId
                  },
                  data: {
                    ...(replacementBotIdentity
                      ? {
                        telegramBotId:
                          String(
                            replacementBotIdentity.id
                          ),
                        telegramBotUsername:
                          replacementBotIdentity.username ??
                          null
                      }
                      : {}),
                    ...(botToken !== undefined
                      ? {
                        botTokenEncrypted:
                          encryptTelegramCredential(
                            botToken.trim()
                          )
                      }
                      : {}),
                    ...(replacementWebhookSecret
                      ? {
                        webhookSecretEncrypted:
                          encryptTelegramCredential(
                            replacementWebhookSecret
                          )
                      }
                      : {}),
                    ...(replacementBotIdentity
                      ? {
                        status:
                          status ??
                          MerchantTelegramIntegrationStatus.ACTIVE
                      }
                      : status !== undefined
                        ? {
                          status:
                            status as MerchantTelegramIntegrationStatus
                        }
                        : {})
                  }
                });

                if (
                  replacementBotIdentity &&
                  isDifferentTelegramBot
                ) {
                await tx.merchantTelegramBotClaim.deleteMany({
                  where: {
                    merchantId,
                    integrationId:
                      existing.id,
                    status:
                      "ACTIVE"
                  }
                });

                const promotedClaim =
                  await tx.merchantTelegramBotClaim.updateMany({
                    where: {
                      merchantId,
                      integrationId:
                        existing.id,
                      telegramBotId:
                        String(
                          replacementBotIdentity.id
                        ),
                      status:
                        "PENDING"
                    },
                    data: {
                      status:
                        "ACTIVE"
                    }
                  });

                if (
                  promotedClaim.count !== 1
                ) {
                  throw new Error(
                    "Telegram pending bot claim changed concurrently"
                  );
                }
              }

              if (
                changedFields.length > 0
              ) {
                await tx.auditLog.create({
                  data: {
                    merchantId,
                    actorUserId:
                      req.auth!.id,
                    action:
                      "TELEGRAM_INTEGRATION_UPDATED",
                    entityType:
                      "TELEGRAM_INTEGRATION",
                    entityId:
                      updatedIntegration.id,
                    metadata: {
                      changedFields
                    }
                  }
                });
              }

              return updatedIntegration;
            }
          );

        } catch (persistenceError) {
          if (
            replacementBotIdentity &&
            replacementWebhookSecret &&
            botToken !== undefined
          ) {
            const replacementBotToken =
              botToken.trim();

            const existingBotToken =
              decryptTelegramCredential(
                existing.botTokenEncrypted
              );

            const existingWebhookSecret =
              decryptTelegramCredential(
                existing.webhookSecretEncrypted
              );

            const webhookUrl =
              `${getPublicApiBaseUrl()}/webhooks/telegram/${existing.webhookKey}`;

            if (
              replacementBotToken !==
              existingBotToken
            ) {
              await deleteTelegramWebhook(
                replacementBotToken
              );
            }

            await setTelegramWebhook(
              existingBotToken,
              webhookUrl,
              existingWebhookSecret
            );

            await prisma.merchantTelegramBotClaim.deleteMany({
              where: {
                merchantId,
                integrationId:
                  existing.id,
                telegramBotId:
                  String(
                    replacementBotIdentity.id
                  ),
                status:
                  "PENDING"
              }
            });

          }

          throw persistenceError;
        }

        res.json(
          toTelegramIntegrationResponse(
            integration
          )
        );
      } catch (error) {
        console.error(
          "Failed to update Telegram integration:",
          error
        );

        res.status(500).json({
          error:
            "Failed to update Telegram integration"
        });
      }
    }
  );

  export default router;
