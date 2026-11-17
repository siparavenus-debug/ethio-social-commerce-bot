import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { afterAll, describe, expect, it } from "vitest";

import {
  createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

import {
  preparePlatformBillingNotificationAttempt,
  markPlatformBillingNotificationRequestStarted
} from "../src/services/platform-billing-notification-attempt-fence.js";

async function createM3Fixture() {
    const suffix = randomUUID();
    const claimId = randomUUID();

    const merchant = await prisma.merchant.create({
      data: {
        name: `b55-m3-${suffix}`,
        currency: "ETB"
      }
    });

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b55-m3-${suffix}@example.test`,
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
          webhookKey: `b55-m3-${suffix}`,
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

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: merchant.id,
        invoiceNumber: `B55-M3-${suffix}`,
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
        subscriptionAmount: "500.00",
        commissionAmount: "50.00",
        totalAmount: "550.00",
        currency: "ETB",
        status: "OPEN",
        openedAt: new Date("2026-10-01T00:00:00.000Z"),
        dueAt: new Date("2026-11-01T00:00:00.000Z")
      }
    });

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: invoice.id,
        occurrenceKey: `B55-M3:${suffix}`
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

    const deliveryId = notification.delivery.id;

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: deliveryId },
      data: {
        destinationId: destination.id,
        destinationLinkVersion: destination.linkVersion,
        status: "PROCESSING",
        claimId,
        processingUntil: new Date(Date.now() + 60_000)
      }
    });

    return { merchant, claimId, deliveryId };
}

describe("B5.5-I2-M3 attempt fencing", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows only one concurrent preparation", async () => {
    const { claimId, deliveryId } =
      await createM3Fixture();

    const results = await Promise.all([
      preparePlatformBillingNotificationAttempt(deliveryId, claimId),
      preparePlatformBillingNotificationAttempt(deliveryId, claimId)
    ]);

    const successful = results.filter(
      (result) => result.prepared
    );

    const rejected = results.filter(
      (result) => !result.prepared
    );

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(results.every(
      (result) => result.sendAuthorized === false
    )).toBe(true);

    expect(rejected[0]).toMatchObject({
      prepared: false,
      sendAuthorized: false,
      reason: "DELIVERY_NOT_PROCESSING"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { attempts: true }
      });

    expect(delivery.status).toBe("SENDING");
    expect(delivery.claimId).toBe(claimId);
    expect(delivery.attemptCount).toBe(1);
    expect(delivery.attempts).toHaveLength(1);

    expect(delivery.attempts[0]).toMatchObject({
      outcome: "PREPARED",
      attemptNumber: 1,
      claimId
    });

    expect(delivery.attempts[0].requestStartedAt).toBeNull();

    expect(successful[0]).toMatchObject({
      prepared: true,
      sendAuthorized: false,
      attemptId: delivery.attempts[0].id,
      attemptNumber: 1
    });
  });
  it("prepares and marks request started without authorizing sending", async () => {
    const { merchant, claimId, deliveryId } =
      await createM3Fixture();
    // M3 negative case: unsafe historical attempt blocks preparation.
    const historicalAttempt =
      await prisma.platformBillingNotificationAttempt.create({
        data: {
          merchantId: merchant.id,
          deliveryId,
          attemptNumber: 1,
          claimId: randomUUID(),
          outcome: "UNCERTAIN"
        }
      });

    const unsafeHistoryResult =
      await preparePlatformBillingNotificationAttempt(
        deliveryId,
        claimId
      );

    expect(unsafeHistoryResult).toEqual({
      prepared: false,
      sendAuthorized: false,
      reason: "PRIOR_ATTEMPT_NOT_SAFE"
    });

    const afterUnsafeHistory =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { attempts: true }
      });

    expect(afterUnsafeHistory.status).toBe("PROCESSING");
    expect(afterUnsafeHistory.claimId).toBe(claimId);
    expect(afterUnsafeHistory.attemptCount).toBe(0);
    expect(afterUnsafeHistory.attempts).toHaveLength(1);
    expect(afterUnsafeHistory.attempts[0].id).toBe(historicalAttempt.id);
    expect(afterUnsafeHistory.attempts[0].outcome).toBe("UNCERTAIN");

    // Remove only this test-created record before subsequent assertions.
    await prisma.platformBillingNotificationAttempt.delete({
      where: { id: historicalAttempt.id }
    });

    // M3 negative case: an expired lease must not prepare an attempt.
    await prisma.platformBillingNotificationDelivery.update({
      where: { id: deliveryId },
      data: {
        processingUntil: new Date(Date.now() - 60_000)
      }
    });

    const expiredLeaseResult =
      await preparePlatformBillingNotificationAttempt(
        deliveryId,
        claimId
      );

    expect(expiredLeaseResult).toEqual({
      prepared: false,
      sendAuthorized: false,
      reason: "PREPARATION_CONDITIONAL_UPDATE_FAILED"
    });

    const afterExpiredLease =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { attempts: true }
      });

    expect(afterExpiredLease.status).toBe("PROCESSING");
    expect(afterExpiredLease.claimId).toBe(claimId);
    expect(afterExpiredLease.attemptCount).toBe(0);
    expect(afterExpiredLease.attempts).toHaveLength(0);

    // Restore the valid lease for subsequent independent assertions.
    await prisma.platformBillingNotificationDelivery.update({
      where: { id: deliveryId },
      data: {
        processingUntil: new Date(Date.now() + 60_000)
      }
    });

    // M3 negative case: an incorrect claim must not prepare an attempt.
    const wrongClaimResult =
      await preparePlatformBillingNotificationAttempt(
        deliveryId,
        randomUUID()
      );

    expect(wrongClaimResult.prepared).toBe(false);
    expect(wrongClaimResult.sendAuthorized).toBe(false);

    const afterWrongClaim =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { attempts: true }
      });

    expect(afterWrongClaim.status).toBe("PROCESSING");
    expect(afterWrongClaim.claimId).toBe(claimId);
    expect(afterWrongClaim.attemptCount).toBe(0);
    expect(afterWrongClaim.attempts).toHaveLength(0);

    const preparationStartedAt = Date.now();
    const prepared =
      await preparePlatformBillingNotificationAttempt(
        deliveryId,
        claimId
      );

    const preparationFinishedAt = Date.now();
    expect(prepared.prepared).toBe(true);
    expect(prepared.sendAuthorized).toBe(false);

    if (!prepared.prepared) {
      throw new Error(
        `Preparation rejected: ${prepared.reason}`
      );
    }

    const afterPreparation =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { attempts: true }
      });

    expect(afterPreparation.updatedAt.getTime()).toBeGreaterThanOrEqual(
      preparationStartedAt - 5_000
    );
    expect(afterPreparation.updatedAt.getTime()).toBeLessThanOrEqual(
      preparationFinishedAt + 5_000
    );
    expect(afterPreparation.status).toBe("SENDING");
    expect(afterPreparation.attemptCount).toBe(1);
    expect(afterPreparation.attempts).toHaveLength(1);
    expect(afterPreparation.attempts[0].outcome).toBe("PREPARED");
    expect(afterPreparation.attempts[0].claimId).toBe(claimId);
    expect(afterPreparation.attempts[0].requestStartedAt).toBeNull();

    // M3 negative case: duplicate preparation must not create another attempt.
    const duplicatePreparation =
      await preparePlatformBillingNotificationAttempt(
        deliveryId,
        claimId
      );

    expect(duplicatePreparation.prepared).toBe(false);
    expect(duplicatePreparation.sendAuthorized).toBe(false);

    const afterDuplicatePreparation =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { attempts: true }
      });

    expect(afterDuplicatePreparation.status).toBe("SENDING");
    expect(afterDuplicatePreparation.attemptCount).toBe(1);
    expect(afterDuplicatePreparation.attempts).toHaveLength(1);
    expect(afterDuplicatePreparation.attempts[0].id).toBe(prepared.attemptId);
    expect(afterDuplicatePreparation.attempts[0].outcome).toBe("PREPARED");
    expect(afterDuplicatePreparation.attempts[0].requestStartedAt).toBeNull();

    const requestStartBeganAt = Date.now();
    const started =
      await markPlatformBillingNotificationRequestStarted(
        deliveryId,
        claimId,
        prepared.attemptId
      );

    const requestStartFinishedAt = Date.now();
    expect(started).toEqual({
      started: true,
      sendAuthorized: false,
      attemptId: prepared.attemptId,
      destinationId: expect.any(String),
      platformBotId: expect.any(String),
      botIdentityId: expect.any(String)
    });

    const attempt =
      await prisma.platformBillingNotificationAttempt.findUniqueOrThrow({
        where: { id: prepared.attemptId }
      });

    expect(attempt.outcome).toBe("REQUEST_STARTED");
    expect(attempt.requestStartedAt).not.toBeNull();
    expect(attempt.requestStartedAt!.getTime()).toBeGreaterThanOrEqual(
      requestStartBeganAt - 5_000
    );
    expect(attempt.requestStartedAt!.getTime()).toBeLessThanOrEqual(
      requestStartFinishedAt + 5_000
    );

    // M3 negative case: duplicate request-start must not restart an attempt.
    const originalRequestStartedAt = attempt.requestStartedAt;

    const duplicateRequestStart =
      await markPlatformBillingNotificationRequestStarted(
        deliveryId,
        claimId,
        prepared.attemptId
      );

    expect(duplicateRequestStart).toEqual({
      started: false,
      sendAuthorized: false,
      reason: "ATTEMPT_NOT_PREPARED"
    });

    const afterDuplicateRequestStart =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { attempts: true }
      });

    expect(afterDuplicateRequestStart.status).toBe("SENDING");
    expect(afterDuplicateRequestStart.attemptCount).toBe(1);
    expect(afterDuplicateRequestStart.attempts).toHaveLength(1);

    const persistedAttempt = afterDuplicateRequestStart.attempts[0];

    expect(persistedAttempt.id).toBe(prepared.attemptId);
    expect(persistedAttempt.claimId).toBe(claimId);
    expect(persistedAttempt.outcome).toBe("REQUEST_STARTED");
    expect(persistedAttempt.requestStartedAt?.getTime()).toBe(
      originalRequestStartedAt?.getTime()
    );
  });
});
