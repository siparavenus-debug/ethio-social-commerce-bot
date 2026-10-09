
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it
  } from "vitest";

  import {
    prisma
  } from "@ethio-commerce/database";

  import {
    bootstrapPlatformOwner
  } from "../src/services/platform-bootstrap.js";

  import {
    requireBootstrapTestDatabase
  } from "./helpers/require-bootstrap-test-database.js";

  describe("concurrent platform OWNER bootstrap", () => {

    beforeAll(async () => {
        await requireBootstrapTestDatabase(
          "ethio_commerce_bootstrap_test"
        );

        const users = await prisma.platformUser.findMany({
          select: {
            email: true,
            role: true
          }
        });

        const expectedEmails = [
          "concurrent-owner-a@test.example",
          "concurrent-owner-b@test.example"
        ];

        if (
          users.length > 1 ||
          (
            users.length === 1 &&
            (
              users[0]?.role !== "OWNER" ||
              !expectedEmails.includes(users[0]?.email)
            )
          )
        ) {
          throw new Error(
            "Concurrency test database contains unexpected platform users."
          );
        }
      });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("allows exactly one concurrent OWNER bootstrap", async () => {
        const existingUsers = await prisma.platformUser.findMany({
          select: {
            email: true,
            role: true
          }
        });

        if (existingUsers.length === 0) {
          const results = await Promise.allSettled([
            bootstrapPlatformOwner({
              email: "concurrent-owner-a@test.example",
              displayName: "Concurrent Owner A",
              password: "ConcurrentPassword123!"
            }),
            bootstrapPlatformOwner({
              email: "concurrent-owner-b@test.example",
              displayName: "Concurrent Owner B",
              password: "ConcurrentPassword456!"
            })
          ]);

          const successful = results.filter(
            (result) => result.status === "fulfilled"
          );

          const rejected = results.filter(
            (result) => result.status === "rejected"
          );

          expect(successful).toHaveLength(1);
          expect(rejected).toHaveLength(1);

          for (const result of rejected) {
            if (result.status === "rejected") {
              expect(result.reason).toBeInstanceOf(Error);
              expect(result.reason.message).toBe(
                "Platform bootstrap is disabled because a platform user already exists."
              );
            }
          }
        } else {
          await expect(
            bootstrapPlatformOwner({
              email: "another-owner@test.example",
              displayName: "Another Owner",
              password: "AnotherPassword123!"
            })
          ).rejects.toThrow(
            "Platform bootstrap is disabled because a platform user already exists."
          );
        }

        const users = await prisma.platformUser.findMany({
          select: {
            email: true,
            role: true
          }
        });

        expect(users).toHaveLength(1);
        expect(users[0]?.role).toBe("OWNER");

        expect([
          "concurrent-owner-a@test.example",
          "concurrent-owner-b@test.example"
        ]).toContain(users[0]?.email);
      });
  });
