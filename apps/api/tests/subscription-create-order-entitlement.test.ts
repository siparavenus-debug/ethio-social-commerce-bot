import {
  MerchantSubscriptionStatus,
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
  createOrder
} from "../src/tools/orders.js";

const testPrefix =
  "d16-create-order";

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
  status?: MerchantSubscriptionStatus
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

  if (status !== undefined) {
    const plan =
      await prisma.subscriptionPlan.create({
        data: {
          code:
            `${testPrefix}-${suffix}`,
          name:
            `Day 16 Plan ${suffix}`,
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
  }

  const customer =
    await prisma.customer.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Customer ${suffix}`
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

  return {
    merchant,
    customer,
    product
  };
}

async function expectNoOrderSideEffects(
  merchantId: string,
  productId: string
) {
  expect(
    await prisma.order.count({
      where: {
        merchantId
      }
    })
  ).toBe(0);

  const product =
    await prisma.product.findUniqueOrThrow({
      where: {
        id:
          productId
      }
    });

  expect(
    product.stock
  ).toBe(5);
}

describe(
  "subscription entitlement inside createOrder",
  () => {
    beforeEach(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    it(
      "allows an ACTIVE merchant to create a Telegram-style order without decrementing stock",
      async () => {
        const fixture =
          await createFixture(
            "active",
            MerchantSubscriptionStatus.ACTIVE
          );

        const order =
          await createOrder(
            fixture.merchant.id,
            fixture.customer.id,
            fixture.product.id,
            2
          );

        expect(
          order.status
        ).toBe(
          OrderStatus.PENDING_PAYMENT
        );

        expect(
          order.total
        ).toBe(200);

        expect(
          order.items
        ).toHaveLength(1);

        expect(
          order.items[0]?.productId
        ).toBe(
          fixture.product.id
        );

        expect(
          order.items[0]?.quantity
        ).toBe(2);

        const persisted =
          await prisma.order.findUnique({
            where: {
              id:
                order.id
            },
            include: {
              items:
                true
            }
          });

        expect(
          persisted
        ).not.toBeNull();

        expect(
          persisted?.status
        ).toBe(
          OrderStatus.PENDING_PAYMENT
        );

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
      "blocks a SUSPENDED merchant before creating an order",
      async () => {
        const fixture =
          await createFixture(
            "suspended",
            MerchantSubscriptionStatus.SUSPENDED
          );

        await expect(
          createOrder(
            fixture.merchant.id,
            fixture.customer.id,
            fixture.product.id,
            1
          )
        ).rejects.toThrow(
          "Merchant is not entitled to CREATE_COMMERCE"
        );

        await expectNoOrderSideEffects(
          fixture.merchant.id,
          fixture.product.id
        );
      }
    );

    it(
      "blocks a CANCELLED merchant before creating an order",
      async () => {
        const fixture =
          await createFixture(
            "cancelled",
            MerchantSubscriptionStatus.CANCELLED
          );

        await expect(
          createOrder(
            fixture.merchant.id,
            fixture.customer.id,
            fixture.product.id,
            1
          )
        ).rejects.toThrow(
          "Merchant is not entitled to CREATE_COMMERCE"
        );

        await expectNoOrderSideEffects(
          fixture.merchant.id,
          fixture.product.id
        );
      }
    );

    it(
      "blocks a merchant with no subscription before creating an order",
      async () => {
        const fixture =
          await createFixture(
            "missing"
          );

        await expect(
          createOrder(
            fixture.merchant.id,
            fixture.customer.id,
            fixture.product.id,
            1
          )
        ).rejects.toThrow(
          "Merchant is not entitled to CREATE_COMMERCE"
        );

        await expectNoOrderSideEffects(
          fixture.merchant.id,
          fixture.product.id
        );
      }
    );
  }
);
