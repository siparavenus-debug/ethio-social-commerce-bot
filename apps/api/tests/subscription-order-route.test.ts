import {
  MerchantSubscriptionStatus,
  MerchantUserRole,
  OrderStatus,
  ProductStatus,
  SubscriptionBillingInterval,
  prisma
} from "@ethio-commerce/database";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import {
  createAuthToken
} from "../src/services/auth.js";

const API_BASE_URL =
  "http://localhost:3000";

const testPrefix =
  "d16-order-route";

async function cleanup(): Promise<void> {
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

  if (merchantIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
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
  }

  await prisma.subscriptionPlan.deleteMany({
    where: {
      code: {
        startsWith:
          testPrefix
      }
    }
  });
}

async function createFixture(
  suffix: string,
  status: MerchantSubscriptionStatus,
  role:
    MerchantUserRole =
      MerchantUserRole.OWNER
) {
  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`,
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
          `${testPrefix}-${suffix}@example.test`,
        passwordHash:
          "test-password-hash",
        displayName:
          `Day 16 ${role}`,
        role,
        tokenVersion:
          0
      }
    });

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${testPrefix}-${suffix}`,
        name:
          `Day 16 ${suffix}`,
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

  await prisma.merchantSubscription.create({
    data: {
      merchantId:
        merchant.id,
      planId:
        plan.id,
      status,
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
          "2026-09-01T00:00:00.000Z"
        ),
      currentPeriodEnd:
        new Date(
          "2026-10-01T00:00:00.000Z"
        )
    }
  });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Product ${suffix}`,
        price:
          "100.00",
        currency:
          "ETB",
        stock:
          5,
        status:
          ProductStatus.ACTIVE
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
    product,
    token
  };
}

async function postOrder(
  merchantId: string,
  token: string,
  productId: string,
  orderNumber: string,
  quantity = 2
) {
  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/orders`,
    {
      method:
        "POST",
      headers: {
        authorization:
          `Bearer ${token}`,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify({
          orderNumber,
          currency:
            "ETB",
          items: [
            {
              productId,
              quantity
            }
          ]
        })
    }
  );
}

async function postOrderStatus(
  merchantId: string,
  orderId: string,
  token: string,
  status:
    "FULFILLING" |
    "FULFILLED"
) {
  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/orders/${orderId}/status`,
    {
      method:
        "POST",
      headers: {
        authorization:
          `Bearer ${token}`,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify({
          status
        })
    }
  );
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe(
  "subscription enforcement on merchant order routes",
  () => {
    it(
      "allows an ACTIVE merchant to create new commerce",
      async () => {
        const fixture =
          await createFixture(
            "active",
            MerchantSubscriptionStatus.ACTIVE
          );

        const response =
          await postOrder(
            fixture.merchant.id,
            fixture.token,
            fixture.product.id,
            "D16-ACTIVE-ORDER"
          );

        expect(
          response.status
        ).toBe(201);

        const body =
          await response.json() as {
            id: string;
            orderNumber: string;
          };

        expect(
          body.orderNumber
        ).toBe(
          "D16-ACTIVE-ORDER"
        );

        const order =
          await prisma.order.findUnique({
            where: {
              id:
                body.id
            }
          });

        expect(
          order
        ).not.toBeNull();

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          product.stock
        ).toBe(3);
      }
    );

    it(
      "blocks a SUSPENDED merchant from creating new commerce without mutating inventory",
      async () => {
        const fixture =
          await createFixture(
            "suspended-owner",
            MerchantSubscriptionStatus.SUSPENDED
          );

        const response =
          await postOrder(
            fixture.merchant.id,
            fixture.token,
            fixture.product.id,
            "D16-SUSPENDED-ORDER"
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          await response.json()
        ).toEqual({
          error:
            "Merchant subscription does not allow this action"
        });

        expect(
          await prisma.order.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          product.stock
        ).toBe(5);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "does not allow STAFF to bypass suspension",
      async () => {
        const fixture =
          await createFixture(
            "suspended-staff",
            MerchantSubscriptionStatus.SUSPENDED,
            MerchantUserRole.STAFF
          );

        const response =
          await postOrder(
            fixture.merchant.id,
            fixture.token,
            fixture.product.id,
            "D16-STAFF-BYPASS"
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          await response.json()
        ).toEqual({
          error:
            "Merchant subscription does not allow this action"
        });

        expect(
          await prisma.order.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          product.stock
        ).toBe(5);
      }
    );

    it(
      "allows a SUSPENDED merchant to process an existing PAID order",
      async () => {
        const fixture =
          await createFixture(
            "suspended-fulfillment",
            MerchantSubscriptionStatus.SUSPENDED,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-EXISTING-PAID",
              status:
                OrderStatus.PAID,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00"
            }
          });

        const response =
          await postOrderStatus(
            fixture.merchant.id,
            order.id,
            fixture.token,
            "FULFILLING"
          );

        expect(
          response.status
        ).toBe(200);

        const updatedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                order.id
            }
          });

        expect(
          updatedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        const audit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLING"
            }
          });

        expect(
          audit
        ).not.toBeNull();

        expect(
          audit?.actorUserId
        ).toBe(
          fixture.user.id
        );
      }
    );
  }
);
