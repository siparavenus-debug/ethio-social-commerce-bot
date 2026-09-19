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
    "http://localhost:3000";
  
  const testPrefix =
    "category-image-route";
  
  const planCodePrefix =
    "catimg-route-";
  
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
  
      await prisma.product.deleteMany({
        where: {
          merchantId: {
            in: merchantIds
          }
        }
      });
  
      await prisma.productCategory.deleteMany({
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
            `Category Image ${role}`,
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
            `Category Image Plan ${suffix}`,
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
  
    const category =
      await prisma.productCategory.create({
        data: {
          merchantId:
            merchant.id,
          name:
            `Category ${suffix}`
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
      category,
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
  
  async function updateCategoryImage(
    merchantId: string,
    categoryId: string,
    token: string,
    body: unknown
  ) {
    return fetch(
      `${API_BASE_URL}/merchants/${merchantId}/products/categories/${categoryId}/image`,
      {
        method:
          "PATCH",
        headers:
          authHeaders(token),
        body:
          JSON.stringify(body)
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
    "product category image route",
    () => {
      it(
        "allows OWNER to set and replace a category image",
        async () => {
          const fixture =
            await createFixture(
              "owner-set"
            );
  
          const firstResponse =
            await updateCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              {
                imageUrl:
                  "https://example.test/shoes.jpg",
                imageAltText:
                  "Shoes"
              }
            );
  
          expect(
            firstResponse.status
          ).toBe(200);
  
          const firstBody =
            await firstResponse.json() as {
              id: string;
              imageUrl: string | null;
              imageAltText: string | null;
            };
  
          expect(
            firstBody.id
          ).toBe(
            fixture.category.id
          );
  
          expect(
            firstBody.imageUrl
          ).toBe(
            "https://example.test/shoes.jpg"
          );
  
          expect(
            firstBody.imageAltText
          ).toBe(
            "Shoes"
          );
  
          const replacementResponse =
            await updateCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              {
                imageUrl:
                  "https://example.test/new-shoes.jpg",
                imageAltText:
                  "New shoes"
              }
            );
  
          expect(
            replacementResponse.status
          ).toBe(200);
  
          const stored =
            await prisma.productCategory.findUniqueOrThrow({
              where: {
                id:
                  fixture.category.id
              }
            });
  
          expect(
            stored.imageUrl
          ).toBe(
            "https://example.test/new-shoes.jpg"
          );
  
          expect(
            stored.imageAltText
          ).toBe(
            "New shoes"
          );
        }
      );
  
      it(
        "allows ADMIN to set a category image",
        async () => {
          const fixture =
            await createFixture(
              "admin-set",
              MerchantUserRole.ADMIN
            );
  
          const response =
            await updateCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              {
                imageUrl:
                  "https://example.test/admin-category.jpg",
                imageAltText:
                  "Admin category"
              }
            );
  
          expect(
            response.status
          ).toBe(200);
  
          const stored =
            await prisma.productCategory.findUniqueOrThrow({
              where: {
                id:
                  fixture.category.id
              }
            });
  
          expect(
            stored.imageUrl
          ).toBe(
            "https://example.test/admin-category.jpg"
          );
        }
      );
  
      it(
        "forbids STAFF from changing a category image",
        async () => {
          const fixture =
            await createFixture(
              "staff-denied",
              MerchantUserRole.STAFF
            );
  
          const response =
            await updateCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              {
                imageUrl:
                  "https://example.test/staff.jpg",
                imageAltText:
                  "Staff image"
              }
            );
  
          expect(
            response.status
          ).toBe(403);
  
          const stored =
            await prisma.productCategory.findUniqueOrThrow({
              where: {
                id:
                  fixture.category.id
              }
            });
  
          expect(
            stored.imageUrl
          ).toBeNull();
  
          expect(
            stored.imageAltText
          ).toBeNull();
        }
      );
  
      it(
        "prevents cross-merchant category modification",
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
            await updateCategoryImage(
              target.merchant.id,
              target.category.id,
              actor.token,
              {
                imageUrl:
                  "https://example.test/cross.jpg",
                imageAltText:
                  "Cross merchant"
              }
            );
  
          expect(
            response.status
          ).toBe(403);
  
          const stored =
            await prisma.productCategory.findUniqueOrThrow({
              where: {
                id:
                  target.category.id
              }
            });
  
          expect(
            stored.imageUrl
          ).toBeNull();
        }
      );
  
      it(
        "rejects invalid category image URLs",
        async () => {
          const fixture =
            await createFixture(
              "invalid-url"
            );
  
          const response =
            await updateCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              {
                imageUrl:
                  "not-a-valid-url",
                imageAltText:
                  "Invalid"
              }
            );
  
          expect(
            response.status
          ).toBe(400);
  
          const stored =
            await prisma.productCategory.findUniqueOrThrow({
              where: {
                id:
                  fixture.category.id
              }
            });
  
          expect(
            stored.imageUrl
          ).toBeNull();
        }
      );
  
      it(
        "rejects oversized category image alt text",
        async () => {
          const fixture =
            await createFixture(
              "oversized-alt"
            );
  
          const response =
            await updateCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              {
                imageUrl:
                  "https://example.test/category.jpg",
                imageAltText:
                  "a".repeat(301)
              }
            );
  
          expect(
            response.status
          ).toBe(400);
  
          const stored =
            await prisma.productCategory.findUniqueOrThrow({
              where: {
                id:
                  fixture.category.id
              }
            });
  
          expect(
            stored.imageUrl
          ).toBeNull();
        }
      );
  
      it(
        "removes both category image fields when imageUrl is null",
        async () => {
          const fixture =
            await createFixture(
              "remove"
            );
  
          await prisma.productCategory.update({
            where: {
              id:
                fixture.category.id
            },
            data: {
              imageUrl:
                "https://example.test/existing.jpg",
              imageAltText:
                "Existing image"
            }
          });
  
          const response =
            await updateCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              {
                imageUrl:
                  null,
                imageAltText:
                  null
              }
            );
  
          expect(
            response.status
          ).toBe(200);
  
          const stored =
            await prisma.productCategory.findUniqueOrThrow({
              where: {
                id:
                  fixture.category.id
              }
            });
  
          expect(
            stored.imageUrl
          ).toBeNull();
  
          expect(
            stored.imageAltText
          ).toBeNull();
        }
      );
  
      it(
        "returns category image metadata from the category list",
        async () => {
          const fixture =
            await createFixture(
              "category-get"
            );
  
          await prisma.productCategory.update({
            where: {
              id:
                fixture.category.id
            },
            data: {
              imageUrl:
                "https://example.test/list-image.jpg",
              imageAltText:
                "Category list image"
            }
          });
  
          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/products/categories`,
              {
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`
                }
              }
            );
  
          expect(
            response.status
          ).toBe(200);
  
          const body =
          await response.json() as Array<{
            id: string;
            imageUrl: string | null;
            imageAltText: string | null;
          }>;
        
        const category =
          body.find(
            (item) =>
              item.id ===
                fixture.category.id
          );
  
          expect(
            category
          ).toBeDefined();
  
          expect(
            category?.imageUrl
          ).toBe(
            "https://example.test/list-image.jpg"
          );
  
          expect(
            category?.imageAltText
          ).toBe(
            "Category list image"
          );
        }
      );
    }
  );