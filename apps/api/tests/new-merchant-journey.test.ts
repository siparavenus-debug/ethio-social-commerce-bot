import type {
  Server
} from "node:http";

import express from "express";

import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
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

const {
  sendTelegramMessageMock
} = vi.hoisted(() => ({
  sendTelegramMessageMock:
    vi.fn()
}));

vi.mock(
  "../src/services/telegram.js",
  () => ({
    sendTelegramMessage:
      sendTelegramMessageMock
  })
);

import platformAdminRouter
  from "../src/routes/platform-admin.js";

import authRouter
  from "../src/routes/auth.js";

import merchantsRouter
  from "../src/routes/merchants.js";

import merchantUsersRouter
  from "../src/routes/merchant-users.js";

import productsRouter
  from "../src/routes/products.js";

import ordersRouter
  from "../src/routes/orders.js";

import paymentMethodsRouter
  from "../src/routes/payment-methods.js";

import merchantTelegramIntegrationRouter
  from "../src/routes/merchant-telegram-integration.js";

import paymentsRouter
  from "../src/routes/payments.js";

import {
  createPlatformAuthToken
} from "../src/services/platform-auth.js";

import {
  createOrder
} from "../src/tools/orders.js";

const testPrefix =
  "new-merchant-journey";

let server:
  Server | null = null;

let apiBaseUrl =
  "";

async function cleanup():
  Promise<void> {
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

  await prisma.platformAuditLog.deleteMany({
    where: {
      OR: [
        {
          actor: {
            email: {
              startsWith:
                `${testPrefix}-platform-`
            }
          }
        },
        {
          merchantId: {
            in:
              merchantIds
          }
        }
      ]
    }
  });

  await prisma.auditLog.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantInvoiceItem.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantSettlement.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantInvoiceReminder.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantInvoice.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.commissionAdjustment.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.commission.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.payment.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.orderItem.deleteMany({
    where: {
      order: {
        merchantId: {
          in:
            merchantIds
        }
      }
    }
  });

  await prisma.order.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.product.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.customer.deleteMany({
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
      OR: [
        {
          code: {
            startsWith:
              testPrefix
          }
        },
        {
          code: {
            startsWith:
              testPrefix.toUpperCase()
          }
        }
      ]
    }
  });

  await prisma.platformUser.deleteMany({
    where: {
      email: {
        startsWith:
          `${testPrefix}-platform-`
      }
    }
  });
}

async function createPlatformFixture() {
  const user =
    await prisma.platformUser.create({
      data: {
        email:
          `${testPrefix}-platform-admin@example.test`,
        passwordHash:
          "test-password-hash",
        displayName:
          "Gate 13 Platform Administrator",
        tokenVersion:
          0
      }
    });

  const token =
    createPlatformAuthToken({
      id:
        user.id,
      tokenVersion:
        user.tokenVersion
    });

  return {
    user,
    token
  };
}

beforeEach(
  async () => {
    sendTelegramMessageMock
      .mockReset();

    sendTelegramMessageMock
      .mockResolvedValue(
        "gate13-telegram-message-id"
      );

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
      "/platform",
      platformAdminRouter
    );

    app.use(
      "/auth",
      authRouter
    );

    app.use(
      "/merchants",
      merchantsRouter
    );

    app.use(
      "/merchants",
      merchantTelegramIntegrationRouter
    );

    app.use(
      "/merchants",
      merchantUsersRouter
    );

    app.use(
      "/merchants",
      productsRouter
    );

    app.use(
      "/merchants",
      ordersRouter
    );

    app.use(
      "/merchants",
      paymentMethodsRouter
    );

    app.use(
      "/merchants",
      paymentsRouter
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
        "Failed to start Gate 13 test server"
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
  "new merchant end-to-end journey",
  () => {
    it(
      "carries a newly onboarded merchant through commerce and payment review",
      async () => {
        const platform =
          await createPlatformFixture();

        const planResponse =
          await fetch(
            `${apiBaseUrl}/platform/plans`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${platform.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  code:
                    `${testPrefix}-plan`,
                  name:
                    "Gate 13 Commerce Plan",
                  monthlyPrice:
                    "500.00",
                  annualPrice:
                    "5000.00",
                  currency:
                    "ETB",
                  commissionRate:
                    "0.035000",
                  features: {
                    source:
                      testPrefix
                  },
                  isActive:
                    true
                })
            }
          );

        expect(
          planResponse.status
        ).toBe(201);

        const planBody =
          await planResponse.json() as {
            plan: {
              id: string;
              code: string;
              name: string;
              currency: string;
              isActive: boolean;
            };
          };

        expect(
          planBody.plan
        ).toMatchObject({
          code:
            `${testPrefix}-plan`.toUpperCase(),
          name:
            "Gate 13 Commerce Plan",
          currency:
            "ETB",
          isActive:
            true
        });

        const merchantName =
          `${testPrefix} Merchant`;

        const ownerEmail =
          `${testPrefix}-owner@example.test`;

        const ownerPassword =
          "gate-13-owner-password";

        const telegramBotToken =
          "gate-13-merchant-bot-token";

        const telegramWebhookSecret =
          "gate-13-merchant-webhook-secret";

        const merchantResponse =
          await fetch(
            `${apiBaseUrl}/platform/merchants`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${platform.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  name:
                    merchantName,
                  currency:
                    "ETB",
                  phone:
                    "0911000013",
                  address:
                    "Gate 13 Address",
                  ownerEmail:
                    ownerEmail.toUpperCase(),
                  ownerPassword,
                  ownerDisplayName:
                    "Gate 13 Owner"
                })
            }
          );

        expect(
          merchantResponse.status
        ).toBe(201);

        const merchantBody =
          await merchantResponse.json() as {
            merchant: {
              id: string;
              name: string;
              currency: string;
              accountStatus: string;
            };
            owner: {
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
            };
          };

        expect(
          merchantBody.merchant
        ).toMatchObject({
          name:
            merchantName,
          currency:
            "ETB",
          accountStatus:
            "ACTIVE"
        });

        expect(
          merchantBody.owner
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          email:
            ownerEmail,
          displayName:
            "Gate 13 Owner",
          role:
            "OWNER"
        });

        const loginResponse =
          await fetch(
            `${apiBaseUrl}/auth/login`,
            {
              method:
                "POST",
              headers: {
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  email:
                    ownerEmail,
                  password:
                    ownerPassword
                })
            }
          );

        expect(
          loginResponse.status
        ).toBe(200);

        const loginBody =
          await loginResponse.json() as {
            token: string;
            user: {
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
            };
          };

        expect(
          loginBody.token.length
        ).toBeGreaterThan(0);

        expect(
          loginBody.user
        ).toEqual({
          id:
            merchantBody.owner.id,
          merchantId:
            merchantBody.merchant.id,
          email:
            ownerEmail,
          displayName:
            "Gate 13 Owner",
          role:
            "OWNER"
        });

                const meResponse =
          await fetch(
            `${apiBaseUrl}/auth/me`,
            {
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`
              }
            }
          );

        expect(
          meResponse.status
        ).toBe(200);

        const meBody =
          await meResponse.json() as {
            user: {
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
              tokenVersion: number;
            };
          };

        expect(
          meBody.user
        ).toEqual({
          id:
            merchantBody.owner.id,
          merchantId:
            merchantBody.merchant.id,
          email:
            ownerEmail,
          displayName:
            "Gate 13 Owner",
          role:
            "OWNER",
          tokenVersion:
            0
        });

                const createAdminResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/users`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  email:
                    `${testPrefix}-admin@example.test`,
                  displayName:
                    "Gate 13 Admin",
                  password:
                    "Gate13AdminPassword123!",
                  role:
                    "ADMIN"
                })
            }
          );

        expect(
          createAdminResponse.status
        ).toBe(201);

        const createAdminBody =
          await createAdminResponse.json() as {
            user: {
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
              passwordHash?: string;
              tokenVersion?: number;
            };
          };

        expect(
          createAdminBody.user
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          email:
            `${testPrefix}-admin@example.test`,
          displayName:
            "Gate 13 Admin",
          role:
            "ADMIN"
        });

        expect(
          createAdminBody.user
        ).not.toHaveProperty(
          "passwordHash"
        );

        expect(
          createAdminBody.user
        ).not.toHaveProperty(
          "tokenVersion"
        );

        const persistedAdmin =
          await prisma.merchantUser.findUnique({
            where: {
              id:
                createAdminBody.user.id
            }
          });

        expect(
          persistedAdmin
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          email:
            `${testPrefix}-admin@example.test`,
          displayName:
            "Gate 13 Admin",
          role:
            "ADMIN"
        });

        const adminCreationAudit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                merchantBody.merchant.id,
              actorUserId:
                loginBody.user.id,
              action:
                "MERCHANT_USER_CREATED",
              entityType:
                "MERCHANT_USER",
              entityId:
                createAdminBody.user.id
            }
          });

        expect(
          adminCreationAudit
        ).not.toBeNull();

        expect(
          adminCreationAudit?.metadata
        ).toEqual({
          role:
            "ADMIN"
        });

                const listUsersResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/users`,
            {
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`
              }
            }
          );

        expect(
          listUsersResponse.status
        ).toBe(200);

        const listUsersBody =
          await listUsersResponse.json() as {
            users: Array<{
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
            }>;
          };

        expect(
          listUsersBody.users
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id:
                createAdminBody.user.id,
              merchantId:
                merchantBody.merchant.id,
              email:
                `${testPrefix}-admin@example.test`,
              role:
                "ADMIN"
            })
          ])
        );

        const updateAdminResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/users/${createAdminBody.user.id}`,
            {
              method:
                "PATCH",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  displayName:
                    "Gate 13 Staff",
                  role:
                    "STAFF"
                })
            }
          );

        expect(
          updateAdminResponse.status
        ).toBe(200);

        const updateAdminBody =
          await updateAdminResponse.json() as {
            user: {
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
            };
          };

        expect(
          updateAdminBody.user
        ).toMatchObject({
          id:
            createAdminBody.user.id,
          merchantId:
            merchantBody.merchant.id,
          email:
            `${testPrefix}-admin@example.test`,
          displayName:
            "Gate 13 Staff",
          role:
            "STAFF"
        });

        const persistedStaff =
          await prisma.merchantUser.findUnique({
            where: {
              id:
                createAdminBody.user.id
            }
          });

        expect(
          persistedStaff
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          displayName:
            "Gate 13 Staff",
          role:
            "STAFF"
        });

        const adminUpdateAudit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                merchantBody.merchant.id,
              actorUserId:
                loginBody.user.id,
              action:
                "MERCHANT_USER_UPDATED",
              entityType:
                "MERCHANT_USER",
              entityId:
                createAdminBody.user.id
            }
          });

        expect(
          adminUpdateAudit
        ).not.toBeNull();

        expect(
          adminUpdateAudit?.metadata
        ).toEqual({
          changedFields: [
            "displayName",
            "role"
          ]
        });

        const periodReference =
          new Date();

        const currentPeriodStart =
          new Date(
            Date.UTC(
              periodReference.getUTCFullYear(),
              periodReference.getUTCMonth(),
              1
            )
          );

        const currentPeriodEnd =
          new Date(
            Date.UTC(
              periodReference.getUTCFullYear(),
              periodReference.getUTCMonth() + 1,
              1
            )
          );

        const trialEndsAt =
          new Date(
            currentPeriodStart.getTime() +
              (
                (
                  currentPeriodEnd.getTime() -
                  currentPeriodStart.getTime()
                ) / 2
              )
          );

        const initializeSubscriptionResponse =
          await fetch(
            `${apiBaseUrl}/platform/merchants/${merchantBody.merchant.id}/subscription`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${platform.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  planId:
                    planBody.plan.id,
                  billingInterval:
                    "MONTHLY",
                  status:
                    "TRIAL",
                  currentPeriodStart:
                    currentPeriodStart.toISOString(),
                  currentPeriodEnd:
                    currentPeriodEnd.toISOString(),
                  trialEndsAt:
                    trialEndsAt.toISOString()
                })
            }
          );

        expect(
          initializeSubscriptionResponse.status
        ).toBe(201);

        const initializeSubscriptionBody =
          await initializeSubscriptionResponse.json() as {
            subscription: {
              id: string;
              merchantId: string;
              planId: string;
              status: string;
              billingInterval: string;
            };
          };

        expect(
          initializeSubscriptionBody.subscription
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          planId:
            planBody.plan.id,
          status:
            "TRIAL",
          billingInterval:
            "MONTHLY"
        });

        const activateSubscriptionResponse =
          await fetch(
            `${apiBaseUrl}/platform/merchants/${merchantBody.merchant.id}/subscription/status`,
            {
              method:
                "PATCH",
              headers: {
                authorization:
                  `Bearer ${platform.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  nextStatus:
                    "ACTIVE"
                })
            }
          );

        expect(
          activateSubscriptionResponse.status
        ).toBe(200);

        const activateSubscriptionBody =
          await activateSubscriptionResponse.json() as {
            subscription: {
              id: string;
              merchantId: string;
              status: string;
            };
          };

        expect(
          activateSubscriptionBody.subscription
        ).toMatchObject({
          id:
            initializeSubscriptionBody.subscription.id,
          merchantId:
            merchantBody.merchant.id,
          status:
            "ACTIVE"
        });

        const persistedSubscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                merchantBody.merchant.id
            }
          });

        expect(
          persistedSubscription
        ).not.toBeNull();

        expect(
          persistedSubscription!
            .priceSnapshot
            .toString()
        ).toBe("500");

        expect(
          persistedSubscription!
            .currency
        ).toBe("ETB");

        expect(
          persistedSubscription!
            .currentPeriodStart
        ).toEqual(
          currentPeriodStart
        );

        expect(
          persistedSubscription!
            .currentPeriodEnd
        ).toEqual(
          currentPeriodEnd
        );

        expect(
          persistedSubscription?.status
        ).toBe("ACTIVE");

        const telegramIntegrationResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/telegram-integration`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  botToken:
                    telegramBotToken,
                  webhookSecret:
                    telegramWebhookSecret
                })
            }
          );

        expect(
          telegramIntegrationResponse.status
        ).toBe(201);

        const telegramIntegrationBody =
          await telegramIntegrationResponse.json() as {
            id: string;
            merchantId: string;
            webhookKey: string;
            status: string;
          };

        expect(
          telegramIntegrationBody
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          status:
            "ACTIVE"
        });

        expect(
          telegramIntegrationBody
            .webhookKey.length
        ).toBeGreaterThan(0);

        expect(
          telegramIntegrationBody
        ).not.toHaveProperty(
          "botTokenEncrypted"
        );

        expect(
          telegramIntegrationBody
        ).not.toHaveProperty(
          "webhookSecretEncrypted"
        );

        const categoryResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/products/categories`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  name:
                    "Gate 13 Products"
                })
            }
          );

        expect(
          categoryResponse.status
        ).toBe(201);

        const categoryBody =
          await categoryResponse.json() as {
            id: string;
            merchantId: string;
            name: string;
          };

        expect(
          categoryBody
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          name:
            "Gate 13 Products"
        });

        const productResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/products`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  name:
                    "Gate 13 Product",
                  description:
                    "Product created by the Gate 13 merchant journey",
                  price:
                    100,
                  stock:
                    5,
                  status:
                    "ACTIVE",
                  categoryId:
                    categoryBody.id
                })
            }
          );

        expect(
          productResponse.status
        ).toBe(201);

        const productBody =
          await productResponse.json() as {
            id: string;
            merchantId: string;
            categoryId: string | null;
            name: string;
            price: string | number;
            currency: string;
            stock: number;
            status: string;
          };

        expect(
          productBody
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          categoryId:
            categoryBody.id,
          name:
            "Gate 13 Product",
          currency:
            "ETB",
          stock:
            5,
          status:
            "ACTIVE"
        });

        expect(
          Number(
            productBody.price
          )
        ).toBe(100);

        const paymentMethodResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/payment-methods`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  provider:
                    PaymentProvider.TELEBIRR,
                  accountName:
                    "Gate 13 Telebirr Account",
                  accountNumber:
                    "0911000013",
                  status:
                    "ACTIVE"
                })
            }
          );

        expect(
          paymentMethodResponse.status
        ).toBe(201);

        const paymentMethodBody =
          await paymentMethodResponse.json() as {
            id: string;
            merchantId: string;
            provider: string;
            accountName: string;
            accountNumber: string;
            status: string;
          };

        expect(
          paymentMethodBody
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          provider:
            PaymentProvider.TELEBIRR,
          accountName:
            "Gate 13 Telebirr Account",
          accountNumber:
            "0911000013",
          status:
            "ACTIVE"
        });

        const customer =
          await prisma.customer.create({
            data: {
              merchantId:
                merchantBody.merchant.id,
              name:
                "Gate 13 Customer",
              telegramChatId:
                `${testPrefix}-customer-chat`,
              telegramUserId:
                `${testPrefix}-customer-user`
            }
          });

        const customerOrder =
          await createOrder(
            merchantBody.merchant.id,
            customer.id,
            productBody.id,
            2,
            {
              name:
                "Gate 13 Customer",
              phone:
                "0911223344",
              address:
                "Bole, Addis Ababa"
            }
          );

        expect(
          customerOrder
        ).toMatchObject({
          status:
            OrderStatus.PENDING_PAYMENT,
          currency:
            "ETB",
          subtotal:
            200,
          total:
            200
        });

        expect(
          customerOrder.items
        ).toHaveLength(1);

        expect(
          customerOrder.items[0]
        ).toMatchObject({
          productId:
            productBody.id,
          productName:
            "Gate 13 Product",
          quantity:
            2,
          unitPrice:
            100,
          lineTotal:
            200
        });

        const productBeforePayment =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                productBody.id
            }
          });

        expect(
          productBeforePayment.stock
        ).toBe(5);

        const persistedPendingOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                customerOrder.id
            }
          });

        expect(
          persistedPendingOrder.status
        ).toBe(
          OrderStatus.PENDING_PAYMENT
        );

                const isolationOwnerEmail =
          `${testPrefix}-isolation-owner@example.test`;

        const isolationOwnerPassword =
          "gate-13-isolation-owner-password";

        const isolationMerchantResponse =
          await fetch(
            `${apiBaseUrl}/platform/merchants`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${platform.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  name:
                    `${testPrefix} Isolation Merchant`,
                  currency:
                    "ETB",
                  ownerEmail:
                    isolationOwnerEmail,
                  ownerPassword:
                    isolationOwnerPassword,
                  ownerDisplayName:
                    "Gate 13 Isolation Owner"
                })
            }
          );

        expect(
          isolationMerchantResponse.status
        ).toBe(201);

        const isolationMerchantBody =
          await isolationMerchantResponse.json() as {
            merchant: {
              id: string;
            };
            owner: {
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
            };
          };

        expect(
          isolationMerchantBody.owner
            .merchantId
        ).toBe(
          isolationMerchantBody.merchant.id
        );

        const isolationLoginResponse =
          await fetch(
            `${apiBaseUrl}/auth/login`,
            {
              method:
                "POST",
              headers: {
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  email:
                    isolationOwnerEmail,
                  password:
                    isolationOwnerPassword
                })
            }
          );

        expect(
          isolationLoginResponse.status
        ).toBe(200);

        const isolationLoginBody =
          await isolationLoginResponse.json() as {
            token: string;
            user: {
              id: string;
              merchantId: string;
              email: string;
              displayName: string | null;
              role: string;
            };
          };

        expect(
          isolationLoginBody.user
            .merchantId
        ).toBe(
          isolationMerchantBody.merchant.id
        );

        expect(
          isolationLoginBody.user
            .merchantId
        ).not.toBe(
          merchantBody.merchant.id
        );

        const crossMerchantOrderResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/orders/${customerOrder.id}`,
            {
              headers: {
                authorization:
                  `Bearer ${isolationLoginBody.token}`
              }
            }
          );

        expect(
          crossMerchantOrderResponse.status
        ).toBe(403);

        expect(
          await crossMerchantOrderResponse.json()
        ).toEqual({
          error:
            "You are not authorized to access this merchant"
        });

        const isolatedOrderLookupResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${isolationMerchantBody.merchant.id}/orders/${customerOrder.id}`,
            {
              headers: {
                authorization:
                  `Bearer ${isolationLoginBody.token}`
              }
            }
          );

        expect(
          isolatedOrderLookupResponse.status
        ).toBe(404);

        expect(
          await isolatedOrderLookupResponse.json()
        ).toEqual({
          error:
            "Order not found"
        });

        const orderAfterIsolationChecks =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                customerOrder.id
            }
          });

        expect(
          orderAfterIsolationChecks
            .merchantId
        ).toBe(
          merchantBody.merchant.id
        );

        expect(
          orderAfterIsolationChecks.status
        ).toBe(
          OrderStatus.PENDING_PAYMENT
        );

        const paymentResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/payments`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  orderId:
                    customerOrder.id,
                  provider:
                    PaymentProvider.TELEBIRR,
                  amount:
                    200,
                  currency:
                    "ETB",
                  transactionReference:
                    "GATE13-TXN-001",
                  receiptUrl:
                    `receipts/${merchantBody.merchant.id}/${customerOrder.id}/gate13.jpg`
                })
            }
          );

        expect(
          paymentResponse.status
        ).toBe(201);

        const paymentBody =
          await paymentResponse.json() as {
            id: string;
            merchantId: string;
            orderId: string;
            provider: string;
            status: string;
            amount: string | number;
            currency: string;
            transactionReference: string;
            receiptUrl: string | null;
          };

        expect(
          paymentBody
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          orderId:
            customerOrder.id,
          provider:
            PaymentProvider.TELEBIRR,
          status:
            PaymentStatus.REVIEW_REQUIRED,
          currency:
            "ETB",
          transactionReference:
            "GATE13-TXN-001"
        });

        expect(
          Number(
            paymentBody.amount
          )
        ).toBe(200);

        const paymentAwaitingReview =
          await prisma.payment.findUniqueOrThrow({
            where: {
              id:
                paymentBody.id
            }
          });

        expect(
          paymentAwaitingReview.status
        ).toBe(
          PaymentStatus.REVIEW_REQUIRED
        );

        expect(
          paymentAwaitingReview.verifiedAt
        ).toBeNull();

        const orderAwaitingReview =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                customerOrder.id
            }
          });

        expect(
          orderAwaitingReview.status
        ).toBe(
          OrderStatus.PAYMENT_REVIEW
        );

        const productAwaitingReview =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                productBody.id
            }
          });

        expect(
          productAwaitingReview.stock
        ).toBe(5);

        const commissionsBeforeVerification =
          await prisma.commission.count({
            where: {
              merchantId:
                merchantBody.merchant.id
            }
          });

        expect(
          commissionsBeforeVerification
        ).toBe(0);

                const crossMerchantPaymentReviewResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/payment-review/${paymentBody.id}`,
            {
              headers: {
                authorization:
                  `Bearer ${isolationLoginBody.token}`
              }
            }
          );

        expect(
          crossMerchantPaymentReviewResponse.status
        ).toBe(403);

        expect(
          await crossMerchantPaymentReviewResponse.json()
        ).toEqual({
          error:
            "You are not authorized to access this merchant"
        });

        const isolatedPaymentReviewResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${isolationMerchantBody.merchant.id}/payment-review/${paymentBody.id}`,
            {
              headers: {
                authorization:
                  `Bearer ${isolationLoginBody.token}`
              }
            }
          );

        expect(
          isolatedPaymentReviewResponse.status
        ).toBe(404);

        expect(
          await isolatedPaymentReviewResponse.json()
        ).toEqual({
          error:
            "Payment not found"
        });

        const crossMerchantVerificationResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/payment-review/${paymentBody.id}/verify`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${isolationLoginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  reviewNote:
                    "Cross-merchant verification attempt"
                })
            }
          );

        expect(
          crossMerchantVerificationResponse.status
        ).toBe(403);

        expect(
          await crossMerchantVerificationResponse.json()
        ).toEqual({
          error:
            "You are not authorized to access this merchant"
        });

        const isolatedVerificationResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${isolationMerchantBody.merchant.id}/payment-review/${paymentBody.id}/verify`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${isolationLoginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  reviewNote:
                    "Cross-merchant verification attempt"
                })
            }
          );

        expect(
          isolatedVerificationResponse.status
        ).toBe(404);

        expect(
          await isolatedVerificationResponse.json()
        ).toEqual({
          error:
            "Payment not found"
        });

        const paymentAfterIsolationChecks =
          await prisma.payment.findUniqueOrThrow({
            where: {
              id:
                paymentBody.id
            }
          });

        expect(
          paymentAfterIsolationChecks.status
        ).toBe(
          PaymentStatus.REVIEW_REQUIRED
        );

        expect(
          paymentAfterIsolationChecks
            .verifiedAt
        ).toBeNull();

        const orderAfterPaymentIsolationChecks =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                customerOrder.id
            }
          });

        expect(
          orderAfterPaymentIsolationChecks
            .status
        ).toBe(
          OrderStatus.PAYMENT_REVIEW
        );

        const productAfterPaymentIsolationChecks =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                productBody.id
            }
          });

        expect(
          productAfterPaymentIsolationChecks
            .stock
        ).toBe(5);

        const commissionsAfterIsolationChecks =
          await prisma.commission.count({
            where: {
              merchantId:
                merchantBody.merchant.id,
              paymentId:
                paymentBody.id
            }
          });

        expect(
          commissionsAfterIsolationChecks
        ).toBe(0);

        const verificationResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/payment-review/${paymentBody.id}/verify`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  reviewNote:
                    "Gate 13 payment verified"
                })
            }
          );

          expect(
            verificationResponse.status
          ).toBe(200);

          const verificationBody =
            await verificationResponse.json() as {
              message: string;
              payment: {
                id: string;
                merchantId: string;
                orderId: string;
                status: string;
              };
              order: {
                id: string;
                merchantId: string;
                status: string;
              };
            };

          expect(
            verificationBody
          ).toMatchObject({
            message:
              "Payment verified successfully",
            payment: {
              id:
                paymentBody.id,
              merchantId:
                merchantBody.merchant.id,
              orderId:
                customerOrder.id,
              status:
                PaymentStatus.VERIFIED
            },
            order: {
              id:
                customerOrder.id,
              merchantId:
                merchantBody.merchant.id,
              status:
                OrderStatus.PAID
            }
          });

        const verifiedPayment =
          await prisma.payment.findUniqueOrThrow({
            where: {
              id:
                paymentBody.id
            }
          });

        expect(
          verifiedPayment.status
        ).toBe(
          PaymentStatus.VERIFIED
        );

        expect(
          verifiedPayment.verifiedAt
        ).not.toBeNull();

        expect(
          verifiedPayment.reviewNote
        ).toBe(
          "Gate 13 payment verified"
        );

        const paidOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                customerOrder.id
            }
          });

        expect(
          paidOrder.status
        ).toBe(
          OrderStatus.PAID
        );

        const productAfterVerification =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                productBody.id
            }
          });

        expect(
          productAfterVerification.stock
        ).toBe(3);

        const commissionsAfterVerification =
          await prisma.commission.findMany({
            where: {
              merchantId:
                merchantBody.merchant.id,
              paymentId:
                paymentBody.id
            }
          });

        expect(
          commissionsAfterVerification
        ).toHaveLength(1);

                const commission =
          commissionsAfterVerification[0]!;

        expect(
          commission
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          paymentId:
            paymentBody.id,
          orderId:
            customerOrder.id,
          subscriptionId:
            initializeSubscriptionBody
              .subscription.id,
          currency:
            "ETB",
          status:
            "ACCRUED"
        });

        expect(
          commission
            .transactionAmount
            .toString()
        ).toBe("200");

        expect(
          commission
            .commissionRate
            .toString()
        ).toBe("0.035");

        expect(
          commission
            .commissionAmount
            .toString()
        ).toBe("7");

        const settlementsFromCustomerPayment =
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                merchantBody.merchant.id
            }
          });

        expect(
          settlementsFromCustomerPayment
        ).toBe(0);

                const invoiceNumber =
          `${testPrefix}-invoice-001`;

        const generateInvoiceResponse =
          await fetch(
            `${apiBaseUrl}/platform/merchants/${merchantBody.merchant.id}/billing/invoices`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${platform.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  invoiceNumber,
                  periodStart:
                    currentPeriodStart.toISOString(),
                  periodEnd:
                    currentPeriodEnd.toISOString(),
                  subscriptionCharge: {
                    subscriptionId:
                      initializeSubscriptionBody
                        .subscription.id,
                    billingPeriodStart:
                      currentPeriodStart.toISOString(),
                    billingPeriodEnd:
                      currentPeriodEnd.toISOString()
                  }
                })
            }
          );

        expect(
          generateInvoiceResponse.status
        ).toBe(201);

        const generateInvoiceBody =
          await generateInvoiceResponse.json() as {
            invoice: {
              id: string;
              merchantId: string;
              invoiceNumber: string;
              status: string;
              currency: string;
              subscriptionAmount: string;
              commissionAmount: string;
              totalAmount: string;
              items: Array<{
                type: string;
                amount: string;
                subscriptionId: string | null;
                commissionId: string | null;
              }>;
            };
          };

        expect(
          generateInvoiceBody.invoice
        ).toMatchObject({
          merchantId:
            merchantBody.merchant.id,
          invoiceNumber,
          status:
            "DRAFT",
          currency:
            "ETB"
        });

        expect(
          generateInvoiceBody.invoice
            .subscriptionAmount
        ).toBe("500");

        expect(
          generateInvoiceBody.invoice
            .commissionAmount
        ).toBe("7");

        expect(
          generateInvoiceBody.invoice
            .totalAmount
        ).toBe("507");

        expect(
          generateInvoiceBody.invoice.items
        ).toHaveLength(2);

        expect(
          generateInvoiceBody.invoice.items
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type:
                "SUBSCRIPTION",
              amount:
                "500",
              subscriptionId:
                initializeSubscriptionBody
                  .subscription.id
            }),
            expect.objectContaining({
              type:
                "COMMISSION",
              amount:
                "7",
              commissionId:
                commission.id
            })
          ])
        );

        const invoicedCommission =
          await prisma.commission.findUniqueOrThrow({
            where: {
              id:
                commission.id
            }
          });

        expect(
          invoicedCommission.status
        ).toBe("INVOICED");

        const persistedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                generateInvoiceBody.invoice.id
            },
            include: {
              items: true
            }
          });

        expect(
          persistedInvoice.merchantId
        ).toBe(
          merchantBody.merchant.id
        );

        expect(
          persistedInvoice.status
        ).toBe("DRAFT");

        expect(
          persistedInvoice
            .subscriptionAmount
            .toString()
        ).toBe("500");

        expect(
          persistedInvoice
            .commissionAmount
            .toString()
        ).toBe("7");

        expect(
          persistedInvoice
            .totalAmount
            .toString()
        ).toBe("507");

        expect(
          persistedInvoice.items
        ).toHaveLength(2);

                const openInvoiceResponse =
          await fetch(
            `${apiBaseUrl}/platform/merchants/${merchantBody.merchant.id}/billing/invoices/${generateInvoiceBody.invoice.id}/open`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${platform.token}`
              }
            }
          );

        expect(
          openInvoiceResponse.status
        ).toBe(200);

        const openInvoiceBody =
          await openInvoiceResponse.json() as {
            invoice: {
              id: string;
              merchantId: string;
              status: string;
              openedAt: string | null;
              dueAt: string | null;
            };
          };

        expect(
          openInvoiceBody.invoice
        ).toMatchObject({
          id:
            generateInvoiceBody.invoice.id,
          merchantId:
            merchantBody.merchant.id,
          status:
            "OPEN"
        });

        expect(
          openInvoiceBody.invoice.openedAt
        ).not.toBeNull();

        expect(
          openInvoiceBody.invoice.dueAt
        ).not.toBeNull();

        const openedAt =
          new Date(
            openInvoiceBody.invoice.openedAt!
          );

        const dueAt =
          new Date(
            openInvoiceBody.invoice.dueAt!
          );

        expect(
          dueAt.getTime() -
            openedAt.getTime()
        ).toBe(
          7 * 24 * 60 * 60 * 1000
        );

        const openedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                generateInvoiceBody.invoice.id
            }
          });

        expect(
          openedInvoice.merchantId
        ).toBe(
          merchantBody.merchant.id
        );

        expect(
          openedInvoice.status
        ).toBe("OPEN");

        expect(
          openedInvoice.openedAt
        ).not.toBeNull();

        expect(
          openedInvoice.dueAt
        ).not.toBeNull();

        expect(
          openedInvoice
            .subscriptionAmount
            .toString()
        ).toBe("500");

        expect(
          openedInvoice
            .commissionAmount
            .toString()
        ).toBe("7");

        expect(
          openedInvoice
            .totalAmount
            .toString()
        ).toBe("507");

        const telegramCallsBeforeFulfillment =
          sendTelegramMessageMock.mock.calls.length;

        const fulfillingResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/orders/${customerOrder.id}/status`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  status:
                    OrderStatus.FULFILLING
                })
            }
          );

        expect(
          fulfillingResponse.status
        ).toBe(200);

        const fulfillingBody =
          await fulfillingResponse.json() as {
            message: string;
            order: {
              id: string;
              merchantId: string;
              status: string;
            };
          };

        expect(
          fulfillingBody
        ).toMatchObject({
          message:
            "Order marked as fulfilling",
          order: {
            id:
              customerOrder.id,
            merchantId:
              merchantBody.merchant.id,
            status:
              OrderStatus.FULFILLING
          }
        });

        expect(
          sendTelegramMessageMock.mock.calls.length
        ).toBe(
          telegramCallsBeforeFulfillment + 1
        );

        const fulfillmentTelegramText =
          String(
            sendTelegramMessageMock
              .mock.calls[
                telegramCallsBeforeFulfillment
              ]?.[2]
          );

        const deliveryCodeMatch =
          fulfillmentTelegramText.match(
            /delivery confirmation code is:\s*(\d{6})/i
          );

        expect(
          deliveryCodeMatch
        ).not.toBeNull();

        const deliveryConfirmationCode =
          deliveryCodeMatch![1];

        const fulfillingOrder =
          await prisma.order
            .findUniqueOrThrow({
              where: {
                id:
                  customerOrder.id
              }
            });

        expect(
          fulfillingOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          fulfillingOrder
            .deliveryConfirmationCodeHash
        ).not.toBeNull();

        expect(
          fulfillingOrder
            .deliveryConfirmationCodeExpiresAt
        ).not.toBeNull();

        expect(
          fulfillingOrder
            .deliveryConfirmationSentAt
        ).not.toBeNull();

        const deliveryConfirmationResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchantBody.merchant.id}/orders/${customerOrder.id}/delivery-confirmation`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${loginBody.token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  code:
                    deliveryConfirmationCode
                })
            }
          );

        expect(
          deliveryConfirmationResponse.status
        ).toBe(200);

        const deliveryConfirmationBody =
          await deliveryConfirmationResponse.json() as {
            message: string;
            order: {
              id: string;
              merchantId: string;
              status: string;
            };
          };

        expect(
          deliveryConfirmationBody
        ).toMatchObject({
          message:
            "Delivery confirmed and order fulfilled",
          order: {
            id:
              customerOrder.id,
            merchantId:
              merchantBody.merchant.id,
            status:
              OrderStatus.FULFILLED
          }
        });

        const fulfilledOrder =
          await prisma.order
            .findUniqueOrThrow({
              where: {
                id:
                  customerOrder.id
              }
            });

        expect(
          fulfilledOrder.status
        ).toBe(
          OrderStatus.FULFILLED
        );

        expect(
          fulfilledOrder
            .deliveryConfirmedAt
        ).not.toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationCodeHash
        ).toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationCodeExpiresAt
        ).toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationSentAt
        ).toBeNull();

        const newOwnerPassword =
        "gate-13-owner-new-password";

      const changePasswordResponse =
        await fetch(
          `${apiBaseUrl}/auth/password`,
          {
            method:
              "PATCH",
            headers: {
              authorization:
                `Bearer ${loginBody.token}`,
              "content-type":
                "application/json"
            },
            body:
              JSON.stringify({
                currentPassword:
                  ownerPassword,
                newPassword:
                  newOwnerPassword
              })
          }
        );

      expect(
        changePasswordResponse.status
      ).toBe(200);

      const changePasswordBody =
        await changePasswordResponse.json() as {
          message: string;
        };

      expect(
        changePasswordBody.message
      ).toBe(
        "Password changed successfully"
      );

      const oldTokenMeResponse =
        await fetch(
          `${apiBaseUrl}/auth/me`,
          {
            headers: {
              authorization:
                `Bearer ${loginBody.token}`
            }
          }
        );

      expect(
        oldTokenMeResponse.status
      ).toBe(401);

      const oldPasswordLoginResponse =
        await fetch(
          `${apiBaseUrl}/auth/login`,
          {
            method:
              "POST",
            headers: {
              "content-type":
                "application/json"
            },
            body:
              JSON.stringify({
                email:
                  ownerEmail,
                password:
                  ownerPassword
              })
          }
        );

      expect(
        oldPasswordLoginResponse.status
      ).toBe(401);

      const newPasswordLoginResponse =
        await fetch(
          `${apiBaseUrl}/auth/login`,
          {
            method:
              "POST",
            headers: {
              "content-type":
                "application/json"
            },
            body:
              JSON.stringify({
                email:
                  ownerEmail,
                password:
                  newOwnerPassword
              })
          }
        );

      expect(
        newPasswordLoginResponse.status
      ).toBe(200);

      const newPasswordLoginBody =
        await newPasswordLoginResponse.json() as {
          token: string;
          user: {
            id: string;
            merchantId: string;
            email: string;
            role: string;
          };
        };

      expect(
        newPasswordLoginBody.user
      ).toMatchObject({
        id:
          loginBody.user.id,
        merchantId:
          merchantBody.merchant.id,
        email:
          ownerEmail,
        role:
          "OWNER"
      });

      expect(
        newPasswordLoginBody.token
      ).not.toBe(
        loginBody.token
      );

      const newTokenMeResponse =
        await fetch(
          `${apiBaseUrl}/auth/me`,
          {
            headers: {
              authorization:
                `Bearer ${newPasswordLoginBody.token}`
            }
          }
        );

      expect(
        newTokenMeResponse.status
      ).toBe(200);

      const newTokenMeBody =
        await newTokenMeResponse.json() as {
          user: {
            id: string;
            merchantId: string;
            email: string;
            role: string;
          };
        };

      expect(
        newTokenMeBody.user
      ).toMatchObject({
        id:
          loginBody.user.id,
        merchantId:
          merchantBody.merchant.id,
        email:
          ownerEmail,
        role:
          "OWNER"
      });
      }
    );
  }
);
