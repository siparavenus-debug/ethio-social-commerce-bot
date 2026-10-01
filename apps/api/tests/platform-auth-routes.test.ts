import type {
  Server
} from "node:http";

import express from "express";

import {
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

import platformAuthRouter
  from "../src/routes/platform-auth.js";

import {
  createAuthToken,
  hashPassword
} from "../src/services/auth.js";

import {
  authenticatePlatformUser,
  createPlatformAuthToken
} from "../src/services/platform-auth.js";

const testPrefix =
  "platform-auth-routes";

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
          `${testPrefix}-`
      }
    }
  });
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
      "/platform/auth",
      platformAuthRouter
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
  "platform authentication routes",
  () => {
    it(
      "changes the authenticated platform user's password and invalidates existing sessions",
      async () => {
        const email =
          `${testPrefix}-password-change@example.test`;

        const currentPassword =
          "CurrentPassword123!";

        const newPassword =
          "NewPassword456!";

        const passwordHash =
          await hashPassword(
            currentPassword
          );

        const user =
          await prisma.platformUser.create({
            data: {
              email,
              passwordHash,
              displayName:
                "Platform Password Test",
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

        const response =
          await fetch(
            `${apiBaseUrl}/platform/auth/password`,
            {
              method:
                "PATCH",
              headers: {
                authorization:
                  `Bearer ${token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  currentPassword,
                  newPassword
                })
            }
          );

        expect(
          response.status
        ).toBe(200);

        const updatedUser =
          await prisma.platformUser.findUniqueOrThrow({
            where: {
              id:
                user.id
            }
          });

        expect(
          updatedUser.passwordHash
        ).not.toBe(
          passwordHash
        );

        expect(
          updatedUser.tokenVersion
        ).toBe(
          user.tokenVersion + 1
        );

        expect(
          await authenticatePlatformUser(
            email,
            currentPassword
          )
        ).toBeNull();

        const authenticatedWithNewPassword =
          await authenticatePlatformUser(
            email,
            newPassword
          );

        expect(
          authenticatedWithNewPassword
        ).not.toBeNull();

        const oldTokenResponse =
          await fetch(
            `${apiBaseUrl}/platform/auth/me`,
            {
              headers: {
                authorization:
                  `Bearer ${token}`
              }
            }
          );

        expect(
          oldTokenResponse.status
        ).toBe(401);
      }
    );

    it(
      "rejects an incorrect current password without changing credentials or invalidating sessions",
      async () => {
        const email =
          `${testPrefix}-wrong-current-password@example.test`;

        const currentPassword =
          "CurrentPassword123!";

        const passwordHash =
          await hashPassword(
            currentPassword
          );

        const user =
          await prisma.platformUser.create({
            data: {
              email,
              passwordHash,
              displayName:
                "Platform Wrong Password Test",
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

        const response =
          await fetch(
            `${apiBaseUrl}/platform/auth/password`,
            {
              method:
                "PATCH",
              headers: {
                authorization:
                  `Bearer ${token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  currentPassword:
                    "WrongPassword123!",
                  newPassword:
                    "NewPassword456!"
                })
            }
          );

        expect(
          response.status
        ).toBe(400);

        const unchangedUser =
          await prisma.platformUser.findUniqueOrThrow({
            where: {
              id:
                user.id
            }
          });

        expect(
          unchangedUser.passwordHash
        ).toBe(
          passwordHash
        );

        expect(
          unchangedUser.tokenVersion
        ).toBe(
          user.tokenVersion
        );

        expect(
          await authenticatePlatformUser(
            email,
            currentPassword
          )
        ).not.toBeNull();

        const existingTokenResponse =
          await fetch(
            `${apiBaseUrl}/platform/auth/me`,
            {
              headers: {
                authorization:
                  `Bearer ${token}`
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
        const email =
          `${testPrefix}-short-new-password@example.test`;

        const currentPassword =
          "CurrentPassword123!";

        const passwordHash =
          await hashPassword(
            currentPassword
          );

        const user =
          await prisma.platformUser.create({
            data: {
              email,
              passwordHash,
              displayName:
                "Platform Short Password Test",
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

        const response =
          await fetch(
            `${apiBaseUrl}/platform/auth/password`,
            {
              method:
                "PATCH",
              headers: {
                authorization:
                  `Bearer ${token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  currentPassword,
                  newPassword:
                    "short"
                })
            }
          );

        expect(
          response.status
        ).toBe(400);

        const unchangedUser =
          await prisma.platformUser.findUniqueOrThrow({
            where: {
              id:
                user.id
            }
          });

        expect(
          unchangedUser.passwordHash
        ).toBe(
          passwordHash
        );

        expect(
          unchangedUser.tokenVersion
        ).toBe(
          user.tokenVersion
        );

        expect(
          await authenticatePlatformUser(
            email,
            currentPassword
          )
        ).not.toBeNull();

        const existingTokenResponse =
          await fetch(
            `${apiBaseUrl}/platform/auth/me`,
            {
              headers: {
                authorization:
                  `Bearer ${token}`
              }
            }
          );

        expect(
          existingTokenResponse.status
        ).toBe(200);
      }
    );

    it(
      "rejects merchant authentication tokens from the platform password endpoint",
      async () => {
        const merchantToken =
          createAuthToken({
            id:
              "merchant-user-test",
            merchantId:
              "merchant-test",
            role:
              "OWNER",
            tokenVersion:
              0
          });

        const response =
          await fetch(
            `${apiBaseUrl}/platform/auth/password`,
            {
              method:
                "PATCH",
              headers: {
                authorization:
                  `Bearer ${merchantToken}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  currentPassword:
                    "CurrentPassword123!",
                  newPassword:
                    "NewPassword456!"
                })
            }
          );

        expect(
          response.status
        ).toBe(403);
      }
    );

    it(
      "rejects a missing new password without changing credentials",
      async () => {
        const email =
          `${testPrefix}-missing-new-password@example.test`;

        const currentPassword =
          "CurrentPassword123!";

        const passwordHash =
          await hashPassword(
            currentPassword
          );

        const user =
          await prisma.platformUser.create({
            data: {
              email,
              passwordHash,
              displayName:
                "Platform Missing Password Test",
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

        const response =
          await fetch(
            `${apiBaseUrl}/platform/auth/password`,
            {
              method:
                "PATCH",
              headers: {
                authorization:
                  `Bearer ${token}`,
                "content-type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  currentPassword
                })
            }
          );

        expect(
          response.status
        ).toBe(400);

        const unchangedUser =
          await prisma.platformUser.findUniqueOrThrow({
            where: {
              id:
                user.id
            }
          });

        expect(
          unchangedUser.passwordHash
        ).toBe(
          passwordHash
        );

        expect(
          unchangedUser.tokenVersion
        ).toBe(
          user.tokenVersion
        );
      }
    );
  }
);
