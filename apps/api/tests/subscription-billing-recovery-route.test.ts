import {
  MerchantInvoiceStatus,
  MerchantSettlementStatus,
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

const API_BASE_URL =
  "http://localhost:3000";

const testPrefix =
  "d16-billing-recovery";

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
    await prisma.merchantSettlement.deleteMany({
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

    await prisma.merchantInvoiceItem.deleteMany({
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

  await prisma.subscriptionPlan.deleteMany({
    where: {
      code: {
        startsWith:
          testPrefix
      }
    }
  });
}

async function createFixture(
  suffix: string,
  subscriptionStatus:
    MerchantSubscriptionStatus | null,
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
          `Day 16 ${role}`,
        role,
        tokenVersion:
          0
      }
    });

  if (subscriptionStatus !== null) {
    const plan =
      await prisma.subscriptionPlan.create({
        data: {
          code:
            `${testPrefix}-${suffix}`,
          name:
            `Day 16 ${suffix}`,
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
          subscriptionStatus,
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
  }

  const invoice =
    await prisma.merchantInvoice.create({
      data: {
        merchantId:
          merchant.id,
        invoiceNumber:
          `INV-D16-${suffix}`,
        periodStart:
          new Date(
            "2026-09-01T00:00:00.000Z"
          ),
        periodEnd:
          new Date(
            "2026-10-01T00:00:00.000Z"
          ),
        subscriptionAmount:
          new Prisma.Decimal(
            "500.00"
          ),
        commissionAmount:
          new Prisma.Decimal(
            "50.00"
          ),
        totalAmount:
          new Prisma.Decimal(
            "550.00"
          ),
        currency:
          "ETB",
        status:
          MerchantInvoiceStatus.OPEN,
        openedAt:
          new Date(
            "2026-10-01T00:00:00.000Z"
          )
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
    invoice,
    token
  };
}

function settlementBody(
  invoiceId: string,
  suffix: string
) {
  return {
    invoiceId,
    provider:
      "TELEBIRR",
    amount:
      "550.00",
    currency:
      "ETB",
    idempotencyKey:
      `d16-${suffix}`,
    transactionReference:
      `TX-D16-${suffix}`
  };
}

async function postSettlement(
  merchantId: string,
  invoiceId: string,
  suffix: string,
  token: string
) {
  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/billing/settlements`,
    {
      method:
        "POST",
      headers: {
        authorization:
          `Bearer ${token}`,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify(
          settlementBody(
            invoiceId,
            suffix
          )
        )
    }
  );
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe(
  "subscription enforcement preserves billing recovery",
  () => {
    it(
      "allows a SUSPENDED OWNER to submit settlement evidence",
      async () => {
        const fixture =
          await createFixture(
            "suspended-owner",
            MerchantSubscriptionStatus.SUSPENDED
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            fixture.invoice.id,
            "SUSPENDED",
            fixture.token
          );

        expect(
          response.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "allows a CANCELLED OWNER to submit settlement evidence",
      async () => {
        const fixture =
          await createFixture(
            "cancelled-owner",
            MerchantSubscriptionStatus.CANCELLED
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            fixture.invoice.id,
            "CANCELLED",
            fixture.token
          );

        expect(
          response.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );
      }
    );

    it(
      "allows an OWNER with no subscription to submit settlement evidence",
      async () => {
        const fixture =
          await createFixture(
            "no-subscription-owner",
            null
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            fixture.invoice.id,
            "NO-SUBSCRIPTION",
            fixture.token
          );

        expect(
          response.status
        ).toBe(201);

        expect(
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBeNull();

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );
      }
    );

    it(
      "does not let SUSPENDED STAFF bypass settlement role authorization",
      async () => {
        const fixture =
          await createFixture(
            "suspended-staff",
            MerchantSubscriptionStatus.SUSPENDED,
            MerchantUserRole.STAFF
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            fixture.invoice.id,
            "SUSPENDED-STAFF",
            fixture.token
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );
      }
    );
  }
);
