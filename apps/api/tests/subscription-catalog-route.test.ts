import {
  MerchantSubscriptionStatus,
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
  "http://127.0.0.1:3100";

const testPrefix =
  "d16-catalog-route";

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

    await prisma.order.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.productImage.deleteMany({
      where: {
        product: {
          merchantId: {
            in:
              merchantIds
          }
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

    await prisma.productCategory.deleteMany({
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
          "Day 16 Catalog Plan",
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

  const category =
    await prisma.productCategory.create({
      data: {
        merchantId:
          merchant.id,
        name:
          "Existing Category"
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        categoryId:
          category.id,
        name:
          "Existing Product",
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

  const image =
    await prisma.productImage.create({
      data: {
        productId:
          product.id,
        url:
          "https://example.test/product.jpg",
        altText:
          "Existing product",
        isPrimary:
          true
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
    category,
    product,
    image,
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
  "subscription enforcement on catalog routes",
  () => {
    it(
      "preserves catalog reads for a SUSPENDED merchant",
      async () => {
        const fixture =
          await createSuspendedFixture();

        const urls = [
          `/merchants/${fixture.merchant.id}/products/categories`,
          `/merchants/${fixture.merchant.id}/products`,
          `/merchants/${fixture.merchant.id}/products/${fixture.product.id}`,
          `/merchants/${fixture.merchant.id}/products/${fixture.product.id}/images`
        ];

        for (const url of urls) {
          const response =
            await fetch(
              `${API_BASE_URL}${url}`,
              {
                headers:
                  authHeaders(
                    fixture.token
                  )
              }
            );

          expect(
            response.status,
            `Expected suspended read ${url} to remain available`
          ).toBe(200);
        }
      }
    );

    it(
      "blocks every catalog mutation route for a SUSPENDED merchant",
      async () => {
        const fixture =
          await createSuspendedFixture();

        const mutations = [
          {
            method: "POST",
            path:
              `/merchants/${fixture.merchant.id}/products/categories`
          },
          {
            method: "PATCH",
            path:
              `/merchants/${fixture.merchant.id}/products/categories/${fixture.category.id}/image`
          },
          {
            method: "DELETE",
            path:
              `/merchants/${fixture.merchant.id}/products/categories/${fixture.category.id}`
          },
          {
            method: "POST",
            path:
              `/merchants/${fixture.merchant.id}/products`
          },
          {
            method: "PATCH",
            path:
              `/merchants/${fixture.merchant.id}/products/${fixture.product.id}`
          },
          {
            method: "DELETE",
            path:
              `/merchants/${fixture.merchant.id}/products/${fixture.product.id}`
          },
          {
            method: "PATCH",
            path:
              `/merchants/${fixture.merchant.id}/products/${fixture.product.id}/stock`
          },
          {
            method: "POST",
            path:
              `/merchants/${fixture.merchant.id}/products/${fixture.product.id}/restock`
          },
          {
            method: "POST",
            path:
              `/merchants/${fixture.merchant.id}/products/${fixture.product.id}/images`
          },
          {
            method: "PATCH",
            path:
              `/merchants/${fixture.merchant.id}/products/${fixture.product.id}/images/${fixture.image.id}/primary`
          },
          {
            method: "DELETE",
            path:
              `/merchants/${fixture.merchant.id}/products/${fixture.product.id}/images/${fixture.image.id}`
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
                  mutation.method ===
                  "DELETE"
                    ? undefined
                    : JSON.stringify({})
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

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          product.stock
        ).toBe(5);

        expect(
          product.name
        ).toBe(
          "Existing Product"
        );

        expect(
          await prisma.productCategory.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(1);

        expect(
          await prisma.product.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(1);

        expect(
          await prisma.productImage.count({
            where: {
              productId:
                fixture.product.id
            }
          })
        ).toBe(1);
      }
    );
  }
);
