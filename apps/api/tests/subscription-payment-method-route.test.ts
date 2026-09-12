import {
  MerchantSubscriptionStatus,
  PaymentMethodStatus,
  PaymentProvider,
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
  "d16-payment-method";

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

    await prisma.paymentMethod.deleteMany({
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
  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-merchant`,
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
          `${testPrefix}@example.test`,
        passwordHash:
          "test-password-hash",
        role:
          "OWNER",
        tokenVersion:
          0
      }
    });

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${testPrefix}-plan`,
        name:
          "Day 16 Payment Method Plan",
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

  const paymentMethod =
    await prisma.paymentMethod.create({
      data: {
        merchantId:
          merchant.id,
        provider:
          PaymentProvider.TELEBIRR,
        accountName:
          "Existing Account",
        accountNumber:
          "0911000000",
        status:
          PaymentMethodStatus.ACTIVE
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
    paymentMethod,
    token
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
  "subscription enforcement on payment-method routes",
  () => {
    it(
      "preserves payment-method reads for a SUSPENDED merchant",
      async () => {
        const fixture =
          await createSuspendedFixture();

        const response =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/payment-methods`,
            {
              headers:
                authHeaders(
                  fixture.token
                )
            }
          );

        expect(
          response.status
        ).toBe(200);
      }
    );

    it(
      "blocks payment-method configuration mutations for a SUSPENDED merchant",
      async () => {
        const fixture =
          await createSuspendedFixture();

        const mutations = [
          {
            method:
              "POST",
            path:
              `/merchants/${fixture.merchant.id}/payment-methods`
          },
          {
            method:
              "PATCH",
            path:
              `/merchants/${fixture.merchant.id}/payment-methods/${fixture.paymentMethod.id}`
          }
        ];

        for (const mutation of mutations) {
          const response =
            await fetch(
              `${API_BASE_URL}${mutation.path}`,
              {
                method:
                  mutation.method,
                headers:
                  authHeaders(
                    fixture.token
                  ),
                body:
                  JSON.stringify({})
              }
            );

          expect(
            response.status,
            `${mutation.method} ${mutation.path}`
          ).toBe(403);

          expect(
            await response.json()
          ).toEqual({
            error:
              "Merchant subscription does not allow this action"
          });
        }

        const paymentMethod =
          await prisma.paymentMethod.findUniqueOrThrow({
            where: {
              id:
                fixture.paymentMethod.id
            }
          });

        expect(
          paymentMethod.accountName
        ).toBe(
          "Existing Account"
        );

        expect(
          paymentMethod.accountNumber
        ).toBe(
          "0911000000"
        );

        expect(
          paymentMethod.status
        ).toBe(
          PaymentMethodStatus.ACTIVE
        );

        expect(
          await prisma.paymentMethod.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(1);
      }
    );
  }
);
