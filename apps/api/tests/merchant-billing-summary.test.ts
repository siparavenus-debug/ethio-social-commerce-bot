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
  createCommissionAdjustment
} from "../src/services/commission-adjustment.js";
import {
  accrueCommission
} from "../src/services/commission.js";
import {
  generateMerchantInvoice
} from "../src/services/invoice.js";
import {
  getMerchantBillingSummary
} from "../src/services/merchant-billing-read.js";
import {
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
  "day17-billing-summary";

const planCodePrefix =
  "d17bs-";

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
  paymentAmount = "1000.00",
  withSubscription = true
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

  if (!withSubscription) {
    return {
      merchant,
      plan: null,
      subscription: null,
      commission: null
    };
  }

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${planCodePrefix}${suffix.slice(0, 18)}`,
        name:
          `Day 17 Summary Plan ${suffix}`,
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
          `d17-summary-tg-${suffix}`
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Summary Product ${suffix}`,
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
          `D17-SUM-${suffix}`,
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
          `D17-SUM-TX-${suffix}`
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

  await prisma.commission.update({
    where: {
      id:
        commission.id
    },
    data: {
      createdAt:
        new Date(
          "2026-09-15T00:00:00.000Z"
        )
    }
  });

  return {
    merchant,
    plan,
    subscription,
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
  "merchant billing summary",
  () => {
    it(
      "returns the authoritative current-period estimate",
      async () => {
        const fixture =
          await createFixture(
            "estimate"
          );

        if (
          !fixture.subscription ||
          !fixture.commission
        ) {
          throw new Error(
            "Expected subscribed fixture"
          );
        }

        const adjustment =
          await createCommissionAdjustment({
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
              "Day 17 estimate correction",
            idempotencyKey:
              "d17-summary-estimate-adjustment",
            actorUserId:
              null
          });

          await prisma.commissionAdjustment.update({
            where: {
              id:
                adjustment.id
            },
            data: {
              createdAt:
                new Date(
                  "2026-09-15T00:00:00.000Z"
                )
            }
          });

        const summary =
          await getMerchantBillingSummary(
            fixture.merchant.id
          );

        expect(
          summary.currentPeriod.status
        ).toBe(
          "ESTIMATE"
        );

        expect(
          summary.subscription?.priceSnapshot
        ).toBe(
          "500"
        );

        expect(
          summary.subscription
            ?.commissionRateSnapshot
        ).toBe(
          "0.035"
        );

        expect(
          summary.currentPeriod
            .subscriptionAmount
        ).toBe(
          "500"
        );

        expect(
          summary.currentPeriod
            .commissionAmount
        ).toBe(
          "30"
        );

        expect(
          summary.currentPeriod.totalAmount
        ).toBe(
          "530"
        );

        expect(
          summary.currentPeriod.invoiceId
        ).toBeNull();
      }
    );

    it(
      "uses persisted current-period invoice amounts after invoicing",
      async () => {
        const fixture =
          await createFixture(
            "invoiced"
          );

        if (!fixture.subscription) {
          throw new Error(
            "Expected subscribed fixture"
          );
        }

        const invoice =
          await generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "D17-SUM-INV-001",
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

        const summary =
          await getMerchantBillingSummary(
            fixture.merchant.id
          );

        expect(
          summary.currentPeriod.status
        ).toBe(
          "INVOICED"
        );

        expect(
          summary.currentPeriod.invoiceId
        ).toBe(
          invoice.id
        );

        expect(
          summary.currentPeriod.invoiceNumber
        ).toBe(
          "D17-SUM-INV-001"
        );

        expect(
          summary.currentPeriod.invoiceStatus
        ).toBe(
          invoice.status
        );

        expect(
          summary.currentPeriod
            .subscriptionAmount
        ).toBe(
          invoice.subscriptionAmount
            .toString()
        );

        expect(
          summary.currentPeriod
            .commissionAmount
        ).toBe(
          invoice.commissionAmount
            .toString()
        );

        expect(
          summary.currentPeriod.totalAmount
        ).toBe(
          invoice.totalAmount.toString()
        );
      }
    );

    it(
      "reports a negative current-period estimate as requiring review",
      async () => {
        const fixture =
          await createFixture(
            "negative",
            "100.00"
          );

        if (!fixture.commission) {
          throw new Error(
            "Expected commission fixture"
          );
        }

        /*
         * Seed a defensive/legacy database state directly.
         *
         * The Day 13 adjustment service correctly prevents
         * a commission's net amount from going below zero.
         * This test is not asserting that such a state can
         * be created through the authorized write path.
         *
         * It proves the Day 17 read model fails safely if
         * persisted financial data nevertheless produces
         * a negative billing-period total.
         */
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
              "Day 17 defensive negative summary",
            idempotencyKey:
              "d17-summary-negative",
            createdAt:
              new Date(
                "2026-09-15T00:00:00.000Z"
              )
          }
        });

        const summary =
          await getMerchantBillingSummary(
            fixture.merchant.id
          );

        expect(
          summary.currentPeriod.status
        ).toBe(
          "NEGATIVE_TOTAL_REQUIRES_REVIEW"
        );

        expect(
          summary.currentPeriod
            .commissionAmount
        ).toBe(
          "-596.5"
        );

        expect(
          summary.currentPeriod.totalAmount
        ).toBe(
          "-96.5"
        );

        expect(
          summary.currentPeriod.invoiceId
        ).toBeNull();
      }
    );

    it(
      "returns an explicit no-subscription state",
      async () => {
        const fixture =
          await createFixture(
            "no-subscription",
            "1000.00",
            false
          );

        const summary =
          await getMerchantBillingSummary(
            fixture.merchant.id
          );

        expect(
          summary.merchantId
        ).toBe(
          fixture.merchant.id
        );

        expect(
          summary.subscription
        ).toBeNull();

        expect(
          summary.currentPeriod.status
        ).toBe(
          "NO_SUBSCRIPTION"
        );

        expect(
          summary.currentPeriod.periodStart
        ).toBeNull();

        expect(
          summary.currentPeriod
            .subscriptionAmount
        ).toBeNull();

        expect(
          summary.currentPeriod.totalAmount
        ).toBeNull();

        expect(
          summary.currentPeriod.currency
        ).toBe(
          "ETB"
        );
      }
    );

    it(
      "keeps billing summaries isolated by merchant id",
      async () => {
        const merchantA =
          await createFixture(
            "isolation-a",
            "1000.00"
          );

        const merchantB =
          await createFixture(
            "isolation-b",
            "2000.00"
          );

        const summaryA =
          await getMerchantBillingSummary(
            merchantA.merchant.id
          );

        const summaryB =
          await getMerchantBillingSummary(
            merchantB.merchant.id
          );

        expect(
          summaryA.merchantId
        ).toBe(
          merchantA.merchant.id
        );

        expect(
          summaryB.merchantId
        ).toBe(
          merchantB.merchant.id
        );

        expect(
          summaryA.currentPeriod
            .commissionAmount
        ).toBe(
          "35"
        );

        expect(
          summaryB.currentPeriod
            .commissionAmount
        ).toBe(
          "70"
        );

        expect(
          summaryA.currentPeriod.totalAmount
        ).toBe(
          "535"
        );

        expect(
          summaryB.currentPeriod.totalAmount
        ).toBe(
          "570"
        );

        expect(
          summaryA.subscription?.id
        ).not.toBe(
          summaryB.subscription?.id
        );
      }
    );
  }
);
