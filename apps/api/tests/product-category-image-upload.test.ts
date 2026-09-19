import type {
    Server
  } from "node:http";
  
  import express from "express";
  
  import {
    MerchantSubscriptionStatus,
    MerchantUserRole,
    Prisma,
    SubscriptionBillingInterval,
    prisma
  } from "@ethio-commerce/database";
  
  import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";
  
  const storageMocks =
    vi.hoisted(() => ({
      uploadProductImage:
        vi.fn()
    }));
  
  vi.mock(
    "../src/services/storage.js",
    () => ({
      getMaxImageSizeBytes:
        () =>
          5 * 1024 * 1024,
  
      isAllowedImageType:
        (mimeType: string) =>
          [
            "image/jpeg",
            "image/png",
            "image/webp"
          ].includes(
            mimeType
          ),
  
      uploadProductImage:
        storageMocks.uploadProductImage
    })
  );
  
  import merchantsRouter
    from "../src/routes/merchants.js";
  
  import {
    createAuthToken
  } from "../src/services/auth.js";
  
  import {
    initializeMerchantSubscription
  } from "../src/services/subscription.js";
  
  const testPrefix =
    "category-image-upload";
  
  const planCodePrefix =
    "catimg-upload-";
  
  const periodStart =
    new Date(
      "2026-09-01T00:00:00.000Z"
    );
  
  const periodEnd =
    new Date(
      "2026-10-01T00:00:00.000Z"
    );
  
  let server:
    Server | null = null;
  
  let apiBaseUrl =
    "";

    async function cleanup():
  Promise<void> {
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
          `Category Upload ${role}`,
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
          `Category Upload Plan ${suffix}`,
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

function createCategoryImageForm(
    contents:
      string =
        "test-category-image",
    mimeType:
      string =
        "image/png"
  ): FormData {
    const form =
      new FormData();
  
    const filename =
      mimeType ===
        "image/jpeg"
        ? "category.jpg"
        : mimeType ===
          "image/webp"
          ? "category.webp"
          : "category.png";
  
    form.set(
      "image",
      new Blob(
        [
          contents
        ],
        {
          type:
            mimeType
        }
      ),
      filename
    );
  
    return form;
  }
  
  async function uploadCategoryImage(
    merchantId: string,
    categoryId: string,
    token: string,
    form:
      FormData =
        createCategoryImageForm()
  ) {
    return fetch(
      `${apiBaseUrl}/merchants/${merchantId}/products/categories/${categoryId}/image/upload`,
      {
        method:
          "POST",
        headers: {
          authorization:
            `Bearer ${token}`
        },
        body:
          form
      }
    );
  }
  
  beforeAll(
    async () => {
      const app =
        express();
  
      app.use(
        express.json()
      );
  
      app.use(
        "/merchants",
        merchantsRouter
      );
  
      await new Promise<void>(
        (
          resolve,
          reject
        ) => {
          server =
            app.listen(
              0,
              "127.0.0.1",
              () => {
                resolve();
              }
            );
  
          server.once(
            "error",
            reject
          );
        }
      );
  
      const address =
        server?.address();
  
      if (
        !address ||
        typeof address ===
          "string"
      ) {
        throw new Error(
          "Failed to start category image upload test server"
        );
      }
  
      apiBaseUrl =
        `http://127.0.0.1:${address.port}`;
    }
  );
  
  beforeEach(
    async () => {
      await cleanup();
  
      storageMocks.uploadProductImage
        .mockReset();
  
      storageMocks.uploadProductImage
        .mockResolvedValue(
          "https://images.example.test/category.png"
        );
    }
  );
  
  afterAll(
    async () => {
      await cleanup();
  
      if (server) {
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            server!.close(
              (error) => {
                if (error) {
                  reject(
                    error
                  );
                  return;
                }
  
                resolve();
              }
            );
          }
        );
      }
  
      await prisma.$disconnect();
    }
  );

  describe(
    "product category image upload",
    () => {
      it(
        "allows OWNER to upload a category image",
        async () => {
          const fixture =
            await createFixture(
              "owner-success"
            );
  
          const response =
            await uploadCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token
            );
  
          expect(
            response.status
          ).toBe(201);
  
          const body =
            await response.json() as {
              message: string;
              category: {
                id: string;
                imageUrl: string | null;
                imageAltText: string | null;
              };
            };
  
          expect(
            body.message
          ).toBe(
            "Category image uploaded successfully"
          );
  
          expect(
            body.category.id
          ).toBe(
            fixture.category.id
          );
  
          expect(
            body.category.imageUrl
          ).toBe(
            "https://images.example.test/category.png"
          );
  
          expect(
            body.category.imageAltText
          ).toBe(
            fixture.category.name
          );
  
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
            "https://images.example.test/category.png"
          );
  
          expect(
            stored.imageAltText
          ).toBe(
            fixture.category.name
          );
  
          expect(
            storageMocks.uploadProductImage
          ).toHaveBeenCalledTimes(1);
  
          const [
            objectKey,
            uploadedBuffer,
            contentType
          ] =
            storageMocks.uploadProductImage
              .mock.calls[0] as [
                string,
                Buffer,
                string
              ];
  
          expect(
            objectKey
          ).toMatch(
            new RegExp(
              `^merchants/${fixture.merchant.id}/categories/${fixture.category.id}/[0-9a-f-]+\\.png$`
            )
          );
  
          expect(
            uploadedBuffer.toString()
          ).toBe(
            "test-category-image"
          );
  
          expect(
            contentType
          ).toBe(
            "image/png"
          );
        }
      );

      it(
        "forbids STAFF from uploading a category image",
        async () => {
          const fixture =
            await createFixture(
              "staff-denied",
              MerchantUserRole.STAFF
            );
      
          const response =
            await uploadCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token
            );
      
          expect(
            response.status
          ).toBe(403);
      
          expect(
            storageMocks.uploadProductImage
          ).not.toHaveBeenCalled();
      
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
        "prevents cross-merchant category image upload",
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
            await uploadCategoryImage(
              target.merchant.id,
              target.category.id,
              actor.token
            );
      
          expect(
            response.status
          ).toBe(403);
      
          expect(
            storageMocks.uploadProductImage
          ).not.toHaveBeenCalled();
      
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
      
          expect(
            stored.imageAltText
          ).toBeNull();
        }
      );

      it(
        "blocks category image upload for a SUSPENDED merchant",
        async () => {
          const fixture =
            await createFixture(
              "suspended-denied"
            );
      
          await prisma.merchantSubscription.update({
            where: {
              merchantId:
                fixture.merchant.id
            },
            data: {
              status:
                MerchantSubscriptionStatus.SUSPENDED
            }
          });
      
          const response =
            await uploadCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token
            );
      
          expect(
            response.status
          ).toBe(403);
      
          expect(
            storageMocks.uploadProductImage
          ).not.toHaveBeenCalled();
      
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
        "rejects an upload when the image file is missing",
        async () => {
          const fixture =
            await createFixture(
              "missing-file"
            );
      
          const response =
            await uploadCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              new FormData()
            );
      
          expect(
            response.status
          ).toBe(400);
      
          const body =
            await response.json() as {
              error: string;
            };
      
          expect(
            body.error
          ).toBe(
            "Image file is required"
          );
      
          expect(
            storageMocks.uploadProductImage
          ).not.toHaveBeenCalled();
      
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
        "rejects unsupported category image file types",
        async () => {
          const fixture =
            await createFixture(
              "invalid-mime"
            );
      
          const response =
            await uploadCategoryImage(
              fixture.merchant.id,
              fixture.category.id,
              fixture.token,
              createCategoryImageForm(
                "not-an-image",
                "text/plain"
              )
            );
      
          expect(
            response.status
          ).toBe(400);
      
          const body =
            await response.json() as {
              error: string;
            };
      
          expect(
            body.error
          ).toBe(
            "Only JPEG, PNG, and WebP images are allowed."
          );
      
          expect(
            storageMocks.uploadProductImage
          ).not.toHaveBeenCalled();
      
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
    
    }
  );