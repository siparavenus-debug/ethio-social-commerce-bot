import type {
    Server
  } from "node:http";

  import express from "express";

  import {
    MerchantSubscriptionStatus,
    MerchantTelegramIntegrationStatus,
    SubscriptionBillingInterval,
    prisma
  } from "@ethio-commerce/database";

  import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it
  } from "vitest";

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
            webhookKey:
              fixture.integration.webhookKey,
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

          const webhookSecret =
            "created-telegram-webhook-secret";

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
                    botToken,
                    webhookSecret
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
            status:
              MerchantTelegramIntegrationStatus.ACTIVE
          });

          expect(
            typeof body.webhookKey
          ).toBe("string");

          expect(
            body.webhookKey.length
          ).toBeGreaterThan(0);

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

          expect(
            JSON.stringify(body)
          ).not.toContain(
            webhookSecret
          );

          const storedIntegration =
            await prisma.merchantTelegramIntegration.findUniqueOrThrow({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            });

          expect(
            storedIntegration.botTokenEncrypted
          ).not.toBe(botToken);

          expect(
            storedIntegration.webhookSecretEncrypted
          ).not.toBe(webhookSecret);

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
            webhookSecret
          );
        }
      );

      it.each([
        {
          name:
            "missing bot token",
          body: {
            webhookSecret:
              "valid-webhook-secret"
          },
          expectedError:
            "botToken is required"
        },
        {
          name:
            "blank bot token",
          body: {
            botToken:
              "   ",
            webhookSecret:
              "valid-webhook-secret"
          },
          expectedError:
            "botToken is required"
        },
        {
          name:
            "missing webhook secret",
          body: {
            botToken:
              "valid-bot-token"
          },
          expectedError:
            "webhookSecret is required"
        },
        {
          name:
            "blank webhook secret",
          body: {
            botToken:
              "valid-bot-token",
            webhookSecret:
              "   "
          },
          expectedError:
            "webhookSecret is required"
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

      it.each([
        {
          method:
            "POST",
          prepare: async (
            merchantId: string
          ) => {
            await prisma.merchantTelegramIntegration.delete({
              where: {
                merchantId
              }
            });
          },
          body: {
            botToken:
              "valid-bot-token",
            webhookSecret:
              "valid-webhook-secret",
            status:
              "UNKNOWN"
          },
          action:
            "TELEGRAM_INTEGRATION_CREATED"
        },
        {
          method:
            "PATCH",
          prepare: async () => {},
          body: {
            status:
              "UNKNOWN"
          },
          action:
            "TELEGRAM_INTEGRATION_UPDATED"
        }
      ])(
        "rejects invalid Telegram integration status on $method",
        async ({
          method,
          prepare,
          body,
          action
        }) => {
          const fixture =
            await createFixture();

          await createActiveSubscription(
            fixture.merchant.id
          );

          await prepare(
            fixture.merchant.id
          );

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${fixture.merchant.id}/telegram-integration`,
              {
                method,
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
              "status must be ACTIVE or INACTIVE"
          });

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action
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

          const newWebhookSecret =
            "rotated-telegram-webhook-secret";

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
                      newBotToken,
                    webhookSecret:
                      newWebhookSecret
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
            webhookKey:
              fixture.integration.webhookKey,
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
            JSON.stringify(body)
          ).not.toContain(
            newWebhookSecret
          );

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

          expect(
            decryptTelegramCredential(
              storedIntegration.webhookSecretEncrypted
            )
          ).toBe(
            newWebhookSecret
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
              "botToken",
              "webhookSecret"
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
            newWebhookSecret
          );
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
            webhookKey:
              fixture.integration.webhookKey,
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
            webhookKey:
              fixture.integration.webhookKey,
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
