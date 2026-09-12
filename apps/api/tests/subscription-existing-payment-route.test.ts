import {
  MerchantSubscriptionStatus,
  MerchantUserRole,
  OrderStatus,
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
  createAuthToken
} from "../src/services/auth.js";

const API_BASE_URL =
  "http://localhost:3000";

const testPrefix =
  "d16-existing-payment";

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

async function createSuspendedFixture() {
  const suffix =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

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
          "Day 16 Suspended Owner",
        role:
          MerchantUserRole.OWNER,
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
          `Day 16 Existing Payment ${suffix}`,
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
    await prisma.merchantSubscription.create({
      data: {
        merchantId:
          merchant.id,
        planId:
          plan.id,
        status:
          MerchantSubscriptionStatus.SUSPENDED,
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

  const customer =
    await prisma.customer.create({
      data: {
        merchantId:
          merchant.id,
        name:
          "Existing Customer"
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Existing Product ${suffix}`,
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

  /*
   * This order deliberately already exists before
   * suspension enforcement is exercised.
   *
   * Day 16 must allow the merchant to finish this
   * customer obligation.
   */
  const order =
    await prisma.order.create({
      data: {
        merchantId:
          merchant.id,
        customerId:
          customer.id,
        orderNumber:
          `D16-EXISTING-${suffix}`,
        status:
          OrderStatus.PENDING_PAYMENT,
        currency:
          "ETB",
        subtotal:
          "100.00",
        total:
          "100.00",
        items: {
          create: {
            productId:
              product.id,
            productName:
              product.name,
            quantity:
              1,
            unitPrice:
              "100.00",
            lineTotal:
              "100.00"
          }
        }
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
    subscription,
    product,
    order,
    token,
    suffix
  };
}

function authHeaders(
  token: string
) {
  return {
    authorization:
      `Bearer ${token}`,
    "content-type":
      "application/json"
  };
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe(
  "subscription enforcement preserves existing payment processing",
  () => {
    it(
      "allows a SUSPENDED merchant to submit and verify payment for an existing order",
      async () => {
        const fixture =
          await createSuspendedFixture();

        const submitResponse =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/payments`,
            {
              method:
                "POST",
              headers:
                authHeaders(
                  fixture.token
                ),
              body:
                JSON.stringify({
                  orderId:
                    fixture.order.id,
                  provider:
                    "TELEBIRR",
                  amount:
                    100,
                  currency:
                    "ETB",
                  transactionReference:
                    `D16-TXN-${fixture.suffix}`,
                  receiptUrl:
                    `receipts/${fixture.merchant.id}/${fixture.order.id}/day16.jpg`
                })
            }
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const submittedPayment =
          await prisma.payment.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              orderId:
                fixture.order.id
            }
          });

        expect(
          submittedPayment.status
        ).toBe(
          PaymentStatus.REVIEW_REQUIRED
        );

        const orderAfterSubmission =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                fixture.order.id
            }
          });

        expect(
          orderAfterSubmission.status
        ).toBe(
          OrderStatus.PAYMENT_REVIEW
        );

        /*
         * Submission is evidence only.
         * It must not commit inventory or commission.
         */
        const productAfterSubmission =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          productAfterSubmission.stock
        ).toBe(5);

        expect(
          await prisma.commission.count({
            where: {
              paymentId:
                submittedPayment.id
            }
          })
        ).toBe(0);

        const verifyResponse =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/payment-review/${submittedPayment.id}/verify`,
            {
              method:
                "POST",
              headers:
                authHeaders(
                  fixture.token
                ),
              body:
                JSON.stringify({
                  reviewNote:
                    "Day 16 suspended existing-payment certification"
                })
            }
          );

        expect(
          verifyResponse.status
        ).toBe(200);

        const verifiedPayment =
          await prisma.payment.findUniqueOrThrow({
            where: {
              id:
                submittedPayment.id
            }
          });

        expect(
          verifiedPayment.status
        ).toBe(
          PaymentStatus.VERIFIED
        );

        const paidOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                fixture.order.id
            }
          });

        expect(
          paidOrder.status
        ).toBe(
          OrderStatus.PAID
        );

        const committedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          committedProduct.stock
        ).toBe(4);

        const commission =
          await prisma.commission.findUniqueOrThrow({
            where: {
              paymentId:
                submittedPayment.id
            }
          });

        expect(
          commission.merchantId
        ).toBe(
          fixture.merchant.id
        );

        expect(
          commission.subscriptionId
        ).toBe(
          fixture.subscription.id
        );

        expect(
          commission.transactionAmount.toString()
        ).toBe("100");

        expect(
          commission.commissionRate.toString()
        ).toBe("0.035");

        expect(
          commission.commissionAmount.toString()
        ).toBe("3.5");

        const subscriptionAfter =
          await prisma.merchantSubscription.findUniqueOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscriptionAfter.status
        ).toBe(
          MerchantSubscriptionStatus.SUSPENDED
        );
      }
    );

    it(
      "allows a SUSPENDED merchant to reject payment for an existing order",
      async () => {
        const fixture =
          await createSuspendedFixture();

        const submitResponse =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/payments`,
            {
              method:
                "POST",
              headers:
                authHeaders(
                  fixture.token
                ),
              body:
                JSON.stringify({
                  orderId:
                    fixture.order.id,
                  provider:
                    "TELEBIRR",
                  amount:
                    100,
                  currency:
                    "ETB",
                  transactionReference:
                    `D16-REJECT-${fixture.suffix}`,
                  receiptUrl:
                    `receipts/${fixture.merchant.id}/${fixture.order.id}/day16-reject.jpg`
                })
            }
          );

        expect(
          submitResponse.status
        ).toBe(201);

        const submittedPayment =
          await prisma.payment.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              orderId:
                fixture.order.id
            }
          });

        expect(
          submittedPayment.status
        ).toBe(
          PaymentStatus.REVIEW_REQUIRED
        );

        const reviewOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                fixture.order.id
            }
          });

        expect(
          reviewOrder.status
        ).toBe(
          OrderStatus.PAYMENT_REVIEW
        );

        const rejectResponse =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/payment-review/${submittedPayment.id}/reject`,
            {
              method:
                "POST",
              headers:
                authHeaders(
                  fixture.token
                ),
              body:
                JSON.stringify({
                  reviewNote:
                    "Day 16 suspended rejection certification"
                })
            }
          );

        expect(
          rejectResponse.status
        ).toBe(200);

        const rejectedPayment =
          await prisma.payment.findUniqueOrThrow({
            where: {
              id:
                submittedPayment.id
            }
          });

        expect(
          rejectedPayment.status
        ).toBe(
          PaymentStatus.REJECTED
        );

        const pendingOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                fixture.order.id
            }
          });

        expect(
          pendingOrder.status
        ).toBe(
          OrderStatus.PENDING_PAYMENT
        );

        const unchangedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          unchangedProduct.stock
        ).toBe(5);

        expect(
          await prisma.commission.count({
            where: {
              paymentId:
                submittedPayment.id
            }
          })
        ).toBe(0);

        const subscriptionAfter =
          await prisma.merchantSubscription.findUniqueOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscriptionAfter.status
        ).toBe(
          MerchantSubscriptionStatus.SUSPENDED
        );
      }
    );
  }
);
