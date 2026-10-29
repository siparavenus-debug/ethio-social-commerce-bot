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
    "merchant-users-route";

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
            `Merchant Users ${role}`,
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

  async function listUsers(
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
      `${API_BASE_URL}/merchants/${merchantId}/users`,
      {
        method: "GET",
        headers
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
    "merchant user routes",
    () => {
      it(
        "rejects unauthenticated user listing",
        async () => {
          const fixture =
            await createFixture(
              "unauthenticated-list"
            );

          const response =
            await listUsers(
              fixture.merchant.id
            );

          expect(
            response.status
          ).toBe(401);
        }
      );

      it(
        "allows OWNER to list merchant users",
        async () => {
          const fixture =
            await createFixture(
              "owner-list"
            );

          const response =
            await listUsers(
              fixture.merchant.id,
              fixture.token
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json() as {
              users: Array<{
                id: string;
                email: string;
                role: string;
                passwordHash?: string;
                tokenVersion?: number;
              }>;
            };

          expect(
            body.users
          ).toHaveLength(1);

          expect(
            body.users[0]?.id
          ).toBe(fixture.user.id);

          expect(
            body.users[0]?.email
          ).toBe(fixture.user.email);

          expect(
            body.users[0]?.role
          ).toBe("OWNER");

          expect(
            body.users[0]
          ).not.toHaveProperty(
            "passwordHash"
          );

          expect(
            body.users[0]
          ).not.toHaveProperty(
            "tokenVersion"
          );
        }
      );

      it(
        "forbids ADMIN from listing merchant users",
        async () => {
          const fixture =
            await createFixture(
              "admin-list",
              MerchantUserRole.ADMIN
            );

          const response =
            await listUsers(
              fixture.merchant.id,
              fixture.token
            );

          expect(
            response.status
          ).toBe(403);
        }
      );

      it(
        "forbids STAFF from listing merchant users",
        async () => {
          const fixture =
            await createFixture(
              "staff-list",
              MerchantUserRole.STAFF
            );

          const response =
            await listUsers(
              fixture.merchant.id,
              fixture.token
            );

          expect(
            response.status
          ).toBe(403);
        }
      );

      it(
        "forbids cross-merchant user listing",
        async () => {
          const owner =
            await createFixture(
              "cross-list-owner"
            );

          const target =
            await createFixture(
              "cross-list-target"
            );

          const response =
            await listUsers(
              target.merchant.id,
              owner.token
            );

          expect(
            response.status
          ).toBe(403);
        }
      );

      it(
        "allows OWNER to get a merchant user without exposing security fields",
        async () => {
          const fixture =
            await createFixture(
              "owner-get-user"
            );

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users/${fixture.user.id}`,
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
            await response.json() as {
              user: {
                id: string;
                merchantId: string;
                email: string;
                role: string;
                passwordHash?: string;
                tokenVersion?: number;
              };
            };

          expect(
            body.user.id
          ).toBe(fixture.user.id);

          expect(
            body.user.merchantId
          ).toBe(
            fixture.merchant.id
          );

          expect(
            body.user.email
          ).toBe(fixture.user.email);

          expect(
            body.user.role
          ).toBe("OWNER");

          expect(
            body.user
          ).not.toHaveProperty(
            "passwordHash"
          );

          expect(
            body.user
          ).not.toHaveProperty(
            "tokenVersion"
          );
        }
      );

      it(
        "does not expose a user belonging to another merchant",
        async () => {
          const owner =
            await createFixture(
              "cross-get-owner"
            );

          const other =
            await createFixture(
              "cross-get-target"
            );

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${other.user.id}`,
              {
                headers: {
                  authorization:
                    `Bearer ${owner.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(404);
        }
      );


      it(
        "allows OWNER to create a merchant user and records an audit log",
        async () => {
          const fixture =
            await createFixture(
              "owner-create"
            );

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  email:
                    "created-admin@example.test",
                  displayName:
                    "Created Admin",
                  password:
                    "StrongPassword123!",
                  role: "ADMIN"
                })
              }
            );

          expect(
            response.status
          ).toBe(201);

          const body =
            await response.json() as {
              user: {
                id: string;
                merchantId: string;
                email: string;
                displayName: string | null;
                role: string;
                passwordHash?: string;
                tokenVersion?: number;
              };
            };

          expect(
            body.user.merchantId
          ).toBe(
            fixture.merchant.id
          );

          expect(
            body.user.email
          ).toBe(
            "created-admin@example.test"
          );

          expect(
            body.user.displayName
          ).toBe("Created Admin");

          expect(
            body.user.role
          ).toBe("ADMIN");

          expect(
            body.user
          ).not.toHaveProperty(
            "passwordHash"
          );

          expect(
            body.user
          ).not.toHaveProperty(
            "tokenVersion"
          );

          const createdUser =
            await prisma.merchantUser.findUnique({
              where: {
                id: body.user.id
              }
            });

          expect(
            createdUser
          ).not.toBeNull();

          expect(
            createdUser?.role
          ).toBe(
            MerchantUserRole.ADMIN
          );

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "MERCHANT_USER_CREATED",
                entityType:
                  "MERCHANT_USER",
                entityId:
                  body.user.id
              }
            });

          expect(
            audit
          ).not.toBeNull();

          expect(
            audit?.actorUserId
          ).toBe(
            fixture.user.id
          );

          expect(
            audit?.metadata
          ).toEqual({
            role: "ADMIN"
          });

          const serializedMetadata =
            JSON.stringify(
              audit?.metadata
            );

          expect(
            serializedMetadata
          ).not.toContain(
            "StrongPassword123!"
          );

          expect(
            serializedMetadata
          ).not.toContain(
            "created-admin@example.test"
          );

          expect(
            serializedMetadata.toLowerCase()
          ).not.toContain(
            "passwordhash"
          );
        }
      );

      it(
        "prevents OWNER from creating a user for another merchant",
        async () => {
          const owner =
            await createFixture(
              "cross-create-owner"
            );

          const other =
            await createFixture(
              "cross-create-target"
            );

          const email =
            "cross-create-forbidden@example.test";

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${other.merchant.id}/users`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  email,
                  displayName:
                    "Cross Merchant User",
                  password:
                    "StrongPassword123!",
                  role: "STAFF"
                })
              }
            );

          expect(
            response.status
          ).toBe(403);

          const createdUser =
            await prisma.merchantUser.findUnique({
              where: {
                email
              }
            });

          expect(
            createdUser
          ).toBeNull();
        }
      );


      it(
        "forbids ADMIN from creating merchant users",
        async () => {
          const fixture =
            await createFixture(
              "admin-create",
              MerchantUserRole.ADMIN
            );

          const email =
            "forbidden-admin-create@example.test";

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  email,
                  displayName:
                    "Forbidden User",
                  password:
                    "StrongPassword123!",
                  role: "STAFF"
                })
              }
            );

          expect(
            response.status
          ).toBe(403);

          const createdUser =
            await prisma.merchantUser.findUnique({
              where: {
                email
              }
            });

          expect(
            createdUser
          ).toBeNull();
        }
      );

      it(
        "forbids STAFF from creating merchant users",
        async () => {
          const fixture =
            await createFixture(
              "staff-create",
              MerchantUserRole.STAFF
            );

          const email =
            "forbidden-staff-create@example.test";

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  email,
                  displayName:
                    "Forbidden User",
                  password:
                    "StrongPassword123!",
                  role: "STAFF"
                })
              }
            );

          expect(
            response.status
          ).toBe(403);

          const createdUser =
            await prisma.merchantUser.findUnique({
              where: {
                email
              }
            });

          expect(
            createdUser
          ).toBeNull();
        }
      );

      it(
        "rejects creation of another OWNER",
        async () => {
          const fixture =
            await createFixture(
              "owner-create-owner"
            );

          const email =
            "forbidden-owner@example.test";

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  email,
                  displayName:
                    "Second Owner",
                  password:
                    "StrongPassword123!",
                  role: "OWNER"
                })
              }
            );

          expect(
            response.status
          ).toBe(400);

          const createdUser =
            await prisma.merchantUser.findUnique({
              where: {
                email
              }
            });

          expect(
            createdUser
          ).toBeNull();
        }
      );

      it(
        "rejects duplicate merchant user email",
        async () => {
          const fixture =
            await createFixture(
              "duplicate-email"
            );

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  email:
                    fixture.user.email,
                  displayName:
                    "Duplicate User",
                  password:
                    "StrongPassword123!",
                  role: "STAFF"
                })
              }
            );

          expect(
            response.status
          ).toBe(409);

          const count =
            await prisma.merchantUser.count({
              where: {
                email:
                  fixture.user.email
              }
            });

          expect(count).toBe(1);
        }
      );

      it(
        "rejects a password shorter than eight characters",
        async () => {
          const fixture =
            await createFixture(
              "weak-password"
            );

          const email =
            "weak-password@example.test";

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  email,
                  displayName:
                    "Weak Password User",
                  password: "short",
                  role: "STAFF"
                })
              }
            );

          expect(
            response.status
          ).toBe(400);

          const createdUser =
            await prisma.merchantUser.findUnique({
              where: {
                email
              }
            });

          expect(
            createdUser
          ).toBeNull();
        }
      );

      it(
        "allows OWNER to change an employee role and invalidates the employee's old token",
        async () => {
          const owner =
            await createFixture(
              "role-change-owner"
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  owner.merchant.id,
                email:
                  "role-change-employee@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Role Change Employee",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const oldEmployeeToken =
            createAuthToken({
              id: employee.id,
              merchantId:
                owner.merchant.id,
              role: employee.role,
              tokenVersion:
                employee.tokenVersion
            });

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${employee.id}`,
              {
                method: "PATCH",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  role: "ADMIN"
                })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json() as {
              user: {
                id: string;
                merchantId: string;
                email: string;
                displayName: string | null;
                role: string;
                passwordHash?: string;
                tokenVersion?: number;
              };
            };

          expect(
            body.user.id
          ).toBe(employee.id);

          expect(
            body.user.role
          ).toBe("ADMIN");

          expect(
            body.user
          ).not.toHaveProperty(
            "passwordHash"
          );

          expect(
            body.user
          ).not.toHaveProperty(
            "tokenVersion"
          );

          const updatedEmployee =
            await prisma.merchantUser.findUnique({
              where: {
                id: employee.id
              }
            });

          expect(
            updatedEmployee?.role
          ).toBe(
            MerchantUserRole.ADMIN
          );

          expect(
            updatedEmployee?.tokenVersion
          ).toBe(
            employee.tokenVersion + 1
          );

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  owner.merchant.id,
                action:
                  "MERCHANT_USER_UPDATED",
                entityType:
                  "MERCHANT_USER",
                entityId:
                  employee.id
              }
            });

          expect(
            audit
          ).not.toBeNull();

          expect(
            audit?.actorUserId
          ).toBe(owner.user.id);

          expect(
            audit?.metadata
          ).toEqual({
            changedFields: [
              "role"
            ]
          });

          const staleTokenResponse =
            await listUsers(
              owner.merchant.id,
              oldEmployeeToken
            );

          expect(
            staleTokenResponse.status
          ).toBe(401);

          const staleTokenBody =
            await staleTokenResponse.json() as {
              error?: string;
            };

          expect(
            staleTokenBody.error
          ).toBe(
            "Authentication token is no longer valid"
          );
        }
      );

      it(
        "allows OWNER to reset an employee password and invalidates the employee's old token",
        async () => {
          const owner =
            await createFixture(
              "password-reset-owner"
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  owner.merchant.id,
                email:
                  "password-reset-employee@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Password Reset Employee",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const oldEmployeeToken =
            createAuthToken({
              id: employee.id,
              merchantId:
                owner.merchant.id,
              role: employee.role,
              tokenVersion:
                employee.tokenVersion
            });

          const newPassword =
            "NewStrongPassword123!";

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${employee.id}`,
              {
                method: "PATCH",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  password:
                    newPassword
                })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const updatedEmployee =
            await prisma.merchantUser.findUnique({
              where: {
                id: employee.id
              }
            });

          expect(
            updatedEmployee
          ).not.toBeNull();

          expect(
            updatedEmployee?.tokenVersion
          ).toBe(
            employee.tokenVersion + 1
          );

          expect(
            updatedEmployee?.passwordHash
          ).not.toBe(
            employee.passwordHash
          );

          expect(
            updatedEmployee?.passwordHash
          ).not.toBe(newPassword);

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  owner.merchant.id,
                action:
                  "MERCHANT_USER_UPDATED",
                entityType:
                  "MERCHANT_USER",
                entityId:
                  employee.id
              }
            });

          expect(
            audit
          ).not.toBeNull();

          expect(
            audit?.actorUserId
          ).toBe(owner.user.id);

          expect(
            audit?.metadata
          ).toEqual({
            changedFields: [
              "password"
            ]
          });

          const serializedMetadata =
            JSON.stringify(
              audit?.metadata
            );

          expect(
            serializedMetadata
          ).not.toContain(
            newPassword
          );

          expect(
            serializedMetadata
          ).not.toContain(
            updatedEmployee?.passwordHash
          );

          const staleTokenResponse =
            await listUsers(
              owner.merchant.id,
              oldEmployeeToken
            );

          expect(
            staleTokenResponse.status
          ).toBe(401);

          const staleTokenBody =
            await staleTokenResponse.json() as {
              error?: string;
            };

          expect(
            staleTokenBody.error
          ).toBe(
            "Authentication token is no longer valid"
          );
        }
      );

      it(
        "prevents modification of the OWNER account",
        async () => {
          const fixture =
            await createFixture(
              "protect-owner-update"
            );

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users/${fixture.user.id}`,
              {
                method: "PATCH",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  displayName:
                    "Modified Owner",
                  role: "ADMIN"
                })
              }
            );

          expect(
            response.status
          ).toBe(403);

          const ownerAfter =
            await prisma.merchantUser.findUnique({
              where: {
                id: fixture.user.id
              }
            });

          expect(
            ownerAfter?.displayName
          ).toBe(
            fixture.user.displayName
          );

          expect(
            ownerAfter?.role
          ).toBe(
            MerchantUserRole.OWNER
          );

          expect(
            ownerAfter?.tokenVersion
          ).toBe(
            fixture.user.tokenVersion
          );

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "MERCHANT_USER_UPDATED",
                entityId:
                  fixture.user.id
              }
            });

          expect(
            auditCount
          ).toBe(0);
        }
      );

      it(
        "rejects promotion of an employee to OWNER",
        async () => {
          const owner =
            await createFixture(
              "reject-owner-promotion"
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  owner.merchant.id,
                email:
                  "owner-promotion-employee@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Promotion Employee",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${employee.id}`,
              {
                method: "PATCH",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  role: "OWNER"
                })
              }
            );

          expect(
            response.status
          ).toBe(400);

          const employeeAfter =
            await prisma.merchantUser.findUnique({
              where: {
                id: employee.id
              }
            });

          expect(
            employeeAfter?.role
          ).toBe(
            MerchantUserRole.STAFF
          );

          expect(
            employeeAfter?.tokenVersion
          ).toBe(0);

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  owner.merchant.id,
                action:
                  "MERCHANT_USER_UPDATED",
                entityId:
                  employee.id
              }
            });

          expect(
            auditCount
          ).toBe(0);
        }
      );

      it(
        "allows OWNER to delete an employee and preserves the deletion audit",
        async () => {
          const owner =
            await createFixture(
              "delete-employee-owner"
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  owner.merchant.id,
                email:
                  "delete-employee@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Delete Employee",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${employee.id}`,
              {
                method: "DELETE",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(204);

          const deletedEmployee =
            await prisma.merchantUser.findUnique({
              where: {
                id: employee.id
              }
            });

          expect(
            deletedEmployee
          ).toBeNull();

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  owner.merchant.id,
                action:
                  "MERCHANT_USER_DELETED",
                entityType:
                  "MERCHANT_USER",
                entityId:
                  employee.id
              }
            });

          expect(
            audit
          ).not.toBeNull();

          expect(
            audit?.actorUserId
          ).toBe(owner.user.id);

          expect(
            audit?.metadata
          ).toEqual({
            role: "STAFF"
          });

          const serializedMetadata =
            JSON.stringify(
              audit?.metadata
            );

          expect(
            serializedMetadata
          ).not.toContain(
            employee.email
          );

          expect(
            serializedMetadata
          ).not.toContain(
            employee.passwordHash
          );
        }
      );

      it(
        "prevents OWNER from deleting a user belonging to another merchant",
        async () => {
          const owner =
            await createFixture(
              "cross-delete-owner"
            );

          const other =
            await createFixture(
              "cross-delete-target"
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  other.merchant.id,
                email:
                  "cross-delete-employee@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Cross Delete Employee",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${employee.id}`,
              {
                method: "DELETE",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(404);

          const employeeAfter =
            await prisma.merchantUser.findUnique({
              where: {
                id: employee.id
              }
            });

          expect(
            employeeAfter
          ).not.toBeNull();

          expect(
            employeeAfter?.merchantId
          ).toBe(
            other.merchant.id
          );

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  owner.merchant.id,
                action:
                  "MERCHANT_USER_DELETED",
                entityId:
                  employee.id
              }
            });

          expect(
            auditCount
          ).toBe(0);
        }
      );

      it(
        "prevents deletion of the OWNER account",
        async () => {
          const fixture =
            await createFixture(
              "protect-owner-delete"
            );

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${fixture.merchant.id}/users/${fixture.user.id}`,
              {
                method: "DELETE",
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(403);

          const ownerAfter =
            await prisma.merchantUser.findUnique({
              where: {
                id: fixture.user.id
              }
            });

          expect(
            ownerAfter
          ).not.toBeNull();

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "MERCHANT_USER_DELETED",
                entityId:
                  fixture.user.id
              }
            });

          expect(
            auditCount
          ).toBe(0);
        }
      );

      it(
        "forbids ADMIN from deleting merchant users",
        async () => {
          const admin =
            await createFixture(
              "admin-delete",
              MerchantUserRole.ADMIN
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  admin.merchant.id,
                email:
                  "admin-delete-target@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Admin Delete Target",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${admin.merchant.id}/users/${employee.id}`,
              {
                method: "DELETE",
                headers: {
                  authorization:
                    `Bearer ${admin.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(403);

          const employeeAfter =
            await prisma.merchantUser.findUnique({
              where: {
                id: employee.id
              }
            });

          expect(
            employeeAfter
          ).not.toBeNull();
        }
      );

      it(
        "forbids STAFF from deleting merchant users",
        async () => {
          const staff =
            await createFixture(
              "staff-delete",
              MerchantUserRole.STAFF
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  staff.merchant.id,
                email:
                  "staff-delete-target@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Staff Delete Target",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${staff.merchant.id}/users/${employee.id}`,
              {
                method: "DELETE",
                headers: {
                  authorization:
                    `Bearer ${staff.token}`
                }
              }
            );

          expect(
            response.status
          ).toBe(403);

          const employeeAfter =
            await prisma.merchantUser.findUnique({
              where: {
                id: employee.id
              }
            });

          expect(
            employeeAfter
          ).not.toBeNull();
        }
      );

      it(
        "prevents OWNER from updating a user belonging to another merchant",
        async () => {
          const owner =
            await createFixture(
              "cross-update-owner"
            );

          const other =
            await createFixture(
              "cross-update-other"
            );

          const originalName =
            other.user.displayName;

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${other.user.id}`,
              {
                method: "PATCH",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  displayName:
                    "Cross Merchant Modified"
                })
              }
            );

          expect(
            response.status
          ).toBe(404);

          const userAfter =
            await prisma.merchantUser.findUnique({
              where: {
                id: other.user.id
              }
            });

          expect(
            userAfter?.displayName
          ).toBe(originalName);

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  owner.merchant.id,
                action:
                  "MERCHANT_USER_UPDATED",
                entityId:
                  other.user.id
              }
            });

          expect(
            auditCount
          ).toBe(0);
        }
      );

      it(
        "does not audit unchanged display name and role values",
        async () => {
          const owner =
            await createFixture(
              "noop-update-owner"
            );

          const employee =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  owner.merchant.id,
                email:
                  "noop-update-employee@example.test",
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Noop Employee",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion: 0
              }
            });

          const response =
            await fetch(
              `${API_BASE_URL}/merchants/${owner.merchant.id}/users/${employee.id}`,
              {
                method: "PATCH",
                headers: {
                  authorization:
                    `Bearer ${owner.token}`,
                  "content-type":
                    "application/json"
                },
                body: JSON.stringify({
                  displayName:
                    employee.displayName,
                  role: "STAFF"
                })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const auditCount =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  owner.merchant.id,
                action:
                  "MERCHANT_USER_UPDATED",
                entityType:
                  "MERCHANT_USER",
                entityId:
                  employee.id
              }
            });

          expect(
            auditCount
          ).toBe(0);
        }
      );

    }
  );
