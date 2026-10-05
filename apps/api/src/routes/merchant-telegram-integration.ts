import {
    randomBytes
  } from "node:crypto";

  import { Router } from "express";

  import {
    MerchantTelegramIntegrationStatus,
    prisma
  } from "@ethio-commerce/database";

  import {
    requireAuth,
    requireMerchantAccess,
    requireRole
  } from "../middleware/auth.js";

  import {
    requireMerchantEntitlement
  } from "../middleware/subscription-entitlement.js";

  import {
    encryptTelegramCredential
  } from "../services/telegram-credential-encryption.js";

  const router = Router();

  router.use(requireAuth);

  function createWebhookKey(): string {
    return randomBytes(32)
      .toString("base64url");
  }

  type TelegramIntegrationResponse = {
    id: string;
    merchantId: string;
    webhookKey: string;
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
      webhookKey: integration.webhookKey,
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
            webhookKey: true,
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
          botToken,
          webhookSecret,
          status
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

        if (
          typeof webhookSecret !== "string" ||
          webhookSecret.trim().length === 0
        ) {
          res.status(400).json({
            error:
              "webhookSecret is required"
          });

          return;
        }

        if (
          status !== undefined &&
          (
            typeof status !== "string" ||
            !Object.values(
              MerchantTelegramIntegrationStatus
            ).includes(
              status as MerchantTelegramIntegrationStatus
            )
          )
        ) {
          res.status(400).json({
            error:
              "status must be ACTIVE or INACTIVE"
          });

          return;
        }

        const existingIntegration =
          await prisma.merchantTelegramIntegration.findUnique({
            where: {
              merchantId
            },
            select: {
              id: true
            }
          });

        if (existingIntegration) {
          res.status(409).json({
            error:
              "Telegram integration already exists"
          });

          return;
        }

        const integration =
          await prisma.$transaction(
            async (tx) => {
              const createdIntegration =
                await tx.merchantTelegramIntegration.create({
                  data: {
                    merchantId,
                    webhookKey:
                      createWebhookKey(),
                    botTokenEncrypted:
                      encryptTelegramCredential(
                        botToken.trim()
                      ),
                    webhookSecretEncrypted:
                      encryptTelegramCredential(
                        webhookSecret.trim()
                      ),
                    status:
                      status === undefined
                        ? MerchantTelegramIntegrationStatus.ACTIVE
                        : (
                          status as MerchantTelegramIntegrationStatus
                        )
                  }
                });

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
                    createdIntegration.id
                }
              });

              return createdIntegration;
            }
          );

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
              id: true
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

        if (
          webhookSecret !== undefined &&
          (
            typeof webhookSecret !== "string" ||
            webhookSecret.trim().length === 0
          )
        ) {
          res.status(400).json({
            error:
              "webhookSecret must be a non-empty string"
          });

          return;
        }

        if (
          status !== undefined &&
          (
            typeof status !== "string" ||
            !Object.values(
              MerchantTelegramIntegrationStatus
            ).includes(
              status as MerchantTelegramIntegrationStatus
            )
          )
        ) {
          res.status(400).json({
            error:
              "status must be ACTIVE or INACTIVE"
          });

          return;
        }

        const changedFields: string[] = [];

        if (botToken !== undefined) {
          changedFields.push(
            "botToken"
          );
        }

        if (webhookSecret !== undefined) {
          changedFields.push(
            "webhookSecret"
          );
        }

        if (status !== undefined) {
          changedFields.push(
            "status"
          );
        }

        const integration =
          await prisma.$transaction(
            async (tx) => {
              const updatedIntegration =
                await tx.merchantTelegramIntegration.update({
                  where: {
                    merchantId
                  },
                  data: {
                    ...(botToken !== undefined
                      ? {
                        botTokenEncrypted:
                          encryptTelegramCredential(
                            botToken.trim()
                          )
                      }
                      : {}),
                    ...(webhookSecret !== undefined
                      ? {
                        webhookSecretEncrypted:
                          encryptTelegramCredential(
                            webhookSecret.trim()
                          )
                      }
                      : {}),
                    ...(status !== undefined
                      ? {
                        status:
                          status as MerchantTelegramIntegrationStatus
                      }
                      : {})
                  }
                });

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
