
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

  describe("platform OWNER bootstrap", () => {
    beforeAll(async () => {
        await requireBootstrapTestDatabase();

        const users = await prisma.platformUser.findMany({
          select: {
            email: true,
            role: true
          }
        });

        if (
          users.length > 1 ||
          (
            users.length === 1 &&
            (
              users[0]?.email !== "bootstrap-owner@test.example" ||
              users[0]?.role !== "OWNER"
            )
          )
        ) {
          throw new Error(
            "Bootstrap test database contains unexpected platform users."
          );
        }
      });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("creates the first platform OWNER", async () => {
        const existingOwner =
        await prisma.platformUser.findUnique({
          where: {
            email: "bootstrap-owner@test.example"
          }
        });

      const owner = existingOwner
        ? {
            id: existingOwner.id,
            email: existingOwner.email,
            role: existingOwner.role
          }
        : await bootstrapPlatformOwner({
            email: "bootstrap-owner@test.example",
            displayName: "Bootstrap Test Owner",
            password: "BootstrapPassword123!"
          });

      expect(owner.role).toBe("OWNER");
      expect(owner.email).toBe(
        "bootstrap-owner@test.example"
      );

      const users = await prisma.platformUser.findMany({
        select: {
          id: true,
          role: true
        }
      });

      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(owner.id);
      expect(users[0]?.role).toBe("OWNER");
    });

    it("rejects a second platform OWNER bootstrap", async () => {
      const originalOwner =
        await prisma.platformUser.findUniqueOrThrow({
          where: {
            email: "bootstrap-owner@test.example"
          }
        });

      await expect(
        bootstrapPlatformOwner({
          email: "second-owner@test.example",
          displayName: "Second Test Owner",
          password: "SecondPassword123!"
        })
      ).rejects.toThrow(
        "Platform bootstrap is disabled because a platform user already exists."
      );

      const users = await prisma.platformUser.findMany({
        select: {
          id: true,
          email: true,
          role: true
        }
      });

      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        id: originalOwner.id,
        email: originalOwner.email,
        role: "OWNER"
      });
    });
  });
