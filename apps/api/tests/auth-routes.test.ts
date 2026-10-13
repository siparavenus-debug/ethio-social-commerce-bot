import {
  createHash,
  randomBytes
} from "node:crypto";

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

  import authRouter
    from "../src/routes/auth.js";

  import {
    authenticateUser,
    createAuthToken,
    hashPassword,
    verifyPassword
  } from "../src/services/auth.js";

  import {
    createPlatformAuthToken
  } from "../src/services/platform-auth.js";

  const testPrefix =
    "auth-routes";

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
              `${testPrefix}-`
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

    await prisma.auditLog.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchantOwnerActivation.deleteMany({
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
    const currentPassword =
      "CurrentPassword123!";

    const passwordHash =
      await hashPassword(
        currentPassword
      );

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
          passwordHash,
          displayName:
            `Auth Routes ${role}`,
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

    return {
      merchant,
      user,
      token,
      currentPassword,
      passwordHash
    };
  }

  async function changePassword(
    token: string | undefined,
    body: unknown
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
      `${apiBaseUrl}/auth/password`,
      {
        method:
          "PATCH",
        headers,
        body:
          JSON.stringify(body)
      }
    );
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
        "/auth",
        authRouter
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
    "merchant authentication routes",
    () => {
      for (
        const role of [
          MerchantUserRole.OWNER,
          MerchantUserRole.ADMIN,
          MerchantUserRole.STAFF
        ]
      ) {
        it(
          `allows ${role} to change their own password and invalidates existing sessions`,
          async () => {
            const fixture =
              await createFixture(
                `password-change-${role.toLowerCase()}`,
                role
              );

            const newPassword =
              "NewPassword456!";

            const secondOldToken =
              createAuthToken({
                id:
                  fixture.user.id,
                merchantId:
                  fixture.merchant.id,
                role:
                  fixture.user.role,
                tokenVersion:
                  fixture.user.tokenVersion
              });

            const response =
              await changePassword(
                fixture.token,
                {
                  currentPassword:
                    fixture.currentPassword,
                  newPassword
                }
              );

            expect(
              response.status
            ).toBe(200);

            const body =
              await response.json() as {
                message?: string;
                passwordHash?: string;
                tokenVersion?: number;
              };

            expect(
              body.message
            ).toBe(
              "Password changed successfully"
            );

            expect(
              body
            ).not.toHaveProperty(
              "passwordHash"
            );

            expect(
              body
            ).not.toHaveProperty(
              "tokenVersion"
            );

            const updatedUser =
              await prisma.merchantUser.findUniqueOrThrow({
                where: {
                  id:
                    fixture.user.id
                }
              });

            expect(
              updatedUser.passwordHash
            ).not.toBe(
              fixture.passwordHash
            );

            expect(
              updatedUser.passwordHash
            ).not.toBe(
              newPassword
            );

            expect(
              await verifyPassword(
                newPassword,
                updatedUser.passwordHash
              )
            ).toBe(true);

            expect(
              updatedUser.tokenVersion
            ).toBe(
              fixture.user.tokenVersion +
                1
            );

            const passwordChangeAudits =
              await prisma.auditLog.findMany({
                where: {
                  merchantId:
                    fixture.merchant.id,
                  actorUserId:
                    fixture.user.id,
                  action:
                    "MERCHANT_PASSWORD_CHANGED",
                  entityType:
                    "MERCHANT_USER",
                  entityId:
                    fixture.user.id
                }
              });

            expect(
              passwordChangeAudits
            ).toHaveLength(1);

            expect(
              await authenticateUser(
                fixture.user.email,
                fixture.currentPassword
              )
            ).toBeNull();

            expect(
              await authenticateUser(
                fixture.user.email,
                newPassword
              )
            ).not.toBeNull();

            for (
              const oldToken of [
                fixture.token,
                secondOldToken
              ]
            ) {
              const oldTokenResponse =
                await fetch(
                  `${apiBaseUrl}/auth/me`,
                  {
                    headers: {
                      authorization:
                        `Bearer ${oldToken}`
                    }
                  }
                );

              expect(
                oldTokenResponse.status
              ).toBe(401);
            }
          }
        );
      }

      it(
        "rejects an incorrect current password without changing credentials or invalidating sessions",
        async () => {
          const fixture =
            await createFixture(
              "wrong-current-password"
            );

          const response =
            await changePassword(
              fixture.token,
              {
                currentPassword:
                  "WrongPassword123!",
                newPassword:
                  "NewPassword456!"
              }
            );

          expect(
            response.status
          ).toBe(400);

          const unchangedUser =
            await prisma.merchantUser.findUniqueOrThrow({
              where: {
                id:
                  fixture.user.id
              }
            });

          expect(
            unchangedUser.passwordHash
          ).toBe(
            fixture.passwordHash
          );

          expect(
            unchangedUser.tokenVersion
          ).toBe(
            fixture.user.tokenVersion
          );

          expect(
            await authenticateUser(
              fixture.user.email,
              fixture.currentPassword
            )
          ).not.toBeNull();

          const existingTokenResponse =
            await fetch(
              `${apiBaseUrl}/auth/me`,
              {
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`
                }
              }
            );

          expect(
            existingTokenResponse.status
          ).toBe(200);
        }
      );

      it(
        "rejects a short new password without changing credentials or invalidating sessions",
        async () => {
          const fixture =
            await createFixture(
              "short-new-password"
            );

          const response =
            await changePassword(
              fixture.token,
              {
                currentPassword:
                  fixture.currentPassword,
                newPassword:
                  "short"
              }
            );

          expect(
            response.status
          ).toBe(400);

          const unchangedUser =
            await prisma.merchantUser.findUniqueOrThrow({
              where: {
                id:
                  fixture.user.id
              }
            });

          expect(
            unchangedUser.passwordHash
          ).toBe(
            fixture.passwordHash
          );

          expect(
            unchangedUser.tokenVersion
          ).toBe(
            fixture.user.tokenVersion
          );

          const existingTokenResponse =
            await fetch(
              `${apiBaseUrl}/auth/me`,
              {
                headers: {
                  authorization:
                    `Bearer ${fixture.token}`
                }
              }
            );

          expect(
            existingTokenResponse.status
          ).toBe(200);
        }
      );

      it(
        "rejects missing password fields without changing credentials",
        async () => {
          const fixture =
            await createFixture(
              "missing-password-fields"
            );

          for (
            const body of [
              {
                currentPassword:
                  fixture.currentPassword
              },
              {
                newPassword:
                  "NewPassword456!"
              }
            ]
          ) {
            const response =
              await changePassword(
                fixture.token,
                body
              );

            expect(
              response.status
            ).toBe(400);
          }

          const unchangedUser =
            await prisma.merchantUser.findUniqueOrThrow({
              where: {
                id:
                  fixture.user.id
              }
            });

          expect(
            unchangedUser.passwordHash
          ).toBe(
            fixture.passwordHash
          );

          expect(
            unchangedUser.tokenVersion
          ).toBe(
            fixture.user.tokenVersion
          );
        }
      );

      it(
        "changes only the authenticated user's password and ignores account selectors in the request body",
        async () => {
          const authenticated =
            await createFixture(
              "self-only-authenticated"
            );

          const other =
            await createFixture(
              "self-only-other"
            );

          const otherPasswordHash =
            other.passwordHash;

          const response =
            await changePassword(
              authenticated.token,
              {
                currentPassword:
                  authenticated.currentPassword,
                newPassword:
                  "AuthenticatedNewPassword456!",
                userId:
                  other.user.id,
                merchantId:
                  other.merchant.id,
                email:
                  other.user.email,
                role:
                  MerchantUserRole.OWNER
              }
            );

          expect(
            response.status
          ).toBe(200);

          const unchangedOther =
            await prisma.merchantUser.findUniqueOrThrow({
              where: {
                id:
                  other.user.id
              }
            });

          expect(
            unchangedOther.passwordHash
          ).toBe(
            otherPasswordHash
          );

          expect(
            unchangedOther.tokenVersion
          ).toBe(
            other.user.tokenVersion
          );

          expect(
            await authenticateUser(
              other.user.email,
              other.currentPassword
            )
          ).not.toBeNull();
        }
      );

      it(
        "rejects an unauthenticated password change",
        async () => {
          const response =
            await changePassword(
              undefined,
              {
                currentPassword:
                  "CurrentPassword123!",
                newPassword:
                  "NewPassword456!"
              }
            );

          expect(
            response.status
          ).toBe(401);
        }
      );

      it(
        "rejects platform authentication tokens from the merchant password endpoint",
        async () => {
          const platformToken =
            createPlatformAuthToken({
              id:
                "platform-user-test",
              tokenVersion:
                0
            });

          const response =
            await changePassword(
              platformToken,
              {
                currentPassword:
                  "CurrentPassword123!",
                newPassword:
                  "NewPassword456!"
              }
            );

          expect(
            response.status
          ).not.toBe(200);
        }
      );

      it(
        "activates a merchant owner using a valid invitation token",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name: `${testPrefix}-owner-activation`,
                currency: "ETB"
              }
            });

          const ownerEmail =
            `${testPrefix}-owner-activation@example.test`;

          const activationToken =
            randomBytes(32).toString("base64url");

          const tokenHash =
            createHash("sha256")
              .update(activationToken)
              .digest("hex");

          const invitation =
            await prisma.merchantOwnerActivation.create({
              data: {
                merchantId: merchant.id,
                ownerEmail,
                ownerDisplayName: "Activated Owner",
                tokenHash,
                expiresAt: new Date(
                  Date.now() + 60 * 60 * 1000
                )
              }
            });

          const password = "SecureOwnerPassword123!";

          const response = await fetch(
            `${apiBaseUrl}/auth/activate-owner`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                token: activationToken,
                password
              })
            }
          );

          expect(response.status).toBe(200);

          const owner =
            await prisma.merchantUser.findUniqueOrThrow({
              where: {
                email: ownerEmail
              }
            });

          expect(owner.merchantId).toBe(merchant.id);
          expect(owner.role).toBe(MerchantUserRole.OWNER);
          expect(owner.displayName).toBe("Activated Owner");

          expect(owner.passwordHash).not.toBe(password);

          expect(
            await verifyPassword(
              password,
              owner.passwordHash
            )
          ).toBe(true);

          const updatedInvitation =
            await prisma.merchantOwnerActivation.findUniqueOrThrow({
              where: {
                id: invitation.id
              }
            });

          expect(updatedInvitation.consumedAt).not.toBeNull();

          const authenticated =
            await authenticateUser(ownerEmail, password);

          expect(authenticated).not.toBeNull();
          expect(authenticated?.id).toBe(owner.id);

          const body = await response.json();

          expect(body).not.toHaveProperty("password");
          expect(body).not.toHaveProperty("passwordHash");
          expect(body).not.toHaveProperty("token");
        }
      );

      it(
        "rejects an expired merchant owner activation invitation",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name: `${testPrefix}-expired-owner-activation`,
                currency: "ETB"
              }
            });

          const ownerEmail =
            `${testPrefix}-expired-owner@example.test`;

          const activationToken =
            randomBytes(32).toString("base64url");

          const invitation =
            await prisma.merchantOwnerActivation.create({
              data: {
                merchantId: merchant.id,
                ownerEmail,
                tokenHash: createHash("sha256")
                  .update(activationToken)
                  .digest("hex"),
                expiresAt: new Date(
                  Date.now() - 60 * 1000
                )
              }
            });

          const response = await fetch(
            `${apiBaseUrl}/auth/activate-owner`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                token: activationToken,
                password: "SecureOwnerPassword123!"
              })
            }
          );

          expect(response.status).toBe(400);

          const owner =
            await prisma.merchantUser.findUnique({
              where: { email: ownerEmail }
            });

          expect(owner).toBeNull();

          const storedInvitation =
            await prisma.merchantOwnerActivation.findUniqueOrThrow({
              where: { id: invitation.id }
            });

          expect(storedInvitation.consumedAt).toBeNull();

          const activationAudits =
            await prisma.auditLog.count({
              where: {
                merchantId: merchant.id,
                action: "MERCHANT_OWNER_ACTIVATED"
              }
            });

          expect(activationAudits).toBe(0);
        }
      );

      it(
        "prevents reuse of a consumed merchant owner activation token",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name: `${testPrefix}-reused-owner-activation`,
                currency: "ETB"
              }
            });

          const ownerEmail =
            `${testPrefix}-reused-owner@example.test`;

          const activationToken =
            randomBytes(32).toString("base64url");

          const invitation =
            await prisma.merchantOwnerActivation.create({
              data: {
                merchantId: merchant.id,
                ownerEmail,
                ownerDisplayName: "Single Use Owner",
                tokenHash: createHash("sha256")
                  .update(activationToken)
                  .digest("hex"),
                expiresAt: new Date(
                  Date.now() + 60 * 60 * 1000
                )
              }
            });

          const url =
            `${apiBaseUrl}/auth/activate-owner`;

          const headers = {
            "content-type": "application/json"
          };

          const firstResponse = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              token: activationToken,
              password: "FirstOwnerPassword123!"
            })
          });

          expect(firstResponse.status).toBe(200);

          const secondResponse = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              token: activationToken,
              password: "SecondOwnerPassword456!"
            })
          });

          expect(secondResponse.status).toBe(400);

          const owners =
            await prisma.merchantUser.findMany({
              where: {
                merchantId: merchant.id,
                role: MerchantUserRole.OWNER
              }
            });

          expect(owners).toHaveLength(1);
          expect(owners[0]?.email).toBe(ownerEmail);

          expect(
            await verifyPassword(
              "FirstOwnerPassword123!",
              owners[0]!.passwordHash
            )
          ).toBe(true);

          expect(
            await verifyPassword(
              "SecondOwnerPassword456!",
              owners[0]!.passwordHash
            )
          ).toBe(false);

          const storedInvitation =
            await prisma.merchantOwnerActivation.findUniqueOrThrow({
              where: { id: invitation.id }
            });

          expect(storedInvitation.consumedAt).not.toBeNull();

          const activationAudits =
            await prisma.auditLog.count({
              where: {
                merchantId: merchant.id,
                action: "MERCHANT_OWNER_ACTIVATED"
              }
            });

          expect(activationAudits).toBe(1);
        }
      );

      it(
        "allows only one concurrent merchant owner activation",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name: `${testPrefix}-concurrent-owner-activation`,
                currency: "ETB"
              }
            });

          const ownerEmail =
            `${testPrefix}-concurrent-owner@example.test`;

          const activationToken =
            randomBytes(32).toString("base64url");

          const invitation =
            await prisma.merchantOwnerActivation.create({
              data: {
                merchantId: merchant.id,
                ownerEmail,
                ownerDisplayName: "Concurrent Owner",
                tokenHash: createHash("sha256")
                  .update(activationToken)
                  .digest("hex"),
                expiresAt: new Date(
                  Date.now() + 60 * 60 * 1000
                )
              }
            });

          const url =
            `${apiBaseUrl}/auth/activate-owner`;

          const headers = {
            "content-type": "application/json"
          };

          const [first, second] = await Promise.all([
            fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify({
                token: activationToken,
                password: "ConcurrentPasswordA123!"
              })
            }),
            fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify({
                token: activationToken,
                password: "ConcurrentPasswordB456!"
              })
            })
          ]);

          expect(
            [first.status, second.status].sort()
          ).toEqual([200, 400]);

          const owners =
            await prisma.merchantUser.findMany({
              where: {
                merchantId: merchant.id,
                role: MerchantUserRole.OWNER
              }
            });

          expect(owners).toHaveLength(1);
          expect(owners[0]?.email).toBe(ownerEmail);

          const passwordAMatches =
            await verifyPassword(
              "ConcurrentPasswordA123!",
              owners[0]!.passwordHash
            );

          const passwordBMatches =
            await verifyPassword(
              "ConcurrentPasswordB456!",
              owners[0]!.passwordHash
            );

          expect(
            Number(passwordAMatches) +
              Number(passwordBMatches)
          ).toBe(1);

          const storedInvitation =
            await prisma.merchantOwnerActivation.findUniqueOrThrow({
              where: { id: invitation.id }
            });

          expect(storedInvitation.consumedAt).not.toBeNull();

          const activationAudits =
            await prisma.auditLog.count({
              where: {
                merchantId: merchant.id,
                action: "MERCHANT_OWNER_ACTIVATED"
              }
            });

          expect(activationAudits).toBe(1);
        }
      );

      it(
        "rejects owner activation when the email already belongs to another merchant",
        async () => {
          const existing =
            await createFixture(
              "activation-existing-email"
            );

          const merchant =
            await prisma.merchant.create({
              data: {
                name: `${testPrefix}-duplicate-email-activation`,
                currency: "ETB"
              }
            });

          const activationToken =
            randomBytes(32).toString("base64url");

          const invitation =
            await prisma.merchantOwnerActivation.create({
              data: {
                merchantId: merchant.id,
                ownerEmail: existing.user.email,
                ownerDisplayName: "Invited Owner",
                tokenHash: createHash("sha256")
                  .update(activationToken)
                  .digest("hex"),
                expiresAt: new Date(
                  Date.now() + 60 * 60 * 1000
                )
              }
            });

          const response = await fetch(
            `${apiBaseUrl}/auth/activate-owner`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                token: activationToken,
                password: "NewActivationPassword123!"
              })
            }
          );

          expect(response.status).toBe(400);

          const existingUser =
            await prisma.merchantUser.findUniqueOrThrow({
              where: {
                email: existing.user.email
              }
            });

          expect(existingUser.id).toBe(existing.user.id);
          expect(existingUser.merchantId).toBe(
            existing.merchant.id
          );

          expect(existingUser.passwordHash).toBe(
            existing.passwordHash
          );

          expect(
            await verifyPassword(
              existing.currentPassword,
              existingUser.passwordHash
            )
          ).toBe(true);

          expect(
            await prisma.merchantUser.count({
              where: { merchantId: merchant.id }
            })
          ).toBe(0);

          const storedInvitation =
            await prisma.merchantOwnerActivation.findUniqueOrThrow({
              where: { id: invitation.id }
            });

          expect(storedInvitation.consumedAt).toBeNull();

          const activationAudits =
            await prisma.auditLog.count({
              where: {
                merchantId: merchant.id,
                action: "MERCHANT_OWNER_ACTIVATED"
              }
            });

          expect(activationAudits).toBe(0);
        }
      );
    }
  );
