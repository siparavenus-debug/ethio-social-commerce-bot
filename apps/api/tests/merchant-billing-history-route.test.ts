import {
  MerchantSubscriptionStatus,
  MerchantUserRole,
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
  "day17-billing-history-route";

type BillingHistoryPath =
  | "commissions"
  | "invoices"
  | "settlements";

const historyPaths:
  BillingHistoryPath[] = [
    "commissions",
    "invoices",
    "settlements"
  ];

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

  if (merchantIds.length === 0) {
    return;
  }

  await prisma.merchantSettlement.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantInvoiceItem.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.commissionAdjustment.deleteMany({
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

  await prisma.auditLog.deleteMany({
    where: {
      merchantId: {
        in:
          merchantIds
      }
    }
  });

  await prisma.merchantInvoice.deleteMany({
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

async function createFixture(
  suffix: string,
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
          `Day 17 ${role}`,
        role,
        tokenVersion:
          0
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
    token
  };
}

async function getHistory(
  merchantId: string,
  path: BillingHistoryPath,
  token?: string
) {
  const headers:
    Record<string, string> = {};

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/billing/${path}`,
    {
      method:
        "GET",
      headers
    }
  );
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
  "merchant billing history routes",
  () => {
    it(
      "rejects unauthenticated access to all history routes",
      async () => {
        const fixture =
          await createFixture(
            "unauthenticated"
          );

        for (
          const path of
          historyPaths
        ) {
          const response =
            await getHistory(
              fixture.merchant.id,
              path
            );

          expect(
            response.status
          ).toBe(
            401
          );
        }
      }
    );

    it(
      "allows OWNER access to all history routes",
      async () => {
        const fixture =
          await createFixture(
            "owner"
          );

        for (
          const path of
          historyPaths
        ) {
          const response =
            await getHistory(
              fixture.merchant.id,
              path,
              fixture.token
            );

          expect(
            response.status
          ).toBe(
            200
          );

          const body =
            await response.json() as
              Record<string, unknown>;

          expect(
            body.merchantId
          ).toBe(
            fixture.merchant.id
          );

          const collectionName =
            path === "commissions"
              ? "commissions"
              : path === "invoices"
                ? "invoices"
                : "settlements";

          expect(
            body[collectionName]
          ).toEqual(
            []
          );
        }
      }
    );

    it(
      "forbids ADMIN access to all history routes",
      async () => {
        const fixture =
          await createFixture(
            "admin",
            MerchantUserRole.ADMIN
          );

        for (
          const path of
          historyPaths
        ) {
          const response =
            await getHistory(
              fixture.merchant.id,
              path,
              fixture.token
            );

          expect(
            response.status
          ).toBe(
            403
          );
        }
      }
    );

    it(
      "forbids STAFF access to all history routes",
      async () => {
        const fixture =
          await createFixture(
            "staff",
            MerchantUserRole.STAFF
          );

        for (
          const path of
          historyPaths
        ) {
          const response =
            await getHistory(
              fixture.merchant.id,
              path,
              fixture.token
            );

          expect(
            response.status
          ).toBe(
            403
          );
        }
      }
    );

    it(
      "forbids cross-merchant OWNER access to all history routes",
      async () => {
        const owner =
          await createFixture(
            "cross-owner"
          );

        const target =
          await createFixture(
            "cross-target"
          );

        for (
          const path of
          historyPaths
        ) {
          const response =
            await getHistory(
              target.merchant.id,
              path,
              owner.token
            );

          expect(
            response.status
          ).toBe(
            403
          );
        }
      }
    );

    it(
      "preserves OWNER history access without a subscription",
      async () => {
        const fixture =
          await createFixture(
            "no-subscription"
          );

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription
        ).toBeNull();

        for (
          const path of
          historyPaths
        ) {
          const response =
            await getHistory(
              fixture.merchant.id,
              path,
              fixture.token
            );

          expect(
            response.status
          ).toBe(
            200
          );
        }
      }
    );

    it(
      "preserves OWNER history access while suspended",
      async () => {
        const fixture =
          await createFixture(
            "suspended"
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `d17-history-suspended-${Date.now()}`,
              name:
                "Day 17 History Suspended Plan",
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
              fixture.merchant.id,
            planId:
              plan.id,
            status:
              MerchantSubscriptionStatus.SUSPENDED,
            billingInterval:
              "MONTHLY",
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

        for (
          const path of
          historyPaths
        ) {
          const response =
            await getHistory(
              fixture.merchant.id,
              path,
              fixture.token
            );

          expect(
            response.status
          ).toBe(
            200
          );
        }

        await prisma.merchantSubscription.delete({
          where: {
            merchantId:
              fixture.merchant.id
          }
        });

        await prisma.subscriptionPlan.delete({
          where: {
            id:
              plan.id
          }
        });
      }
    );
  }
);
