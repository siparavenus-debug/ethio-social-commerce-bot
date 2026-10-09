import {
    prisma
} from "@ethio-commerce/database";

import express from "express";

import type {
    Server
} from "node:http";

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

import platformAdminRouter
    from "../src/routes/platform-admin.js";

import {
    authenticatePlatformUser,
    createPlatformAuthToken
} from "../src/services/platform-auth.js";

import {
    hashPassword
  } from "../src/services/auth.js";

import platformUsersRouter
    from "../src/routes/platform-users.js";

const testPrefix =
    "platform-users-route";

let server:
    Server | undefined;

let apiBaseUrl = "";

async function cleanup(): Promise<void> {
    await prisma.platformAuditLog.deleteMany({
        where: {
            actor: {
                email: {
                    startsWith:
                        `${testPrefix}-`
                }
            }
        }
    });

    await prisma.platformUser.deleteMany({
        where: {
            email: {
                startsWith:
                    `${testPrefix}-`
            }
        }
    });
}

async function createPlatformFixture(
    suffix: string,
    role:
        "OWNER" |
        "ADMIN" |
        "STAFF"
) {
    const user =
        await prisma.platformUser.create({
            data: {
                email:
                    `${testPrefix}-${suffix}@example.test`,
                passwordHash:
                    "test-password-hash",
                displayName:
                    `Platform Users ${suffix}`,
                role,
                tokenVersion: 0
            }
        });

    const token =
        createPlatformAuthToken({
            id: user.id,
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

        app.use(
            "/platform/users",
            platformUsersRouter
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

        await prisma.$disconnect();
    }
);

describe(
    "platform user routes",
    () => {
        it(
            "denies ADMIN access to platform user management",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "admin-denied",
                        "ADMIN"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users`,
                        {
                            method: "GET",
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(403);

                await expect(
                    response.json()
                ).resolves.toEqual({
                    error:
                        "You do not have permission to perform this platform action"
                });
            }
        );

        it(
            "denies ADMIN permission to reset operator passwords",
            async () => {
              const admin =
                await createPlatformFixture(
                  "admin-password-reset-denied",
                  "ADMIN"
                );

              const operator =
                await createPlatformFixture(
                  "admin-reset-target",
                  "STAFF"
                );

              const response =
                await fetch(
                  `${apiBaseUrl}/platform/users/${operator.user.id}/password`,
                  {
                    method: "PATCH",
                    headers: {
                      authorization:
                        `Bearer ${admin.token}`,
                      "content-type":
                        "application/json"
                    },
                    body: JSON.stringify({
                      newPassword:
                        "UnauthorizedReset123!"
                    })
                  }
                );

              expect(
                response.status
              ).toBe(403);

              await expect(
                response.json()
              ).resolves.toEqual({
                error:
                  "You do not have permission to perform this platform action"
              });

              const unchangedOperator =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: operator.user.id
                  }
                });

              expect(
                unchangedOperator.passwordHash
              ).toBe(
                operator.user.passwordHash
              );

              expect(
                unchangedOperator.tokenVersion
              ).toBe(
                operator.user.tokenVersion
              );

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      admin.user.id,
                    action:
                      "PLATFORM_USER_PASSWORD_RESET",
                    entityId:
                      operator.user.id
                  }
                });

              expect(audit).toBeNull();
            }
          );

        it(
            "allows OWNER to list platform users",
            async () => {
                const {
                    user,
                    token
                } =
                    await createPlatformFixture(
                        "owner-list",
                        "OWNER"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users`,
                        {
                            method: "GET",
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
                    body.users
                ).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            id: user.id,
                            email: user.email,
                            displayName:
                                user.displayName,
                            role: "OWNER"
                        })
                    ])
                );
            }
        );

        it(
            "rejects creating another OWNER through ordinary platform user management",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "create-owner-denied",
                        "OWNER"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    email:
                                        `${testPrefix}-second-owner@example.test`,
                                    displayName:
                                        "Second Owner",
                                    password:
                                        "StrongPassword123!",
                                    role:
                                        "OWNER"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(400);

                await expect(
                    response.json()
                ).resolves.toEqual({
                    error:
                        "New platform users may only have ADMIN or STAFF roles"
                });

                const createdUser =
                    await prisma.platformUser.findUnique({
                        where: {
                            email:
                                `${testPrefix}-second-owner@example.test`
                        }
                    });

                expect(
                    createdUser
                ).toBeNull();
            }
        );

        it(
            "allows OWNER to create an ADMIN platform user",
            async () => {
                const {
                    user: owner,
                    token
                } =
                    await createPlatformFixture(
                        "create-admin-owner",
                        "OWNER"
                    );

                const email =
                    `${testPrefix}-created-admin@example.test`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    email,
                                    displayName:
                                        "Created Admin",
                                    password:
                                        "StrongPassword123!",
                                    role:
                                        "ADMIN"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(201);

                const body =
                    await response.json();

                expect(
                    body.user
                ).toEqual(
                    expect.objectContaining({
                        email,
                        displayName:
                            "Created Admin",
                        role:
                            "ADMIN"
                    })
                );

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
                    await prisma.platformUser.findUniqueOrThrow({
                        where: {
                            email
                        }
                    });

                expect(
                    createdUser.passwordHash
                ).not.toBe(
                    "StrongPassword123!"
                );

                const audit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                owner.id,
                            action:
                                "PLATFORM_USER_CREATED",
                            entityType:
                                "PLATFORM_USER",
                            entityId:
                                createdUser.id
                        }
                    });

                expect(
                    audit
                ).not.toBeNull();
            }
        );

        it(
            "allows OWNER to create a STAFF platform user",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "create-staff-owner",
                        "OWNER"
                    );

                const email =
                    `${testPrefix}-created-staff@example.test`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    email,
                                    displayName:
                                        "Created Staff",
                                    password:
                                        "StrongPassword123!",
                                    role:
                                        "STAFF"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(201);

                await expect(
                    response.json()
                ).resolves.toEqual({
                    user:
                        expect.objectContaining({
                            email,
                            displayName:
                                "Created Staff",
                            role:
                                "STAFF"
                        })
                });

                const createdUser =
                    await prisma.platformUser.findUniqueOrThrow({
                        where: {
                            email
                        }
                    });

                expect(
                    createdUser.role
                ).toBe("STAFF");
            }
        );

        it(
          "returns 409 when operator creation encounters a database email conflict",
          async () => {
            const owner =
              await createPlatformFixture(
                "duplicate-conflict-owner",
                "OWNER"
              );

            const email =
              `${testPrefix}-duplicate-conflict@example.test`;

              const originalTransaction =
              prisma.$transaction.bind(prisma);

            let injected = false;

            const transactionSpy =
              vi.spyOn(
                prisma,
                "$transaction"
              ).mockImplementation(
                (async (callback: any, options?: any) => {
                  if (!injected) {
                    injected = true;

                    await prisma.platformUser.create({
                      data: {
                        email,
                        passwordHash:
                          "competing-password-hash",
                        role: "STAFF"
                      }
                    });
                  }

                  return originalTransaction(
                    callback,
                    options
                  );
                }) as typeof prisma.$transaction
              );

            let response: Response;

            try {
              response = await fetch(
                `${apiBaseUrl}/platform/users`,
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
                    password:
                      "StrongPassword123!",
                    role: "ADMIN"
                  })
                }
              );
            } finally {
              transactionSpy.mockRestore();
            }

            expect(injected).toBe(true);
            expect(response.status).toBe(409);

            await expect(
              response.json()
            ).resolves.toEqual({
              error:
                "An account with that email already exists"
            });

            const users =
              await prisma.platformUser.findMany({
                where: { email }
              });

            expect(users).toHaveLength(1);
            expect(users[0]?.role).toBe("STAFF");

            const audit =
              await prisma.platformAuditLog.findFirst({
                where: {
                  actorPlatformUserId:
                    owner.user.id,
                  action:
                    "PLATFORM_USER_CREATED",
                  entityId:
                    users[0]!.id
                }
              });

            expect(audit).toBeNull();
          }
        );

        it(
            "rejects modifying an OWNER through ordinary platform user management",
            async () => {
                const {
                    user,
                    token
                } =
                    await createPlatformFixture(
                        "owner-modification-denied",
                        "OWNER"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users/${user.id}`,
                        {
                            method: "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    displayName:
                                        "Modified Owner"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(403);

                await expect(
                    response.json()
                ).resolves.toEqual({
                    error:
                        "The platform OWNER account cannot be modified here"
                });

                const unchangedUser =
                    await prisma.platformUser.findUniqueOrThrow({
                        where: {
                            id: user.id
                        }
                    });

                expect(
                    unchangedUser.displayName
                ).toBe(
                    user.displayName
                );

                expect(
                    unchangedUser.role
                ).toBe("OWNER");
            }
        );

        it(
            "rejects resetting the protected OWNER password",
            async () => {
              const owner =
                await createPlatformFixture(
                  "owner-password-reset-denied",
                  "OWNER"
                );

              const response =
                await fetch(
                  `${apiBaseUrl}/platform/users/${owner.user.id}/password`,
                  {
                    method: "PATCH",
                    headers: {
                      authorization:
                        `Bearer ${owner.token}`,
                      "content-type":
                        "application/json"
                    },
                    body: JSON.stringify({
                      newPassword:
                        "ForbiddenReset123!"
                    })
                  }
                );

              expect(
                response.status
              ).toBe(403);

              await expect(
                response.json()
              ).resolves.toEqual({
                error:
                  "The platform OWNER account cannot be modified here"
              });

              const unchangedOwner =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: owner.user.id
                  }
                });

              expect(
                unchangedOwner.passwordHash
              ).toBe(
                owner.user.passwordHash
              );

              expect(
                unchangedOwner.tokenVersion
              ).toBe(
                owner.user.tokenVersion
              );

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      owner.user.id,
                    action:
                      "PLATFORM_USER_PASSWORD_RESET",
                    entityId:
                      owner.user.id
                  }
                });

              expect(audit).toBeNull();
            }
          );

          it(
            "rejects promoting an operator to OWNER",
            async () => {
              const owner =
                await createPlatformFixture(
                  "owner-promotion-denied",
                  "OWNER"
                );

              const operator =
                await createPlatformFixture(
                  "promotion-target",
                  "STAFF"
                );

              const response =
                await fetch(
                  `${apiBaseUrl}/platform/users/${operator.user.id}`,
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

              expect(response.status).toBe(400);

              await expect(
                response.json()
              ).resolves.toEqual({
                error:
                  "Platform user role may only be ADMIN or STAFF"
              });

              const unchangedOperator =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: operator.user.id
                  }
                });

              expect(
                unchangedOperator.role
              ).toBe("STAFF");

              expect(
                unchangedOperator.tokenVersion
              ).toBe(
                operator.user.tokenVersion
              );

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      owner.user.id,
                    action:
                      "PLATFORM_USER_UPDATED",
                    entityId:
                      operator.user.id
                  }
                });

              expect(audit).toBeNull();
            }
          );

          it(
            "does not invalidate sessions when an operator role is unchanged",
            async () => {
              const owner =
                await createPlatformFixture(
                  "unchanged-role-owner",
                  "OWNER"
                );

              const operator =
                await createPlatformFixture(
                  "unchanged-role-operator",
                  "STAFF"
                );

              const response =
                await fetch(
                  `${apiBaseUrl}/platform/users/${operator.user.id}`,
                  {
                    method: "PATCH",
                    headers: {
                      authorization:
                        `Bearer ${owner.token}`,
                      "content-type":
                        "application/json"
                    },
                    body: JSON.stringify({
                      role: "STAFF"
                    })
                  }
                );

              expect(response.status).toBe(200);

              const body = await response.json();

              expect(body.user).toEqual(
                expect.objectContaining({
                  id: operator.user.id,
                  role: "STAFF"
                })
              );

              const unchangedOperator =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: operator.user.id
                  }
                });

              expect(unchangedOperator.role).toBe("STAFF");

              expect(
                unchangedOperator.tokenVersion
              ).toBe(operator.user.tokenVersion);

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      owner.user.id,
                    action: "PLATFORM_USER_UPDATED",
                    entityId: operator.user.id
                  }
                });

              expect(audit).toBeNull();

              const existingTokenResponse =
                await fetch(
                  `${apiBaseUrl}/platform/merchants`,
                  {
                    headers: {
                      authorization:
                        `Bearer ${operator.token}`
                    }
                  }
                );

              expect(
                existingTokenResponse.status
              ).toBe(200);
            }
          );

          it(
            "rejects a stale unchanged-role request",
            async () => {
              const owner =
                await createPlatformFixture(
                  "stale-noop-owner",
                  "OWNER"
                );

              const operator =
                await createPlatformFixture(
                  "stale-noop-operator",
                  "STAFF"
                );

              const originalFindUnique =
                prisma.platformUser.findUnique;

              let injected = false;

              const readSpy =
                vi.spyOn(
                  prisma.platformUser,
                  "findUnique"
                ).mockImplementation(
                  async (...args) => {
                    const result =
                      await originalFindUnique.apply(
                        prisma.platformUser,
                        args
                      );

                    if (
                      !injected &&
                      result?.id === operator.user.id
                    ) {
                      injected = true;

                      await prisma.platformUser.update({
                        where: {
                          id: operator.user.id
                        },
                        data: {
                          tokenVersion: {
                            increment: 1
                          }
                        }
                      });
                    }

                    return result;
                  }
                );

              let response: Response;

              try {
                response =
                  await fetch(
                    `${apiBaseUrl}/platform/users/${operator.user.id}`,
                    {
                      method: "PATCH",
                      headers: {
                        authorization:
                          `Bearer ${owner.token}`,
                        "content-type":
                          "application/json"
                      },
                      body: JSON.stringify({
                        role: "STAFF"
                      })
                    }
                  );
              } finally {
                readSpy.mockRestore();
              }

              expect(injected).toBe(true);

              expect(response.status).toBe(409);

              await expect(
                response.json()
              ).resolves.toEqual({
                error:
                  "Platform user changed concurrently"
              });

              const unchangedOperator =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: operator.user.id
                  }
                });

              expect(
                unchangedOperator.role
              ).toBe("STAFF");

              expect(
                unchangedOperator.tokenVersion
              ).toBe(
                operator.user.tokenVersion + 1
              );

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      owner.user.id,
                    action:
                      "PLATFORM_USER_UPDATED",
                    entityId:
                      operator.user.id
                  }
                });

              expect(audit).toBeNull();
            }
          );

          it(
            "rejects a stale role update without overwriting concurrent changes",
            async () => {
              const owner =
                await createPlatformFixture(
                  "stale-role-owner",
                  "OWNER"
                );

              const operator =
                await createPlatformFixture(
                  "stale-role-operator",
                  "STAFF"
                );

              const originalFindUnique =
                prisma.platformUser.findUnique;

              let injected = false;

              const readSpy =
                vi.spyOn(
                  prisma.platformUser,
                  "findUnique"
                ).mockImplementation(
                  async (...args) => {
                    const result =
                      await originalFindUnique.apply(
                        prisma.platformUser,
                        args
                      );

                    if (
                      !injected &&
                      result?.id === operator.user.id
                    ) {
                      injected = true;

                      await prisma.platformUser.update({
                        where: {
                          id: operator.user.id
                        },
                        data: {
                          tokenVersion: {
                            increment: 1
                          }
                        }
                      });
                    }

                    return result;
                  }
                );

              let response: Response;

              try {
                response =
                  await fetch(
                    `${apiBaseUrl}/platform/users/${operator.user.id}`,
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
              } finally {
                readSpy.mockRestore();
              }

              expect(injected).toBe(true);

              expect(response.status).toBe(409);

              const unchangedOperator =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: operator.user.id
                  }
                });

              expect(
                unchangedOperator.role
              ).toBe("STAFF");

              expect(
                unchangedOperator.tokenVersion
              ).toBe(
                operator.user.tokenVersion + 1
              );

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      owner.user.id,
                    action:
                      "PLATFORM_USER_UPDATED",
                    entityId:
                      operator.user.id
                  }
                });

              expect(audit).toBeNull();
            }
          );

        it(
            "allows OWNER to change an operator role and invalidates the operator's old token",
            async () => {
                const owner =
                    await createPlatformFixture(
                        "role-change-owner",
                        "OWNER"
                    );

                const operator =
                    await createPlatformFixture(
                        "role-change-operator",
                        "STAFF"
                    );

                const oldOperatorToken =
                    createPlatformAuthToken({
                        id:
                            operator.user.id,
                        tokenVersion:
                            operator.user.tokenVersion
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users/${operator.user.id}`,
                        {
                            method: "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${owner.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    role:
                                        "ADMIN"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json();

                expect(
                    body.user
                ).toEqual(
                    expect.objectContaining({
                        id:
                            operator.user.id,
                        role:
                            "ADMIN"
                    })
                );

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

                const updatedOperator =
                    await prisma.platformUser.findUniqueOrThrow({
                        where: {
                            id:
                                operator.user.id
                        }
                    });

                expect(
                    updatedOperator.role
                ).toBe("ADMIN");

                expect(
                    updatedOperator.tokenVersion
                ).toBe(
                    operator.user.tokenVersion + 1
                );

                const audit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                owner.user.id,
                            action:
                                "PLATFORM_USER_UPDATED",
                            entityType:
                                "PLATFORM_USER",
                            entityId:
                                operator.user.id
                        }
                    });

                expect(
                    audit
                ).not.toBeNull();

                const oldTokenResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/users`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${oldOperatorToken}`
                            }
                        }
                    );

                expect(
                    oldTokenResponse.status
                ).toBe(401);
            }
        );

        it(
            "rejects a short operator password without changing credentials or sessions",
            async () => {
              const owner =
                await createPlatformFixture(
                  "short-password-owner",
                  "OWNER"
                );

              const operator =
                await createPlatformFixture(
                  "short-password-operator",
                  "STAFF"
                );

              const response =
                await fetch(
                  `${apiBaseUrl}/platform/users/${operator.user.id}/password`,
                  {
                    method: "PATCH",
                    headers: {
                      authorization:
                        `Bearer ${owner.token}`,
                      "content-type":
                        "application/json"
                    },
                    body: JSON.stringify({
                      newPassword: "short"
                    })
                  }
                );

              expect(
                response.status
              ).toBe(400);

              await expect(
                response.json()
              ).resolves.toEqual({
                error:
                  "New password must be at least 8 characters"
              });

              const unchangedOperator =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: operator.user.id
                  }
                });

              expect(
                unchangedOperator.passwordHash
              ).toBe(
                operator.user.passwordHash
              );

              expect(
                unchangedOperator.tokenVersion
              ).toBe(
                operator.user.tokenVersion
              );

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      owner.user.id,
                    action:
                      "PLATFORM_USER_PASSWORD_RESET",
                    entityId:
                      operator.user.id
                  }
                });

              expect(audit).toBeNull();
            }
          );

          it(
            "returns 409 when an operator changes during password reset",
            async () => {
              const owner =
                await createPlatformFixture(
                  "stale-password-owner",
                  "OWNER"
                );

              const operator =
                await createPlatformFixture(
                  "stale-password-operator",
                  "STAFF"
                );

              const originalTransaction =
                prisma.$transaction.bind(prisma);

              let injected = false;

              const transactionSpy =
                vi.spyOn(
                  prisma,
                  "$transaction"
                ).mockImplementation(
                  (async (callback: any, options?: any) => {
                    if (!injected) {
                      injected = true;

                      await prisma.platformUser.update({
                        where: {
                          id: operator.user.id
                        },
                        data: {
                          role: "ADMIN",
                          tokenVersion: {
                            increment: 1
                          }
                        }
                      });
                    }

                    return originalTransaction(
                      callback,
                      options
                    );
                  }) as typeof prisma.$transaction
                );

              let response: Response;

              try {
                response = await fetch(
                  `${apiBaseUrl}/platform/users/${operator.user.id}/password`,
                  {
                    method: "PATCH",
                    headers: {
                      authorization:
                        `Bearer ${owner.token}`,
                      "content-type":
                        "application/json"
                    },
                    body: JSON.stringify({
                      newPassword:
                        "NewPassword123!"
                    })
                  }
                );
              } finally {
                transactionSpy.mockRestore();
              }

              expect(injected).toBe(true);
              expect(response.status).toBe(409);

              await expect(
                response.json()
              ).resolves.toEqual({
                error:
                  "Platform user changed concurrently"
              });

              const unchangedOperator =
                await prisma.platformUser.findUniqueOrThrow({
                  where: {
                    id: operator.user.id
                  }
                });

              expect(unchangedOperator.role).toBe("ADMIN");

              expect(
                unchangedOperator.passwordHash
              ).toBe(operator.user.passwordHash);

              expect(
                unchangedOperator.tokenVersion
              ).toBe(
                operator.user.tokenVersion + 1
              );

              const audit =
                await prisma.platformAuditLog.findFirst({
                  where: {
                    actorPlatformUserId:
                      owner.user.id,
                    action:
                      "PLATFORM_USER_PASSWORD_RESET",
                    entityId:
                      operator.user.id
                  }
                });

              expect(audit).toBeNull();
            }
          );

        it(
            "allows OWNER to reset an operator password and invalidates existing sessions",
            async () => {
                const owner =
                    await createPlatformFixture(
                        "password-reset-owner",
                        "OWNER"
                    );

                const operator =
                    await createPlatformFixture(
                      "password-reset-operator",
                      "STAFF"
                    );

                const oldPassword =
                    "OriginalPassword123!";

                const originalPasswordHash =
                    await hashPassword(oldPassword);

                await prisma.platformUser.update({
                    where: {
                        id: operator.user.id
                    },
                    data: {
                        passwordHash: originalPasswordHash
                    }
                });

                const newPassword =
                    "ResetPassword456!";

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/users/${operator.user.id}/password`,
                        {
                            method: "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${owner.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    newPassword
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const updatedOperator =
                    await prisma.platformUser.findUniqueOrThrow({
                        where: {
                            id: operator.user.id
                        }
                    });

                expect(
                    updatedOperator.passwordHash
                ).not.toBe(
                    operator.user.passwordHash
                );

                expect(
                    updatedOperator.passwordHash
                ).not.toBe(
                    newPassword
                );

                expect(
                    updatedOperator.tokenVersion
                ).toBe(
                    operator.user.tokenVersion + 1
                );

                const authenticatedWithNewPassword =
                    await authenticatePlatformUser(
                        operator.user.email,
                        newPassword
                    );

                expect(
                    authenticatedWithNewPassword
                ).not.toBeNull();

                expect(
                    authenticatedWithNewPassword?.id
                ).toBe(
                    operator.user.id
                );

                const authenticatedWithOldPassword =
                    await authenticatePlatformUser(
                        operator.user.email,
                        oldPassword
                    );

                expect(
                    authenticatedWithOldPassword
                ).toBeNull();



                const audit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                owner.user.id,
                            action:
                                "PLATFORM_USER_PASSWORD_RESET",
                            entityType:
                                "PLATFORM_USER",
                            entityId:
                                operator.user.id
                        }
                    });

                expect(
                    audit
                ).not.toBeNull();

                const oldTokenResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/users`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${operator.token}`
                            }
                        }
                    );

                expect(
                    oldTokenResponse.status
                ).toBe(401);
            }
        );
    }
);
