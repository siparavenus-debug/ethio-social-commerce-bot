import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import express from "express";

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

import platformAdminRouter from "../src/routes/platform-admin.js";

import {
  createPlatformAuthToken
} from "../src/services/platform-auth.js";

const testPrefix =
  "b72-deliveries";

const endpoint =
  "/platform/billing/telegram/deliveries";

let server: Server | null = null;
let apiBaseUrl = "";

const platformUserIds: string[] = [];

async function createPlatformUser(
  role: "OWNER" | "ADMIN" | "STAFF",
  suffix: string
) {
  const user = await prisma.platformUser.create({
    data: {
      email:
        `${testPrefix}-${suffix}@example.test`,
      passwordHash: "test-password-hash",
      displayName: `B7.2 ${suffix}`,
      role,
      tokenVersion: 0
    }
  });

  platformUserIds.push(user.id);

  return createPlatformAuthToken({
    id: user.id,
    tokenVersion: user.tokenVersion
  });
}

async function requestDeliveries(
  token?: string,
  query = ""
) {
  return fetch(
    `${apiBaseUrl}${endpoint}${query}`,
    {
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : {}
    }
  );
}

beforeAll(async () => {
  const app = express();

  app.use(express.json());

  app.use(
    "/platform",
    platformAdminRouter
  );

  await new Promise<void>((resolve) => {
    server = app.listen(
      0,
      "127.0.0.1",
      () => {
        const address = server!.address();

        if (
          !address ||
          typeof address === "string"
        ) {
          throw new Error(
            "Invalid test server address"
          );
        }

        apiBaseUrl =
          `http://127.0.0.1:${address.port}`;

        resolve();
      }
    );
  });
});

afterAll(async () => {
  if (platformUserIds.length > 0) {
    await prisma.platformUser.deleteMany({
      where: {
        id: {
          in: platformUserIds
        }
      }
    });
  }

  if (server) {
    await new Promise<void>(
      (resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }
    );
  }
});

describe("B7.2 persisted delivery records", () => {
  const merchantIds: string[] = [];

  async function createMerchant() {
    const merchant = await prisma.merchant.create({
      data: {
        name: `b72-persisted-${randomUUID()}`,
        currency: "ETB"
      }
    });

    merchantIds.push(merchant.id);
    return merchant;
  }

  async function createDelivery(
    merchantId: string,
    status:
      | "PENDING"
      | "PROCESSING"
      | "SENDING"
      | "SENT"
      | "FAILED"
      | "SUPPRESSED"
      | "REVIEW_REQUIRED",
    createdAt?: Date
  ) {
    const suffix = randomUUID();

    const event = await prisma.platformBillingEvent.create({
      data: {
        merchantId,
        type: "INVOICE_ISSUED",
        sourceId: suffix,
        occurrenceKey: `B72:${suffix}`
      }
    });

    const notification =
      await prisma.platformBillingNotification.create({
        data: {
          merchantId,
          eventId: event.id
        }
      });

    return prisma.platformBillingNotificationDelivery.create({
      data: {
        merchantId,
        notificationId: notification.id,
        status,
        ...(createdAt ? { createdAt } : {})
      }
    });
  }

  afterAll(async () => {
    if (merchantIds.length === 0) return;

    await prisma.$transaction(async (tx) => {
      const deliveries =
        await tx.platformBillingNotificationDelivery.findMany({
          where: { merchantId: { in: merchantIds } },
          select: { id: true }
        });

      const deliveryIds = deliveries.map((d) => d.id);

      await tx.platformBillingDeliveryQuarantine.deleteMany({
        where: { deliveryId: { in: deliveryIds } }
      });

      await tx.platformBillingNotificationAttempt.deleteMany({
        where: { deliveryId: { in: deliveryIds } }
      });

      await tx.platformBillingNotificationDelivery.deleteMany({
        where: { merchantId: { in: merchantIds } }
      });

      await tx.platformBillingNotification.deleteMany({
        where: { merchantId: { in: merchantIds } }
      });
      // Billing events are append-only.
      // Retain their merchant records to preserve referential integrity.
    });
  });

  it("returns all seven persisted delivery statuses", async () => {
    const merchant = await createMerchant();

    const statuses = [
      "PENDING",
      "PROCESSING",
      "SENDING",
      "SENT",
      "FAILED",
      "SUPPRESSED",
      "REVIEW_REQUIRED"
    ] as const;

    for (const status of statuses) {
      await createDelivery(merchant.id, status);
    }

    const token = await createPlatformUser(
      "OWNER",
      "persisted-statuses"
    );

    const response = await requestDeliveries(
      token,
      `?merchantId=${merchant.id}&limit=20`
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.deliveries).toHaveLength(7);

    expect(
      new Set(
        body.deliveries.map(
          (delivery: { status: string }) => delivery.status
        )
      )
    ).toEqual(new Set(statuses));
  });

  it("filters persisted deliveries by merchant and status", async () => {
    const merchantA = await createMerchant();
    const merchantB = await createMerchant();

    await createDelivery(merchantA.id, "FAILED");
    await createDelivery(merchantA.id, "SENT");
    await createDelivery(merchantB.id, "FAILED");

    const token = await createPlatformUser(
      "ADMIN",
      "persisted-filter"
    );

    const response = await requestDeliveries(
      token,
      `?merchantId=${merchantA.id}&status=FAILED`
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0].merchantId).toBe(merchantA.id);
    expect(body.deliveries[0].status).toBe("FAILED");
  });

  it("paginates without repeating or omitting deliveries", async () => {
    const merchant = await createMerchant();
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const createdIds: string[] = [];

    for (let index = 0; index < 5; index++) {
      const delivery = await createDelivery(
        merchant.id,
        "PENDING",
        createdAt
      );

      createdIds.push(delivery.id);
    }

    const token = await createPlatformUser(
      "OWNER",
      "persisted-pages"
    );

    const collectedIds: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 3; page++) {
      const query = new URLSearchParams({
        merchantId: merchant.id,
        limit: "2",
        ...(cursor ? { cursor } : {})
      });

      const response = await requestDeliveries(
        token,
        `?${query.toString()}`
      );

      expect(response.status).toBe(200);

      const body = await response.json();

      collectedIds.push(
        ...body.deliveries.map(
          (delivery: { id: string }) => delivery.id
        )
      );

      cursor = body.nextCursor;

      if (page < 2) {
        expect(cursor).toBeTruthy();
      }
    }

    expect(collectedIds).toHaveLength(5);
    expect(new Set(collectedIds).size).toBe(5);
    expect(new Set(collectedIds)).toEqual(new Set(createdIds));
    expect(cursor).toBeNull();
  });

  it("exposes uncertain attempts and quarantine without private fields", async () => {
    const merchant = await createMerchant();

    const delivery = await createDelivery(
      merchant.id,
      "REVIEW_REQUIRED"
    );

    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: merchant.id,
        deliveryId: delivery.id,
        attemptNumber: 1,
        claimId: randomUUID(),
        outcome: "UNCERTAIN",
        requestStartedAt: new Date(),
        sanitizedError: "PRIVATE_TEST_ERROR",
        telegramMessageId: "PRIVATE_MESSAGE_ID"
      }
    });

    await prisma.platformBillingDeliveryQuarantine.create({
      data: {
        merchantId: merchant.id,
        deliveryId: delivery.id,
        reason: "PRIVATE_QUARANTINE_REASON"
      }
    });

    const token = await createPlatformUser(
      "OWNER",
      "persisted-privacy"
    );

    const response = await requestDeliveries(
      token,
      `?merchantId=${merchant.id}`
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0].quarantined).toBe(true);
    expect(body.deliveries[0].attempts[0].outcome).toBe("UNCERTAIN");

    const serialized = JSON.stringify(body);

    for (const privateValue of [
      "PRIVATE_TEST_ERROR",
      "PRIVATE_MESSAGE_ID",
      "PRIVATE_QUARANTINE_REASON"
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    expect(body.deliveries[0]).not.toHaveProperty("destinationId");
    expect(body.deliveries[0]).not.toHaveProperty("terminalReason");
    expect(body.deliveries[0].attempts[0]).not.toHaveProperty("sanitizedError");
    expect(body.deliveries[0].attempts[0]).not.toHaveProperty("telegramMessageId");
  });
});
describe(
  "B7.2 platform billing notification delivery overview",
  () => {
    it(
      "rejects unauthenticated requests",
      async () => {
        const response =
          await requestDeliveries();

        expect(response.status).toBe(401);
      }
    );

    it(
      "rejects invalid platform credentials",
      async () => {
        const response =
          await requestDeliveries(
            "invalid-platform-token"
          );

        expect(response.status).toBe(401);
      }
    );

    it(
      "rejects platform STAFF",
      async () => {
        const token =
          await createPlatformUser(
            "STAFF",
            "staff"
          );

        const response =
          await requestDeliveries(token);

        expect(response.status).toBe(403);
      }
    );

    it(
      "allows platform OWNER",
      async () => {
        const token =
          await createPlatformUser(
            "OWNER",
            "owner"
          );

        const response =
          await requestDeliveries(
            token,
            "?merchantId=b72-nonexistent-merchant"
          );

        expect(response.status).toBe(200);

        const body = await response.json();

        expect(body).toEqual({
          deliveries: [],
          nextCursor: null
        });
      }
    );

    it(
      "allows platform ADMIN",
      async () => {
        const token =
          await createPlatformUser(
            "ADMIN",
            "admin"
          );

        const response =
          await requestDeliveries(
            token,
            "?merchantId=b72-nonexistent-merchant"
          );

        expect(response.status).toBe(200);

        const body = await response.json();

        expect(body).toEqual({
          deliveries: [],
          nextCursor: null
        });
      }
    );

    it(
      "rejects invalid delivery status",
      async () => {
        const token =
          await createPlatformUser(
            "OWNER",
            "invalid-status"
          );

        const response =
          await requestDeliveries(
            token,
            "?status=NOT_A_DELIVERY_STATUS"
          );

        expect(response.status).toBe(400);
      }
    );

    it(
      "rejects invalid delivery limit",
      async () => {
        const token =
          await createPlatformUser(
            "OWNER",
            "invalid-limit"
          );

        const response =
          await requestDeliveries(
            token,
            "?limit=101"
          );

        expect(response.status).toBe(400);
      }
    );

    it(
      "rejects malformed pagination cursor",
      async () => {
        const token =
          await createPlatformUser(
            "OWNER",
            "invalid-cursor"
          );

        const response =
          await requestDeliveries(
            token,
            "?cursor=not-a-valid-cursor"
          );

        expect(response.status).toBe(400);
      }
    );
  }
);
