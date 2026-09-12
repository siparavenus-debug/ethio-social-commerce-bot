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
  getMerchantSubscriptionStatus,
  merchantHasEntitlement,
  requireMerchantEntitlement
} from "../src/services/subscription-entitlement.js";

const testPrefix =
"d16-entitlement-service";

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
  status?: MerchantSubscriptionStatus
) {
  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`
      }
    });

  if (status === undefined) {
    return {
      merchant,
      plan: null
    };
  }

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${testPrefix}-${suffix}`,
        name:
          `Day 16 Plan ${suffix}`,
        monthlyPrice: "500.00",
        annualPrice: "5000.00",
        currency: "ETB",
        commissionRate: "0.035000",
        isActive: true
      }
    });

  await prisma.merchantSubscription.create({
    data: {
      merchantId: merchant.id,
      planId: plan.id,
      status,
      billingInterval:
        SubscriptionBillingInterval.MONTHLY,
      priceSnapshot: "500.00",
      commissionRateSnapshot:
        "0.035000",
      currency: "ETB",
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

  return {
    merchant,
    plan
  };
}

describe(
  "merchant subscription entitlement service",
  () => {
    beforeEach(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    it(
      "resolves the subscription status for the exact merchant",
      async () => {
        const { merchant } =
          await createFixture(
            "status",
            MerchantSubscriptionStatus.ACTIVE
          );

        await expect(
          getMerchantSubscriptionStatus(
            prisma,
            merchant.id
          )
        ).resolves.toBe(
          MerchantSubscriptionStatus.ACTIVE
        );
      }
    );

    it(
      "returns null when the merchant has no subscription",
      async () => {
        const { merchant } =
          await createFixture(
            "missing"
          );

        await expect(
          getMerchantSubscriptionStatus(
            prisma,
            merchant.id
          )
        ).resolves.toBeNull();
      }
    );

    it(
      "allows new commerce for an active merchant",
      async () => {
        const { merchant } =
          await createFixture(
            "active",
            MerchantSubscriptionStatus.ACTIVE
          );

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBe(true);

        await expect(
          requireMerchantEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBeUndefined();
      }
    );

    it(
      "allows new commerce for a trial merchant",
      async () => {
        const { merchant } =
          await createFixture(
            "trial",
            MerchantSubscriptionStatus.TRIAL
          );

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBe(true);

        await expect(
          requireMerchantEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBeUndefined();
      }
    );

    it(
      "allows new commerce for a past-due merchant",
      async () => {
        const { merchant } =
          await createFixture(
            "past-due",
            MerchantSubscriptionStatus.PAST_DUE
          );

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBe(true);

        await expect(
          requireMerchantEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBeUndefined();
      }
    );
    it(
      "blocks new commerce for a suspended merchant",
      async () => {
        const { merchant } =
          await createFixture(
            "suspended",
            MerchantSubscriptionStatus.SUSPENDED
          );

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBe(false);

        await expect(
          requireMerchantEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).rejects.toThrow(
          "Merchant is not entitled to CREATE_COMMERCE"
        );
      }
    );

    it(
      "preserves existing-commerce and billing recovery for a suspended merchant",
      async () => {
        const { merchant } =
          await createFixture(
            "suspended-recovery",
            MerchantSubscriptionStatus.SUSPENDED
          );

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "PROCESS_EXISTING_COMMERCE"
          )
        ).resolves.toBe(true);

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "BILLING_RECOVERY"
          )
        ).resolves.toBe(true);
      }
    );

    it(
      "blocks new commerce but preserves billing recovery when no subscription exists",
      async () => {
        const { merchant } =
          await createFixture(
            "no-subscription"
          );

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBe(false);

        await expect(
          merchantHasEntitlement(
            prisma,
            merchant.id,
            "BILLING_RECOVERY"
          )
        ).resolves.toBe(true);
      }
    );

    it(
      "keeps merchant entitlement decisions isolated by merchant id",
      async () => {
        const active =
          await createFixture(
            "isolation-active",
            MerchantSubscriptionStatus.ACTIVE
          );

        const suspended =
          await createFixture(
            "isolation-suspended",
            MerchantSubscriptionStatus.SUSPENDED
          );

        await expect(
          merchantHasEntitlement(
            prisma,
            active.merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBe(true);

        await expect(
          merchantHasEntitlement(
            prisma,
            suspended.merchant.id,
            "CREATE_COMMERCE"
          )
        ).resolves.toBe(false);
      }
    );

    it(
      "can evaluate entitlement inside an existing transaction",
      async () => {
        const { merchant } =
          await createFixture(
            "transaction",
            MerchantSubscriptionStatus.ACTIVE
          );

        const allowed =
          await prisma.$transaction(
            async (tx) =>
              merchantHasEntitlement(
                tx,
                merchant.id,
                "CREATE_COMMERCE"
              )
          );

        expect(allowed).toBe(true);
      }
    );
  }
);
