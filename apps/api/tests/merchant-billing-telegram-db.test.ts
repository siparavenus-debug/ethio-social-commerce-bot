
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

import express from "express";

import {
  BillingDestinationStatus,
  prisma
} from "@ethio-commerce/database";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";

import merchantBillingTelegramRouter from
  "../src/routes/merchant-billing-telegram.js";

import {
  createAuthToken
} from "../src/services/auth.js";

describe("B3.1 database-backed destination isolation", () => {
  const runId = randomUUID().replace(/-/g, "");

  let server: Server | undefined;
  let baseUrl = "";

  let merchantAId = "";
  let merchantBId = "";

  let ownerAId = "";
  let ownerBId = "";

  let tokenA = "";
  let tokenB = "";

  let botIdentityId = "";
  let platformBotId = "";

  let destinationAId = "";
  let destinationBId = "";

  async function cleanup() {
    if (destinationAId || destinationBId) {
      await prisma.merchantBillingTelegramDestination.deleteMany({
        where: {
          id: {
            in: [
              destinationAId,
              destinationBId
            ].filter(Boolean)
          }
        }
      });
    }

    if (platformBotId) {
      await prisma.platformBillingTelegramBot.deleteMany({
        where: {
          id: platformBotId
        }
      });
    }

    if (botIdentityId) {
      await prisma.telegramBotIdentityRegistry.deleteMany({
        where: {
          id: botIdentityId
        }
      });
    }

    if (ownerAId || ownerBId) {
      await prisma.merchantUser.deleteMany({
        where: {
          id: {
            in: [
              ownerAId,
              ownerBId
            ].filter(Boolean)
          }
        }
      });
    }

    if (merchantAId || merchantBId) {
      await prisma.merchant.deleteMany({
        where: {
          id: {
            in: [
              merchantAId,
              merchantBId
            ].filter(Boolean)
          }
        }
      });
    }
  }

  async function getSettings(
    merchantId: string,
    token: string
  ) {
    const response = await fetch(
      `${baseUrl}/merchants/${merchantId}/billing-telegram`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    return {
      status: response.status,
      body: await response.json(),
      cacheControl: response.headers.get(
        "cache-control"
      )
    };
  }

  beforeAll(async () => {
    if (
      process.env.API_TEST_SUITE !== "billing-telegram-b3"
    ) {
      throw new Error(
        "This test requires the billing-telegram-b3 suite."
      );
    }

    const database = await prisma.$queryRaw<
      Array<{ database_name: string }>
    >`
      SELECT current_database() AS database_name
    `;

    if (
      database[0]?.database_name !==
      "ethio_commerce_b2_migration_test"
    ) {
      throw new Error(
        "Refusing to run outside the isolated B2/B3 database."
      );
    }

    const app = express();

    app.use(
      "/merchants",
      merchantBillingTelegramRouter
    );

    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(
        0,
        "127.0.0.1",
        () => resolve(listeningServer)
      );
    });

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Invalid test server address.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;

    const merchantA = await prisma.merchant.create({
      data: {
        name: `b3-db-${runId}-merchant-a`,
        currency: "ETB"
      }
    });

    merchantAId = merchantA.id;

    const merchantB = await prisma.merchant.create({
      data: {
        name: `b3-db-${runId}-merchant-b`,
        currency: "ETB"
      }
    });

    merchantBId = merchantB.id;

    const ownerA = await prisma.merchantUser.create({
      data: {
        merchantId: merchantAId,
        email: `b3-db-${runId}-a@example.test`,
        passwordHash: "test-only-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    ownerAId = ownerA.id;

    const ownerB = await prisma.merchantUser.create({
      data: {
        merchantId: merchantBId,
        email: `b3-db-${runId}-b@example.test`,
        passwordHash: "test-only-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    ownerBId = ownerB.id;

    tokenA = createAuthToken({
      id: ownerA.id,
      merchantId: merchantAId,
      role: ownerA.role,
      tokenVersion: ownerA.tokenVersion
    });

    tokenB = createAuthToken({
      id: ownerB.id,
      merchantId: merchantBId,
      role: ownerB.role,
      tokenVersion: ownerB.tokenVersion
    });

    const botIdentity =
      await prisma.telegramBotIdentityRegistry.create({
        data: {
          telegramBotId: `b3-test-${runId}`
        }
      });

    botIdentityId = botIdentity.id;

    const platformBot =
      await prisma.platformBillingTelegramBot.create({
        data: {
          botIdentityId,
          botTokenEncrypted: "test-only-inert-value",
          webhookSecretEncrypted: "test-only-inert-value",
          webhookKey: `b3-test-${runId}`,
          status: "PROVISIONING"
        }
      });

    platformBotId = platformBot.id;

    const destinationA =
      await prisma.merchantBillingTelegramDestination.create({
        data: {
          merchantId: merchantAId,
          platformBotId,
          chatId: `chat-a-${runId}`,
          telegramUserId: `user-a-${runId}`,
          status: BillingDestinationStatus.ACTIVE,
          linkedByUserId: ownerAId,
          consentedAt: new Date()
        }
      });

    destinationAId = destinationA.id;

    const destinationB =
      await prisma.merchantBillingTelegramDestination.create({
        data: {
          merchantId: merchantBId,
          platformBotId,
          chatId: `chat-b-${runId}`,
          telegramUserId: `user-b-${runId}`,
          status: BillingDestinationStatus.ACTIVE,
          linkedByUserId: ownerBId,
          consentedAt: new Date()
        }
      });

    destinationBId = destinationB.id;
  });

  afterAll(async () => {
    try {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) =>
            error ? reject(error) : resolve()
          );
        });
      }
    } finally {
      await cleanup();
    }
  });

  it("returns Merchant A's own destination", async () => {
    const result = await getSettings(
      merchantAId,
      tokenA
    );

    expect(result.status).toBe(200);
    expect(result.body.linked).toBe(true);
    expect(result.body.destination.id).toBe(
      destinationAId
    );
    expect(result.cacheControl).toBe("no-store");
  });

  it("rejects OWNER A accessing Merchant B", async () => {
    const result = await getSettings(
      merchantBId,
      tokenA
    );

    expect(result.status).toBe(403);
  });

  it("returns Merchant B's own destination", async () => {
    const result = await getSettings(
      merchantBId,
      tokenB
    );

    expect(result.status).toBe(200);
    expect(result.body.destination.id).toBe(
      destinationBId
    );
    expect(result.body.destination.id).not.toBe(
      destinationAId
    );
  });

  it("excludes a destination after revocation", async () => {
    await prisma.merchantBillingTelegramDestination.update({
      where: {
        id: destinationAId
      },
      data: {
        status: BillingDestinationStatus.REVOKED,
        revokedAt: new Date()
      }
    });

    const result = await getSettings(
      merchantAId,
      tokenA
    );

    expect(result.status).toBe(200);
    expect(result.body.linked).toBe(false);
    expect(result.body.destination).toBeNull();
  });


  it("rejects inconsistent destination revocation state", async () => {
    await expect(
      prisma.merchantBillingTelegramDestination.update({
        where: {
          id: destinationAId
        },
        data: {
          status: BillingDestinationStatus.ACTIVE,
          revokedAt: new Date()
        }
      })
    ).rejects.toMatchObject({
        code: "P2039"
      });

    const result = await getSettings(
      merchantAId,
      tokenA
    );

    expect(result.status).toBe(200);
    expect(result.body.linked).toBe(false);
    expect(result.body.destination).toBeNull();
  });


  it("returns unlinked when no destination exists", async () => {
    await prisma.merchantBillingTelegramDestination.update({
      where: {
        id: destinationAId
      },
      data: {
        status: BillingDestinationStatus.REVOKED,
        revokedAt: new Date()
      }
    });

    const result = await getSettings(
      merchantAId,
      tokenA
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      linked: false,
      destination: null
    });
  });
});
