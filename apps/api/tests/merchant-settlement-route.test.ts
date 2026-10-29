import {
  MerchantInvoiceStatus,
  MerchantSettlementStatus,
  MerchantUserRole,
  Prisma,
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
  "http://127.0.0.1:3100";

const testPrefix =
  "day15-settlement-route";

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
          `Test ${role}`,
        role,
        tokenVersion:
          0
      }
    });

  const invoice =
    await prisma.merchantInvoice.create({
      data: {
        merchantId:
          merchant.id,
        invoiceNumber:
          `INV-ROUTE-${suffix}`,
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
      `route-${suffix}`,
    transactionReference:
      `TX-ROUTE-${suffix}`
  };
}

async function postSettlement(
  merchantId: string,
  body: unknown,
  token?: string
) {
  const headers:
    Record<string, string> = {
      "content-type":
        "application/json"
    };

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/billing/settlements`,
    {
      method:
        "POST",
      headers,
      body:
        JSON.stringify(body)
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
  "merchant settlement submission route",
  () => {
    it(
      "rejects unauthenticated submission",
      async () => {
        const fixture =
          await createFixture(
            "unauthenticated"
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            settlementBody(
              fixture.invoice.id,
              "UNAUTH"
            )
          );

        expect(
          response.status
        ).toBe(401);

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "forbids STAFF submission",
      async () => {
        const fixture =
          await createFixture(
            "staff",
            MerchantUserRole.STAFF
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            settlementBody(
              fixture.invoice.id,
              "STAFF"
            ),
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
      }
    );

    it(
      "forbids cross-merchant submission",
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
          await postSettlement(
            target.merchant.id,
            settlementBody(
              target.invoice.id,
              "CROSS"
            ),
            owner.token
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                target.merchant.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "allows OWNER submission but keeps settlement under review and invoice open",
      async () => {
        const fixture =
          await createFixture(
            "owner"
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            settlementBody(
              fixture.invoice.id,
              "OWNER"
            ),
            fixture.token
          );

        expect(
          response.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          settlement.verifiedAt
        ).toBeNull();

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice.paidAt
        ).toBeNull();

        const audit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_SUBMITTED",
              entityId:
                settlement.id
            }
          });

        expect(
          audit?.actorUserId
        ).toBe(
          fixture.user.id
        );
      }
    );

    it(
      "forbids ADMIN submission",
      async () => {
        const fixture =
          await createFixture(
            "admin",
            MerchantUserRole.ADMIN
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            settlementBody(
              fixture.invoice.id,
              "ADMIN"
            ),
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
      }
    );

    it(
      "forbids merchant OWNER from verifying own settlement through platform administration",
      async () => {
        const fixture =
          await createFixture(
            "owner-platform-verify"
          );

        const submission =
          await postSettlement(
            fixture.merchant.id,
            settlementBody(
              fixture.invoice.id,
              "OWNER-PLATFORM-VERIFY"
            ),
            fixture.token
          );

        expect(
          submission.status
        ).toBe(201);

        const settlement =
          await prisma.merchantSettlement.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        const response =
          await fetch(
            `${API_BASE_URL}/platform/merchants/${fixture.merchant.id}/billing/settlements/${settlement.id}/verify`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${fixture.token}`
              }
            }
          );

        expect(
          response.status
        ).toBe(403);

        const responseBody =
          await response.json() as {
            error?: string;
          };

        expect(
          responseBody.error
        ).toBe(
          "Merchant accounts are not authorized to access platform administration"
        );

        const unchangedSettlement =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                settlement.id
            }
          });

        const unchangedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          unchangedSettlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          unchangedSettlement.verifiedAt
        ).toBeNull();

        expect(
          unchangedInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          unchangedInvoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "returns the same settlement for an identical idempotent replay",
      async () => {
        const fixture =
          await createFixture(
            "replay"
          );

        const body =
          settlementBody(
            fixture.invoice.id,
            "REPLAY"
          );

        const first =
          await postSettlement(
            fixture.merchant.id,
            body,
            fixture.token
          );

        const second =
          await postSettlement(
            fixture.merchant.id,
            body,
            fixture.token
          );

        expect(
          first.status
        ).toBe(201);

        expect(
          second.status
        ).toBe(201);

        const settlements =
          await prisma.merchantSettlement.findMany({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          settlements
        ).toHaveLength(1);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_SUBMITTED"
            }
          })
        ).toBe(1);
      }
    );

    it(
      "returns conflict when an idempotency key is reused for different evidence",
      async () => {
        const fixture =
          await createFixture(
            "conflict"
          );

        const firstBody =
          settlementBody(
            fixture.invoice.id,
            "CONFLICT"
          );

        const first =
          await postSettlement(
            fixture.merchant.id,
            firstBody,
            fixture.token
          );

        expect(
          first.status
        ).toBe(201);

        const second =
          await postSettlement(
            fixture.merchant.id,
            {
              ...firstBody,
              transactionReference:
                "TX-ROUTE-CONFLICT-DIFFERENT"
            },
            fixture.token
          );

        expect(
          second.status
        ).toBe(409);

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(1);
      }
    );

    it(
      "rejects malformed submission input",
      async () => {
        const fixture =
          await createFixture(
            "malformed"
          );

        const response =
          await postSettlement(
            fixture.merchant.id,
            {
              invoiceId:
                fixture.invoice.id,
              provider:
                "NOT_A_PROVIDER",
              amount:
                "550.00",
              currency:
                "ETB",
              idempotencyKey:
                "route-malformed",
              transactionReference:
                "TX-MALFORMED"
            },
            fixture.token
          );

        expect(
          response.status
        ).toBe(400);

        expect(
          await prisma.merchantSettlement.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);
      }
    );
  }
);
