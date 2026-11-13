
import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";

import {
  createBillingTelegramLinkToken,
  BillingTelegramLinkNotEligibleError
} from "../src/services/merchant-billing-telegram-link-token.js";

describe("B3.2 secure billing Telegram link tokens", () => {
  const runId = randomUUID().replace(/-/g, "");

  let merchantId = "";
  let ownerId = "";

  const hashToken = (token: string) =>
    createHash("sha256")
      .update(token)
      .digest("hex");

  beforeAll(async () => {
    if (process.env.API_TEST_SUITE !== "billing-telegram-b3") {
      throw new Error("B3 isolated test suite required");
    }

    const result = await prisma.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;

    if (
      result[0]?.name !==
      "ethio_commerce_b2_migration_test"
    ) {
      throw new Error("Refusing to use an unexpected database");
    }

    const merchant = await prisma.merchant.create({
      data: {
        name: `b3-token-${runId}`
      }
    });

    merchantId = merchant.id;

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId,
        email: `b3-token-${runId}@example.test`,
        passwordHash: "test-only-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    ownerId = owner.id;
  });

  afterAll(async () => {
    if (merchantId) {
      await prisma.platformTelegramLinkToken.deleteMany({
        where: { merchantId }
      });
    }

    if (ownerId) {
      await prisma.merchantUser.deleteMany({
        where: { id: ownerId }
      });
    }

    if (merchantId) {
      await prisma.merchant.deleteMany({
        where: { id: merchantId }
      });
    }
  });

  it("generates a 32-byte random token and stores only its hash", async () => {
    const result = await createBillingTelegramLinkToken(
      merchantId,
      ownerId,
      0
    );

    expect(
      Buffer.from(result.token, "base64url")
    ).toHaveLength(32);

    const record = await prisma.platformTelegramLinkToken.findUnique({
      where: {
        tokenHash: hashToken(result.token)
      }
    });

    expect(record).not.toBeNull();
    expect(record?.tokenHash).toBe(
      hashToken(result.token)
    );
    expect(record?.tokenHash).not.toBe(
      result.token
    );

    expect(record?.merchantId).toBe(merchantId);
    expect(record?.createdByUserId).toBe(ownerId);
    expect(record?.createdByTokenVersion).toBe(0);

    const ttl = result.expiresAt.getTime() - Date.now();

    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("revokes earlier unused tokens on replacement", async () => {
    const first = await createBillingTelegramLinkToken(
      merchantId,
      ownerId,
      0
    );

    const second = await createBillingTelegramLinkToken(
      merchantId,
      ownerId,
      0
    );

    const firstRecord =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: {
          tokenHash: hashToken(first.token)
        }
      });

    const secondRecord =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: {
          tokenHash: hashToken(second.token)
        }
      });

    expect(firstRecord.revokedAt).not.toBeNull();
    expect(secondRecord.revokedAt).toBeNull();
    expect(secondRecord.consumedAt).toBeNull();
  });

  it("serializes concurrent token issuance", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createBillingTelegramLinkToken(
          merchantId,
          ownerId,
          0
        )
      )
    );

    expect(
      new Set(results.map((result) => result.token)).size
    ).toBe(5);

    const activeTokens =
      await prisma.platformTelegramLinkToken.findMany({
        where: {
          merchantId,
          consumedAt: null,
          revokedAt: null,
          expiresAt: {
            gt: new Date()
          }
        }
      });

    expect(activeTokens).toHaveLength(1);
  });

  it("rejects stale OWNER tokenVersion", async () => {
    await expect(
      createBillingTelegramLinkToken(
        merchantId,
        ownerId,
        999
      )
    ).rejects.toBeInstanceOf(
        BillingTelegramLinkNotEligibleError
      );
  });

  it("rejects non-OWNER issuance", async () => {
    await prisma.merchantUser.update({
      where: {
        id: ownerId
      },
      data: {
        role: "ADMIN"
      }
    });

    try {
      await expect(
        createBillingTelegramLinkToken(
          merchantId,
          ownerId,
          0
        )
      ).rejects.toBeInstanceOf(
        BillingTelegramLinkNotEligibleError
      );
    } finally {
      await prisma.merchantUser.update({
        where: {
          id: ownerId
        },
        data: {
          role: "OWNER"
        }
      });
    }
  });

  it("rejects suspended merchant accounts", async () => {
    await prisma.merchant.update({
      where: {
        id: merchantId
      },
      data: {
        accountStatus: "SUSPENDED"
      }
    });

    try {
      await expect(
        createBillingTelegramLinkToken(
          merchantId,
          ownerId,
          0
        )
      ).rejects.toBeInstanceOf(
        BillingTelegramLinkNotEligibleError
      );
    } finally {
      await prisma.merchant.update({
        where: {
          id: merchantId
        },
        data: {
          accountStatus: "ACTIVE"
        }
      });
    }
  });
});
