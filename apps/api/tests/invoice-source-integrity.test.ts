import {
  CommissionAdjustmentType,
  MerchantInvoiceItemType,
  MerchantSubscriptionStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  Prisma,
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
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
  "day14-invoice-source-integrity";

const periodStart =
  new Date("2026-09-01T00:00:00.000Z");

const periodEnd =
  new Date("2026-10-01T00:00:00.000Z");

async function cleanup() {
  const merchants =
    await prisma.merchant.findMany({
      where: {
        name: {
          startsWith: testPrefix
        }
      },
      select: {
        id: true
      }
    });

  const merchantIds =
    merchants.map(
      (merchant) => merchant.id
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
        startsWith: "d14-"
      }
    }
  });
}

async function createFixture(
  suffix: string
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
        `d14-${suffix.slice(0, 20)}`,
        name:
          `Day 14 Plan ${suffix}`,
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
        periodStart,
      currentPeriodEnd:
        periodEnd
    });

  const customer =
    await prisma.customer.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Day 14 Customer ${suffix}`,
        telegramChatId:
          `day14-chat-${suffix}`,
        telegramUserId:
          `day14-user-${suffix}`
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Day 14 Product ${suffix}`,
        price:
          "99.00",
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
          `DAY14-${suffix}`,
        status:
          OrderStatus.PAID,
        currency:
          "ETB",
        subtotal:
          "99.00",
        total:
          "99.00",
        items: {
          create: {
            productId:
              product.id,
            productName:
              product.name,
            quantity:
              1,
            unitPrice:
              "99.00",
            lineTotal:
              "99.00"
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
          "99.00",
        currency:
          "ETB",
        transactionReference:
          `DAY14-TXN-${suffix}`,
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

  const invoice =
    await prisma.merchantInvoice.create({
      data: {
        merchantId:
          merchant.id,
        invoiceNumber:
          `DAY14-INV-${suffix}`,
        periodStart,
        periodEnd,
        subscriptionAmount:
          "0.00",
        commissionAmount:
          "0.00",
        totalAmount:
          "0.00",
        currency:
          "ETB"
      }
    });

  return {
    merchant,
    plan,
    subscription,
    customer,
    product,
    order,
    payment,
    commission,
    invoice
  };
}

async function createAdjustment(
  fixture: Awaited<
    ReturnType<typeof createFixture>
  >,
  suffix: string
) {
  return createCommissionAdjustment({
    merchantId:
      fixture.merchant.id,
    commissionId:
      fixture.commission.id,
    type:
      CommissionAdjustmentType.CORRECTION,
    amount:
      new Prisma.Decimal("-1.00"),
    currency:
      "ETB",
    reason:
      "Day 14 invoice source-integrity test",
    idempotencyKey:
      `day14-adjustment-${suffix}`
  });
}

describe(
  "invoice source integrity",
  () => {
    beforeEach(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    it(
      "rejects a COMMISSION item without commissionId at the database boundary",
      async () => {
        const fixture =
          await createFixture(
            "commission-missing-source"
          );

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              type:
                MerchantInvoiceItemType.COMMISSION,
              description:
                "Invalid commission item",
              amount:
                fixture.commission
                  .commissionAmount,
              currency:
                "ETB"
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2039"
        });
      }
    );

    it(
      "rejects a COMMISSION item carrying an adjustment source",
      async () => {
        const fixture =
          await createFixture(
            "commission-extra-source"
          );

        const adjustment =
          await createAdjustment(
            fixture,
            "commission-extra-source"
          );

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              type:
                MerchantInvoiceItemType.COMMISSION,
              description:
                "Invalid mixed-source commission",
              amount:
                fixture.commission
                  .commissionAmount,
              currency:
                "ETB",
              commissionId:
                fixture.commission.id,
              adjustmentId:
                adjustment.id
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2039"
        });
      }
    );

    it(
      "rejects an ADJUSTMENT item without adjustmentId at the database boundary",
      async () => {
        const fixture =
          await createFixture(
            "adjustment-missing-source"
          );

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              type:
                MerchantInvoiceItemType.ADJUSTMENT,
              description:
                "Invalid adjustment item",
              amount:
                "-1.00",
              currency:
                "ETB"
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2039"
        });
      }
    );

    it(
      "rejects a SUBSCRIPTION item without a complete billing period",
      async () => {
        const fixture =
          await createFixture(
            "subscription-incomplete-period"
          );

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              type:
                MerchantInvoiceItemType.SUBSCRIPTION,
              description:
                "Invalid subscription period",
              amount:
                fixture.subscription
                  .priceSnapshot,
              currency:
                "ETB",
              subscriptionId:
                fixture.subscription.id,
              billingPeriodStart:
                periodStart
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2039"
        });
      }
    );

    it(
      "rejects a SUBSCRIPTION item whose billing period does not advance",
      async () => {
        const fixture =
          await createFixture(
            "subscription-invalid-period"
          );

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              type:
                MerchantInvoiceItemType.SUBSCRIPTION,
              description:
                "Invalid subscription period",
              amount:
                fixture.subscription
                  .priceSnapshot,
              currency:
                "ETB",
              subscriptionId:
                fixture.subscription.id,
              billingPeriodStart:
                periodStart,
              billingPeriodEnd:
                periodStart
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2039"
        });
      }
    );

    it(
      "prevents the same Commission from being invoiced twice",
      async () => {
        const fixture =
          await createFixture(
            "duplicate-commission"
          );

        const data = {
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          type:
            MerchantInvoiceItemType.COMMISSION,
          description:
            "Commission charge",
          amount:
            fixture.commission
              .commissionAmount,
          currency:
            "ETB",
          commissionId:
            fixture.commission.id
        };

        await prisma.merchantInvoiceItem.create({
          data
        });

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              ...data,
              description:
                "Duplicate commission charge"
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2002"
        });
      }
    );

    it(
      "prevents the same CommissionAdjustment from being invoiced twice",
      async () => {
        const fixture =
          await createFixture(
            "duplicate-adjustment"
          );

        const adjustment =
          await createAdjustment(
            fixture,
            "duplicate-adjustment"
          );

        const data = {
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          type:
            MerchantInvoiceItemType.ADJUSTMENT,
          description:
            "Commission correction",
          amount:
            adjustment.amount,
          currency:
            "ETB",
          adjustmentId:
            adjustment.id
        };

        await prisma.merchantInvoiceItem.create({
          data
        });

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              ...data,
              description:
                "Duplicate correction"
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2002"
        });
      }
    );

    it(
      "prevents the same subscription billing period from being invoiced twice",
      async () => {
        const fixture =
          await createFixture(
            "duplicate-subscription-period"
          );

        const data = {
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          type:
            MerchantInvoiceItemType.SUBSCRIPTION,
          description:
            "Monthly subscription",
          amount:
            fixture.subscription
              .priceSnapshot,
          currency:
            "ETB",
          subscriptionId:
            fixture.subscription.id,
          billingPeriodStart:
            periodStart,
          billingPeriodEnd:
            periodEnd
        };

        await prisma.merchantInvoiceItem.create({
          data
        });

        await expect(
          prisma.merchantInvoiceItem.create({
            data: {
              ...data,
              description:
                "Duplicate monthly subscription"
            }
          })
        ).rejects.toMatchObject({
          code:
            "P2002"
    });
  });

  it(
    "allows a negative commission subtotal when the overall invoice total remains nonnegative",
    async () => {
      const fixture =
        await createFixture(
          "negative-commission-subtotal"
        );

      const updated =
        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            subscriptionAmount:
              new Prisma.Decimal("500.00"),
            commissionAmount:
              new Prisma.Decimal("-20.00"),
            totalAmount:
              new Prisma.Decimal("480.00")
          }
        });

      expect(
        updated.subscriptionAmount.toFixed(2)
      ).toBe(
        "500.00"
      );

      expect(
        updated.commissionAmount.toFixed(2)
      ).toBe(
        "-20.00"
      );

      expect(
        updated.totalAmount.toFixed(2)
      ).toBe(
        "480.00"
      );
    }
  );

  it(
    "rejects a negative payable invoice even when the commission subtotal is validly negative",
    async () => {
      const fixture =
        await createFixture(
          "negative-payable-total"
        );

      await expect(
        prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            subscriptionAmount:
              new Prisma.Decimal("0.00"),
            commissionAmount:
              new Prisma.Decimal("-20.00"),
            totalAmount:
              new Prisma.Decimal("-20.00")
          }
        })
      ).rejects.toMatchObject({
        code:
          "P2039"
      });
    }
  );
});
