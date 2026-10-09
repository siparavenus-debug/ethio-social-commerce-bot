import type {
    Server
  } from "node:http";

  import express from "express";

  import {
    MerchantUserRole,
    prisma
  } from "@ethio-commerce/database";

  import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it
  } from "vitest";

  import platformAdminRouter
    from "../src/routes/platform-admin.js";

  import {
    createPlatformAuthToken
  } from "../src/services/platform-auth.js";

  import {
    createAuthToken
  } from "../src/services/auth.js";

  const testPrefix =
    "platform-merchant-profile";

  let server:
    Server | null = null;

  let apiBaseUrl =
    "";

  async function cleanup():
  Promise<void> {
    await prisma.platformUser.deleteMany({
      where: {
        email: {
          startsWith:
            `${testPrefix}-platform-`
        }
      }
    });

    await prisma.merchant.deleteMany({
      where: {
        name: {
          startsWith:
            testPrefix
        }
      }
    });
  }

  async function createMerchant(
    suffix: string
  ) {
    return prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`,
        currency:
          "ETB",
        phone:
          `+251911000${suffix}`,
        alternatePhone:
          `+251922000${suffix}`,
        address:
          `Addis Ababa ${suffix}`
      }
    });
  }

  async function createPlatformFixture(
    suffix: string
  ) {
    const user =
      await prisma.platformUser.create({
        data: {
          email:
            `${testPrefix}-platform-${suffix}@example.test`,
          passwordHash:
            "test-password-hash",
          displayName:
            `Platform Test ${suffix}`,
          role: "ADMIN",
          tokenVersion:
            0
        }
      });

    const token =
      createPlatformAuthToken({
        id:
          user.id,
        tokenVersion:
          user.tokenVersion
      });

    return {
      user,
      token
    };
  }

  beforeAll(
    async () => {
      await cleanup();

      const app =
        express();

      app.use(
        express.json()
      );

      app.use(
        "/platform",
        platformAdminRouter
      );

      await new Promise<void>(
        (resolve) => {
          server =
            app.listen(
              0,
              "127.0.0.1",
              () => {
                const address =
                  server!.address();

                if (
                  !address ||
                  typeof address ===
                    "string"
                ) {
                  throw new Error(
                    "Failed to start test server"
                  );
                }

                apiBaseUrl =
                  `http://127.0.0.1:${address.port}`;

                resolve();
              }
            );
        }
      );
    }
  );

  beforeEach(
    async () => {
      await cleanup();
    }
  );

  afterAll(
    async () => {
      await cleanup();

      if (server) {
        await new Promise<void>(
          (resolve, reject) => {
            server!.close(
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }

                resolve();
              }
            );
          }
        );
      }
    }
  );

  describe(
    "platform merchant contact profile reads",
    () => {
      it(
        "rejects unauthenticated merchant list reads",
        async () => {
          const response =
            await fetch(
              `${apiBaseUrl}/platform/merchants`
            );

          expect(
            response.status
          ).toBe(401);
        }
      );

      it(
        "rejects unauthenticated merchant detail reads",
        async () => {
          const merchant =
            await createMerchant(
              "unauth-detail"
            );

          const response =
            await fetch(
              `${apiBaseUrl}/platform/merchants/${merchant.id}`
            );

          expect(
            response.status
          ).toBe(401);
        }
      );

      for (
        const role of [
          MerchantUserRole.OWNER,
          MerchantUserRole.ADMIN,
          MerchantUserRole.STAFF
        ]
      ) {
        it(
          `rejects merchant ${role} credentials from platform merchant reads`,
          async () => {
            const merchant =
              await createMerchant(
                `merchant-${role.toLowerCase()}`
              );

            const user =
              await prisma.merchantUser.create({
                data: {
                  merchantId:
                    merchant.id,
                  email:
                    `${testPrefix}-${role.toLowerCase()}@example.test`,
                  passwordHash:
                    "test-password-hash",
                  displayName:
                    `Merchant ${role}`,
                  role,
                  tokenVersion:
                    0
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

            const listResponse =
              await fetch(
                `${apiBaseUrl}/platform/merchants`,
                {
                  headers: {
                    authorization:
                      `Bearer ${token}`
                  }
                }
              );

            expect(
              listResponse.status
            ).toBe(403);

            const detailResponse =
              await fetch(
                `${apiBaseUrl}/platform/merchants/${merchant.id}`,
                {
                  headers: {
                    authorization:
                      `Bearer ${token}`
                  }
                }
              );

            expect(
              detailResponse.status
            ).toBe(403);
          }
        );
      }


      it(
        "includes merchant contact fields in the platform merchant list",
        async () => {
          const merchant =
            await createMerchant(
              "list"
            );

          const {
            token
          } =
            await createPlatformFixture(
              "list"
            );

          const response =
            await fetch(
              `${apiBaseUrl}/platform/merchants`,
              {
                headers: {
                  authorization:
                    `Bearer ${token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          const returnedMerchant =
            body.merchants.find(
              (
                item: {
                  id: string;
                }
              ) =>
                item.id ===
                merchant.id
            );

          expect(
            returnedMerchant
          ).toMatchObject({
            id:
              merchant.id,
            name:
              merchant.name,
            currency:
              "ETB",
            phone:
              merchant.phone,
              alternatePhone:
              merchant.alternatePhone,
            address:
              merchant.address,
            accountStatus:
              "ACTIVE",
            accountSuspensionReason:
              null,
            accountSuspendedAt:
              null
          });
        }
      );

      it(
        "includes merchant contact fields in platform merchant detail",
        async () => {
          const merchant =
            await createMerchant(
              "detail"
            );

          const {
            token
          } =
            await createPlatformFixture(
              "detail"
            );

          const response =
            await fetch(
              `${apiBaseUrl}/platform/merchants/${merchant.id}`,
              {
                headers: {
                  authorization:
                    `Bearer ${token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          expect(
            body.merchant
          ).toMatchObject({
            id:
              merchant.id,
            name:
              merchant.name,
            currency:
              "ETB",
            phone:
              merchant.phone,
              alternatePhone:
              merchant.alternatePhone,
            address:
              merchant.address,
            accountStatus:
              "ACTIVE",
            accountSuspensionReason:
              null,
            accountSuspendedAt:
              null
          });
        }
      );

      it(
        "returns null contact fields when merchant contact information is not set",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-nulls`,
                currency:
                  "ETB"
              }
            });

          const {
            token
          } =
            await createPlatformFixture(
              "nulls"
            );

          const response =
            await fetch(
              `${apiBaseUrl}/platform/merchants/${merchant.id}`,
              {
                headers: {
                  authorization:
                    `Bearer ${token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          expect(
            body.merchant
          ).toMatchObject({
            id:
              merchant.id,
            phone:
              null,
            alternatePhone:
              null,
            address:
              null
          });
        }
      );
    }
  );