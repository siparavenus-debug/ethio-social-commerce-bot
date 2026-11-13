import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { afterAll, describe, expect, it } from "vitest";

import { createPlatformBillingEvent } from "../src/services/platform-billing-notification-events.js";
import { recoverExpiredPlatformBillingNotificationDeliveries } from "../src/services/platform-billing-notification-recovery.js";
import { claimNextPlatformBillingNotificationDelivery } from "../src/services/platform-billing-notification-claim.js";

const prefix = "b65-recovery-";

async function createFixture() {
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
      email: `b65-${suffix}@example.test`,
      passwordHash: "test-only-not-a-real-password",
      role: "OWNER"
    }
  });

  const identity =
    await prisma.telegramBotIdentityRegistry.create({
      data: { telegramBotId: suffix }
    });

  const bot = await prisma.platformBillingTelegramBot.create({
    data: {
      botIdentityId: identity.id,
      botTokenEncrypted: "test-only-token",
      webhookSecretEncrypted: "test-only-secret",
      webhookKey: `b65-${suffix}`,
      status: "ACTIVE"
    }
  });

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

  const event = await prisma.$transaction((tx) =>
    createPlatformBillingEvent(tx, {
      merchantId: merchant.id,
      type: "INVOICE_ISSUED",
      sourceId: randomUUID(),
      occurrenceKey: `B65:INVOICE_ISSUED:${randomUUID()}`
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
    notification,
    delivery: notification.delivery
  };
}

const expired = new Date(Date.now() - 60_000);
const active = new Date(Date.now() + 60_000);

describe("B6.5 expired lease recovery", () => {
  it("requeues expired PROCESSING without attempts", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "PROCESSING",
        claimId: randomUUID(),
        processingUntil: expired
      }
    });

    const results =
      await recoverExpiredPlatformBillingNotificationDeliveries(fixture.delivery.id);

    expect(results).toContainEqual({
      recovered: true,
      deliveryId: fixture.delivery.id,
      action: "REQUEUED"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PENDING");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
  });

  it("does not recover an active lease", async () => {
    const fixture = await createFixture();
    const claimId = randomUUID();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "PROCESSING",
        claimId,
        processingUntil: active
      }
    });

    await recoverExpiredPlatformBillingNotificationDeliveries(fixture.delivery.id);

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("PROCESSING");
    expect(delivery.claimId).toBe(claimId);
  });

  it("quarantines an expired SENDING request already started", async () => {
    const fixture = await createFixture();
    const claimId = randomUUID();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "SENDING",
        claimId,
        processingUntil: expired,
        attemptCount: 1
      }
    });

    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: fixture.merchant.id,
        deliveryId: fixture.delivery.id,
        attemptNumber: 1,
        claimId,
        outcome: "REQUEST_STARTED",
        requestStartedAt: new Date(Date.now() - 120_000)
      }
    });

    await recoverExpiredPlatformBillingNotificationDeliveries(fixture.delivery.id);

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { quarantine: true }
      });

    expect(delivery.status).toBe("REVIEW_REQUIRED");
    expect(delivery.quarantine).not.toBeNull();
    expect(delivery.claimId).toBeNull();
  });

  it("quarantines a possible Telegram acceptance after worker crash without resending", async () => {
    const fixture = await createFixture();
    const claimId = randomUUID();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "SENDING",
        claimId,
        processingUntil: expired,
        attemptCount: 1
      }
    });

    const attempt =
      await prisma.platformBillingNotificationAttempt.create({
        data: {
          merchantId: fixture.merchant.id,
          deliveryId: fixture.delivery.id,
          attemptNumber: 1,
          claimId,
          outcome: "REQUEST_STARTED",
          requestStartedAt: new Date(Date.now() - 120_000)
        }
      });

    // Simulated fault: Telegram may have accepted the request,
    // but the worker terminated before persisting its response.
    // No network call is performed.
    const results =
      await recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      );

    expect(results).toContainEqual({
      recovered: true,
      deliveryId: fixture.delivery.id,
      action: "REVIEW_REQUIRED"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: {
          notification: true,
          attempts: true,
          quarantine: true
        }
      });

    expect(delivery.status).toBe("REVIEW_REQUIRED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(delivery.quarantine).not.toBeNull();
    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].id).toBe(attempt.id);
    expect(delivery.attempts[0].outcome).toBe("REQUEST_STARTED");
    expect(delivery.attempts[0].responseReceivedAt).toBeNull();

    const nextClaim =
      await claimNextPlatformBillingNotificationDelivery(
        fixture.delivery.id
      );

    expect(nextClaim).toEqual({ claimed: false });

    const after =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.attemptCount).toBe(1);
  });
  it("resolves a consistent PREPARED attempt without resending", async () => {
    const fixture = await createFixture();
    const claimId = randomUUID();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "SENDING",
        claimId,
        processingUntil: expired,
        attemptCount: 1
      }
    });

    const attempt =
      await prisma.platformBillingNotificationAttempt.create({
        data: {
          merchantId: fixture.merchant.id,
          deliveryId: fixture.delivery.id,
          attemptNumber: 1,
          claimId,
          outcome: "PREPARED"
        }
      });

    await recoverExpiredPlatformBillingNotificationDeliveries(fixture.delivery.id);

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    const updatedAttempt =
      await prisma.platformBillingNotificationAttempt.findUniqueOrThrow({
        where: { id: attempt.id }
      });

    expect(delivery.status).toBe("PENDING");
    expect(updatedAttempt.outcome).toBe("FAILED_PRE_SEND");
    expect(updatedAttempt.requestStartedAt).toBeNull();
  });

  it("fails safely when retry budget is exhausted", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "PROCESSING",
        claimId: randomUUID(),
        processingUntil: expired,
        attemptCount: 5
      }
    });

    await recoverExpiredPlatformBillingNotificationDeliveries(fixture.delivery.id);

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    expect(delivery.status).toBe("FAILED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.terminalReason).toBe(
      "RECOVERY_ATTEMPTS_EXHAUSTED"
    );
  });

  it("never requeues an already quarantined delivery", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "PROCESSING",
        claimId: randomUUID(),
        processingUntil: expired
      }
    });

    await prisma.platformBillingDeliveryQuarantine.create({
      data: {
        merchantId: fixture.merchant.id,
        deliveryId: fixture.delivery.id,
        reason: "TEST_EXISTING_QUARANTINE"
      }
    });

    const results =
      await recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      );

    expect(results).toContainEqual({
      recovered: true,
      deliveryId: fixture.delivery.id,
      action: "REVIEW_REQUIRED"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { quarantine: true }
      });

    expect(delivery.status).toBe("REVIEW_REQUIRED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(delivery.quarantine).not.toBeNull();
    expect(delivery.quarantine?.reason).toBe(
      "TEST_EXISTING_QUARANTINE"
    );
  });
  it("quarantines an expired delivery with a non-pending notification", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotification.update({
      where: { id: fixture.notification.id },
      data: { status: "COMPLETED" }
    });

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "PROCESSING",
        claimId: randomUUID(),
        processingUntil: expired
      }
    });

    const results =
      await recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      );

    expect(results).toContainEqual({
      recovered: true,
      deliveryId: fixture.delivery.id,
      action: "REVIEW_REQUIRED"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { quarantine: true }
      });

    expect(delivery.status).toBe("REVIEW_REQUIRED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(delivery.quarantine).not.toBeNull();
    expect(delivery.terminalReason).toBe(
      "EXPIRED_LEASE_REVIEW_REQUIRED"
    );
  });
  it("quarantines an inconsistent PREPARED attempt", async () => {
    const fixture = await createFixture();
    const claimId = randomUUID();
    const differentClaimId = randomUUID();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "SENDING",
        claimId,
        processingUntil: expired,
        attemptCount: 1
      }
    });

    const attempt =
      await prisma.platformBillingNotificationAttempt.create({
        data: {
          merchantId: fixture.merchant.id,
          deliveryId: fixture.delivery.id,
          attemptNumber: 1,
          claimId: differentClaimId,
          outcome: "PREPARED"
        }
      });

    const results =
      await recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      );

    expect(results).toContainEqual({
      recovered: true,
      deliveryId: fixture.delivery.id,
      action: "REVIEW_REQUIRED"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { quarantine: true }
      });

    const updatedAttempt =
      await prisma.platformBillingNotificationAttempt.findUniqueOrThrow({
        where: { id: attempt.id }
      });

    expect(delivery.status).toBe("REVIEW_REQUIRED");
    expect(delivery.quarantine).not.toBeNull();
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();

    expect(updatedAttempt.outcome).toBe("PREPARED");
    expect(updatedAttempt.requestStartedAt).toBeNull();
  });
  it("is idempotent when recovering the same delivery twice", async () => {
    const fixture = await createFixture();
    const claimId = randomUUID();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "SENDING",
        claimId,
        processingUntil: expired,
        attemptCount: 1
      }
    });

    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: fixture.merchant.id,
        deliveryId: fixture.delivery.id,
        attemptNumber: 1,
        claimId,
        outcome: "REQUEST_STARTED",
        requestStartedAt: new Date(Date.now() - 120_000)
      }
    });

    const first =
      await recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      );

    expect(first).toContainEqual({
      recovered: true,
      deliveryId: fixture.delivery.id,
      action: "REVIEW_REQUIRED"
    });

    const before =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { quarantine: true }
      });

    const second =
      await recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      );

    const after =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { quarantine: true }
      });

    expect(second).toEqual([]);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.claimId).toBeNull();
    expect(after.processingUntil).toBeNull();
    expect(after.quarantine).not.toBeNull();
    expect(after.quarantine?.reason).toBe(
      before.quarantine?.reason
    );
    expect(after.quarantine?.createdAt).toEqual(
      before.quarantine?.createdAt
    );
  });
  it("prevents duplicate recovery under concurrent workers", async () => {
    const fixture = await createFixture();
    const claimId = randomUUID();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        status: "SENDING",
        claimId,
        processingUntil: expired,
        attemptCount: 1
      }
    });

    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: fixture.merchant.id,
        deliveryId: fixture.delivery.id,
        attemptNumber: 1,
        claimId,
        outcome: "REQUEST_STARTED",
        requestStartedAt: new Date(Date.now() - 120_000)
      }
    });

    const [first, second] = await Promise.all([
      recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      ),
      recoverExpiredPlatformBillingNotificationDeliveries(
        fixture.delivery.id
      )
    ]);

    const successful = [...first, ...second].filter(
      (result) => result.recovered
    );

    expect(successful).toEqual([
      {
        recovered: true,
        deliveryId: fixture.delivery.id,
        action: "REVIEW_REQUIRED"
      }
    ]);

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { quarantine: true }
      });

    const quarantineCount =
      await prisma.platformBillingDeliveryQuarantine.count({
        where: { deliveryId: fixture.delivery.id }
      });

    expect(delivery.status).toBe("REVIEW_REQUIRED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(delivery.quarantine).not.toBeNull();
    expect(quarantineCount).toBe(1);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
});
