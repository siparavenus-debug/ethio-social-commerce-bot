import type {
    Server
  } from "node:http";

  import express from "express";

  import {
    MerchantSubscriptionStatus,
    MerchantTelegramIntegrationStatus,
    Prisma,
    SubscriptionBillingInterval,
    prisma
  } from "@ethio-commerce/database";

  import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  const telegramMocks =
    vi.hoisted(() => ({
      getTelegramBotIdentity:
        vi.fn(),
      setTelegramWebhook:
        vi.fn(),
      deleteTelegramWebhook:
        vi.fn(),
      getTelegramWebhookInfo:
        vi.fn()
    }));

  const configMocks =
    vi.hoisted(() => ({
      getPublicApiBaseUrl:
        vi.fn(() =>
          "http://127.0.0.1:3000"
        )
    }));

  vi.mock(
    "../src/config/env.js",
    async (importOriginal) => {
      const actual =
        await importOriginal<
          typeof import("../src/config/env.js")
        >();

      return {
        ...actual,
        getPublicApiBaseUrl:
          configMocks.getPublicApiBaseUrl
      };
    }
  );

  vi.mock(
    "../src/services/telegram.js",
    () => telegramMocks
  );

  import merchantTelegramIntegrationRouter
    from "../src/routes/merchant-telegram-integration.js";

  import {
    createAuthToken
  } from "../src/services/auth.js";

  import {
    decryptTelegramCredential,
    encryptTelegramCredential
  } from "../src/services/telegram-credential-encryption.js";

  const testPrefix =
    "telegram-integration-route";

  let server: Server | undefined;
  let apiBaseUrl = "";

  async function cleanup() {
    const merchants =
      await prisma.merchant.findMany({
        where: {
          name: {
            startsWith:
              testPrefix
          }
        },
        select: {
          id: true
        }
      });

    const merchantIds =
      merchants.map(
        (merchant) =>
          merchant.id
      );

    if (merchantIds.length === 0) {
      return;
    }

    await prisma.auditLog.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantTelegramIntegration.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantSubscription.deleteMany({
        where: {
          merchantId: {
            in:
              merchantIds
          }
        }
      });

    await prisma.merchantUser.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchant.deleteMany({
      where: {
        id: {
          in:
            merchantIds
        }
      }
    });

    await prisma.subscriptionPlan.deleteMany({
        where: {
          code: {
            startsWith:
              testPrefix
          }
        }
      });
  }

  async function createFixture() {
    const merchant =
      await prisma.merchant.create({
        data: {
          name:
            `${testPrefix}-merchant`,
          currency:
            "ETB"
        }
      });

    const user =
      await prisma.merchantUser.create({
        data: {
          merchantId:
            merchant.id,
          email:
            `${testPrefix}@example.test`,
          passwordHash:
            "test-password-hash",
          role:
            "OWNER",
          tokenVersion:
            0
        }
      });

    const botToken =
      "test-telegram-bot-token";

    const webhookSecret =
      "test-telegram-webhook-secret";

    const integration =
      await prisma.merchantTelegramIntegration.create({
        data: {
          merchantId:
            merchant.id,
          webhookKey:
            "test-telegram-webhook-key",
          telegramBotId:
            "123456789",
          telegramBotUsername:
            "test_shop_bot",
          botTokenEncrypted:
            encryptTelegramCredential(
              botToken
            ),
          webhookSecretEncrypted:
            encryptTelegramCredential(
              webhookSecret
            ),
          status:
            MerchantTelegramIntegrationStatus.ACTIVE
        }
      });

      await prisma.merchantTelegramBotClaim.create({
        data: {
          merchantId:
            merchant.id,
          integrationId:
            integration.id,
          telegramBotId:
            "123456789",
          status:
            "ACTIVE"
        }
      });

    const token =
      createAuthToken({
        id:
          user.id,
        merchantId:
          merchant.id,
        role:
          user.role,
        tokenVersion:
          user.tokenVersion
      });

    return {
      merchant,
      user,
      integration,
      token,
      botToken,
      webhookSecret
    };
  }

  async function createActiveSubscription(
    merchantId: string
  ) {
    const plan =
      await prisma.subscriptionPlan.create({
        data: {
          code:
            `${testPrefix}-plan`,
          name:
            "Telegram Integration Test Plan",
          monthlyPrice:
            "500.00",
          annualPrice:
            "5000.00",
          currency:
            "ETB",
          commissionRate:
            "0.035000",
          isActive:
            true
        }
      });

    return prisma.merchantSubscription.create({
      data: {
        merchantId,
        planId:
          plan.id,
        status:
          MerchantSubscriptionStatus.ACTIVE,
        billingInterval:
          SubscriptionBillingInterval.MONTHLY,
        priceSnapshot:
          "500.00",
        commissionRateSnapshot:
          "0.035000",
        currency:
          "ETB",
        currentPeriodStart:
          new Date(
            "2026-10-01T00:00:00.000Z"
          ),
        currentPeriodEnd:
          new Date(
            "2026-11-01T00:00:00.000Z"
          )
      }
    });
  }

  beforeEach(
    async () => {
      vi.clearAllMocks();

      telegramMocks.getTelegramBotIdentity
        .mockResolvedValue({
          id: 123456789,
          username:
            "test_shop_bot",
          firstName:
            "Test Shop Bot"
        });

      telegramMocks.setTelegramWebhook
        .mockResolvedValue(
          undefined
        );

      telegramMocks.deleteTelegramWebhook
        .mockResolvedValue(
          undefined
        );

      telegramMocks.getTelegramWebhookInfo
        .mockResolvedValue({
          url: "",
          pendingUpdateCount: 0
        });

      await cleanup();
    }
  );

  beforeAll(
    async () => {
      const app =
        express();

      app.use(
        express.json()
      );

      app.use(
        "/merchants",
        merchantTelegramIntegrationRouter
      );

      await new Promise<void>(
        (resolve, reject) => {
          const listeningServer =
            app.listen(
              0,
              "127.0.0.1",
              () => {
                server =
                  listeningServer;

                resolve();
              }
            );

          listeningServer.on(
            "error",
            reject
          );
        }
      );

      const address =
        server?.address();

      if (
        !address ||
        typeof address === "string"
      ) {
        throw new Error(
          "Failed to start Telegram integration test server"
        );
      }

      apiBaseUrl =
        `http://127.0.0.1:${address.port}`;
    }
  );

  afterAll(
    async () => {
      if (server) {
        await new Promise<void>(
          (resolve, reject) => {
            server?.close(
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }

                resolve();
              }
            );
          }
        );
      }

      await cleanup();
      await prisma.$disconnect();
    }
  );

  describe(
    "merchant Telegram integration routes",
    () => {
      it(
        "returns only safe Telegram integration metadata for the authenticated merchant",
        async () => {
          const fixture =
            await createFixture();

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          expect(body).toEqual({
            id:
              fixture.integration.id,
            merchantId:
              fixture.merchant.id,
            telegramBotUsername:
              fixture.integration.telegramBotUsername,
            status:
              MerchantTelegramIntegrationStatus.ACTIVE,
            createdAt:
              fixture.integration.createdAt.toISOString(),
            updatedAt:
              fixture.integration.updatedAt.toISOString()
          });

          expect(
            JSON.stringify(body)
          ).not.toContain(
            fixture.botToken
          );

          expect(
            JSON.stringify(body)
          ).not.toContain(
            fixture.webhookSecret
          );

          expect(body).not.toHaveProperty(
            "botTokenEncrypted"
          );

          expect(body).not.toHaveProperty(
            "webhookSecretEncrypted"
          );
        }
      );

      it(
        "returns 404 when the authenticated merchant has no Telegram integration",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(404);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Telegram integration not found"
          });
        }
      );

      it(
        "rejects unauthenticated Telegram integration access",
        async () => {
          const fixture =
            await createFixture();

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`
            );

          expect(
            response.status
          ).toBe(401);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Authentication required"
          });
        }
      );

      it(
        "rejects cross-merchant Telegram integration access",
        async () => {
          const fixture =
            await createFixture();

          const otherMerchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-other-merchant`,
                currency:
                  "ETB"
              }
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${otherMerchant.id}/telegram-integration`,
              {
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(403);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "You are not authorized to access this merchant"
          });
        }
      );

      it(
        "does not reserve or mutate Telegram state when webhook configuration is invalid",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          configMocks.getPublicApiBaseUrl
            .mockImplementationOnce(
              () => {
                throw new Error(
                  "PUBLIC_API_BASE_URL must be configured before managing Telegram webhooks."
                );
              }
            );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "configuration-failure-bot-token"
                  })
              }
            );

          expect(
            response.status
          ).toBe(500);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Failed to create Telegram integration"
          });

          expect(
            telegramMocks.getTelegramBotIdentity
          ).not.toHaveBeenCalled();

          expect(
            telegramMocks.setTelegramWebhook
          ).not.toHaveBeenCalled();

          expect(
            telegramMocks.deleteTelegramWebhook
          ).not.toHaveBeenCalled();

          const integration =
            await prisma.merchantTelegramIntegration.findUnique({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(integration).toBeNull();

          const botClaims =
            await prisma.merchantTelegramBotClaim.findMany({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(botClaims).toHaveLength(0);

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED"
              }
            });

          expect(audit).toBeNull();
        }
      );

      it(
        "creates and audits an encrypted Telegram integration",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const botToken =
            "created-telegram-bot-token";

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                JSON.stringify({
                  botToken
                })
              }
            );

          expect(
            response.status
          ).toBe(201);

          const body =
            await response.json();

          expect(body).toMatchObject({
            merchantId:
              fixture.merchant.id,
            telegramBotUsername:
              "test_shop_bot",
            status:
              MerchantTelegramIntegrationStatus.ACTIVE
          });

          expect(body).not.toHaveProperty(
            "webhookKey"
          );

          expect(body).not.toHaveProperty(
            "botTokenEncrypted"
          );

          expect(body).not.toHaveProperty(
            "webhookSecretEncrypted"
          );

          expect(
            JSON.stringify(body)
          ).not.toContain(
            botToken
          );

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

            const botClaims =
            await prisma.merchantTelegramBotClaim.findMany({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(botClaims).toHaveLength(1);

          expect(botClaims[0]).toMatchObject({
            merchantId:
              fixture.merchant.id,
            integrationId:
              storedIntegration.id,
            telegramBotId:
              "123456789",
            status:
              "ACTIVE"
          });

          expect(
            storedIntegration.telegramBotId
          ).toBe(
            "123456789"
          );

          expect(
            storedIntegration.telegramBotUsername
          ).toBe(
            "test_shop_bot"
          );

          expect(
            storedIntegration.botTokenEncrypted
          ).not.toBe(botToken);

          const generatedWebhookSecret =
            decryptTelegramCredential(
              storedIntegration.webhookSecretEncrypted
           );

          expect(
            generatedWebhookSecret.length
          ).toBeGreaterThan(0);

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledWith(
            botToken
          );

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledTimes(1);

          expect(
            telegramMocks.setTelegramWebhook
          ).toHaveBeenCalledWith(
            botToken,
            `http://127.0.0.1:3000/webhooks/telegram/${storedIntegration.webhookKey}`,
            generatedWebhookSecret
          );

          expect(
            telegramMocks.setTelegramWebhook
          ).toHaveBeenCalledTimes(1);

          expect(
            storedIntegration.webhookSecretEncrypted
          ).not.toBe(
            generatedWebhookSecret
          );

          expect(
            storedIntegration.botTokenEncrypted
          ).toMatch(/^v1\./);

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toMatch(/^v1\./);

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                actorUserId:
                  fixture.user.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED",
                entityType:
                  "TELEGRAM_INTEGRATION",
                entityId:
                  storedIntegration.id
              }
            });

          expect(audit).not.toBeNull();

          expect(
            JSON.stringify(
              audit?.metadata ?? null
            )
          ).not.toContain(
            botToken
          );

          expect(
            JSON.stringify(
              audit?.metadata ?? null
            )
          ).not.toContain(
            generatedWebhookSecret
          );
        }
      );

      it(
        "rejects a Telegram bot already connected to another merchant before replacing its webhook",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const secondMerchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-second-merchant`,
                currency:
                  "ETB"
              }
            });

          const secondUser =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  secondMerchant.id,
                email:
                  `${testPrefix}-second@example.test`,
                passwordHash:
                  "test-password-hash",
                role:
                  "OWNER",
                tokenVersion:
                  0
              }
            });

          const existingSubscription =
            await prisma.merchantSubscription.findFirstOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          await prisma.merchantSubscription.create({
            data: {
              merchantId:
                secondMerchant.id,
              planId:
                existingSubscription.planId,
              status:
                MerchantSubscriptionStatus.ACTIVE,
              billingInterval:
                SubscriptionBillingInterval.MONTHLY,
              priceSnapshot:
                "500.00",
              commissionRateSnapshot:
                "0.035000",
              currency:
                "ETB",
              currentPeriodStart:
                new Date(
                  "2026-10-01T00:00:00.000Z"
                ),
              currentPeriodEnd:
                new Date(
                  "2026-11-01T00:00:00.000Z"
                )
            }
          });

          const secondToken =
            createAuthToken({
              id:
                secondUser.id,
              merchantId:
                secondMerchant.id,
              role:
                secondUser.role,
              tokenVersion:
                secondUser.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${secondMerchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${secondToken}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "same-bot-different-token-text"
                  })
              }
            );

          expect(
            response.status
          ).toBe(409);

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledWith(
            "same-bot-different-token-text"
          );

          expect(
            telegramMocks.setTelegramWebhook
          ).not.toHaveBeenCalled();

          expect(
            telegramMocks.deleteTelegramWebhook
          ).not.toHaveBeenCalled();

          const secondIntegration =
            await prisma.merchantTelegramIntegration.findUnique({
              where: {
                merchantId:
                  secondMerchant.id
              }
            });

          expect(
            secondIntegration
          ).toBeNull();

          const existingIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            existingIntegration.telegramBotId
          ).toBe(
            "123456789"
          );
        }
      );

      it(
        "does not persist an integration when Telegram webhook registration fails",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const botToken =
            "failed-webhook-bot-token";

          telegramMocks.setTelegramWebhook
            .mockRejectedValueOnce(
              new Error(
                "Telegram webhook registration failed"
              )
            );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken
                  })
              }
            );

          expect(
            response.status
          ).toBe(500);

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledWith(
            botToken
          );

          expect(
            telegramMocks.setTelegramWebhook
          ).toHaveBeenCalledTimes(1);

          expect(
            telegramMocks.deleteTelegramWebhook
          ).not.toHaveBeenCalled();

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUnique({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration
          ).toBeNull();

          const botClaims =
            await prisma.merchantTelegramBotClaim.findMany({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            botClaims
          ).toHaveLength(0);

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED"
              }
            });

          expect(audit).toBeNull();
        }
      );

      it(
        "deletes the Telegram webhook when persistence fails after registration",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const botToken =
            "persistence-failure-bot-token";

          const originalTransaction =
            prisma.$transaction.bind(
              prisma
            );

          const transactionSpy =
            vi.spyOn(
              prisma,
              "$transaction"
            );

          transactionSpy
            .mockImplementationOnce(
              ((...args: Parameters<
                typeof prisma.$transaction
              >) =>
                originalTransaction(
                  ...args
                )) as typeof prisma.$transaction
            )
            .mockRejectedValueOnce(
              new Error(
                "Simulated persistence failure"
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method:
                    "POST",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(500);

            expect(
              telegramMocks.getTelegramBotIdentity
            ).toHaveBeenCalledWith(
              botToken
            );

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledWith(
              botToken
            );

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUnique({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration
            ).toBeNull();

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_CREATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            transactionSpy.mockRestore();
          }
        }
      );

      it(
        "keeps the provisioning reservation when Telegram webhook cleanup fails",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const botToken =
            "cleanup-failure-bot-token";

          const originalTransaction =
            prisma.$transaction.bind(
              prisma
            );

          const transactionSpy =
            vi.spyOn(
              prisma,
              "$transaction"
            );

          transactionSpy
            .mockImplementationOnce(
              ((...args: Parameters<
                typeof prisma.$transaction
              >) =>
                originalTransaction(
                  ...args
                )) as typeof prisma.$transaction
            )
            .mockRejectedValueOnce(
              new Error(
                "Simulated persistence failure"
              )
            );

          telegramMocks.deleteTelegramWebhook
            .mockRejectedValueOnce(
              new Error(
                "Simulated Telegram cleanup failure"
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method:
                    "POST",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(500);

            expect(
              telegramMocks.getTelegramBotIdentity
            ).toHaveBeenCalledWith(
              botToken
            );

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledWith(
              botToken
            );

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUnique({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration
            ).not.toBeNull();

            expect(
              storedIntegration?.status
            ).toBe(
              MerchantTelegramIntegrationStatus.PROVISIONING
            );

            expect(
              storedIntegration?.telegramBotId
            ).toBe(
              "123456789"
            );

            const botClaims =
              await prisma.merchantTelegramBotClaim.findMany({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              botClaims
            ).toHaveLength(1);

            expect(
              botClaims[0]
            ).toMatchObject({
              merchantId:
                fixture.merchant.id,
              integrationId:
                storedIntegration!.id,
              telegramBotId:
                "123456789",
              status:
                "PENDING"
            });

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_CREATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            transactionSpy.mockRestore();
          }
        }
      );

      it(
        "does not register the Telegram webhook when bot claim reservation loses a uniqueness race",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const botToken =
            "telegram-bot-race-token";

          const transactionSpy =
            vi.spyOn(
              prisma,
              "$transaction"
            ).mockRejectedValueOnce(
              new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed",
                {
                  code: "P2002",
                  clientVersion:
                    "7.9.1",
                  meta: {
                    target: [
                      "telegramBotId"
                    ]
                  }
                }
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method:
                    "POST",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(409);

            expect(
              telegramMocks.getTelegramBotIdentity
            ).toHaveBeenCalledWith(
              botToken
            );

            expect(
              telegramMocks.setTelegramWebhook
            ).not.toHaveBeenCalled();

            expect(
              telegramMocks.deleteTelegramWebhook
            ).not.toHaveBeenCalled();

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUnique({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration
            ).toBeNull();

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_CREATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            transactionSpy.mockRestore();
          }
        }
      );

      it.each([
        {
          name:
            "missing bot token",
          body: {},
          expectedError:
            "botToken is required"
        },
        {
          name:
            "blank bot token",
          body: {
            botToken:
              "   "
          },
          expectedError:
            "botToken is required"
        }
      ])(
        "rejects Telegram integration creation with $name",
        async ({
          body,
          expectedError
        }) => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify(body)
              }
            );

          expect(
            response.status
          ).toBe(400);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              expectedError
          });

          const integration =
            await prisma.merchantTelegramIntegration.findUnique({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(integration).toBeNull();

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED"
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "rejects invalid Telegram integration status on PATCH",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    status:
                      "PROVISIONING"
                  })
              }
            );

          expect(
            response.status
          ).toBe(400);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "status must be ACTIVE or INACTIVE"
          });

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED"
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "rejects client-provided Telegram webhook secrets on PATCH",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    webhookSecret:
                      "client-controlled-secret"
                  })
              }
            );

          expect(response.status).toBe(400);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "webhookSecret is managed by the server"
          });

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED",
                entityId:
                  fixture.integration.id
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "blocks Telegram integration creation without a commerce configuration entitlement",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "blocked-telegram-bot-token",
                    webhookSecret:
                      "blocked-telegram-webhook-secret"
                  })
              }
            );

          expect(
            response.status
          ).toBe(403);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Merchant subscription does not allow this action"
          });

          const integration =
            await prisma.merchantTelegramIntegration.findUnique({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(integration).toBeNull();

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED"
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "rejects STAFF Telegram integration creation",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const staff =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                email:
                  `${testPrefix}-staff@example.com`,
                passwordHash:
                  "test-password-hash",
                role:
                  "STAFF",
                tokenVersion:
                  0
              }
            });

        const staffToken =
          createAuthToken({
            id:
              staff.id,
            merchantId:
              fixture.merchant.id,
            role:
              staff.role,
            tokenVersion:
              staff.tokenVersion
          });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${staffToken}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "staff-telegram-bot-token",
                    webhookSecret:
                      "staff-telegram-webhook-secret"
                  })
              }
            );

          expect(
            response.status
          ).toBe(403);

          const integration =
            await prisma.merchantTelegramIntegration.findUnique({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(integration).toBeNull();

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED"
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "rejects duplicate Telegram integration creation",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "replacement-telegram-bot-token",
                    webhookSecret:
                      "replacement-telegram-webhook-secret"
                  })
              }
            );

          expect(
            response.status
          ).toBe(409);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Telegram integration already exists"
          });

          const integrations =
            await prisma.merchantTelegramIntegration.findMany({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(integrations).toHaveLength(1);

          expect(
            integrations[0]?.id
          ).toBe(
            fixture.integration.id
          );

          expect(
            integrations[0]?.botTokenEncrypted
          ).toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            integrations[0]?.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED"
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "rotates Telegram credentials without exposing secrets or changing the webhook key",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const newBotToken =
            "rotated-telegram-bot-token";

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 987654321,
              username:
                "replacement_shop_bot",
              firstName:
                "Replacement Shop Bot"
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      newBotToken
                  })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          expect(body).toMatchObject({
            id:
              fixture.integration.id,
            merchantId:
              fixture.merchant.id,
            telegramBotUsername:
              "replacement_shop_bot",
            status:
              MerchantTelegramIntegrationStatus.ACTIVE
          });

          expect(body).not.toHaveProperty(
            "botTokenEncrypted"
          );

          expect(body).not.toHaveProperty(
            "webhookSecretEncrypted"
          );

          expect(
            JSON.stringify(body)
          ).not.toContain(
            newBotToken
          );

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledWith(
            newBotToken
          );

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledTimes(1);

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.webhookKey
          ).toBe(
            fixture.integration.webhookKey
          );

          expect(
            storedIntegration.telegramBotId
          ).toBe(
            "987654321"
          );

          expect(
            storedIntegration.telegramBotUsername
          ).toBe(
            "replacement_shop_bot"
          );

          expect(
            storedIntegration.botTokenEncrypted
          ).not.toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            storedIntegration.webhookSecretEncrypted
          ).not.toBe(
            fixture.integration.webhookSecretEncrypted
          );

          expect(
            decryptTelegramCredential(
              storedIntegration.botTokenEncrypted
            )
          ).toBe(
            newBotToken
          );

          const generatedWebhookSecret =
            decryptTelegramCredential(
              storedIntegration.webhookSecretEncrypted
            );

          expect(
            generatedWebhookSecret.length
          ).toBeGreaterThan(0);

          expect(
            generatedWebhookSecret
          ).not.toBe(
            fixture.webhookSecret
          );

          expect(
            telegramMocks.setTelegramWebhook
          ).toHaveBeenCalledWith(
            newBotToken,
            `http://127.0.0.1:3000/webhooks/telegram/${fixture.integration.webhookKey}`,
            generatedWebhookSecret
          );

          expect(
            telegramMocks.setTelegramWebhook
          ).toHaveBeenCalledTimes(1);

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                actorUserId:
                  fixture.user.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED",
                entityType:
                  "TELEGRAM_INTEGRATION",
                entityId:
                  fixture.integration.id
              }
            });

          expect(audit).not.toBeNull();

          expect(
            audit?.metadata
          ).toEqual({
            changedFields: [
              "botToken",
              "webhookSecret",
              "telegramBotId",
              "telegramBotUsername"
            ]
          });

          expect(
            JSON.stringify(
              audit?.metadata ?? null
            )
          ).not.toContain(
            newBotToken
          );

          expect(
            JSON.stringify(
              audit?.metadata ?? null
            )
          ).not.toContain(
            generatedWebhookSecret
          );

          const claims =
          await prisma.merchantTelegramBotClaim.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              integrationId:
                fixture.integration.id
            },
            orderBy: {
              createdAt:
                "asc"
            }
          });

        expect(claims).toHaveLength(1);

        expect(claims[0]).toMatchObject({
          merchantId:
            fixture.merchant.id,
          integrationId:
            fixture.integration.id,
          telegramBotId:
            "987654321",
          status:
            "ACTIVE"
        });

        expect(
          claims.some(
            (claim) =>
              claim.telegramBotId ===
              fixture.integration.telegramBotId
          )
        ).toBe(false);

        expect(
          claims.some(
            (claim) =>
              claim.status ===
              "PENDING"
          )
        ).toBe(false);
        }
      );

      it(
        "does not create a pending bot claim when replacement webhook configuration is invalid",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const newBotToken =
            "replacement-configuration-failure-token";

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 987654321,
              username:
                "replacement_config_failure_bot",
              firstName:
                "Replacement Config Failure Bot"
            });

          configMocks.getPublicApiBaseUrl
            .mockImplementationOnce(
              () => {
                throw new Error(
                  "PUBLIC_API_BASE_URL must be configured before managing Telegram webhooks."
                );
              }
            );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      newBotToken
                  })
              }
            );

          expect(
            response.status
          ).toBe(500);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Failed to update Telegram integration"
          });

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledWith(
            newBotToken
          );

          expect(
            telegramMocks.getTelegramBotIdentity
          ).toHaveBeenCalledTimes(1);

          expect(
            telegramMocks.setTelegramWebhook
          ).not.toHaveBeenCalled();

          expect(
            telegramMocks.deleteTelegramWebhook
          ).not.toHaveBeenCalled();

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.telegramBotId
          ).toBe(
            fixture.integration.telegramBotId
          );

          expect(
            storedIntegration.telegramBotUsername
          ).toBe(
            fixture.integration.telegramBotUsername
          );

          expect(
            storedIntegration.botTokenEncrypted
          ).toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          expect(
            storedIntegration.status
          ).toBe(
            MerchantTelegramIntegrationStatus.ACTIVE
          );

          const claims =
            await prisma.merchantTelegramBotClaim.findMany({
              where: {
                merchantId:
                  fixture.merchant.id,
                integrationId:
                  fixture.integration.id
              }
            });

          expect(claims).toHaveLength(1);

          expect(claims[0]).toMatchObject({
            merchantId:
              fixture.merchant.id,
            integrationId:
              fixture.integration.id,
            telegramBotId:
              fixture.integration.telegramBotId,
            status:
              "ACTIVE"
          });

          expect(
            claims.some(
              (claim) =>
                claim.status ===
                "PENDING"
            )
          ).toBe(false);

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                actorUserId:
                  fixture.user.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED",
                entityType:
                  "TELEGRAM_INTEGRATION",
                entityId:
                  fixture.integration.id
              }
            });

          expect(audit).toBeNull();
        }
      );

      it(
        "restores the existing integration when replacement webhook registration fails",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const newBotToken =
            "replacement-webhook-failure-token";

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 987654321,
              username:
                "replacement_failure_bot",
              firstName:
                "Replacement Failure Bot"
            });

          telegramMocks.setTelegramWebhook
            .mockRejectedValueOnce(
              new Error(
                "Simulated Telegram webhook failure"
              )
            );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      newBotToken
                  })
              }
            );

          expect(
            response.status
          ).toBe(500);

          expect(
            telegramMocks.setTelegramWebhook
          ).toHaveBeenCalledTimes(1);

          expect(
            telegramMocks.setTelegramWebhook
          ).toHaveBeenCalledWith(
            newBotToken,
            `http://127.0.0.1:3000/webhooks/telegram/${fixture.integration.webhookKey}`,
            expect.any(String)
          );

          expect(
            telegramMocks.deleteTelegramWebhook
          ).not.toHaveBeenCalled();

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.telegramBotId
          ).toBe(
            fixture.integration.telegramBotId
          );

          expect(
            storedIntegration.telegramBotUsername
          ).toBe(
            fixture.integration.telegramBotUsername
          );

          expect(
            storedIntegration.botTokenEncrypted
          ).toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          expect(
            storedIntegration.status
          ).toBe(
            fixture.integration.status
          );

          const claims =
            await prisma.merchantTelegramBotClaim.findMany({
              where: {
                merchantId:
                  fixture.merchant.id,
                integrationId:
                  fixture.integration.id
              }
            });

          expect(claims).toHaveLength(1);

          expect(claims[0]).toMatchObject({
            merchantId:
              fixture.merchant.id,
            integrationId:
              fixture.integration.id,
            telegramBotId:
              fixture.integration.telegramBotId,
            status:
              "ACTIVE"
          });

          expect(
            claims.some(
              (claim) =>
                claim.telegramBotId ===
                "987654321"
            )
          ).toBe(false);

          expect(
            claims.some(
              (claim) =>
                claim.status ===
                "PENDING"
            )
          ).toBe(false);

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED"
              }
            });

          expect(audit).toBeNull();
        }
      );

      it(
        "cleans up the replacement webhook and restores the existing integration when final persistence fails",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const newBotToken =
            "replacement-persistence-failure-token";

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 987654321,
              username:
                "replacement_persistence_bot",
              firstName:
                "Replacement Persistence Bot"
            });

          const transactionSpy =
            vi.spyOn(
              prisma,
              "$transaction"
            ).mockRejectedValueOnce(
              new Error(
                "Simulated replacement persistence failure"
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method:
                    "PATCH",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken:
                        newBotToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(500);

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenCalledTimes(2);

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledWith(
              newBotToken
            );

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenCalledTimes(2);

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenNthCalledWith(
              2,
              fixture.botToken,
              `http://127.0.0.1:3000/webhooks/telegram/${fixture.integration.webhookKey}`,
              fixture.webhookSecret
            );

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUniqueOrThrow({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration.telegramBotId
            ).toBe(
              fixture.integration.telegramBotId
            );

            expect(
              storedIntegration.telegramBotUsername
            ).toBe(
              fixture.integration.telegramBotUsername
            );

            expect(
              storedIntegration.botTokenEncrypted
            ).toBe(
              fixture.integration.botTokenEncrypted
            );

            expect(
              storedIntegration.webhookSecretEncrypted
            ).toBe(
              fixture.integration.webhookSecretEncrypted
            );

            expect(
              storedIntegration.status
            ).toBe(
              fixture.integration.status
            );

            const claims =
              await prisma.merchantTelegramBotClaim.findMany({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  integrationId:
                    fixture.integration.id
                }
              });

            expect(claims).toHaveLength(1);

            expect(claims[0]).toMatchObject({
              merchantId:
                fixture.merchant.id,
              integrationId:
                fixture.integration.id,
              telegramBotId:
                fixture.integration.telegramBotId,
              status:
                "ACTIVE"
            });

            expect(
              claims.some(
                (claim) =>
                  claim.telegramBotId ===
                  "987654321"
              )
            ).toBe(false);

            expect(
              claims.some(
                (claim) =>
                  claim.status ===
                  "PENDING"
              )
            ).toBe(false);

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_UPDATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            transactionSpy.mockRestore();
          }
        }
      );

      it(
        "keeps the replacement provisioning reservation when final persistence cleanup fails",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const newBotToken =
            "replacement-cleanup-failure-token";

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 987654321,
              username:
                "replacement_cleanup_bot",
              firstName:
                "Replacement Cleanup Bot"
            });

          const transactionSpy =
            vi.spyOn(
              prisma,
              "$transaction"
            ).mockRejectedValueOnce(
              new Error(
                "Simulated replacement persistence failure"
              )
            );

          telegramMocks.deleteTelegramWebhook
            .mockRejectedValueOnce(
              new Error(
                "Simulated replacement cleanup failure"
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method:
                    "PATCH",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken:
                        newBotToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(500);

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledWith(
              newBotToken
            );

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUniqueOrThrow({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration.status
            ).toBe(
              fixture.integration.status
            );

            expect(
              storedIntegration.telegramBotId
            ).toBe(
              fixture.integration.telegramBotId
            );

            expect(
              storedIntegration.telegramBotUsername
            ).toBe(
              fixture.integration.telegramBotUsername
            );

            expect(
              storedIntegration.botTokenEncrypted
            ).toBe(
              fixture.integration.botTokenEncrypted
            );

            expect(
              storedIntegration.webhookSecretEncrypted
            ).toBe(
              fixture.integration.webhookSecretEncrypted
            );

            const claims =
              await prisma.merchantTelegramBotClaim.findMany({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  integrationId:
                    fixture.integration.id
                }
              });

            expect(claims).toHaveLength(2);

            expect(claims).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  telegramBotId:
                    fixture.integration.telegramBotId,
                  status:
                    "ACTIVE"
                }),
                expect.objectContaining({
                  telegramBotId:
                    "987654321",
                  status:
                    "PENDING"
                })
              ])
            );

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_UPDATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            transactionSpy.mockRestore();
          }
        }
      );

      it(
        "keeps the replacement provisioning reservation when original webhook restoration fails",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const newBotToken =
            "replacement-restore-failure-token";

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 987654321,
              username:
                "replacement_restore_failure_bot",
              firstName:
                "Replacement Restore Failure Bot"
            });

          const transactionSpy =
            vi.spyOn(
              prisma,
              "$transaction"
            ).mockRejectedValueOnce(
              new Error(
                "Simulated replacement persistence failure"
              )
            );

          telegramMocks.setTelegramWebhook
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(
              new Error(
                "Simulated original webhook restoration failure"
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method:
                    "PATCH",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken:
                        newBotToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(500);

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenCalledTimes(2);

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledWith(
              newBotToken
            );

            expect(
              telegramMocks.deleteTelegramWebhook
            ).toHaveBeenCalledTimes(1);

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenNthCalledWith(
              2,
              fixture.botToken,
              `http://127.0.0.1:3000/webhooks/telegram/${fixture.integration.webhookKey}`,
              fixture.webhookSecret
            );

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUniqueOrThrow({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration.status
            ).toBe(
              fixture.integration.status
            );

            expect(
              storedIntegration.telegramBotId
            ).toBe(
              fixture.integration.telegramBotId
            );

            expect(
              storedIntegration.telegramBotUsername
            ).toBe(
              fixture.integration.telegramBotUsername
            );

            expect(
              storedIntegration.botTokenEncrypted
            ).toBe(
              fixture.integration.botTokenEncrypted
            );

            expect(
              storedIntegration.webhookSecretEncrypted
            ).toBe(
              fixture.integration.webhookSecretEncrypted
            );

            const claims =
              await prisma.merchantTelegramBotClaim.findMany({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  integrationId:
                    fixture.integration.id
                }
              });

            expect(claims).toHaveLength(2);

            expect(claims).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  telegramBotId:
                    fixture.integration.telegramBotId,
                  status:
                    "ACTIVE"
                }),
                expect.objectContaining({
                  telegramBotId:
                    "987654321",
                  status:
                    "PENDING"
                })
              ])
            );

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_UPDATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            transactionSpy.mockRestore();
          }
        }
      );

      it(
        "restores the original webhook without deleting it when same-token final persistence fails",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 123456789,
              username: "test_shop_bot",
              firstName: "Test Shop Bot"
            });

          const transactionSpy =
            vi.spyOn(
              prisma,
              "$transaction"
            ).mockRejectedValueOnce(
              new Error(
                "Simulated same-token persistence failure"
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method: "PATCH",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken:
                        fixture.botToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(500);

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenCalledTimes(2);

            expect(
              telegramMocks.deleteTelegramWebhook
            ).not.toHaveBeenCalled();

            expect(
              telegramMocks.setTelegramWebhook
            ).toHaveBeenNthCalledWith(
              2,
              fixture.botToken,
              `http://127.0.0.1:3000/webhooks/telegram/${fixture.integration.webhookKey}`,
              fixture.webhookSecret
            );

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUniqueOrThrow({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration.telegramBotId
            ).toBe(
              fixture.integration.telegramBotId
            );

            expect(
              storedIntegration.telegramBotUsername
            ).toBe(
              fixture.integration.telegramBotUsername
            );

            expect(
              storedIntegration.botTokenEncrypted
            ).toBe(
              fixture.integration.botTokenEncrypted
            );

            expect(
              storedIntegration.webhookSecretEncrypted
            ).toBe(
              fixture.integration.webhookSecretEncrypted
            );

            expect(
              storedIntegration.status
            ).toBe(
              fixture.integration.status
            );

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_UPDATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            transactionSpy.mockRestore();
          }
        }
      );

      it(
        "does not replace the Telegram webhook when the pending bot claim loses a uniqueness race",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const newBotToken =
            "replacement-race-bot-token";

          telegramMocks.getTelegramBotIdentity
            .mockResolvedValueOnce({
              id: 987654321,
              username:
                "replacement_race_bot",
              firstName:
                "Replacement Race Bot"
            });

          const claimCreateSpy =
            vi.spyOn(
              prisma.merchantTelegramBotClaim,
              "create"
            ).mockRejectedValueOnce(
              new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed",
                {
                  code: "P2002",
                  clientVersion: "7.9.1",
                  meta: {
                    target: [
                      "telegramBotId"
                    ]
                  }
                }
              )
            );

          try {
            const response =
              await fetch(
                `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
                {
                  method:
                    "PATCH",
                  headers: {
                    authorization:
                      `Bearer ${fixture.token}`,
                    "content-type":
                      "application/json"
                  },
                  body:
                    JSON.stringify({
                      botToken:
                        newBotToken
                    })
                }
              );

            expect(
              response.status
            ).toBe(409);

            expect(
              telegramMocks.getTelegramBotIdentity
            ).toHaveBeenCalledWith(
              newBotToken
            );

            expect(
              claimCreateSpy
            ).toHaveBeenCalledWith({
              data: {
                merchantId:
                  fixture.merchant.id,
                integrationId:
                  fixture.integration.id,
                telegramBotId:
                  "987654321",
                status:
                  "PENDING"
              }
            });

            expect(
              telegramMocks.setTelegramWebhook
            ).not.toHaveBeenCalled();

            expect(
              telegramMocks.deleteTelegramWebhook
            ).not.toHaveBeenCalled();

            const storedIntegration =
              await prisma.merchantTelegramIntegration.findUniqueOrThrow({
                where: {
                  merchantId:
                    fixture.merchant.id
                }
              });

            expect(
              storedIntegration.telegramBotId
            ).toBe(
              fixture.integration.telegramBotId
            );

            expect(
              storedIntegration.telegramBotUsername
            ).toBe(
              fixture.integration.telegramBotUsername
            );

            expect(
              storedIntegration.botTokenEncrypted
            ).toBe(
              fixture.integration.botTokenEncrypted
            );

            expect(
              storedIntegration.webhookSecretEncrypted
            ).toBe(
              fixture.integration.webhookSecretEncrypted
            );

            expect(
              storedIntegration.status
            ).toBe(
              MerchantTelegramIntegrationStatus.ACTIVE
            );

            const activeClaim =
              await prisma.merchantTelegramBotClaim.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  integrationId:
                    fixture.integration.id,
                  status:
                    "ACTIVE"
                }
              });

            expect(activeClaim).not.toBeNull();

            expect(
              activeClaim?.telegramBotId
            ).toBe(
              fixture.integration.telegramBotId
            );

            const pendingClaim =
              await prisma.merchantTelegramBotClaim.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  integrationId:
                    fixture.integration.id,
                  status:
                    "PENDING"
                }
              });

            expect(pendingClaim).toBeNull();

            const audit =
              await prisma.auditLog.findFirst({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  action:
                    "TELEGRAM_INTEGRATION_UPDATED"
                }
              });

            expect(audit).toBeNull();
          } finally {
            claimCreateSpy.mockRestore();
          }
        }
      );

      it(
        "changes Telegram integration status without rotating credentials",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    status:
                      MerchantTelegramIntegrationStatus.INACTIVE
                  })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          expect(body).toMatchObject({
            id:
              fixture.integration.id,
            merchantId:
              fixture.merchant.id,
            telegramBotUsername:
              fixture.integration.telegramBotUsername,
            status:
              MerchantTelegramIntegrationStatus.INACTIVE
          });

          expect(body).not.toHaveProperty(
            "botTokenEncrypted"
          );

          expect(body).not.toHaveProperty(
            "webhookSecretEncrypted"
          );

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.status
          ).toBe(
            MerchantTelegramIntegrationStatus.INACTIVE
          );

          expect(
            storedIntegration.botTokenEncrypted
          ).toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          expect(
            storedIntegration.webhookKey
          ).toBe(
            fixture.integration.webhookKey
          );

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                actorUserId:
                  fixture.user.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED",
                entityType:
                  "TELEGRAM_INTEGRATION",
                entityId:
                  fixture.integration.id
              }
            });

          expect(audit).not.toBeNull();

          expect(
            audit?.metadata
          ).toEqual({
            changedFields: [
              "status"
            ]
          });
        }
      );

      it(
        "does not audit an empty Telegram integration update",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({})
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          expect(body).toMatchObject({
            id:
              fixture.integration.id,
            merchantId:
              fixture.merchant.id,
            telegramBotUsername:
              fixture.integration.telegramBotUsername,
            status:
              fixture.integration.status
          });

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.botTokenEncrypted
          ).toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          expect(
            storedIntegration.webhookKey
          ).toBe(
            fixture.integration.webhookKey
          );

          expect(
            storedIntegration.status
          ).toBe(
            fixture.integration.status
          );

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED",
                entityId:
                  fixture.integration.id
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "blocks Telegram integration updates without a commerce configuration entitlement",
        async () => {
          const fixture =
            await createFixture();

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "blocked-rotated-bot-token",
                    status:
                      MerchantTelegramIntegrationStatus.INACTIVE
                  })
              }
            );

          expect(
            response.status
          ).toBe(403);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Merchant subscription does not allow this action"
          });

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.botTokenEncrypted
          ).toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          expect(
            storedIntegration.webhookKey
          ).toBe(
            fixture.integration.webhookKey
          );

          expect(
            storedIntegration.status
          ).toBe(
            fixture.integration.status
          );

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED",
                entityId:
                  fixture.integration.id
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "rejects STAFF Telegram integration updates",
        async () => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          const staff =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                email:
                  `${testPrefix}-patch-staff@example.com`,
                passwordHash:
                  "test-password-hash",
                role:
                  "STAFF",
                tokenVersion:
                  0
              }
            });

          const staffToken =
            createAuthToken({
              id:
                staff.id,
              merchantId:
                fixture.merchant.id,
              role:
                staff.role,
              tokenVersion:
                staff.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${staffToken}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "staff-rotated-bot-token",
                    status:
                      MerchantTelegramIntegrationStatus.INACTIVE
                  })
              }
            );

          expect(
            response.status
          ).toBe(403);

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.botTokenEncrypted
          ).toBe(
            fixture.integration.botTokenEncrypted
          );

          expect(
            storedIntegration.webhookSecretEncrypted
          ).toBe(
            fixture.integration.webhookSecretEncrypted
          );

          expect(
            storedIntegration.webhookKey
          ).toBe(
            fixture.integration.webhookKey
          );

          expect(
            storedIntegration.status
          ).toBe(
            fixture.integration.status
          );

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED",
                entityId:
                  fixture.integration.id
              }
            });

          expect(auditCount).toBe(0);
        }
      );

      it(
        "allows ADMIN to create a Telegram integration",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const admin =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                email:
                  `${testPrefix}-admin@example.com`,
                passwordHash:
                  "test-password-hash",
                role:
                  "ADMIN",
                tokenVersion:
                  0
              }
            });

          const adminToken =
            createAuthToken({
              id:
                admin.id,
              merchantId:
                fixture.merchant.id,
              role:
                admin.role,
              tokenVersion:
                admin.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${adminToken}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    botToken:
                      "admin-telegram-bot-token",
                    webhookSecret:
                      "admin-telegram-webhook-secret"
                  })
              }
            );

          expect(
            response.status
          ).toBe(201);

          const integration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            integration.status
          ).toBe(
            MerchantTelegramIntegrationStatus.ACTIVE
          );

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                actorUserId:
                  admin.id,
                action:
                  "TELEGRAM_INTEGRATION_CREATED",
                entityId:
                  integration.id
              }
            });

          expect(audit).not.toBeNull();
        }
      );

      it(
        "returns 404 when updating a missing Telegram integration",
        async () => {
          const fixture =
            await createFixture();

          await prisma.merchantTelegramIntegration.delete({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          await createActiveSubscription(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method:
                  "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    status:
                      MerchantTelegramIntegrationStatus.INACTIVE
                  })
              }
            );

          expect(
            response.status
          ).toBe(404);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Telegram integration not found"
          });

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "TELEGRAM_INTEGRATION_UPDATED"
              }
            });

          expect(auditCount).toBe(0);
        }
      );
    }
  );
