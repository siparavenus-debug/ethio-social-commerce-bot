import {
  CommissionAdjustmentType,
  CommissionStatus,
  MerchantSubscriptionStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
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
  accrueCommission
} from "../src/services/commission.js";

import {
  createCommissionAdjustment
} from "../src/services/commission-adjustment.js";

import {
  getMerchantCommissionHistory
} from "../src/services/merchant-billing-read.js";

import {
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
  "day17-commission-history";

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
    await prisma.commissionAdjustment.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.auditLog.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.commission.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.payment.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.orderItem.deleteMany({
      where: {
        order: {
          merchantId: {
            in: merchantIds
          }
        }
      }
    });

    await prisma.order.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.product.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.customer.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchantSubscription.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchant.deleteMany({
      where: {
        id: {
          in: merchantIds
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
  amount = "1000.00"
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

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${testPrefix}-${suffix}`,
        name:
          `Day 17 Commission History ${suffix}`,
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

  const subscription =
    await initializeMerchantSubscription({
      merchantId:
        merchant.id,
      planId:
        plan.id,
      billingInterval:
        SubscriptionBillingInterval.MONTHLY,
      status:
        MerchantSubscriptionStatus.ACTIVE,
      currentPeriodStart:
        new Date(
          "2026-09-01T00:00:00.000Z"
        ),
      currentPeriodEnd:
        new Date(
          "2026-10-01T00:00:00.000Z"
        )
    });

  const customer =
    await prisma.customer.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Day 17 Customer ${suffix}`,
        telegramChatId:
          `day17-history-chat-${suffix}`,
        telegramUserId:
          `day17-history-user-${suffix}`
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Day 17 Product ${suffix}`,
        price:
          amount,
        currency:
          "ETB",
        stock:
          10,
        status:
          ProductStatus.ACTIVE
      }
    });

  const order =
    await prisma.order.create({
      data: {
        merchantId:
          merchant.id,
        customerId:
          customer.id,
        orderNumber:
          `DAY17-HISTORY-${suffix}`,
        status:
          OrderStatus.PAID,
        currency:
          "ETB",
        subtotal:
          amount,
        total:
          amount,
        items: {
          create: {
            productId:
              product.id,
            productName:
              product.name,
            quantity:
              1,
            unitPrice:
              amount,
            lineTotal:
              amount
          }
        }
      }
    });

  const payment =
    await prisma.payment.create({
      data: {
        merchantId:
          merchant.id,
        orderId:
          order.id,
        provider:
          PaymentProvider.TELEBIRR,
        status:
          PaymentStatus.VERIFIED,
        amount,
        currency:
          "ETB",
        transactionReference:
          `DAY17-HISTORY-TXN-${suffix}`,
        verifiedAt:
          new Date()
      }
    });

  const commission =
    await prisma.$transaction(
      async (tx) =>
        accrueCommission(
          tx,
          {
            merchantId:
              merchant.id,
            paymentId:
              payment.id
          }
        )
    );

  return {
    merchant,
    plan,
    subscription,
    customer,
    product,
    order,
    payment,
    commission
  };
}

beforeEach(
  async () => {
    await cleanup();
  }
);

afterAll(
  async () => {
    await cleanup();
    await prisma.$disconnect();
  }
);

describe(
  "merchant commission history",
  () => {
    it(
      "returns stored snapshots, signed adjustments, and net commission",
      async () => {
        const fixture =
          await createFixture(
            "snapshots"
          );

        await createCommissionAdjustment({
          merchantId:
            fixture.merchant.id,
          commissionId:
            fixture.commission.id,
          type:
            CommissionAdjustmentType.REFUND,
          amount:
            new Prisma.Decimal(
              "-5.00"
            ),
          currency:
            "ETB",
          reason:
            "Partial refund",
          idempotencyKey:
            "day17-history-refund"
        });

        /*
         * Change the current plan rate after accrual.
         * Historical output must continue using the
         * commission's stored rate snapshot.
         */
        await prisma.subscriptionPlan.update({
          where: {
            id:
              fixture.plan.id
          },
          data: {
            commissionRate:
              "0.100000"
          }
        });

        const result =
          await getMerchantCommissionHistory(
            fixture.merchant.id
          );

        expect(
          result.commissions
        ).toHaveLength(1);

        const history =
          result.commissions[0];

        expect(
          history.transactionAmount
        ).toBe("1000");

        expect(
          history.commissionRate
        ).toBe("0.035");

        expect(
          history.commissionAmount
        ).toBe("35");

        expect(
          history.adjustmentAmount
        ).toBe("-5");

        expect(
          history.netCommissionAmount
        ).toBe("30");

        expect(
          history.currency
        ).toBe("ETB");

        expect(
          history.adjustments
        ).toHaveLength(1);

        expect(
          history.adjustments[0]
        ).toMatchObject({
          type:
            CommissionAdjustmentType.REFUND,
          amount:
            "-5",
          currency:
            "ETB",
          reason:
            "Partial refund"
        });
      }
    );

    it(
      "keeps already-invoiced commissions visible in history",
      async () => {
        const fixture =
          await createFixture(
            "invoiced"
          );

        await prisma.commission.update({
          where: {
            id:
              fixture.commission.id
          },
          data: {
            status:
              CommissionStatus.INVOICED
          }
        });

        const result =
          await getMerchantCommissionHistory(
            fixture.merchant.id
          );

        expect(
          result.commissions
        ).toHaveLength(1);

        expect(
          result.commissions[0].id
        ).toBe(
          fixture.commission.id
        );

        expect(
          result.commissions[0].status
        ).toBe(
          CommissionStatus.INVOICED
        );
      }
    );

    it(
      "returns newest commissions first",
      async () => {
        const fixture =
          await createFixture(
            "ordering",
            "100.00"
          );

        const newerOrder =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id,
              orderNumber:
                "DAY17-HISTORY-ordering-newer",
              status:
                OrderStatus.PAID,
              currency:
                "ETB",
              subtotal:
                "200.00",
              total:
                "200.00",
              items: {
                create: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  quantity:
                    1,
                  unitPrice:
                    "200.00",
                  lineTotal:
                    "200.00"
                }
              }
            }
          });

        const newerPayment =
          await prisma.payment.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderId:
                newerOrder.id,
              provider:
                PaymentProvider.TELEBIRR,
              status:
                PaymentStatus.VERIFIED,
              amount:
                "200.00",
              currency:
                "ETB",
              transactionReference:
                "DAY17-HISTORY-TXN-ordering-newer",
              verifiedAt:
                new Date()
            }
          });

        const newerCommission =
          await prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    newerPayment.id
                }
              )
          );

        await prisma.commission.update({
          where: {
            id:
              fixture.commission.id
          },
          data: {
            createdAt:
              new Date(
                "2026-09-10T10:00:00.000Z"
              )
          }
        });

        await prisma.commission.update({
          where: {
            id:
              newerCommission.id
          },
          data: {
            createdAt:
              new Date(
                "2026-09-11T10:00:00.000Z"
              )
          }
        });

        const result =
          await getMerchantCommissionHistory(
            fixture.merchant.id
          );

        expect(
          result.commissions.map(
            (commission) =>
              commission.id
          )
        ).toEqual([
          newerCommission.id,
          fixture.commission.id
        ]);
      }
    );
    it(
      "isolates commission history by merchant",
      async () => {
        const merchantA =
          await createFixture(
            "merchant-a"
          );

        const merchantB =
          await createFixture(
            "merchant-b"
          );

        const result =
          await getMerchantCommissionHistory(
            merchantA.merchant.id
          );

        expect(
          result.merchantId
        ).toBe(
          merchantA.merchant.id
        );

        expect(
          result.commissions.map(
            (commission) =>
              commission.id
          )
        ).toEqual([
          merchantA.commission.id
        ]);

        expect(
          result.commissions.some(
            (commission) =>
              commission.id ===
              merchantB.commission.id
          )
        ).toBe(false);
      }
    );
  }
);
