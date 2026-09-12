import {
  CommissionStatus,
  MerchantSubscriptionStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
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
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
  "day12-commission-accrual";

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
        startsWith: testPrefix
      }
    }
  });
}

async function createFixture(
  suffix: string,
  options?: {
    paymentStatus?: PaymentStatus;
    paymentCurrency?: string;
    subscriptionCurrency?: string;
  }
) {
  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`,
        currency: "ETB"
      }
    });

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${testPrefix}-${suffix}`,
        name:
          `Day 12 Plan ${suffix}`,
        monthlyPrice:
          "500.00",
        annualPrice:
          "5000.00",
        currency:
          options?.subscriptionCurrency ??
          "ETB",
        commissionRate:
          "0.035000",
        isActive: true
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
          `Day 12 Customer ${suffix}`,
        telegramChatId:
          `day12-chat-${suffix}`,
        telegramUserId:
          `day12-user-${suffix}`
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Day 12 Product ${suffix}`,
        price:
          "99.00",
        currency: "ETB",
        stock: 10,
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
          `DAY12-${suffix}`,
        status:
          OrderStatus.PAYMENT_REVIEW,
        currency: "ETB",
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
            quantity: 1,
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
          options?.paymentStatus ??
          PaymentStatus.VERIFIED,
        amount:
          "99.00",
        currency:
          options?.paymentCurrency ??
          "ETB",
        transactionReference:
          `DAY12-TXN-${suffix}`,
        verifiedAt:
          options?.paymentStatus ===
            PaymentStatus.REVIEW_REQUIRED
            ? null
            : new Date()
      }
    });

  return {
    merchant,
    plan,
    subscription,
    customer,
    product,
    order,
    payment
  };
}

async function verifyPaymentInTransaction(
  merchantId: string,
  paymentId: string
) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: {
        id: paymentId,
        merchantId
      },
      include: {
        order: {
          include: {
            items: true
          }
        }
      }
    });

    if (!payment || payment.status !== PaymentStatus.REVIEW_REQUIRED) {
      throw new Error("Payment could not be claimed for verification");
    }

    for (const item of payment.order.items) {
      if (!item.productId) {
        throw new Error("Order item has no product");
      }

      const stock = await tx.product.updateMany({
        where: {
          id: item.productId,
          merchantId,
          stock: {
            gte: item.quantity
          }
        },
        data: {
          stock: {
            decrement: item.quantity
          }
        }
      });

      if (stock.count !== 1) {
        throw new Error("Insufficient stock");
      }
    }

    const claim = await tx.payment.updateMany({
      where: {
        id: payment.id,
        merchantId,
        status: PaymentStatus.REVIEW_REQUIRED
      },
      data: {
        status: PaymentStatus.VERIFIED,
        verifiedAt: new Date()
      }
    });

    if (claim.count !== 1) {
      throw new Error("Payment could not be claimed for verification");
    }

    await accrueCommission(tx, {
      merchantId,
      paymentId: payment.id
    });

    await tx.order.update({
      where: {
        id: payment.orderId
      },
      data: {
        status: OrderStatus.PAID
      }
    });

    await tx.auditLog.create({
      data: {
        merchantId,
        action: "PAYMENT_VERIFIED",
        entityType: "PAYMENT",
        entityId: payment.id
      }
    });
  });
}

describe(
  "commission accrual",
  () => {
    beforeEach(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    it(
      "accrues commission from the verified payment and subscription snapshot",
      async () => {
        const fixture =
          await createFixture(
            "basic"
          );

        const commission =
          await prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    fixture.payment.id
                }
              )
          );

        expect(
          commission.paymentId
        ).toBe(
          fixture.payment.id
        );

        expect(
          commission.orderId
        ).toBe(
          fixture.order.id
        );

        expect(
          commission.subscriptionId
        ).toBe(
          fixture.subscription.id
        );

        expect(
          commission.transactionAmount.toFixed(2)
        ).toBe(
          "99.00"
        );

        expect(
          commission.commissionRate.toString()
        ).toBe(
          "0.035"
        );

        expect(
          commission.commissionAmount.toFixed(2)
        ).toBe(
          "3.47"
        );

        expect(
          commission.currency
        ).toBe(
          "ETB"
        );

        expect(
          commission.status
        ).toBe(
          CommissionStatus.ACCRUED
        );
      }
    );

    it(
      "creates separate commissions for multiple verified transactions",
      async () => {
        const fixture =
          await createFixture("multiple");

        const secondOrder =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id,
              orderNumber:
                "DAY12-multiple-2",
              status:
                OrderStatus.PAYMENT_REVIEW,
              currency:
                "ETB",
              subtotal:
                "99.00",
              total:
                "99.00"
            }
          });

        const secondPayment =
          await prisma.payment.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderId:
                secondOrder.id,
              provider:
                PaymentProvider.TELEBIRR,
              status:
                PaymentStatus.VERIFIED,
              amount:
                "99.00",
              currency:
                "ETB",
              transactionReference:
                "DAY12-TXN-multiple-2",
              verifiedAt:
                new Date()
            }
          });

        await prisma.$transaction(
          async (tx) => {
            await accrueCommission(
              tx,
              {
                merchantId:
                  fixture.merchant.id,
                paymentId:
                  fixture.payment.id
              }
            );

            await accrueCommission(
              tx,
              {
                merchantId:
                  fixture.merchant.id,
                paymentId:
                  secondPayment.id
              }
            );
          }
        );

        const commissions =
          await prisma.commission.findMany({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          commissions
        ).toHaveLength(2);

        expect(
          new Set(
            commissions.map(
              (commission) =>
                commission.paymentId
            )
          ).size
        ).toBe(2);
      }
    );

    it(
      "creates a financial audit record for a new accrual",
      async () => {
        const fixture =
          await createFixture(
            "audit"
          );

        const commission =
          await prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    fixture.payment.id
                }
              )
          );

        const audit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "COMMISSION_ACCRUED",
              entityId:
                commission.id
            }
          });

        expect(
          audit
        ).not.toBeNull();

        expect(
          audit?.entityType
        ).toBe(
          "COMMISSION"
        );
      }
    );

    it(
      "is idempotent when the same payment is accrued twice",
      async () => {
        const fixture =
          await createFixture(
            "replay"
          );

        const first =
          await prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    fixture.payment.id
                }
              )
          );

        const second =
          await prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    fixture.payment.id
                }
              )
          );

        expect(
          second.id
        ).toBe(
          first.id
        );

        const commissions =
          await prisma.commission.findMany({
            where: {
              paymentId:
                fixture.payment.id
            }
          });

        expect(
          commissions
        ).toHaveLength(1);

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "COMMISSION_ACCRUED",
              entityId:
                first.id
            }
          });

        expect(
          audits
        ).toHaveLength(1);
      }
    );

    it(
      "allows only one commission row during concurrent accrual",
      async () => {
        const fixture =
          await createFixture(
            "concurrent"
          );

        const results =
          await Promise.all([
            prisma.$transaction(
              async (tx) =>
                accrueCommission(
                  tx,
                  {
                    merchantId:
                      fixture.merchant.id,
                    paymentId:
                      fixture.payment.id
                  }
                )
            ),

            prisma.$transaction(
              async (tx) =>
                accrueCommission(
                  tx,
                  {
                    merchantId:
                      fixture.merchant.id,
                    paymentId:
                      fixture.payment.id
                  }
                )
            )
          ]);

        expect(
          results[0].id
        ).toBe(
          results[1].id
        );

        const commissions =
          await prisma.commission.findMany({
            where: {
              paymentId:
                fixture.payment.id
            }
          });

        expect(
          commissions
        ).toHaveLength(1);

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "COMMISSION_ACCRUED"
            }
          });

        expect(
          audits
        ).toHaveLength(1);
      }
    );

    it(
      "rejects a payment that has not been verified",
      async () => {
        const fixture =
          await createFixture(
            "unverified",
            {
              paymentStatus:
                PaymentStatus.REVIEW_REQUIRED
            }
          );

        await expect(
          prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    fixture.payment.id
                }
              )
          )
        ).rejects.toThrow(
          "Commission can only accrue from a verified payment"
        );

        expect(
          await prisma.commission.count({
            where: {
              paymentId:
                fixture.payment.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "rejects accrual when the merchant has no subscription",
      async () => {
        const fixture =
          await createFixture(
            "missing-subscription"
          );

        await prisma.auditLog.deleteMany({
          where: {
            merchantId:
              fixture.merchant.id,
            action:
              "SUBSCRIPTION_INITIALIZED"
          }
        });

        await prisma.merchantSubscription.delete({
          where: {
            merchantId:
              fixture.merchant.id
          }
        });

        await expect(
          prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    fixture.payment.id
                }
              )
          )
        ).rejects.toThrow(
          "Merchant subscription not found"
        );

        expect(
          await prisma.commission.count({
            where: {
              paymentId:
                fixture.payment.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "rejects a payment belonging to another merchant",
      async () => {
        const fixture =
          await createFixture(
            "merchant-scope"
          );

        await expect(
          prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    "wrong-merchant-id",
                  paymentId:
                    fixture.payment.id
                }
              )
          )
        ).rejects.toThrow(
          "Payment not found"
        );

        expect(
          await prisma.commission.count({
            where: {
              paymentId:
                fixture.payment.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "rejects a payment whose currency differs from the subscription",
      async () => {
        const fixture =
          await createFixture(
            "currency",
            {
              paymentCurrency:
                "USD",
              subscriptionCurrency:
                "ETB"
            }
          );

        await expect(
          prisma.$transaction(
            async (tx) =>
              accrueCommission(
                tx,
                {
                  merchantId:
                    fixture.merchant.id,
                  paymentId:
                    fixture.payment.id
                }
              )
          )
        ).rejects.toThrow(
          "Payment currency does not match subscription currency"
        );

        expect(
          await prisma.commission.count({
            where: {
              paymentId:
                fixture.payment.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "commits verification, stock, audit, and one commission together",
      async () => {
        const fixture = await createFixture("verification", {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED
        });

        await verifyPaymentInTransaction(
          fixture.merchant.id,
          fixture.payment.id
        );

        const [payment, order, product, commissions, paymentAudits, commissionAudits] =
          await Promise.all([
            prisma.payment.findUnique({ where: { id: fixture.payment.id } }),
            prisma.order.findUnique({ where: { id: fixture.order.id } }),
            prisma.product.findUnique({ where: { id: fixture.product.id } }),
            prisma.commission.findMany({ where: { paymentId: fixture.payment.id } }),
            prisma.auditLog.findMany({
              where: { merchantId: fixture.merchant.id, action: "PAYMENT_VERIFIED" }
            }),
            prisma.auditLog.findMany({
              where: { merchantId: fixture.merchant.id, action: "COMMISSION_ACCRUED" }
            })
          ]);

        expect(payment?.status).toBe(PaymentStatus.VERIFIED);
        expect(order?.status).toBe(OrderStatus.PAID);
        expect(product?.stock).toBe(9);
        expect(commissions).toHaveLength(1);
        expect(commissions[0].transactionAmount.toFixed(2)).toBe("99.00");
        expect(commissions[0].commissionRate.toString()).toBe("0.035");
        expect(commissions[0].commissionAmount.toFixed(2)).toBe("3.47");
        expect(paymentAudits).toHaveLength(1);
        expect(commissionAudits).toHaveLength(1);
      }
    );

    it(
      "does not replay verification or commission after the claim",
      async () => {
        const fixture = await createFixture("verification-replay", {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED
        });

        await verifyPaymentInTransaction(fixture.merchant.id, fixture.payment.id);
        await expect(
          verifyPaymentInTransaction(fixture.merchant.id, fixture.payment.id)
        ).rejects.toThrow("Payment could not be claimed for verification");

        expect(await prisma.commission.count({ where: { paymentId: fixture.payment.id } })).toBe(1);
        expect(await prisma.product.findUnique({ where: { id: fixture.product.id } }))
          .toMatchObject({ stock: 9 });
        expect(await prisma.auditLog.count({
          where: { merchantId: fixture.merchant.id, action: "PAYMENT_VERIFIED" }
        })).toBe(1);
      }
    );

    it(
      "allows one winner in a concurrent verification race",
      async () => {
        const fixture = await createFixture("verification-concurrent", {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED
        });

        const results = await Promise.allSettled([
          verifyPaymentInTransaction(fixture.merchant.id, fixture.payment.id),
          verifyPaymentInTransaction(fixture.merchant.id, fixture.payment.id)
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(await prisma.commission.count({ where: { paymentId: fixture.payment.id } })).toBe(1);
        expect(await prisma.product.findUnique({ where: { id: fixture.product.id } }))
          .toMatchObject({ stock: 9 });
        expect(await prisma.auditLog.count({
          where: { merchantId: fixture.merchant.id, action: "PAYMENT_VERIFIED" }
        })).toBe(1);
        expect(await prisma.auditLog.count({
          where: { merchantId: fixture.merchant.id, action: "COMMISSION_ACCRUED" }
        })).toBe(1);
      }
    );

    it(
      "rolls back verification and stock if commission accrual fails",
      async () => {
        const fixture = await createFixture("verification-rollback", {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED,
          subscriptionCurrency: "USD"
        });

        await expect(
          verifyPaymentInTransaction(fixture.merchant.id, fixture.payment.id)
        ).rejects.toThrow("Payment currency does not match subscription currency");

        expect(await prisma.payment.findUnique({ where: { id: fixture.payment.id } }))
          .toMatchObject({ status: PaymentStatus.REVIEW_REQUIRED, verifiedAt: null });
        expect(await prisma.order.findUnique({ where: { id: fixture.order.id } }))
          .toMatchObject({ status: OrderStatus.PAYMENT_REVIEW });
        expect(await prisma.product.findUnique({ where: { id: fixture.product.id } }))
          .toMatchObject({ stock: 10 });
        expect(await prisma.commission.count({ where: { paymentId: fixture.payment.id } })).toBe(0);
      }
    );

    it(
      "does not accrue for receipt submission awaiting review or rejection",
      async () => {
        const pending = await createFixture("receipt-pending", {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED
        });
        const rejected = await createFixture("receipt-rejected", {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED
        });

        await prisma.payment.update({
          where: { id: rejected.payment.id },
          data: { status: PaymentStatus.REJECTED, reviewNote: "Receipt rejected" }
        });

        await expect(prisma.$transaction((tx) => accrueCommission(tx, {
          merchantId: pending.merchant.id,
          paymentId: pending.payment.id
        }))).rejects.toThrow("Commission can only accrue from a verified payment");
        await expect(prisma.$transaction((tx) => accrueCommission(tx, {
          merchantId: rejected.merchant.id,
          paymentId: rejected.payment.id
        }))).rejects.toThrow("Commission can only accrue from a verified payment");

        expect(await prisma.commission.count({
          where: { paymentId: { in: [pending.payment.id, rejected.payment.id] } }
        })).toBe(0);
      }
    );
  }
);
