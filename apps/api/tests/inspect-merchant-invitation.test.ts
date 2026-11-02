import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { prisma } from "@ethio-commerce/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireTestDatabase } from "./helpers/require-test-database.js";

const prefix = "inspect-invitation-test-";
let validatedDatabaseUrl: string;
let databaseValidated = false;
const createdMerchantIds: string[] = [];

async function createFixture() {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: prefix + suffix,
      currency: "ETB"
    }
  });

  createdMerchantIds.push(merchant.id);

  const activation = await prisma.merchantOwnerActivation.create({
    data: {
      merchantId: merchant.id,
      ownerEmail: "owner-" + suffix + "@example.test",
      tokenHash: suffix.replace(/-/g, ""),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  const delivery = await prisma.merchantInvitationDelivery.create({
    data: {
      activationId: activation.id,
      recipientEmail: activation.ownerEmail,
      encryptedToken: "encrypted-test-token",
      status: "PENDING"
    }
  });

  return { merchant, activation, delivery };
}

function inspect(
  deliveryId: string,
  merchantId: string,
  recipientEmail: string
) {
  const script = path.resolve(
    process.cwd(),
    "dist/scripts/inspect-merchant-invitation.js"
  );

  return spawnSync(
    process.execPath,
    [script, deliveryId, merchantId, recipientEmail],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: validatedDatabaseUrl,
        NODE_ENV: "test"
      },
      encoding: "utf8",
      timeout: 10000
    }
  );
}

beforeAll(async () => {
  if (process.env.API_TEST_SUITE !== "standard") {
    throw new Error("Standard API test suite is required.");
  }

  validatedDatabaseUrl =
    await requireTestDatabase("ethio_commerce_test");

  if (process.env.DATABASE_URL !== validatedDatabaseUrl) {
    throw new Error("Test database connection mismatch.");
  }

  databaseValidated = true;
});

afterAll(async () => {
  if (!databaseValidated) {
    return;
  }

  if (createdMerchantIds.length > 0) {
    await prisma.merchantInvitationDelivery.deleteMany({
      where: {
        activation: {
          merchantId: { in: createdMerchantIds }
        }
      }
    });

    await prisma.merchantOwnerActivation.deleteMany({
      where: {
        merchantId: { in: createdMerchantIds }
      }
    });

    await prisma.merchant.deleteMany({
      where: {
        id: { in: createdMerchantIds }
      }
    });
  }

  await prisma.$disconnect();
});

describe("merchant invitation inspection CLI", () => {
  it("reports an eligible invitation without modifying it", async () => {
    const { merchant, activation, delivery } =
      await createFixture();

    const before = await prisma.merchantInvitationDelivery.findUniqueOrThrow({
      where: { id: delivery.id }
    });

    const result = inspect(
      delivery.id,
      merchant.id,
      activation.ownerEmail
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Eligible for targeted processing: true"
    );
    expect(result.stdout).toContain(
      "No invitation was claimed or sent."
    );

    const after = await prisma.merchantInvitationDelivery.findUniqueOrThrow({
      where: { id: delivery.id }
    });

    expect(after.status).toBe(before.status);
    expect(after.attemptCount).toBe(before.attemptCount);
    expect(after.processingUntil).toEqual(before.processingUntil);
    expect(after.sentAt).toEqual(before.sentAt);
    expect(after.providerMessageId).toBe(before.providerMessageId);
  });

  it("rejects a mismatched merchant", async () => {
    const { activation, delivery } = await createFixture();

    const result = inspect(
      delivery.id,
      "wrong-merchant-" + randomUUID(),
      activation.ownerEmail
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain(
      "No invitation matches all supplied identities."
    );
  });

  it("rejects a mismatched recipient", async () => {
    const { merchant, delivery } = await createFixture();

    const result = inspect(
      delivery.id,
      merchant.id,
      "wrong-recipient@example.test"
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain(
      "No invitation matches all supplied identities."
    );
  });

  it("reports an expired activation as ineligible", async () => {
    const { merchant, activation, delivery } =
      await createFixture();

    await prisma.merchantOwnerActivation.update({
      where: { id: activation.id },
      data: {
        expiresAt: new Date(Date.now() - 60 * 1000)
      }
    });

    const result = inspect(
      delivery.id,
      merchant.id,
      activation.ownerEmail
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Eligible for targeted processing: false"
    );
  });

  it("reports exhausted retries as ineligible", async () => {
    const { merchant, activation, delivery } =
      await createFixture();

    await prisma.merchantInvitationDelivery.update({
      where: { id: delivery.id },
      data: { attemptCount: 5 }
    });

    const result = inspect(
      delivery.id,
      merchant.id,
      activation.ownerEmail
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Eligible for targeted processing: false"
    );
  });
});
