import {
  MerchantSubscriptionStatus,
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
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
  "day11-subscription-initialization";

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
    await prisma.platformAuditLog.deleteMany({
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
}

async function createMerchant(
  suffix: string
) {
  return prisma.merchant.create({
    data: {
      name: `${testPrefix}-${suffix}`
    }
  });
}

async function createPlan(
  suffix: string,
  isActive = true
) {
  return prisma.subscriptionPlan.create({
    data: {
      code: `${testPrefix}-${suffix}`,
      name: `Test Plan ${suffix}`,
      monthlyPrice: "500.00",
      annualPrice: "5000.00",
      currency: "ETB",
      commissionRate: "0.035000",
      isActive
    }
  });
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
        `Platform Test ${suffix}`,
      role: "ADMIN"
    }
  });
}

describe(
  "merchant subscription initialization",
  () => {
    beforeEach(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    it(
      "creates a monthly subscription using plan snapshots",
      async () => {
        const merchant =
          await createMerchant("monthly");

        const plan =
          await createPlan("monthly");

        const currentPeriodStart =
          new Date(
            "2026-09-01T00:00:00.000Z"
          );

        const currentPeriodEnd =
          new Date(
            "2026-10-01T00:00:00.000Z"
          );

        const subscription =
          await initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            status:
              MerchantSubscriptionStatus.ACTIVE,
            currentPeriodStart,
            currentPeriodEnd
          });

        expect(
          subscription.merchantId
        ).toBe(merchant.id);

        expect(
          subscription.planId
        ).toBe(plan.id);

        expect(
          subscription.priceSnapshot.toString()
        ).toBe("500");

        expect(
          subscription.commissionRateSnapshot.toString()
        ).toBe("0.035");

        expect(
          subscription.currency
        ).toBe("ETB");
      }
    );

    it(
      "uses the annual plan price for an annual subscription",
      async () => {
        const merchant =
          await createMerchant("annual");

        const plan =
          await createPlan("annual");

        const subscription =
          await initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
            billingInterval:
              SubscriptionBillingInterval.ANNUAL,
            status:
              MerchantSubscriptionStatus.ACTIVE,
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2027-09-01T00:00:00.000Z"
              )
          });

        expect(
          subscription.priceSnapshot.toString()
        ).toBe("5000");
      }
    );

    it(
      "creates an audit record in the same operation",

      async () => {
        const merchant =
          await createMerchant("audit");

        const plan =
          await createPlan("audit");

        const subscription =
          await initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
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

        const audit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId: merchant.id,
              action:
                "SUBSCRIPTION_INITIALIZED",
              entityId:
                subscription.id
            }
          });

        expect(audit).not.toBeNull();

        expect(
          audit?.entityType
        ).toBe(
          "MERCHANT_SUBSCRIPTION"
        );
      }
    );

    it(
      "creates platform audit for platform-admin initialization",
      async () => {
        const merchant =
          await createMerchant(
            "platform-audit"
          );

        const plan =
          await createPlan(
            "platform-audit"
          );

        const platformUser =
          await createPlatformUser(
            "platform-audit"
          );

        const subscription =
          await initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
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
              ),
            actorPlatformUserId:
              platformUser.id
          });

        const merchantAudit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId: merchant.id,
              action:
                "SUBSCRIPTION_INITIALIZED",
              entityId:
                subscription.id
            }
          });

        const platformAudit =
          await prisma.platformAuditLog.findFirst({
            where: {
              actorPlatformUserId:
                platformUser.id,
              merchantId:
                merchant.id,
              action:
                "MERCHANT_SUBSCRIPTION_INITIALIZED",
              entityType:
                "MERCHANT_SUBSCRIPTION",
              entityId:
                subscription.id
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

        expect(
          platformAudit?.merchantId
        ).toBe(
          merchant.id
        );
      }
    );

    it(
      "rolls back initialization when platform audit fails",
      async () => {
        const merchant =
          await createMerchant(
            "pf-rollback"
          );

        const plan =
          await createPlan(
            "pf-rollback"
          );

        await expect(
          initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
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
              ),
            actorPlatformUserId:
              "nonexistent-platform-user"
          })
        ).rejects.toThrow();

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                merchant.id
            }
          });

        const merchantAuditCount =
          await prisma.auditLog.count({
            where: {
              merchantId:
                merchant.id,
              action:
                "SUBSCRIPTION_INITIALIZED"
            }
          });

        const platformAuditCount =
          await prisma.platformAuditLog.count({
            where: {
              merchantId:
                merchant.id,
              action:
                "MERCHANT_SUBSCRIPTION_INITIALIZED"
            }
          });

        expect(
          subscription
        ).toBeNull();

        expect(
          merchantAuditCount
        ).toBe(0);

        expect(
          platformAuditCount
        ).toBe(0);
      }
    );

    it(
      "rejects an inactive subscription plan",
      async () => {
        const merchant =
          await createMerchant("inactive");

        const plan =
          await createPlan(
            "inactive",
            false
          );

        await expect(
          initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
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
          })
        ).rejects.toThrow(
          "Subscription plan is inactive"
        );
      }
    );

    it(
      "rejects duplicate subscription initialization",
      async () => {
        const merchant =
          await createMerchant("duplicate");

        const plan =
          await createPlan("duplicate");

        const input = {
          merchantId: merchant.id,
          planId: plan.id,
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
        };

        await initializeMerchantSubscription(
          input
        );

        await expect(
          initializeMerchantSubscription(
            input
          )
        ).rejects.toThrow(
          "Merchant already has a subscription"
        );

        const count =
          await prisma.merchantSubscription.count({
            where: {
              merchantId: merchant.id
            }
          });

        expect(count).toBe(1);
      }
    );

    it(
      "requires a trial end date for TRIAL subscriptions",
      async () => {
        const merchant =
          await createMerchant("trial-missing");

        const plan =
          await createPlan("trial-missing");

        await expect(
          initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            status:
              MerchantSubscriptionStatus.TRIAL,
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-10-01T00:00:00.000Z"
              )
          })
        ).rejects.toThrow(
          "Trial subscriptions must have a trial end date"
        );
      }
    );

    it(
      "rejects an invalid subscription period",
      async () => {
        const merchant =
          await createMerchant("period");

        const plan =
          await createPlan("period");

        await expect(
          initializeMerchantSubscription({
            merchantId: merchant.id,
            planId: plan.id,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            status:
              MerchantSubscriptionStatus.ACTIVE,
            currentPeriodStart:
              new Date(
                "2026-10-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-09-01T00:00:00.000Z"
              )
          })
        ).rejects.toThrow(
          "Subscription period end must be after subscription period start"
        );
      }
    );
  }
);