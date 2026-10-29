import {
    MerchantUserRole,
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
    "merchant-profile-route";

  async function cleanup(): Promise<void> {
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

    if (merchantIds.length === 0) {
      return;
    }

    await prisma.auditLog.deleteMany({
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
          currency: "ETB"
        }
      });

    const user =
      await prisma.merchantUser.create({
        data: {
          merchantId: merchant.id,
          email:
            `${testPrefix}-${suffix}@example.test`,
          passwordHash:
            "test-password-hash",
          displayName:
            `Merchant Profile ${role}`,
          role,
          tokenVersion: 0
        }
      });

    const token =
      createAuthToken({
        id: user.id,
        merchantId: merchant.id,
        role: user.role,
        tokenVersion:
          user.tokenVersion
      });

    return {
      merchant,
      user,
      token
    };
  }

  async function getProfile(
    merchantId: string,
    token?: string
  ) {
    const headers:
      Record<string, string> = {};

    if (token) {
      headers.authorization =
        `Bearer ${token}`;
    }

    return fetch(
      `${API_BASE_URL}/merchants/${merchantId}/profile`,
      {
        method: "GET",
        headers
      }
    );
  }

  async function patchProfile(
    merchantId: string,
    body: Record<string, unknown>,
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
      `${API_BASE_URL}/merchants/${merchantId}/profile`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(body)
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
    "merchant profile routes",
    () => {
      it(
        "rejects unauthenticated profile reads",
        async () => {
          const fixture =
            await createFixture(
              "unauthenticated-read"
            );

          const response =
            await getProfile(
              fixture.merchant.id
            );

          expect(
            response.status
          ).toBe(401);
        }
      );

      it(
        "allows STAFF to read its merchant profile",
        async () => {
          const fixture =
            await createFixture(
              "staff-read",
              MerchantUserRole.STAFF
            );

          await prisma.merchant.update({
            where: {
              id: fixture.merchant.id
            },
            data: {
              phone: "+251911111111",
              alternatePhone:
                "+251922222222",
              address:
                "Addis Ababa"
            }
          });

          const response =
            await getProfile(
              fixture.merchant.id,
              fixture.token
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json() as
              Record<string, unknown>;

          expect(body.id).toBe(
            fixture.merchant.id
          );

          expect(body.phone).toBe(
            "+251911111111"
          );

          expect(
            body.alternatePhone
          ).toBe(
            "+251922222222"
          );

          expect(body.address).toBe(
            "Addis Ababa"
          );
        }
      );

      it(
        "forbids cross-merchant profile reads",
        async () => {
          const owner =
            await createFixture(
              "cross-read-owner"
            );

          const target =
            await createFixture(
              "cross-read-target"
            );

          const response =
            await getProfile(
              target.merchant.id,
              owner.token
            );

          expect(
            response.status
          ).toBe(403);
        }
      );

      it(
        "rejects unauthenticated profile updates",
        async () => {
          const fixture =
            await createFixture(
              "unauthenticated-update"
            );

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone:
                  "+251911111111"
              }
            );

          expect(
            response.status
          ).toBe(401);
        }
      );

      it(
        "forbids STAFF profile updates",
        async () => {
          const fixture =
            await createFixture(
              "staff-update",
              MerchantUserRole.STAFF
            );

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone:
                  "+251911111111"
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(403);

          const merchant =
            await prisma.merchant.findUniqueOrThrow({
              where: {
                id: fixture.merchant.id
              }
            });

          expect(
            merchant.phone
          ).toBeNull();
        }
      );

      it(
        "forbids cross-merchant profile updates",
        async () => {
          const owner =
            await createFixture(
              "cross-update-owner"
            );

          const target =
            await createFixture(
              "cross-update-target"
            );

          const response =
            await patchProfile(
              target.merchant.id,
              {
                phone:
                  "+251911111111"
              },
              owner.token
            );

          expect(
            response.status
          ).toBe(403);

          const merchant =
            await prisma.merchant.findUniqueOrThrow({
              where: {
                id: target.merchant.id
              }
            });

          expect(
            merchant.phone
          ).toBeNull();
        }
      );

      it(
        "allows OWNER to update merchant contact fields",
        async () => {
          const fixture =
            await createFixture(
              "owner-update"
            );

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone:
                  " +251911111111 ",
                alternatePhone:
                  " +251922222222 ",
                address:
                  " Addis Ababa, Ethiopia "
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json() as
              Record<string, unknown>;

          expect(body.phone).toBe(
            "+251911111111"
          );

          expect(
            body.alternatePhone
          ).toBe(
            "+251922222222"
          );

          expect(body.address).toBe(
            "Addis Ababa, Ethiopia"
          );
        }
      );

      it(
        "allows ADMIN to update merchant contact fields",
        async () => {
          const fixture =
            await createFixture(
              "admin-update",
              MerchantUserRole.ADMIN
            );

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone:
                  "+251933333333"
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(200);

          const merchant =
            await prisma.merchant.findUniqueOrThrow({
              where: {
                id: fixture.merchant.id
              }
            });

          expect(
            merchant.phone
          ).toBe(
            "+251933333333"
          );
        }
      );

      it(
        "rejects requests without a supported profile field",
        async () => {
          const fixture =
            await createFixture(
              "no-supported-field"
            );

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                unsupported:
                  "value"
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(400);
        }
      );

      it(
        "rejects invalid profile field types",
        async () => {
          const fixture =
            await createFixture(
              "invalid-type"
            );

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone: 12345
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(400);

          const merchant =
            await prisma.merchant.findUniqueOrThrow({
              where: {
                id: fixture.merchant.id
              }
            });

          expect(
            merchant.phone
          ).toBeNull();
        }
      );

      it(
        "rejects contact fields that exceed maximum lengths",
        async () => {
          const fixture =
            await createFixture(
              "max-length"
            );

          const phoneResponse =
            await patchProfile(
              fixture.merchant.id,
              {
                phone:
                  "1".repeat(51)
              },
              fixture.token
            );

          expect(
            phoneResponse.status
          ).toBe(400);

          const addressResponse =
            await patchProfile(
              fixture.merchant.id,
              {
                address:
                  "a".repeat(1001)
              },
              fixture.token
            );

          expect(
            addressResponse.status
          ).toBe(400);
        }
      );

      it(
        "allows contact fields to be cleared with blank strings or null",
        async () => {
          const fixture =
            await createFixture(
              "clear-fields"
            );

          await prisma.merchant.update({
            where: {
              id: fixture.merchant.id
            },
            data: {
              phone:
                "+251911111111",
              alternatePhone:
                "+251922222222",
              address:
                "Addis Ababa"
            }
          });

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone: "   ",
                alternatePhone:
                  null,
                address: ""
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(200);

          const merchant =
            await prisma.merchant.findUniqueOrThrow({
              where: {
                id: fixture.merchant.id
              }
            });

          expect(
            merchant.phone
          ).toBeNull();

          expect(
            merchant.alternatePhone
          ).toBeNull();

          expect(
            merchant.address
          ).toBeNull();
        }
      );

      it(
        "audits changed fields without copying contact PII into metadata",
        async () => {
          const fixture =
            await createFixture(
              "audit"
            );

          const phone =
            "+251944444444";

          const address =
            "Sensitive merchant address";

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone,
                address
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(200);

          const auditLog =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "MERCHANT_PROFILE_UPDATED",
                entityType:
                  "MERCHANT",
                entityId:
                  fixture.merchant.id
              },
              orderBy: {
                createdAt: "desc"
              }
            });

          expect(
            auditLog
          ).not.toBeNull();

          expect(
            auditLog?.actorUserId
          ).toBe(
            fixture.user.id
          );

          expect(
            auditLog?.metadata
          ).toEqual({
            changedFields: [
              "phone",
              "address"
            ]
          });

          const serializedMetadata =
            JSON.stringify(
              auditLog?.metadata
            );

          expect(
            serializedMetadata
          ).not.toContain(phone);

          expect(
            serializedMetadata
          ).not.toContain(address);
        }
      );

      it(
        "does not create an audit event when normalized values do not change",
        async () => {
          const fixture =
            await createFixture(
              "no-op"
            );

          await prisma.merchant.update({
            where: {
              id: fixture.merchant.id
            },
            data: {
              phone:
                "+251955555555"
            }
          });

          const response =
            await patchProfile(
              fixture.merchant.id,
              {
                phone:
                  " +251955555555 "
              },
              fixture.token
            );

          expect(
            response.status
          ).toBe(200);

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "MERCHANT_PROFILE_UPDATED"
              }
            });

          expect(
            auditCount
          ).toBe(0);
        }
      );
    }
  );