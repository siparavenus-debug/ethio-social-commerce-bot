import {
  CommissionAdjustmentType,
  CommissionStatus,
  MerchantInvoiceItemType,
  MerchantInvoiceStatus,
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
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
  "day14-invoice-engine";

const planCodePrefix =
  "d14ie-";

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
    await prisma.platformAuditLog.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantInvoiceItem
      .deleteMany({
        where: {
          merchantId: {
            in:
              merchantIds
          }
        }
      });

    await prisma.merchantSettlement
      .deleteMany({
        where: {
          merchantId: {
            in:
              merchantIds
          }
        }
      });

    await prisma.merchantInvoice
      .deleteMany({
        where: {
          merchantId: {
            in:
              merchantIds
          }
        }
      });

    await prisma.commissionAdjustment
      .deleteMany({
        where: {
          merchantId: {
            in:
              merchantIds
          }
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

    await prisma.merchantSubscription
      .deleteMany({
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

  await prisma.platformAuditLog.deleteMany({
    where: {
      actor: {
        email: {
          startsWith:
            `${testPrefix}-platform-`
        }
      }
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
          `Day 14 Invoice Plan ${suffix}`,
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
          `tg-${suffix}`
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
          `ORD-${suffix}`,
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
          `TX-${suffix}`
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
    customer,
    product,
    order,
    payment,
    commission
  };
}

async function createPlatformUser(
  suffix: string
) {
  return prisma.platformUser.create({
    data: {
      email:
        `${testPrefix}-platform-${suffix}@example.com`,
      passwordHash:
        "test-password-hash",
      displayName:
        `Platform Test ${suffix}`
    }
  });
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
  "invoice generation",
  () => {
    it(
      "generates a DRAFT invoice from subscription and accrued commission sources",
      async () => {
        const fixture =
          await createFixture(
            "basic"
          );

        const invoice =
          await generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-BASIC",
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

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.DRAFT
        );

        expect(
          invoice.subscriptionAmount
            .toFixed(2)
        ).toBe(
          "500.00"
        );

        expect(
          invoice.commissionAmount
            .toFixed(2)
        ).toBe(
          "3.50"
        );

        expect(
          invoice.totalAmount.toFixed(2)
        ).toBe(
          "503.50"
        );

        expect(
          invoice.items
        ).toHaveLength(
          2
        );

        expect(
          invoice.items.map(
            (item) =>
              item.type
          )
        ).toEqual(
          expect.arrayContaining([
            MerchantInvoiceItemType.SUBSCRIPTION,
            MerchantInvoiceItemType.COMMISSION
          ])
        );

        const commission =
          await prisma.commission.findUniqueOrThrow({
            where: {
              id:
                fixture.commission.id
            }
          });

        expect(
          commission.status
        ).toBe(
          CommissionStatus.INVOICED
        );
      }
    );

    it(
      "creates immutable adjustment line items and uses the signed adjustment in the commission subtotal",
      async () => {
        const fixture =
          await createFixture(
            "adjustment"
          );

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
                "-1.00"
              ),
            currency:
              "ETB",
            reason:
              "Test correction",
            idempotencyKey:
              "invoice-adjustment",
            actorUserId:
              null
          });

        const invoice =
          await generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-ADJ",
            periodStart,
            periodEnd,
            subscriptionCharge: {
              subscriptionId:
                fixture.subscription.id,
              billingPeriodStart:
                periodStart,
              billingPeriodEnd:
                periodEnd
            }
          });

        expect(
          invoice.commissionAmount
            .toFixed(2)
        ).toBe(
          "2.50"
        );

        expect(
          invoice.totalAmount.toFixed(2)
        ).toBe(
          "502.50"
        );

        const adjustmentItem =
          invoice.items.find(
            (item) =>
              item.type ===
              MerchantInvoiceItemType.ADJUSTMENT
          );

        expect(
          adjustmentItem?.adjustmentId
        ).toBe(
          adjustment.id
        );

        expect(
          adjustmentItem?.amount.toFixed(2)
        ).toBe(
          "-1.00"
        );
      }
    );

    it(
      "is replay-safe for the same invoice instruction",
      async () => {
        const fixture =
          await createFixture(
            "replay"
          );

        const input = {
          merchantId:
            fixture.merchant.id,
          invoiceNumber:
            "INV-REPLAY",
          periodStart,
          periodEnd,
          subscriptionCharge: {
            subscriptionId:
              fixture.subscription.id,
            billingPeriodStart:
              periodStart,
            billingPeriodEnd:
              periodEnd
          }
        };

        const first =
          await generateMerchantInvoice(
            input
          );

        const second =
          await generateMerchantInvoice(
            input
          );

        expect(
          second.id
        ).toBe(
          first.id
        );

        expect(
          await prisma.merchantInvoice.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(
          1
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_GENERATED"
            }
          })
        ).toBe(
          1
        );
      }
    );

    it(
      "rejects reuse of the same invoice period for a different instruction",
      async () => {
        const fixture =
          await createFixture(
            "different-instruction"
          );

        await generateMerchantInvoice({
          merchantId:
            fixture.merchant.id,
          invoiceNumber:
            "INV-ONE",
          periodStart,
          periodEnd,
          subscriptionCharge: {
            subscriptionId:
              fixture.subscription.id,
            billingPeriodStart:
              periodStart,
            billingPeriodEnd:
              periodEnd
          }
        });

        await expect(
          generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-TWO",
            periodStart,
            periodEnd,
            subscriptionCharge: {
              subscriptionId:
                fixture.subscription.id,
              billingPeriodStart:
                periodStart,
              billingPeriodEnd:
                periodEnd
            }
          })
        ).rejects.toThrow(
          "Invoice period was already used for a different instruction"
        );
      }
    );

    it(
      "allows a zero-total invoice when valid financial source items exist",
      async () => {
        const fixture =
          await createFixture(
            "negative-total",
            "10.00"
          );

        await createCommissionAdjustment({
          merchantId:
            fixture.merchant.id,
          commissionId:
            fixture.commission.id,
          type:
            CommissionAdjustmentType.CORRECTION,
          amount:
            new Prisma.Decimal(
              "-0.35"
            ),
          currency:
            "ETB",
          reason:
            "Reduce commission to zero",
          idempotencyKey:
            "reduce-to-zero",
          actorUserId:
            null
        });

        /*
         * There is no subscription charge in this
         * invoice instruction and net commission is
         * zero, so this still produces a valid
         * zero-total invoice rather than a negative
         * invoice.
         *
         * Day 14 forbids negative totals, not zero.
         */
        const invoice =
          await generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-ZERO",
            periodStart,
            periodEnd
          });

        expect(
          invoice.totalAmount.toFixed(2)
        ).toBe(
          "0.00"
        );

        expect(
          invoice.commissionAmount
            .toFixed(2)
        ).toBe(
          "0.00"
        );
      }
    );

    it(
      "rejects generation when there are no financial source items",
      async () => {
        const fixture =
          await createFixture(
            "empty"
          );

        await prisma.commission.update({
          where: {
            id:
              fixture.commission.id
          },
          data: {
            createdAt:
              new Date(
                "2026-11-01T00:00:00.000Z"
              )
          }
        });

        await expect(
          generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-EMPTY",
            periodStart,
            periodEnd
          })
        ).rejects.toThrow(
          "Invoice has no financial source items"
        );
      }
    );

    it(
      "records exactly one INVOICE_GENERATED audit event with actor attribution",
      async () => {
        const fixture =
          await createFixture(
            "audit"
          );

        const actorUserId =
          "platform-test-actor";

        const invoice =
          await generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-AUDIT",
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
            actorUserId
          });

        const logs =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_GENERATED",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                invoice.id
            }
          });

        expect(
          logs
        ).toHaveLength(
          1
        );

        expect(
          logs[0]?.actorUserId
        ).toBe(
          actorUserId
        );
      }
    );

    it(
      "rejects a negative-total invoice atomically without mutating historical invoice sources",
      async () => {
        const fixture =
          await createFixture(
            "true-negative-total",
            "10.00"
          );

        const originalInvoice =
          await generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-NEGATIVE-ORIGINAL",
            periodStart,
            periodEnd
          });

        expect(
          originalInvoice.totalAmount
            .toFixed(2)
        ).toBe(
          "0.35"
        );

        expect(
          originalInvoice.commissionAmount
            .toFixed(2)
        ).toBe(
          "0.35"
        );

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
                "-0.35"
              ),
            currency:
              "ETB",
            reason:
              "Full correction after prior invoice",
            idempotencyKey:
              "true-negative-total-correction",
            actorUserId:
              null
          });

        const octoberStart =
          new Date(
            "2026-10-01T00:00:00.000Z"
          );

        const octoberEnd =
          new Date(
            "2026-11-01T00:00:00.000Z"
          );

        await prisma.commissionAdjustment.update({
          where: {
            id:
              adjustment.id
          },
          data: {
            createdAt:
              new Date(
                "2026-10-15T00:00:00.000Z"
              )
          }
        });

        const historicalInvoiceBefore =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                originalInvoice.id
            },
            include: {
              items: true
            }
          });

        const historicalCommissionBefore =
          await prisma.commission.findUniqueOrThrow({
            where: {
              id:
                fixture.commission.id
            }
          });

        const adjustmentBefore =
          await prisma.commissionAdjustment.findUniqueOrThrow({
            where: {
              id:
                adjustment.id
            }
          });

        await expect(
          generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-NEGATIVE-FAIL",
            periodStart:
              octoberStart,
            periodEnd:
              octoberEnd
          })
        ).rejects.toThrow(
          "Invoice total cannot be negative"
        );

        expect(
          await prisma.merchantInvoice.count({
            where: {
              merchantId:
                fixture.merchant.id,
              periodStart:
                octoberStart,
              periodEnd:
                octoberEnd
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.merchantInvoiceItem.count({
            where: {
              adjustmentId:
                adjustment.id
            }
          })
        ).toBe(
          0
        );

        const historicalInvoiceAfter =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                originalInvoice.id
            },
            include: {
              items: true
            }
          });

        const historicalCommissionAfter =
          await prisma.commission.findUniqueOrThrow({
            where: {
              id:
                fixture.commission.id
            }
          });

        const adjustmentAfter =
          await prisma.commissionAdjustment.findUniqueOrThrow({
            where: {
              id:
                adjustment.id
            }
          });

        expect(
          historicalInvoiceAfter.totalAmount
            .toFixed(2)
        ).toBe(
          historicalInvoiceBefore.totalAmount
            .toFixed(2)
        );

        expect(
          historicalInvoiceAfter.commissionAmount
            .toFixed(2)
        ).toBe(
          historicalInvoiceBefore.commissionAmount
            .toFixed(2)
        );

        expect(
          historicalInvoiceAfter.items.length
        ).toBe(
          historicalInvoiceBefore.items.length
        );

        expect(
          historicalCommissionAfter.commissionAmount
            .toFixed(2)
        ).toBe(
          historicalCommissionBefore.commissionAmount
            .toFixed(2)
        );

        expect(
          historicalCommissionAfter.status
        ).toBe(
          CommissionStatus.INVOICED
        );

        expect(
          adjustmentAfter.amount.toFixed(2)
        ).toBe(
          adjustmentBefore.amount.toFixed(2)
        );

        expect(
          adjustmentAfter.type
        ).toBe(
          adjustmentBefore.type
        );

        expect(
          adjustmentAfter.reason
        ).toBe(
          adjustmentBefore.reason
        );
      }
    );

    it(
      "rejects a subscription source that belongs to another merchant",
      async () => {
        const firstFixture =
          await createFixture(
            "isolation-a"
          );

        const secondFixture =
          await createFixture(
            "isolation-b"
          );

        await expect(
          generateMerchantInvoice({
            merchantId:
              firstFixture.merchant.id,
            invoiceNumber:
              "INV-MERCHANT-ISOLATION",
            periodStart,
            periodEnd,
            subscriptionCharge: {
              subscriptionId:
                secondFixture.subscription.id,
              billingPeriodStart:
                periodStart,
              billingPeriodEnd:
                periodEnd
            }
          })
        ).rejects.toThrow(
          "Merchant subscription not found"
        );

        expect(
          await prisma.merchantInvoice.count({
            where: {
              merchantId:
                firstFixture.merchant.id
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.merchantInvoiceItem.count({
            where: {
              subscriptionId:
                secondFixture.subscription.id
            }
          })
        ).toBe(
          0
        );

        const firstCommission =
          await prisma.commission.findUniqueOrThrow({
            where: {
              id:
                firstFixture.commission.id
            }
          });

        expect(
          firstCommission.status
        ).toBe(
          CommissionStatus.ACCRUED
        );
      }
    );

    it(
      "rejects commission currency mismatch without claiming the commission",
      async () => {
        const fixture =
          await createFixture(
            "commission-currency"
          );

        await prisma.merchant.update({
          where: {
            id:
              fixture.merchant.id
          },
          data: {
            currency:
              "USD"
          }
        });

        await expect(
          generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-CURRENCY-MISMATCH",
            periodStart,
            periodEnd
          })
        ).rejects.toThrow(
          "Commission currency does not match merchant currency"
        );

        expect(
          await prisma.merchantInvoice.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.merchantInvoiceItem.count({
            where: {
              commissionId:
                fixture.commission.id
            }
          })
        ).toBe(
          0
        );

        const commissionAfter =
          await prisma.commission.findUniqueOrThrow({
            where: {
              id:
                fixture.commission.id
            }
          });

        expect(
          commissionAfter.status
        ).toBe(
          CommissionStatus.ACCRUED
        );

        expect(
          commissionAfter.commissionAmount
            .toFixed(2)
        ).toBe(
          fixture.commission.commissionAmount
            .toFixed(2)
        );
      }
    );

    it(
      "rejects a subscription charge when its requested billing period is not the subscription current period",
      async () => {
        const fixture =
          await createFixture(
            "subscription-period-mismatch"
          );

        await prisma.merchantSubscription.update({
          where: {
            id:
              fixture.subscription.id
          },
          data: {
            currentPeriodStart:
              new Date(
                "2026-08-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-09-01T00:00:00.000Z"
              )
          }
        });

        await expect(
          generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-PERIOD-MISMATCH",
            periodStart,
            periodEnd,
            subscriptionCharge: {
              subscriptionId:
                fixture.subscription.id,
              billingPeriodStart:
                periodStart,
              billingPeriodEnd:
                periodEnd
            }
          })
        ).rejects.toThrow(
          "Subscription billing period does not match the subscription current period"
        );

        expect(
          await prisma.merchantInvoice.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.merchantInvoiceItem.count({
            where: {
              subscriptionId:
                fixture.subscription.id
            }
          })
        ).toBe(
          0
        );

        const commissionAfter =
          await prisma.commission.findUniqueOrThrow({
            where: {
              id:
                fixture.commission.id
            }
          });

        expect(
          commissionAfter.status
        ).toBe(
          CommissionStatus.ACCRUED
        );
      }
    );

    it(
      "handles concurrent identical generation without duplicating the invoice or source items",
      async () => {
        const fixture =
          await createFixture(
            "concurrent"
          );

        const input = {
          merchantId:
            fixture.merchant.id,
          invoiceNumber:
            "INV-CONCURRENT",
          periodStart,
          periodEnd,
          subscriptionCharge: {
            subscriptionId:
              fixture.subscription.id,
            billingPeriodStart:
              periodStart,
            billingPeriodEnd:
              periodEnd
          }
        };

        const [
          first,
          second
        ] =
          await Promise.all([
            generateMerchantInvoice(
              input
            ),
            generateMerchantInvoice(
              input
            )
          ]);

        expect(
          first.id
        ).toBe(
          second.id
        );

        expect(
          await prisma.merchantInvoice.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(
          1
        );

        expect(
          await prisma.merchantInvoiceItem.count({
            where: {
              invoiceId:
                first.id
            }
          })
        ).toBe(
          2
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_GENERATED"
            }
          })
        ).toBe(
          1
        );
      }
    );

    it(
      "creates platform audit for platform-admin invoice generation",
      async () => {
        const fixture =
          await createFixture(
            "platform-audit"
          );

        const platformUser =
          await createPlatformUser(
            "invoice-generation"
          );

        const invoice =
          await generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-PLATFORM-AUDIT",
            periodStart,
            periodEnd,
            actorUserId:
              null,
            actorPlatformUserId:
              platformUser.id,
            subscriptionCharge: {
              subscriptionId:
                fixture.subscription.id,
              billingPeriodStart:
                periodStart,
              billingPeriodEnd:
                periodEnd
            }
          });

        const merchantAudit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_GENERATED",
              entityId:
                invoice.id
            }
          });

        const platformAudit =
          await prisma.platformAuditLog.findFirst({
            where: {
              actorPlatformUserId:
                platformUser.id,
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_INVOICE_GENERATED",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                invoice.id
            }
          });

        expect(
          merchantAudit
        ).not.toBeNull();

        expect(
          merchantAudit?.actorUserId
        ).toBeNull();

        expect(
          platformAudit
        ).not.toBeNull();

        expect(
          platformAudit?.actorPlatformUserId
        ).toBe(
          platformUser.id
        );
      }
    );

    it(
      "rolls back invoice generation when platform audit fails",
      async () => {
        const fixture =
          await createFixture(
            "platform-rollback"
          );

        await expect(
          generateMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-PLATFORM-ROLLBACK",
            periodStart,
            periodEnd,
            actorUserId:
              null,
            actorPlatformUserId:
              "nonexistent-platform-user",
            subscriptionCharge: {
              subscriptionId:
                fixture.subscription.id,
              billingPeriodStart:
                periodStart,
              billingPeriodEnd:
                periodEnd
            }
          })
        ).rejects.toThrow();

        expect(
          await prisma.merchantInvoice.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_GENERATED"
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.platformAuditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_INVOICE_GENERATED"
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.commission.count({
            where: {
              merchantId:
                fixture.merchant.id,
              status:
                CommissionStatus.ACCRUED
            }
          })
        ).toBe(
          1
        );
      }
    );
  }
);
