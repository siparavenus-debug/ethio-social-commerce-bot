import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  tokenFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  ownerFindFirst: vi.fn(),
  botFindUnique: vi.fn(),
  reservationFindFirst: vi.fn(),
  destinationFindMany: vi.fn(),
  destinationUpdateMany: vi.fn(),
  destinationCreate: vi.fn(),
  deliveryCount: vi.fn(),
  tokenUpdateMany: vi.fn(),
  auditCreate: vi.fn()
}));

vi.mock("@ethio-commerce/database", () => ({
  Prisma: {
    TransactionIsolationLevel: {
      ReadCommitted: "ReadCommitted"
    }
  },
  prisma: {
    $transaction: mocks.transaction,
    platformTelegramLinkToken: {
      findUnique: mocks.tokenFindUnique
    }
  }
}));

import {
  redeemBillingTelegramLink
} from "../src/services/merchant-billing-telegram-redemption.js";

const tokenHash = "a".repeat(64);

const validInput = {
  tokenHash,
  platformBotId: "platform-bot-1",
  chatId: "123456789",
  telegramUserId: "123456789"
};

function makeToken() {
  return {
    id: "token-1",
    merchantId: "merchant-1",
    createdByUserId: "owner-1",
    createdByTokenVersion: 2,
    expiresAt: new Date(Date.now() + 600_000),
    consumedAt: null,
    revokedAt: null
  };
}

describe("billing Telegram atomic redemption", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.tokenFindUnique
      .mockResolvedValueOnce({
        id: "token-1",
        merchantId: "merchant-1"
      })
      .mockResolvedValue(makeToken());

    mocks.queryRaw.mockResolvedValue([{ id: "locked" }]);
    mocks.ownerFindFirst.mockResolvedValue({ id: "owner-1" });

    mocks.botFindUnique.mockResolvedValue({
      id: "platform-bot-1",
      botIdentityId: "identity-1"
    });

    mocks.reservationFindFirst.mockResolvedValue({
      id: "reservation-1"
    });

    mocks.destinationFindMany.mockResolvedValue([]);
    mocks.destinationUpdateMany.mockResolvedValue({ count: 1 });

    mocks.destinationCreate.mockResolvedValue({
      id: "destination-1"
    });

    mocks.deliveryCount.mockResolvedValue(0);
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });

    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          $queryRaw: mocks.queryRaw,
          platformTelegramLinkToken: {
            findUnique: mocks.tokenFindUnique,
            updateMany: mocks.tokenUpdateMany
          },
          merchantUser: {
            findFirst: mocks.ownerFindFirst
          },
          platformBillingTelegramBot: {
            findUnique: mocks.botFindUnique
          },
          telegramBotOwnershipReservation: {
            findFirst: mocks.reservationFindFirst
          },
          merchantBillingTelegramDestination: {
            findMany: mocks.destinationFindMany,
            updateMany: mocks.destinationUpdateMany,
            create: mocks.destinationCreate
          },
          platformBillingNotificationDelivery: {
            count: mocks.deliveryCount
          },
          platformBillingNotificationAudit: {
            create: mocks.auditCreate
          }
        })
    );
  });

  it("creates a destination and consumes the token", async () => {
    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: true,
      value: {
        destinationId: "destination-1",
        merchantId: "merchant-1",
        replacedPreviousDestination: false
      }
    });

    expect(mocks.destinationCreate).toHaveBeenCalledOnce();
    expect(mocks.tokenUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
  });

  it("rejects invalid input before database access", async () => {
    await expect(
      redeemBillingTelegramLink({
        ...validInput,
        chatId: "0"
      })
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.tokenFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects missing tokens", async () => {
    mocks.tokenFindUnique.mockReset();
    mocks.tokenFindUnique.mockResolvedValue(null);

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects expired tokens", async () => {
    mocks.tokenFindUnique.mockReset();
    mocks.tokenFindUnique
      .mockResolvedValueOnce({
        id: "token-1",
        merchantId: "merchant-1"
      })
      .mockResolvedValue({
        ...makeToken(),
        expiresAt: new Date(Date.now() - 1000)
      });

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing OWNER", async () => {
    mocks.ownerFindFirst.mockResolvedValue(null);

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });

  it("rejects an unreserved platform bot", async () => {
    mocks.reservationFindFirst.mockResolvedValue(null);

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });

  it("blocks replacement with unresolved deliveries", async () => {
    mocks.destinationFindMany.mockResolvedValue([
      { id: "old-destination" }
    ]);
    mocks.deliveryCount.mockResolvedValue(1);

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "REPLACEMENT_UNSAFE"
    });

    expect(mocks.destinationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });

  it("replaces a destination without unresolved deliveries", async () => {
    mocks.destinationFindMany.mockResolvedValue([
      { id: "old-destination" }
    ]);

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: true,
      value: {
        destinationId: "destination-1",
        merchantId: "merchant-1",
        replacedPreviousDestination: true
      }
    });

    expect(mocks.destinationUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sanitizedMetadata: {
            replacedPreviousDestination: true
          }
        })
      })
    );
  });

  it("rejects a failed token consumption", async () => {
    mocks.tokenUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("propagates unexpected database failures", async () => {
    mocks.destinationCreate.mockRejectedValue(
      new Error("database failure")
    );

    await expect(
      redeemBillingTelegramLink(validInput)
    ).rejects.toThrow("database failure");
  });
  describe("billing Telegram redemption security regressions", () => {
  const input = {
    tokenHash: "a".repeat(64),
    platformBotId: "platform-bot-1",
    chatId: "123456789",
    telegramUserId: "123456789"
  };

  it.each([
    ["consumed", { consumedAt: new Date() }],
    ["revoked", { revokedAt: new Date() }]
  ])("rejects a %s token", async (_name, changes) => {
    mocks.tokenFindUnique.mockReset();

    mocks.tokenFindUnique
      .mockResolvedValueOnce({
        id: "token-1",
        merchantId: "merchant-1"
      })
      .mockResolvedValue({
        id: "token-1",
        merchantId: "merchant-1",
        createdByUserId: "owner-1",
        createdByTokenVersion: 2,
        expiresAt: new Date(Date.now() + 600_000),
        consumedAt: null,
        revokedAt: null,
        ...changes
      });

    await expect(
      redeemBillingTelegramLink(input)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });

  it("rejects a changed OWNER token version", async () => {
    mocks.ownerFindFirst.mockResolvedValue(null);

    await expect(
      redeemBillingTelegramLink(input)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });

  it("rejects an inactive platform bot", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "merchant-1" }])
      .mockResolvedValueOnce([{ id: "token-1" }])
      .mockResolvedValueOnce([{ id: "owner-1" }])
      .mockResolvedValueOnce([{ id: "identity-1" }])
      .mockResolvedValueOnce([]);

    await expect(
      redeemBillingTelegramLink(input)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });

  it("rejects duplicate ACTIVE destinations", async () => {
    mocks.destinationFindMany.mockResolvedValue([
      { id: "destination-1" },
      { id: "destination-2" }
    ]);

    await expect(
      redeemBillingTelegramLink(input)
    ).resolves.toEqual({
      ok: false,
      reason: "DESTINATION_CONFLICT"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
  });
});
  it("rejects a missing bot identity lock", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "merchant-1" }])
      .mockResolvedValueOnce([{ id: "token-1" }])
      .mockResolvedValueOnce([{ id: "owner-1" }])
      .mockResolvedValueOnce([]);

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("rejects failed destination revocation", async () => {
    mocks.destinationFindMany.mockResolvedValue([
      { id: "old-destination" }
    ]);

    mocks.destinationUpdateMany.mockResolvedValue({
      count: 0
    });

    await expect(
      redeemBillingTelegramLink(validInput)
    ).resolves.toEqual({
      ok: false,
      reason: "DESTINATION_CONFLICT"
    });

    expect(mocks.destinationCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("propagates audit insertion failure", async () => {
    mocks.auditCreate.mockRejectedValue(
      new Error("audit insertion failed")
    );

    await expect(
      redeemBillingTelegramLink(validInput)
    ).rejects.toThrow("audit insertion failed");

    expect(mocks.destinationCreate).toHaveBeenCalledOnce();
    expect(mocks.tokenUpdateMany).toHaveBeenCalledOnce();
  });

});
