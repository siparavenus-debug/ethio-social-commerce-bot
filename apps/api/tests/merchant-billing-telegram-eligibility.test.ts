
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn()
}));

vi.mock("@ethio-commerce/database", () => ({
  prisma: {
    platformTelegramLinkToken: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      updateMany: mocks.updateMany,
      create: mocks.create
    }
  }
}));

import {
  checkBillingTelegramLinkEligibility
} from "../src/services/merchant-billing-telegram-eligibility.js";

const tokenHash = "a".repeat(64);
const now = new Date("2026-11-09T09:00:00.000Z");

function eligibleToken() {
  return {
    id: "link-token-1",
    merchantId: "merchant-1",
    createdByUserId: "owner-1",
    createdByTokenVersion: 2,
    expiresAt: new Date("2026-11-09T09:10:00.000Z"),
    consumedAt: null,
    revokedAt: null,
    merchant: {
      accountStatus: "ACTIVE"
    },
    creator: {
      id: "owner-1",
      merchantId: "merchant-1",
      role: "OWNER",
      tokenVersion: 2
    }
  };
}

const notEligible = {
  ok: false,
  reason: "NOT_ELIGIBLE"
};

describe("billing Telegram link eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(eligibleToken());
  });

  it("accepts an eligible token", async () => {
    await expect(
      checkBillingTelegramLinkEligibility(tokenHash, now)
    ).resolves.toEqual({
      ok: true,
      value: {
        tokenId: "link-token-1",
        merchantId: "merchant-1",
        createdByUserId: "owner-1"
      }
    });

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash }
      })
    );
  });

  it("rejects a missing token", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(
      checkBillingTelegramLinkEligibility(tokenHash, now)
    ).resolves.toEqual(notEligible);
  });

  it.each([
    ["expired", { expiresAt: now }],
    ["consumed", { consumedAt: now }],
    ["revoked", { revokedAt: now }],
    [
      "suspended merchant",
      { merchant: { accountStatus: "SUSPENDED" } }
    ],
    [
      "non-owner creator",
      { creator: { ...eligibleToken().creator, role: "ADMIN" } }
    ],
    [
      "creator merchant mismatch",
      {
        creator: {
          ...eligibleToken().creator,
          merchantId: "merchant-2"
        }
      }
    ],
    [
      "creator ID mismatch",
      {
        creator: {
          ...eligibleToken().creator,
          id: "owner-2"
        }
      }
    ],
    [
      "changed token version",
      {
        creator: {
          ...eligibleToken().creator,
          tokenVersion: 3
        }
      }
    ]
  ])("rejects %s", async (_label, override) => {
    mocks.findUnique.mockResolvedValue({
      ...eligibleToken(),
      ...override
    });

    await expect(
      checkBillingTelegramLinkEligibility(tokenHash, now)
    ).resolves.toEqual(notEligible);
  });

  it.each([
    "",
    "invalid",
    "A".repeat(64),
    "a".repeat(63)
  ])("rejects malformed token hashes", async (hash) => {
    await expect(
      checkBillingTelegramLinkEligibility(hash, now)
    ).resolves.toEqual(notEligible);

    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid clock value", async () => {
    await expect(
      checkBillingTelegramLinkEligibility(
        tokenHash,
        new Date("invalid")
      )
    ).resolves.toEqual(notEligible);

    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("propagates database failures", async () => {
    mocks.findUnique.mockRejectedValue(
      new Error("Database unavailable")
    );

    await expect(
      checkBillingTelegramLinkEligibility(tokenHash, now)
    ).rejects.toThrow("Database unavailable");
  });

  it("does not perform database writes", async () => {
    await checkBillingTelegramLinkEligibility(
      tokenHash,
      now
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
