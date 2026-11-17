import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { describe, expect, it } from "vitest";

import {
  createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

import {
  cleanupPreparedPlatformBillingNotificationAttempt
} from "../src/services/platform-billing-notification-pre-send-cleanup.js";

async function createFixture(
  attemptNumber = 1,
  outcome: "PREPARED" | "REQUEST_STARTED" = "PREPARED",
  leaseExpired = false
) {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `b6imp1-${suffix}`,
      currency: "ETB"
    }
  });

  const owner = await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: `b6imp1-${suffix}@example.test`,
      passwordHash: "test-only",
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
      botTokenEncrypted: "test-only",
      webhookSecretEncrypted: "test-only",
      webhookKey: `b6imp1-${suffix}`,
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
      consentedAt: new Date("2020-01-01"),
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
      occurrenceKey: `B6IMP1:${randomUUID()}`
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

  const claimId = randomUUID();

  const delivery =
    await prisma.platformBillingNotificationDelivery.update({
      where: { id: notification.delivery.id },
      data: {
        status: "SENDING",
        claimId,
        attemptCount: attemptNumber,
        processingUntil: new Date(
          Date.now() + (leaseExpired ? -60000 : 300000)
        )
      }
    });

  const attempt =
    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: merchant.id,
        deliveryId: delivery.id,
        claimId,
        attemptNumber,
        outcome,
        requestStartedAt:
          outcome === "REQUEST_STARTED" ? new Date() : null
      }
    });

  return { merchant, delivery, attempt, claimId };
}

async function readState(
  deliveryId: string,
  attemptId: string
) {
  const delivery =
    await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId }
    });

  const attempt =
    await prisma.platformBillingNotificationAttempt.findUniqueOrThrow({
      where: { id: attemptId }
    });

  return { delivery, attempt };
}

import {
  markPlatformBillingNotificationRequestStarted
} from "../src/services/platform-billing-notification-attempt-fence.js";
describe("B6-IMP1 immediate PREPARED cleanup", () => {
  it("requeues a safe PREPARED attempt", async () => {
    const f = await createFixture();

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        f.attempt.id,
        1,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result).toMatchObject({
      cleaned: true,
      action: "REQUEUED",
      sendAuthorized: false
    });

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("PENDING");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(attempt.outcome).toBe("FAILED_PRE_SEND");
    expect(attempt.requestStartedAt).toBeNull();
  });

  it("fails terminally on the fifth attempt", async () => {
    const f = await createFixture(5);

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        f.attempt.id,
        5,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result).toMatchObject({
      cleaned: true,
      action: "FAILED"
    });

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("FAILED");
    expect(attempt.outcome).toBe("FAILED_PRE_SEND");
    expect(attempt.requestStartedAt).toBeNull();
  });

  it("rejects a wrong claim without mutation", async () => {
    const f = await createFixture();

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        randomUUID(),
        f.attempt.id,
        1,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result.cleaned).toBe(false);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("SENDING");
    expect(attempt.outcome).toBe("PREPARED");
  });

  it("rejects an expired lease without mutation", async () => {
    const f = await createFixture(1, "PREPARED", true);

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        f.attempt.id,
        1,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result.cleaned).toBe(false);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("SENDING");
    expect(attempt.outcome).toBe("PREPARED");
  });

  it("never cleans an attempt after request-start", async () => {
    const f = await createFixture(1, "REQUEST_STARTED");

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        f.attempt.id,
        1,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result.cleaned).toBe(false);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("SENDING");
    expect(attempt.outcome).toBe("REQUEST_STARTED");
    expect(attempt.requestStartedAt).not.toBeNull();
  });

  it("is idempotent and cannot clean the same attempt twice", async () => {
    const f = await createFixture();

    const args = [
      f.delivery.id,
      f.claimId,
      f.attempt.id,
      1,
      "MESSAGE_PREPARATION_FAILED"
    ] as const;

    const first =
      await cleanupPreparedPlatformBillingNotificationAttempt(...args);

    const second =
      await cleanupPreparedPlatformBillingNotificationAttempt(...args);

    expect(first.cleaned).toBe(true);
    expect(second.cleaned).toBe(false);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("PENDING");
    expect(attempt.outcome).toBe("FAILED_PRE_SEND");
  });

  it("rejects a wrong attempt ID without mutation", async () => {
    const f = await createFixture();

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        randomUUID(),
        1,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result.cleaned).toBe(false);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("SENDING");
    expect(attempt.outcome).toBe("PREPARED");
  });

  it("rejects an unsafe historical attempt", async () => {
    const f = await createFixture(2);

    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: f.merchant.id,
        deliveryId: f.delivery.id,
        claimId: randomUUID(),
        attemptNumber: 1,
        outcome: "SUCCEEDED",
        requestStartedAt: new Date()
      }
    });

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        f.attempt.id,
        2,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result.cleaned).toBe(false);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("SENDING");
    expect(attempt.outcome).toBe("PREPARED");
  });
  it("rejects cleanup of a quarantined delivery", async () => {
    const f = await createFixture();

    await prisma.platformBillingDeliveryQuarantine.create({
      data: {
        deliveryId: f.delivery.id,
        merchantId: f.merchant.id,
        reason: "EXPIRED_LEASE_REVIEW_REQUIRED"
      }
    });

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        f.attempt.id,
        1,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result.cleaned).toBe(false);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(delivery.status).toBe("SENDING");
    expect(delivery.claimId).toBe(f.claimId);
    expect(attempt.outcome).toBe("PREPARED");
    expect(attempt.requestStartedAt).toBeNull();
  });

  it("rejects a cross-merchant attempt mismatch", async () => {
    const first = await createFixture();
    const second = await createFixture();

    const result =
      await cleanupPreparedPlatformBillingNotificationAttempt(
        first.delivery.id,
        first.claimId,
        second.attempt.id,
        1,
        "MESSAGE_PREPARATION_FAILED"
      );

    expect(result.cleaned).toBe(false);

    const firstState =
      await readState(first.delivery.id, first.attempt.id);

    const secondState =
      await readState(second.delivery.id, second.attempt.id);

    expect(firstState.delivery.status).toBe("SENDING");
    expect(firstState.attempt.outcome).toBe("PREPARED");

    expect(secondState.delivery.status).toBe("SENDING");
    expect(secondState.attempt.outcome).toBe("PREPARED");
  });

  it("serializes cleanup against request-start without unsafe requeue", async () => {
    const f = await createFixture();

    const [cleanup, requestStart] = await Promise.all([
      cleanupPreparedPlatformBillingNotificationAttempt(
        f.delivery.id,
        f.claimId,
        f.attempt.id,
        1,
        "MESSAGE_PREPARATION_FAILED"
      ),
      markPlatformBillingNotificationRequestStarted(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      )
    ]);

    const { delivery, attempt } =
      await readState(f.delivery.id, f.attempt.id);

    expect(cleanup.sendAuthorized).toBe(false);
    expect(requestStart.sendAuthorized).toBe(false);

    if (cleanup.cleaned) {
      expect(requestStart.started).toBe(false);
      expect(delivery.status).toBe("PENDING");
      expect(delivery.claimId).toBeNull();
      expect(attempt.outcome).toBe("FAILED_PRE_SEND");
      expect(attempt.requestStartedAt).toBeNull();
    } else if (requestStart.started) {
      expect(delivery.status).toBe("SENDING");
      expect(delivery.claimId).toBe(f.claimId);
      expect(attempt.outcome).toBe("REQUEST_STARTED");
      expect(attempt.requestStartedAt).not.toBeNull();
    } else {
      throw new Error(
        "Neither cleanup nor request-start completed the race"
      );
    }

    expect(
      cleanup.cleaned && requestStart.started
    ).toBe(false);
  });
});
