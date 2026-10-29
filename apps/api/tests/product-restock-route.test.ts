import {
  MerchantSubscriptionStatus,
  MerchantUserRole,
  Prisma,
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

import {
  initializeMerchantSubscription
} from "../src/services/subscription.js";

const API_BASE_URL =
  "http://127.0.0.1:3100";

const testPrefix =
  "product-restock-route";

const planCodePrefix =
  "restock-route-";

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
          planCodePrefix
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
          `Restock ${role}`,
        role,
        tokenVersion:
          0
      }
    });

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${planCodePrefix}${suffix}`,
        name:
          `Restock Plan ${suffix}`,
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
      periodStart,
    currentPeriodEnd:
      periodEnd,
    actorUserId:
      null
  });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Product ${suffix}`,
        price:
          new Prisma.Decimal(
            "100.00"
          ),
        currency:
          "ETB",
        stock:
          5,
        status:
          ProductStatus.ACTIVE
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
    product,
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

async function restockProduct(
  merchantId: string,
  productId: string,
  token: string,
  body: unknown
) {
  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/products/${productId}/restock`,
    {
      method:
        "POST",
      headers:
        authHeaders(token),
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
  "product restock route",
  () => {
    it(
      "allows OWNER to restock a product and records an attributed audit",
      async () => {
        const fixture =
          await createFixture(
            "owner-success"
          );

        const response =
          await restockProduct(
            fixture.merchant.id,
            fixture.product.id,
            fixture.token,
            {
              quantity: 7,
              note:
                "New shipment received"
            }
          );

        expect(
          response.status
        ).toBe(200);

        const body =
          await response.json() as {
            message: string;
            product: {
              id: string;
              stock: number;
            };
            quantityAdded: number;
          };

        expect(
          body.message
        ).toBe(
          "Product restocked successfully"
        );

        expect(
          body.product.id
        ).toBe(
          fixture.product.id
        );

        expect(
          body.product.stock
        ).toBe(12);

        expect(
          body.quantityAdded
        ).toBe(7);

        const storedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          storedProduct.stock
        ).toBe(12);

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "PRODUCT_RESTOCKED",
              entityType:
                "PRODUCT",
              entityId:
                fixture.product.id
            }
          });

        expect(
          audits
        ).toHaveLength(1);

        expect(
          audits[0]?.actorUserId
        ).toBe(
          fixture.user.id
        );

        expect(
          audits[0]?.metadata
        ).toEqual({
          productName:
            fixture.product.name,
          quantityAdded:
            7,
          previousStock:
            5,
          newStock:
            12,
          note:
            "New shipment received"
        });
      }
    );

    it(
      "forbids STAFF from restocking a product without changing stock or audit history",
      async () => {
        const fixture =
          await createFixture(
            "staff-denied",
            MerchantUserRole.STAFF
          );

        const response =
          await restockProduct(
            fixture.merchant.id,
            fixture.product.id,
            fixture.token,
            {
              quantity: 4
            }
          );

        expect(
          response.status
        ).toBe(403);

        const storedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          storedProduct.stock
        ).toBe(5);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "PRODUCT_RESTOCKED",
              entityId:
                fixture.product.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "prevents cross-merchant restocking without changing the target product or audit history",
      async () => {
        const actor =
          await createFixture(
            "cross-actor"
          );

        const target =
          await createFixture(
            "cross-target"
          );

        const response =
          await restockProduct(
            target.merchant.id,
            target.product.id,
            actor.token,
            {
              quantity: 9
            }
          );

        expect(
          response.status
        ).toBe(403);

        const storedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                target.product.id
            }
          });

        expect(
          storedProduct.stock
        ).toBe(5);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                target.merchant.id,
              action:
                "PRODUCT_RESTOCKED",
              entityId:
                target.product.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "audits exact stock replacement through the dedicated stock route",
      async () => {
        const fixture =
          await createFixture(
            "stock-set-dedicated"
          );

        const response =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/products/${fixture.product.id}/stock`,
            {
              method:
                "PATCH",
              headers:
                authHeaders(
                  fixture.token
                ),
              body:
                JSON.stringify({
                  stock: 11
                })
            }
          );

        expect(
          response.status
        ).toBe(200);

        const storedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          storedProduct.stock
        ).toBe(11);

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              actorUserId:
                fixture.user.id,
              action:
                "PRODUCT_STOCK_SET",
              entityType:
                "PRODUCT",
              entityId:
                fixture.product.id
            }
          });

        expect(
          audits
        ).toHaveLength(1);

        expect(
          audits[0]?.metadata
        ).toEqual({
          productName:
            fixture.product.name,
          previousStock:
            5,
          newStock:
            11
        });
      }
    );

    it(
      "audits exact stock replacement through the general product update route",
      async () => {
        const fixture =
          await createFixture(
            "stock-set-general"
          );

        const response =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/products/${fixture.product.id}`,
            {
              method:
                "PATCH",
              headers:
                authHeaders(
                  fixture.token
                ),
              body:
                JSON.stringify({
                  stock: 2
                })
            }
          );

        expect(
          response.status
        ).toBe(200);

        const storedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          storedProduct.stock
        ).toBe(2);

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              actorUserId:
                fixture.user.id,
              action:
                "PRODUCT_STOCK_SET",
              entityType:
                "PRODUCT",
              entityId:
                fixture.product.id
            }
          });

        expect(
          audits
        ).toHaveLength(1);

        expect(
          audits[0]?.metadata
        ).toEqual({
          productName:
            fixture.product.name,
          previousStock:
            5,
          newStock:
            2
        });
      }
    );

    it(
      "audits product price currency and status changes",
      async () => {
        const fixture =
          await createFixture(
            "commerce-update"
          );

        const response =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/products/${fixture.product.id}`,
            {
              method:
                "PATCH",
              headers:
                authHeaders(
                  fixture.token
                ),
              body:
                JSON.stringify({
                  price: 125,
                  currency: "USD",
                  status:
                    ProductStatus.DRAFT
                })
            }
          );

        expect(
          response.status
        ).toBe(200);

        const storedProduct =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          Number(storedProduct.price)
        ).toBe(125);

        expect(
          storedProduct.currency
        ).toBe("USD");

        expect(
          storedProduct.status
        ).toBe(
          ProductStatus.DRAFT
        );

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              actorUserId:
                fixture.user.id,
              action:
                "PRODUCT_COMMERCE_UPDATED",
              entityType:
                "PRODUCT",
              entityId:
                fixture.product.id
            }
          });

        expect(
          audits
        ).toHaveLength(1);

        expect(
          audits[0]?.metadata
        ).toEqual({
          productName:
            fixture.product.name,
          changedFields: [
            "price",
            "currency",
            "status"
          ],
          previousPrice:
            "100",
          newPrice:
            "125",
          previousCurrency:
            "ETB",
          newCurrency:
            "USD",
          previousStatus:
            ProductStatus.ACTIVE,
          newStatus:
            ProductStatus.DRAFT
        });
      }
    );
  }
);
