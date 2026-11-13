import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { afterAll, describe, expect, it } from "vitest";

import { createPlatformBillingEvent } from "../src/services/platform-billing-notification-events.js";
import { claimNextPlatformBillingNotificationDelivery } from "../src/services/platform-billing-notification-claim.js";

const prefix = "b62-claim-";

async function createFixture(
  eventType:
    | "INVOICE_ISSUED"
    | "SUBSCRIPTION_SUSPENDED" = "INVOICE_ISSUED"
) {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `${prefix}${suffix}`,
      currency: "ETB"
    }
  });

  const owner = await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: `b55-${suffix}@example.test`,
      passwordHash: "test-only-not-a-real-password",
      role: "OWNER"
    }
  });

  const identity =
    await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: suffix
      }
    });

  const bot =
    await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-token",
        webhookSecretEncrypted: "test-only-secret",
        webhookKey: `b55-${suffix}`,
        status: "ACTIVE"
      }
    });

  const reservation =
    await prisma.telegramBotOwnershipReservation.create({
      data: {
        botIdentityId: identity.id,
        platformBillingBotId: bot.id,
        ownerType: "PLATFORM_BILLING",
        status: "RESERVED",
        merchantId: null,
        merchantIntegrationId: null,
        releasedAt: null
      }
    });

  const destination =
    await prisma.merchantBillingTelegramDestination.create({
      data: {
        merchantId: merchant.id,
        platformBotId: bot.id,
        chatId: "111111111",
        telegramUserId: "111111111",
        linkedByUserId: owner.id,
        consentedAt: new Date("2020-01-01T00:00:00.000Z"),
        notificationsEnabled: true,
        status: "ACTIVE",
        linkVersion: 1
      }
    });

  const event = await prisma.$transaction(
    async (tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: eventType,
        sourceId: randomUUID(),
        occurrenceKey: `B55:${eventType}:${randomUUID()}`
      })
  );

  const notification =
    await prisma.platformBillingNotification.findUniqueOrThrow({
      where: { eventId: event.id },
      include: { delivery: true }
    });

  if (!notification.delivery) {
    throw new Error("Expected notification delivery");
  }

  return {
    merchant,
    owner,
    bot,
    reservation,
    destination,
    event,
    notification,
    delivery: notification.delivery
  };
}


describe("B6.2 platform billing notification claims", () => {
  it("claims one eligible delivery with a five-minute lease without consuming an attempt", async () => {
    const fixture = await createFixture();

    const result =
      await claimNextPlatformBillingNotificationDelivery(fixture.delivery.id);

    expect(result.claimed).toBe(true);

    if (!result.claimed) {
      throw new Error("Expected a successful claim");
    }

    expect(result.deliveryId).toBe(fixture.delivery.id);
    expect(result.claimId).toBeTruthy();

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PROCESSING");
    expect(delivery.claimId).toBe(result.claimId);
    expect(delivery.attemptCount).toBe(0);
    expect(delivery.processingUntil).not.toBeNull();

    const leaseMs =
      result.processingUntil.getTime() - Date.now();

    expect(leaseMs).toBeGreaterThan(4 * 60 * 1000);
    expect(leaseMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("does not claim the same delivery twice", async () => {
    const fixture = await createFixture();

    const first =
      await claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      );

    expect(first.claimed).toBe(true);

    const second =
      await claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      );

    expect(second).toEqual({ claimed: false });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PROCESSING");
    expect(delivery.attemptCount).toBe(0);

    if (first.claimed) {
      expect(delivery.claimId).toBe(first.claimId);
    }
  });
  it("allows only one concurrent worker to claim a delivery", async () => {
    const fixture = await createFixture();

    const results = await Promise.all([
      claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      ),
      claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      )
    ]);

    const successful = results.filter(
      (result) => result.claimed
    );

    const unsuccessful = results.filter(
      (result) => !result.claimed
    );

    expect(successful).toHaveLength(1);
    expect(unsuccessful).toHaveLength(1);

    const winner = successful[0];

    if (!winner.claimed) {
      throw new Error("Expected exactly one successful claim");
    }

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PROCESSING");
    expect(delivery.claimId).toBe(winner.claimId);
    expect(delivery.attemptCount).toBe(0);
  });
  it("skips a locked merchant and claims another eligible delivery", async () => {
    const first = await createFixture();
    const second = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: first.delivery.id },
      data: { nextAttemptAt: new Date("2020-01-01T00:00:00.000Z") }
    });

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: second.delivery.id },
      data: { nextAttemptAt: new Date("2020-01-02T00:00:00.000Z") }
    });

    let releaseLock!: () => void;
    let signalLocked!: () => void;

    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "Merchant"
        WHERE "id" = ${first.merchant.id}
        FOR UPDATE
      `;

      signalLocked();
      await release;
    }, { timeout: 10000 });

    try {
      await locked;

      const result =
        await claimNextPlatformBillingNotificationDelivery([
          first.delivery.id,
          second.delivery.id
        ]);

      expect(result.claimed).toBe(true);

      if (!result.claimed) {
        throw new Error("Expected a successful claim");
      }

      expect(result.deliveryId).toBe(second.delivery.id);
    } finally {
      releaseLock();
      await holder;
    }
  });
  it("does not claim a delivery that exhausted its attempt budget", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: { attemptCount: 5 }
    });

    const result =
      await claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      );

    expect(result).toEqual({ claimed: false });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PENDING");
    expect(delivery.claimId).toBeNull();
    expect(delivery.attemptCount).toBe(5);
  });
  it("does not claim a quarantined delivery", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingDeliveryQuarantine.create({
      data: {
        deliveryId: fixture.delivery.id,
        merchantId: fixture.merchant.id,
        reason: "B6.2 isolated quarantine exclusion test"
      }
    });

    const result =
      await claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      );

    expect(result).toEqual({ claimed: false });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PENDING");
    expect(delivery.claimId).toBeNull();
    expect(delivery.attemptCount).toBe(0);
  });
  it("does not reclaim a delivery with a previously started request", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: fixture.merchant.id,
        deliveryId: fixture.delivery.id,
        attemptNumber: 1,
        claimId: "b62-previous-claim",
        outcome: "UNCERTAIN",
        requestStartedAt: new Date()
      }
    });

    const result =
      await claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      );

    expect(result).toEqual({ claimed: false });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PENDING");
    expect(delivery.claimId).toBeNull();
    expect(delivery.attemptCount).toBe(0);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
});
