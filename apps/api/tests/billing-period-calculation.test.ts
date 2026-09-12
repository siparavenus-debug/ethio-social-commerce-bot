import {
  CommissionAdjustmentType,
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
  calculateBillingPeriod
} from "../src/services/billing-period-calculation.js";
import {
  accrueCommission
} from "../src/services/commission.js";
import {
  generateMerchantInvoice
} from "../src/services/invoice.js";
import {
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
  "day17-billing-period";

const planCodePrefix =
  "d17bp-";

const periodStart =
  new Date(
    "2026-09-01T00:00:00.000Z"
  );

const periodEnd =
  new Date(
    "2026-10-01T00:00:00.000Z"
  );

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
    await prisma.merchantInvoiceItem.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchantSettlement.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchantInvoice.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

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
          planCodePrefix
      }
    }
  });
}

async function createFixture(
  suffix: string,
  paymentAmount = "100.00"
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
          `${planCodePrefix}${suffix.slice(0, 18)}`,
        name:
          `Day 17 Billing Plan ${suffix}`,
        monthlyPrice:
          new Prisma.Decimal(
            "500.00"
          ),
        annualPrice:
          new Prisma.Decimal(
            "5000.00"
          ),
        currency:
          "ETB",
        commissionRate:
          new Prisma.Decimal(
            "0.035000"
          ),
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
        "ACTIVE",
      currentPeriodStart:
        periodStart,
      currentPeriodEnd:
        periodEnd,
      actorUserId:
        null
    });

  const customer =
    await prisma.customer.create({
      data: {
        merchantId:
          merchant.id,
        telegramUserId:
          `d17-tg-${suffix}`
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
          new Prisma.Decimal(
            paymentAmount
          ),
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
          `D17-ORD-${suffix}`,
        status:
          OrderStatus.PAID,
        currency:
          "ETB",
        subtotal:
          new Prisma.Decimal(
            paymentAmount
          ),
        total:
          new Prisma.Decimal(
            paymentAmount
          ),
        items: {
          create: {
            productId:
              product.id,
            productName:
              product.name,
            quantity:
              1,
            unitPrice:
              new Prisma.Decimal(
                paymentAmount
              ),
            lineTotal:
              new Prisma.Decimal(
                paymentAmount
              )
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
        amount:
          new Prisma.Decimal(
            paymentAmount
          ),
        currency:
          "ETB",
        transactionReference:
          `D17-TX-${suffix}`
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
              payment.id,
            actorUserId:
              null
          }
        )
    );

  return {
    merchant,
    plan,
    subscription,
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
  "billing period calculation",
  () => {
    it(
      "uses the subscription snapshot and eligible commission and adjustment sources",
      async () => {
        const fixture =
          await createFixture(
            "basic",
            "1000.00"
          );

        await prisma.commissionAdjustment.create({
          data: {
            merchantId:
              fixture.merchant.id,
            commissionId:
              fixture.commission.id,
            type:
              CommissionAdjustmentType.CORRECTION,
            amount:
              new Prisma.Decimal(
                "-5.00"
              ),
            currency:
              "ETB",
            reason:
              "Day 17 test correction",
            idempotencyKey:
              "d17-basic-adjustment"
          }
        });

        const result =
          await calculateBillingPeriod(
            prisma,
            {
              merchantId:
                fixture.merchant.id,
              periodStart,
              periodEnd,
              subscriptionId:
                fixture.subscription.id
            }
          );

        expect(
          result.subscriptionAmount.toString()
        ).toBe("500");

        expect(
          result.commissionAccrualTotal.toString()
        ).toBe("35");

        expect(
          result.adjustmentTotal.toString()
        ).toBe("-5");

        expect(
          result.commissionAmount.toString()
        ).toBe("30");

        expect(
          result.totalAmount.toString()
        ).toBe("530");

        expect(
          result.commissions
        ).toHaveLength(1);

        expect(
          result.adjustments
        ).toHaveLength(1);
      }
    );

    it(
      "uses a half-open period and excludes a source created exactly at periodEnd",
      async () => {
        const fixture =
          await createFixture(
            "boundary"
          );

        await prisma.commission.update({
          where: {
            id:
              fixture.commission.id
          },
          data: {
            createdAt:
              periodEnd
          }
        });

        const result =
          await calculateBillingPeriod(
            prisma,
            {
              merchantId:
                fixture.merchant.id,
              periodStart,
              periodEnd,
              subscriptionId:
                fixture.subscription.id
            }
          );

        expect(
          result.commissions
        ).toHaveLength(0);

        expect(
          result.commissionAmount.toString()
        ).toBe("0");

        expect(
          result.totalAmount.toString()
        ).toBe("500");
      }
    );

    it(
      "excludes commission and adjustment sources after they have been invoiced",
      async () => {
        const fixture =
          await createFixture(
            "invoiced",
            "1000.00"
          );

        await prisma.commissionAdjustment.create({
          data: {
            merchantId:
              fixture.merchant.id,
            commissionId:
              fixture.commission.id,
            type:
              CommissionAdjustmentType.CORRECTION,
            amount:
              new Prisma.Decimal(
                "-5.00"
              ),
            currency:
              "ETB",
            reason:
              "Day 17 invoiced correction",
            idempotencyKey:
              "d17-invoiced-adjustment"
          }
        });

        await generateMerchantInvoice({
          merchantId:
            fixture.merchant.id,
          invoiceNumber:
            "D17-INV-INVOICED",
          periodStart,
          periodEnd,
          subscriptionCharge: {
            subscriptionId:
              fixture.subscription.id,
            billingPeriodStart:
              periodStart,
            billingPeriodEnd:
              periodEnd
          },
          actorUserId:
            null
        });

        const result =
          await calculateBillingPeriod(
            prisma,
            {
              merchantId:
                fixture.merchant.id,
              periodStart,
              periodEnd,
              subscriptionId:
                fixture.subscription.id
            }
          );

        expect(
          result.commissions
        ).toHaveLength(0);

        expect(
          result.adjustments
        ).toHaveLength(0);

        expect(
          result.commissionAmount.toString()
        ).toBe("0");

        expect(
          result.subscriptionAmount.toString()
        ).toBe("500");

        expect(
          result.totalAmount.toString()
        ).toBe("500");
      }
    );

    it(
      "returns a negative mathematical total without applying invoice policy",
      async () => {
        const fixture =
          await createFixture(
            "negative",
            "100.00"
          );

        await prisma.commissionAdjustment.create({
          data: {
            merchantId:
              fixture.merchant.id,
            commissionId:
              fixture.commission.id,
            type:
              CommissionAdjustmentType.CORRECTION,
            amount:
              new Prisma.Decimal(
                "-600.00"
              ),
            currency:
              "ETB",
            reason:
              "Day 17 negative estimate test",
            idempotencyKey:
              "d17-negative-adjustment"
          }
        });

        const result =
          await calculateBillingPeriod(
            prisma,
            {
              merchantId:
                fixture.merchant.id,
              periodStart,
              periodEnd,
              subscriptionId:
                fixture.subscription.id
            }
          );

        expect(
          result.commissionAmount.toString()
        ).toBe("-596.5");

        expect(
          result.totalAmount.toString()
        ).toBe("-96.5");

        expect(
          result.totalAmount.lessThan(0)
        ).toBe(true);
      }
    );
  }
);
