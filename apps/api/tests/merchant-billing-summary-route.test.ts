import {
  MerchantSubscriptionStatus,
  MerchantUserRole,
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
  createAuthToken
} from "../src/services/auth.js";
import {
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const API_BASE_URL =
  "http://127.0.0.1:3100";

const testPrefix =
  "day17-billing-summary-route";

const planCodePrefix =
  "d17bsr-";

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
    await prisma.auditLog.deleteMany({
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

    await prisma.merchantUser.deleteMany({
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
  role:
    MerchantUserRole =
      MerchantUserRole.OWNER,
  subscriptionStatus:
    MerchantSubscriptionStatus | null =
      MerchantSubscriptionStatus.ACTIVE
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

  let subscription = null;

  if (subscriptionStatus !== null) {
    const plan =
      await prisma.subscriptionPlan.create({
        data: {
          code:
            `${planCodePrefix}${suffix.slice(0, 18)}`,
          name:
            `Day 17 Route Plan ${suffix}`,
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

    subscription =
      await initializeMerchantSubscription({
        merchantId:
          merchant.id,
        planId:
          plan.id,
        billingInterval:
          SubscriptionBillingInterval.MONTHLY,
        status:
          subscriptionStatus,
        currentPeriodStart:
          periodStart,
        currentPeriodEnd:
          periodEnd,
        actorUserId:
          null
      });
  }

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
    token
  };
}

async function getBillingSummary(
  merchantId: string,
  token?: string
) {
  const headers:
    Record<string, string> = {};

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/billing/summary`,
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
  "merchant billing summary route",
  () => {
    it(
      "rejects unauthenticated access",
      async () => {
        const fixture =
          await createFixture(
            "unauthenticated"
          );

        const response =
          await getBillingSummary(
            fixture.merchant.id
          );

        expect(
          response.status
        ).toBe(
          401
        );
      }
    );

    it(
      "allows OWNER access",
      async () => {
        const fixture =
          await createFixture(
            "owner"
          );

        const response =
          await getBillingSummary(
            fixture.merchant.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(
          200
        );

        const body =
          await response.json() as {
            merchantId: string;
            subscription: {
              status: string;
              priceSnapshot: string;
              commissionRateSnapshot: string;
            } | null;
            currentPeriod: {
              status: string;
              subscriptionAmount: string | null;
              commissionAmount: string | null;
              totalAmount: string | null;
              currency: string;
            };
          };

        expect(
          body.merchantId
        ).toBe(
          fixture.merchant.id
        );

        expect(
          body.subscription?.status
        ).toBe(
          MerchantSubscriptionStatus.ACTIVE
        );

        expect(
          body.subscription?.priceSnapshot
        ).toBe(
          "500"
        );

        expect(
          body.subscription
            ?.commissionRateSnapshot
        ).toBe(
          "0.035"
        );

        expect(
          body.currentPeriod.status
        ).toBe(
          "ESTIMATE"
        );

        expect(
          body.currentPeriod.totalAmount
        ).toBe(
          "500"
        );
      }
    );

    it(
      "forbids ADMIN access",
      async () => {
        const fixture =
          await createFixture(
            "admin",
            MerchantUserRole.ADMIN
          );

        const response =
          await getBillingSummary(
            fixture.merchant.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(
          403
        );
      }
    );

    it(
      "forbids STAFF access",
      async () => {
        const fixture =
          await createFixture(
            "staff",
            MerchantUserRole.STAFF
          );

        const response =
          await getBillingSummary(
            fixture.merchant.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(
          403
        );
      }
    );

    it(
      "forbids cross-merchant OWNER access",
      async () => {
        const owner =
          await createFixture(
            "cross-owner"
          );

        const target =
          await createFixture(
            "cross-target"
          );

        const response =
          await getBillingSummary(
            target.merchant.id,
            owner.token
          );

        expect(
          response.status
        ).toBe(
          403
        );
      }
    );

    it(
      "allows OWNER billing access when no subscription exists",
      async () => {
        const fixture =
          await createFixture(
            "no-subscription",
            MerchantUserRole.OWNER,
            null
          );

        const response =
          await getBillingSummary(
            fixture.merchant.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(
          200
        );

        const body =
          await response.json() as {
            subscription: unknown;
            currentPeriod: {
              status: string;
              totalAmount: unknown;
              currency: string;
            };
          };

        expect(
          body.subscription
        ).toBeNull();

        expect(
          body.currentPeriod.status
        ).toBe(
          "NO_SUBSCRIPTION"
        );

        expect(
          body.currentPeriod.totalAmount
        ).toBeNull();

        expect(
          body.currentPeriod.currency
        ).toBe(
          "ETB"
        );
      }
    );

    it(
      "preserves OWNER billing access while suspended",
      async () => {
        const fixture =
          await createFixture(
            "suspended",
            MerchantUserRole.OWNER,
            MerchantSubscriptionStatus.SUSPENDED
          );

        const response =
          await getBillingSummary(
            fixture.merchant.id,
            fixture.token
          );

        expect(
          response.status
        ).toBe(
          200
        );

        const body =
          await response.json() as {
            subscription: {
              status: string;
            } | null;
            currentPeriod: {
              status: string;
            };
          };

        expect(
          body.subscription?.status
        ).toBe(
          MerchantSubscriptionStatus.SUSPENDED
        );

        expect(
          body.currentPeriod.status
        ).toBe(
          "ESTIMATE"
        );
      }
    );
  }
);
