import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { afterAll, describe, expect, it } from "vitest";

import {
  createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

import {
  claimNextPlatformBillingNotificationDelivery
} from "../src/services/platform-billing-notification-claim.js";

import {
  processClaimedPlatformBillingNotificationB63
} from "../src/services/platform-billing-notification-b63.js";

async function createFixture() {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `b63-${suffix}`,
      currency: "ETB"
    }
  });

  const owner = await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: `b63-${suffix}@example.test`,
      passwordHash: "test-only-not-a-real-password",
      role: "OWNER"
    }
  });

  const identity =
    await prisma.telegramBotIdentityRegistry.create({
      data: { telegramBotId: suffix }
    });

  const bot =
    await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-token",
        webhookSecretEncrypted: "test-only-secret",
        webhookKey: `b63-${suffix}`,
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
      invoiceNumber: `B63-${suffix}`,
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
      occurrenceKey: `B63:${suffix}`
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

  await prisma.platformBillingNotificationDelivery.update({
    where: { id: notification.delivery.id },
    data: {
      destinationId: destination.id,
      destinationLinkVersion: destination.linkVersion
    }
  });

  return {
    merchant,
    destination,
    invoice,
    deliveryId: notification.delivery.id
  };
}

async function claimFixture(deliveryId: string) {
  const claim =
    await claimNextPlatformBillingNotificationDelivery(
      deliveryId
    );

  if (!claim.claimed) {
    throw new Error("Expected B6.2 claim");
  }

  return claim.claimId;
}

describe("B6.3 non-sending notification integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("prepares one attempt without starting a request", async () => {
    const fixture = await createFixture();
    const claimId = await claimFixture(fixture.deliveryId);

    const result =
      await processClaimedPlatformBillingNotificationB63(
        fixture.deliveryId,
        claimId
      );

    expect(result, JSON.stringify(result)).toMatchObject({ outcome: "PREPARED" });
    expect(result.sendAuthorized).toBe(false);

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
        include: { attempts: true }
      });

    expect(delivery.status).toBe("SENDING");
    expect(delivery.attemptCount).toBe(1);
    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].outcome).toBe("PREPARED");
    expect(delivery.attempts[0].requestStartedAt).toBeNull();
  });

  it("does not prepare the same claim twice", async () => {
    const fixture = await createFixture();
    const claimId = await claimFixture(fixture.deliveryId);

    const first =
      await processClaimedPlatformBillingNotificationB63(
        fixture.deliveryId,
        claimId
      );

    const second =
      await processClaimedPlatformBillingNotificationB63(
        fixture.deliveryId,
        claimId
      );

    expect(first, JSON.stringify(first)).toMatchObject({ outcome: "PREPARED" });
    expect(second.outcome).toBe("NOT_PREPARED");

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
        include: { attempts: true }
      });

    expect(delivery.attemptCount).toBe(1);
    expect(delivery.attempts).toHaveLength(1);
  });

  it("reviews an unsafe prior attempt without preparing another", async () => {
    const fixture = await createFixture();
    const claimId = await claimFixture(fixture.deliveryId);

    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: fixture.merchant.id,
        deliveryId: fixture.deliveryId,
        attemptNumber: 1,
        claimId,
        outcome: "REQUEST_STARTED",
        requestStartedAt: new Date()
      }
    });

    const result =
      await processClaimedPlatformBillingNotificationB63(
        fixture.deliveryId,
        claimId
      );

    expect(result, JSON.stringify(result)).toMatchObject({
      outcome: "DISPOSITION_APPLIED",
      disposition: "REVIEW_REQUIRED",
      sendAuthorized: false
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
        include: {
          attempts: true,
          notification: true
        }
      });

    expect(delivery.status).toBe("REVIEW_REQUIRED");
    expect(delivery.terminalReason).toBe("PRIOR_ATTEMPT_NOT_SAFE");
    expect(delivery.notification.status).toBe("REVIEW_REQUIRED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(delivery.attemptCount).toBe(0);
    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].outcome).toBe("REQUEST_STARTED");
  });
  it("suppresses a revoked destination without preparing", async () => {
    const fixture = await createFixture();

    await prisma.merchantBillingTelegramDestination.update({
      where: { id: fixture.destination.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date()
      }
    });

    const claimId = await claimFixture(fixture.deliveryId);

    const result =
      await processClaimedPlatformBillingNotificationB63(
        fixture.deliveryId,
        claimId
      );

    expect(result, JSON.stringify(result)).toMatchObject({ outcome: "DISPOSITION_APPLIED" });

    if (result.outcome === "DISPOSITION_APPLIED") {
      expect(result.disposition).toBe("SUPPRESS");
    }

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
        include: { attempts: true }
      });

    expect(delivery.status).toBe("SUPPRESSED");
    expect(delivery.attemptCount).toBe(0);
    expect(delivery.attempts).toHaveLength(0);
  });
});
