import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { describe, expect, it } from "vitest";

import {
  createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

import {
  resolvePlatformBillingTransportContext
} from "../src/services/platform-billing-notification-transport-context.js";

async function createFixture() {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `b6imp2a-${suffix}`,
      currency: "ETB"
    }
  });

  const owner = await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: `b6imp2a-${suffix}@example.test`,
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
      webhookKey: `b6imp2a-${suffix}`,
      status: "ACTIVE"
    }
  });

  const reservation =
    await prisma.telegramBotOwnershipReservation.create({
      data: {
        botIdentityId: identity.id,
        platformBillingBotId: bot.id,
        ownerType: "PLATFORM_BILLING",
        status: "RESERVED"
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
        consentedAt: new Date("2020-01-01"),
        notificationsEnabled: true,
        status: "ACTIVE",
        linkVersion: 1
      }
    });

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: merchant.id,
        invoiceNumber: `B6IMP2A-${suffix}`,

        periodStart: new Date("2026-01-01T00:00:00.000Z"),
        periodEnd: new Date("2026-01-31T23:59:59.999Z"),

        subscriptionAmount: "100.00",
        commissionAmount: "0.00",
        totalAmount: "100.00",

        currency: "ETB",
        status: "OPEN",
        openedAt: new Date("2026-02-01T00:00:00.000Z"),
        dueAt: new Date("2026-02-15T00:00:00.000Z")
      }
    });

  const event = await prisma.$transaction((tx) =>
    createPlatformBillingEvent(tx, {
      merchantId: merchant.id,
      type: "INVOICE_ISSUED",
      sourceId: invoice.id,
      occurrenceKey: `B6IMP2A:${suffix}`
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
        attemptCount: 1,
        processingUntil: new Date(Date.now() + 300000)
      }
    });

  const attempt =
    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: merchant.id,
        deliveryId: delivery.id,
        claimId,
        attemptNumber: 1,
        outcome: "PREPARED"
      }
    });

  return {
    merchant,
    bot,
    identity,
    reservation,
    destination,
    delivery,
    attempt,
    claimId
  };
}

describe("B6-IMP2-A transport context", () => {
  it("resolves a valid PREPARED context without authorizing sending", async () => {
    const f = await createFixture();

    const result =
      await resolvePlatformBillingTransportContext(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      );

    expect(result).toMatchObject({
      resolved: true,
      sendAuthorized: false,
      deliveryId: f.delivery.id,
      attemptId: f.attempt.id,
      destinationId: f.destination.id,
      platformBotId: f.bot.id,
      botIdentityId: f.identity.id
    });
  });

  it("rejects a mismatched claim", async () => {
    const f = await createFixture();

    const result =
      await resolvePlatformBillingTransportContext(
        f.delivery.id,
        randomUUID(),
        f.attempt.id
      );

    expect(result).toMatchObject({
      resolved: false,
      sendAuthorized: false,
      reason: "DELIVERY_NOT_SENDABLE"
    });
  });

  it("rejects an expired lease", async () => {
    const f = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: f.delivery.id },
      data: {
        processingUntil: new Date(Date.now() - 60000)
      }
    });

    const result =
      await resolvePlatformBillingTransportContext(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      );

    expect(result).toMatchObject({
      resolved: false,
      sendAuthorized: false,
      reason: "CLAIM_LEASE_EXPIRED"
    });
  });

  it("rejects an already started request", async () => {
    const f = await createFixture();

    await prisma.platformBillingNotificationAttempt.update({
      where: { id: f.attempt.id },
      data: {
        outcome: "REQUEST_STARTED",
        requestStartedAt: new Date()
      }
    });

    const result =
      await resolvePlatformBillingTransportContext(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      );

    expect(result).toMatchObject({
      resolved: false,
      sendAuthorized: false,
      reason: "ATTEMPT_NOT_PREPARED"
    });
  });

  it("rejects a revoked destination", async () => {
    const f = await createFixture();

    await prisma.merchantBillingTelegramDestination.update({
      where: { id: f.destination.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date()
      }
    });

    const result =
      await resolvePlatformBillingTransportContext(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      );

    expect(result).toMatchObject({
      resolved: false,
      sendAuthorized: false,
      reason:
        "TRANSPORT_SUPPRESS_DESTINATION_NO_LONGER_ELIGIBLE"
    });
  });

  it("rejects a released bot ownership reservation", async () => {
    const f = await createFixture();

    await prisma.telegramBotOwnershipReservation.update({
      where: { id: f.reservation.id },
      data: {
        status: "RELEASED",
        releasedAt: new Date()
      }
    });

    const result =
      await resolvePlatformBillingTransportContext(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      );

    expect(result).toMatchObject({
      resolved: false,
      sendAuthorized: false,
      reason:
        "TRANSPORT_REVIEW_REQUIRED_BOT_OWNERSHIP_NOT_CONFIRMED"
    });
  });
});
