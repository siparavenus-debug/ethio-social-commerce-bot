import type {
  NextFunction,
  Request,
  Response
} from "express";

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
  it,
  vi
} from "vitest";

import {
  requireMerchantEntitlement
} from "../src/middleware/subscription-entitlement.js";

const testPrefix =
  "d16-entitlement-mw";

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
    return merchant;
  }

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${testPrefix}-${suffix}`,
        name:
          `Day 16 Middleware ${suffix}`,
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
      priceSnapshot:
        "500.00",
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

  return merchant;
}

function createResponse() {
  const status =
    vi.fn();

  const json =
    vi.fn();

  status.mockReturnValue({
    json
  });

  const res = {
    status,
    json
  } as unknown as Response;

  return {
    res,
    status,
    json
  };
}

function createRequest(
  merchantId?: string
) {
  return {
    auth: {
      id: "test-user",
      merchantId:
        merchantId ?? "test-merchant",
      email:
        "test@example.com",
      displayName:
        "Test User",
      role:
        "OWNER",
      tokenVersion: 0
    },
    params:
      merchantId
        ? {
            merchantId
          }
        : {}
  } as unknown as Request;
}

describe(
  "subscription entitlement middleware",
  () => {
    beforeEach(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    it(
      "allows CREATE_COMMERCE for an active merchant",
      async () => {
        const merchant =
          await createFixture(
            "active",
            MerchantSubscriptionStatus.ACTIVE
          );

        const req =
          createRequest(
            merchant.id
          );

        const {
          res,
          status
        } = createResponse();

        const next =
          vi.fn() as NextFunction;

        await requireMerchantEntitlement(
          "CREATE_COMMERCE"
        )(
          req,
          res,
          next
        );

        expect(next).toHaveBeenCalledOnce();
        expect(status).not.toHaveBeenCalled();
      }
    );

    it(
      "returns 403 for CREATE_COMMERCE when the merchant is suspended",
      async () => {
        const merchant =
          await createFixture(
            "suspended",
            MerchantSubscriptionStatus.SUSPENDED
          );

        const req =
          createRequest(
            merchant.id
          );

        const {
          res,
          status,
          json
        } = createResponse();

        const next =
          vi.fn() as NextFunction;

        await requireMerchantEntitlement(
          "CREATE_COMMERCE"
        )(
          req,
          res,
          next
        );

        expect(status).toHaveBeenCalledWith(
          403
        );

        expect(json).toHaveBeenCalledWith({
          error:
            "Merchant subscription does not allow this action"
        });

        expect(next).not.toHaveBeenCalled();
      }
    );

    it(
      "allows PROCESS_EXISTING_COMMERCE for a suspended merchant",
      async () => {
        const merchant =
          await createFixture(
            "existing",
            MerchantSubscriptionStatus.SUSPENDED
          );

        const req =
          createRequest(
            merchant.id
          );

        const {
          res,
          status
        } = createResponse();

        const next =
          vi.fn() as NextFunction;

        await requireMerchantEntitlement(
          "PROCESS_EXISTING_COMMERCE"
        )(
          req,
          res,
          next
        );

        expect(next).toHaveBeenCalledOnce();
        expect(status).not.toHaveBeenCalled();
      }
    );

    it(
      "allows BILLING_RECOVERY for a merchant with no subscription",
      async () => {
        const merchant =
          await createFixture(
            "no-sub"
          );

        const req =
          createRequest(
            merchant.id
          );

        const {
          res,
          status
        } = createResponse();

        const next =
          vi.fn() as NextFunction;

        await requireMerchantEntitlement(
          "BILLING_RECOVERY"
        )(
          req,
          res,
          next
        );

        expect(next).toHaveBeenCalledOnce();
        expect(status).not.toHaveBeenCalled();
      }
    );

    it(
      "returns 401 when authentication is missing",
      async () => {
        const req = {
          params: {
            merchantId:
              "merchant-id"
          }
        } as unknown as Request;

        const {
          res,
          status,
          json
        } = createResponse();

        const next =
          vi.fn() as NextFunction;

        await requireMerchantEntitlement(
          "CREATE_COMMERCE"
        )(
          req,
          res,
          next
        );

        expect(status).toHaveBeenCalledWith(
          401
        );

        expect(json).toHaveBeenCalledWith({
          error:
            "Authentication required"
        });

        expect(next).not.toHaveBeenCalled();
      }
    );

    it(
      "returns 400 when merchantId is missing",
      async () => {
        const req =
          createRequest();

        const {
          res,
          status,
          json
        } = createResponse();

        const next =
          vi.fn() as NextFunction;

        await requireMerchantEntitlement(
          "CREATE_COMMERCE"
        )(
          req,
          res,
          next
        );

        expect(status).toHaveBeenCalledWith(
          400
        );

        expect(json).toHaveBeenCalledWith({
          error:
            "Merchant id is required"
        });

        expect(next).not.toHaveBeenCalled();
      }
    );
  }
);
