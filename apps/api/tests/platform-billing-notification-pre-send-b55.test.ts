import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { afterAll, describe, expect, it } from "vitest";

import { createPlatformBillingEvent } from "../src/services/platform-billing-notification-events.js";
import { validatePlatformBillingPreSend } from "../src/services/platform-billing-notification-pre-send.js";

const prefix = "b55-presend-";

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

async function validate(deliveryId: string) {
  return prisma.$transaction((tx) =>
    validatePlatformBillingPreSend(tx, deliveryId)
  );
}

describe("B5.5-I1 pre-send eligibility", () => {
  it("rejects a quarantined otherwise-eligible OPEN invoice delivery", async () => {
    const fixture = await createFixture();

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: fixture.merchant.id,
        invoiceNumber: `B55-QUARANTINE-${randomUUID()}`,
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
        merchantId: fixture.merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: invoice.id,
        occurrenceKey: `B55-QUARANTINE:${randomUUID()}`
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

    const before = await validate(notification.delivery.id);

    expect(before).toEqual({
      eligible: true,
      sendAuthorized: false
    });

    await prisma.platformBillingDeliveryQuarantine.create({
      data: {
        deliveryId: notification.delivery.id,
        merchantId: fixture.merchant.id,
        reason: "LEGACY_LINK_VERSION_UNVERIFIED"
      }
    });

    const decision = await validate(notification.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "REVIEW_REQUIRED",
      reason: "LEGACY_LINK_VERSION_UNVERIFIED"
    });
  });

  it("prioritizes quarantine over missing invoice source", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingDeliveryQuarantine.create({
      data: {
        deliveryId: fixture.delivery.id,
        merchantId: fixture.merchant.id,
        reason: "LEGACY_LINK_VERSION_UNVERIFIED"
      }
    });

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "REVIEW_REQUIRED",
      reason: "LEGACY_LINK_VERSION_UNVERIFIED"
    });
  });

  it("does not mutate quarantined delivery or quarantine records", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingDeliveryQuarantine.create({
      data: {
        deliveryId: fixture.delivery.id,
        merchantId: fixture.merchant.id,
        reason: "LEGACY_LINK_VERSION_UNVERIFIED"
      }
    });

    const beforeDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    const beforeQuarantine =
      await prisma.platformBillingDeliveryQuarantine.findUniqueOrThrow({
        where: { deliveryId: fixture.delivery.id }
      });

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "REVIEW_REQUIRED",
      reason: "LEGACY_LINK_VERSION_UNVERIFIED"
    });

    const afterDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id }
      });

    const afterQuarantine =
      await prisma.platformBillingDeliveryQuarantine.findUniqueOrThrow({
        where: { deliveryId: fixture.delivery.id }
      });

    expect(afterDelivery).toEqual(beforeDelivery);
    expect(afterQuarantine).toEqual(beforeQuarantine);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("recognizes an eligible OPEN invoice without authorizing sending", async () => {
    const fixture = await createFixture();

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: fixture.merchant.id,
        invoiceNumber: `B55-ISSUED-${randomUUID()}`,
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

    const event = await prisma.$transaction(async (tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: fixture.merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: invoice.id,
        occurrenceKey: `B55-OPEN:${randomUUID()}`
      })
    );

    const notification =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { eventId: event.id },
        include: { delivery: true }
      });

    expect(notification.delivery).not.toBeNull();

    if (!notification.delivery) {
      throw new Error("Expected notification delivery");
    }

    const decision = await validate(notification.delivery.id);

    expect(decision).toEqual({
      eligible: true,
      sendAuthorized: false
    });
  });

  it.each(["SETTLEMENT_SUBMITTED", "SETTLEMENT_REJECTED"] as const)(
    "recognizes eligible %s without authorizing sending",
    async (eventType) => {
      const fixture = await createFixture();

      const invoice = await prisma.merchantInvoice.create({
        data: {
          merchantId: fixture.merchant.id,
          invoiceNumber: `B55-SETTLEMENT-${randomUUID()}`,
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

      const settlement = await prisma.merchantSettlement.create({
        data: {
          merchantId: fixture.merchant.id,
          invoiceId: invoice.id,
          provider: "TELEBIRR",
          status:
            eventType === "SETTLEMENT_SUBMITTED"
              ? "REVIEW_REQUIRED"
              : "REJECTED",
          amount: "550.00",
          currency: "ETB",
          idempotencyKey: `b55-${randomUUID()}`,
          transactionReference: `B55-TX-${randomUUID()}`
        }
      });

      const event = await prisma.$transaction(async (tx) =>
        createPlatformBillingEvent(tx, {
          merchantId: fixture.merchant.id,
          type: eventType,
          sourceId: settlement.id,
          occurrenceKey: `B55:${eventType}:${randomUUID()}`
        })
      );

      const notification =
        await prisma.platformBillingNotification.findUniqueOrThrow({
          where: { eventId: event.id },
          include: { delivery: true }
        });

      expect(notification.delivery).not.toBeNull();

      if (!notification.delivery) {
        throw new Error("Expected notification delivery");
      }

      expect(await validate(notification.delivery.id)).toEqual({
        eligible: true,
        sendAuthorized: false
      });
    }
  );
  it.each(["ELIGIBLE", "PAID", "PENDING_SETTLEMENT", "SUPERSEDED"] as const)(
    "validates first-overdue reminder scenario %s",
    async (scenario) => {
      const fixture = await createFixture();

      const invoice = await prisma.merchantInvoice.create({
        data: {
          merchantId: fixture.merchant.id,
          invoiceNumber: `B55-OVERDUE-${randomUUID()}`,
          periodStart: new Date("2026-09-01T00:00:00.000Z"),
          periodEnd: new Date("2026-10-01T00:00:00.000Z"),
          subscriptionAmount: "500.00",
          commissionAmount: "50.00",
          totalAmount: "550.00",
          currency: "ETB",
          status: scenario === "PAID" ? "PAID" : "OVERDUE",
          openedAt: new Date("2026-10-01T00:00:00.000Z"),
          dueAt: new Date("2026-11-01T00:00:00.000Z")
        }
      });

      const reminder = await prisma.merchantInvoiceReminder.create({
        data: {
          merchantId: fixture.merchant.id,
          invoiceId: invoice.id,
          type: "FIRST_OVERDUE"
        }
      });

      if (scenario === "PENDING_SETTLEMENT") {
        await prisma.merchantSettlement.create({
          data: {
            merchantId: fixture.merchant.id,
            invoiceId: invoice.id,
            provider: "TELEBIRR",
            status: "REVIEW_REQUIRED",
            amount: "550.00",
            currency: "ETB",
            idempotencyKey: `b55-${randomUUID()}`,
            transactionReference: `B55-TX-${randomUUID()}`
          }
        });
      }

      if (scenario === "SUPERSEDED") {
        await prisma.merchantInvoiceReminder.create({
          data: {
            merchantId: fixture.merchant.id,
            invoiceId: invoice.id,
            type: "SECOND_OVERDUE"
          }
        });
      }

      const event = await prisma.$transaction(async (tx) =>
        createPlatformBillingEvent(tx, {
          merchantId: fixture.merchant.id,
          type: "INVOICE_FIRST_OVERDUE",
          sourceId: reminder.id,
          occurrenceKey: `B55-FIRST-OVERDUE:${randomUUID()}`
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

      const expected =
        scenario === "PAID"
          ? {
              eligible: false,
              disposition: "SUPPRESS",
              reason: "INVOICE_NO_LONGER_OVERDUE"
            }
          : scenario === "PENDING_SETTLEMENT"
            ? {
                eligible: false,
                disposition: "DEFER",
                reason: "SETTLEMENT_REVIEW_PENDING"
              }
            : scenario === "SUPERSEDED"
              ? {
                  eligible: false,
                  disposition: "SUPPRESS",
                  reason: "SUPERSEDED_BY_SECOND_OVERDUE"
                }
              : {
                  eligible: true,
                  sendAuthorized: false
                };

      expect(await validate(notification.delivery.id)).toEqual(expected);
    }
  );
  it.each(["NOT_PAID", "NO_VERIFIED_SETTLEMENT", "ATTRIBUTION_UNCONFIRMED"] as const)(
    "fails closed for invoice-paid scenario %s",
    async (scenario) => {
      const fixture = await createFixture();

      const invoice = await prisma.merchantInvoice.create({
        data: {
          merchantId: fixture.merchant.id,
          invoiceNumber: `B55-PAID-${randomUUID()}`,
          periodStart: new Date("2026-09-01T00:00:00.000Z"),
          periodEnd: new Date("2026-10-01T00:00:00.000Z"),
          subscriptionAmount: "500.00",
          commissionAmount: "50.00",
          totalAmount: "550.00",
          currency: "ETB",
          status: scenario === "NOT_PAID" ? "OPEN" : "PAID",
          openedAt: new Date("2026-10-01T00:00:00.000Z"),
          dueAt: new Date("2026-11-01T00:00:00.000Z")
        }
      });

      if (scenario === "ATTRIBUTION_UNCONFIRMED") {
        await prisma.merchantSettlement.create({
          data: {
            merchantId: fixture.merchant.id,
            invoiceId: invoice.id,
            provider: "TELEBIRR",
            status: "VERIFIED",
            amount: "550.00",
            currency: "ETB",
            idempotencyKey: `b55-${randomUUID()}`,
            transactionReference: `B55-TX-${randomUUID()}`
          }
        });
      }

      const event = await prisma.$transaction(async (tx) =>
        createPlatformBillingEvent(tx, {
          merchantId: fixture.merchant.id,
          type: "INVOICE_PAID",
          sourceId: invoice.id,
          occurrenceKey: `B55-INVOICE-PAID:${randomUUID()}`
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

      const expected =
        scenario === "NOT_PAID"
          ? {
              eligible: false,
              disposition: "SUPPRESS",
              reason: "INVOICE_STATE_CHANGED"
            }
          : scenario === "NO_VERIFIED_SETTLEMENT"
            ? {
                eligible: false,
                disposition: "REVIEW_REQUIRED",
                reason: "VERIFIED_SETTLEMENT_UNCONFIRMED"
              }
            : {
                eligible: false,
                disposition: "REVIEW_REQUIRED",
                reason: "INVOICE_PAYMENT_ATTRIBUTION_UNCONFIRMED"
              };

      expect(await validate(notification.delivery.id)).toEqual(expected);
    }
  );
  it("does not authorize sending when an invoice source is missing", async () => {
    const fixture = await createFixture();

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "REVIEW_REQUIRED",
      reason: "INVOICE_NOT_FOUND"
    });
  });

  it("rejects a destination whose linking user is no longer OWNER", async () => {
    const fixture = await createFixture();

    await prisma.merchantUser.update({
      where: { id: fixture.owner.id },
      data: { role: "STAFF" }
    });

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "SUPPRESS",
      reason: "OWNER_NO_LONGER_AUTHORIZED"
    });
  });

  it("rejects mismatched Telegram identity", async () => {
    const fixture = await createFixture();

    await prisma.merchantBillingTelegramDestination.update({
      where: { id: fixture.destination.id },
      data: { telegramUserId: "222222222" }
    });

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "REVIEW_REQUIRED",
      reason: "TELEGRAM_IDENTITY_INVALID"
    });
  });

  it("defers when the platform bot becomes inactive", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingTelegramBot.update({
      where: { id: fixture.bot.id },
      data: { status: "INACTIVE" }
    });

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "DEFER",
      reason: "PLATFORM_BOT_NOT_ACTIVE"
    });
  });

  it("requires manual review when bot ownership is no longer valid", async () => {
    const fixture = await createFixture();

    await prisma.telegramBotOwnershipReservation.update({
      where: { id: fixture.reservation.id },
      data: {
        status: "RELEASED",
        releasedAt: new Date()
      }
    });

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "REVIEW_REQUIRED",
      reason: "BOT_OWNERSHIP_NOT_CONFIRMED"
    });
  });

  it("fails closed for unconfirmed subscription occurrences", async () => {
    const fixture =
      await createFixture("SUBSCRIPTION_SUSPENDED");

    const decision = await validate(fixture.delivery.id);

    expect(decision).toEqual({
      eligible: false,
      disposition: "REVIEW_REQUIRED",
      reason: "SUBSCRIPTION_OCCURRENCE_UNCONFIRMED"
    });
  });

  it("suppresses billing delivery when merchant is inactive", async () => {
    const fixture = await createFixture();

    await prisma.merchant.update({
      where: { id: fixture.merchant.id },
      data: { accountStatus: "SUSPENDED" }
    });

    expect(await validate(fixture.delivery.id)).toEqual({
      eligible: false,
      disposition: "SUPPRESS",
      reason: "MERCHANT_NOT_ACTIVE"
    });
  });

  it("suppresses billing delivery when destination is revoked", async () => {
    const fixture = await createFixture();

    await prisma.merchantBillingTelegramDestination.update({
      where: { id: fixture.destination.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date()
      }
    });

    expect(await validate(fixture.delivery.id)).toEqual({
      eligible: false,
      disposition: "SUPPRESS",
      reason: "DESTINATION_NO_LONGER_ELIGIBLE"
    });
  });

  it("suppresses billing delivery after destination link version changes", async () => {
    const fixture = await createFixture();

    await prisma.merchantBillingTelegramDestination.update({
      where: { id: fixture.destination.id },
      data: { linkVersion: { increment: 1 } }
    });

    expect(await validate(fixture.delivery.id)).toEqual({
      eligible: false,
      disposition: "SUPPRESS",
      reason: "DESTINATION_LINK_VERSION_CHANGED"
    });
  });
  it.each([
    "NOTIFICATIONS_DISABLED",
    "CONSENT_AFTER_EVENT",
    "NOTIFICATION_NOT_PENDING",
    "DELIVERY_SENT"
  ] as const)(
    "rejects destination or delivery state %s",
    async (scenario) => {
      const fixture = await createFixture();

      if (scenario === "NOTIFICATIONS_DISABLED") {
        await prisma.merchantBillingTelegramDestination.update({
          where: { id: fixture.destination.id },
          data: { notificationsEnabled: false }
        });
      }

      if (scenario === "CONSENT_AFTER_EVENT") {
        await prisma.merchantBillingTelegramDestination.update({
          where: { id: fixture.destination.id },
          data: {
            consentedAt: new Date(
              fixture.event.createdAt.getTime() + 60_000
            )
          }
        });
      }

      if (scenario === "NOTIFICATION_NOT_PENDING") {
        await prisma.platformBillingNotification.update({
          where: { id: fixture.notification.id },
          data: { status: "SUPPRESSED" }
        });
      }

      if (scenario === "DELIVERY_SENT") {
        await prisma.platformBillingNotificationDelivery.update({
          where: { id: fixture.delivery.id },
          data: { status: "SENT" }
        });
      }

      const expected =
        scenario === "NOTIFICATIONS_DISABLED" ||
        scenario === "CONSENT_AFTER_EVENT"
          ? {
              eligible: false,
              disposition: "SUPPRESS",
              reason: "DESTINATION_NO_LONGER_ELIGIBLE"
            }
          : {
              eligible: false,
              disposition: "REVIEW_REQUIRED",
              reason: "DELIVERY_NOT_SENDABLE"
            };

      expect(await validate(fixture.delivery.id)).toEqual(expected);
    }
  );
  it("does not mutate notification or delivery records", async () => {
    const fixture = await createFixture();

    const before =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { id: fixture.notification.id },
        include: { delivery: true }
      });

    await validate(fixture.delivery.id);

    const after =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { id: fixture.notification.id },
        include: { delivery: true }
      });

    expect(after).toEqual(before);
  });
  it("B5.6-T5 suppresses an overdue notification when invoice becomes PAID before send", async () => {
    const fixture = await createFixture();

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: fixture.merchant.id,
        invoiceNumber: `B56-T5-${randomUUID()}`,
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
        subscriptionAmount: "500.00",
        commissionAmount: "50.00",
        totalAmount: "550.00",
        currency: "ETB",
        status: "OVERDUE",
        openedAt: new Date("2026-10-01T00:00:00.000Z"),
        dueAt: new Date("2026-11-01T00:00:00.000Z")
      }
    });

    const reminder = await prisma.merchantInvoiceReminder.create({
      data: {
        merchantId: fixture.merchant.id,
        invoiceId: invoice.id,
        type: "FIRST_OVERDUE"
      }
    });

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: fixture.merchant.id,
        type: "INVOICE_FIRST_OVERDUE",
        sourceId: reminder.id,
        occurrenceKey: `B56-T5:${randomUUID()}`
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

    expect(await validate(deliveryId)).toEqual({
      eligible: true,
      sendAuthorized: false
    });

    await prisma.merchantInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        paidAt: new Date()
      }
    });

    const before =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { id: notification.id },
        include: { delivery: true }
      });

    const decision = await validate(deliveryId);

    expect(decision).toEqual({
      eligible: false,
      disposition: "SUPPRESS",
      reason: "INVOICE_NO_LONGER_OVERDUE"
    });

    const after =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { id: notification.id },
        include: { delivery: true }
      });

    expect(after).toEqual(before);

    expect(
      await prisma.merchantInvoice.findUniqueOrThrow({
        where: { id: invoice.id }
      })
    ).toMatchObject({
      status: "PAID"
    });
  });
  it("B5.6-T6 suppresses a pending notification after merchant opt-out", async () => {
    const fixture = await createFixture();

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: fixture.merchant.id,
        invoiceNumber: `B56-T6-${randomUUID()}`,
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
        merchantId: fixture.merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: invoice.id,
        occurrenceKey: `B56-T6:${randomUUID()}`
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

    expect(await validate(deliveryId)).toEqual({
      eligible: true,
      sendAuthorized: false
    });

    await prisma.merchantBillingTelegramDestination.update({
      where: { id: fixture.destination.id },
      data: { notificationsEnabled: false }
    });

    const destination =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: fixture.destination.id }
      });

    expect(destination.notificationsEnabled).toBe(false);

    const before =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { id: notification.id },
        include: { delivery: true }
      });

    expect(await validate(deliveryId)).toEqual({
      eligible: false,
      disposition: "SUPPRESS",
      reason: "DESTINATION_NO_LONGER_ELIGIBLE"
    });

    const after =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { id: notification.id },
        include: { delivery: true }
      });

    expect(after).toEqual(before);
  });
  it("B5.6-T7 recognizes eligible second-overdue notification without authorizing sending", async () => {
    const fixture = await createFixture();

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: fixture.merchant.id,
        invoiceNumber: `B56-T7-${randomUUID()}`,
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
        subscriptionAmount: "500.00",
        commissionAmount: "50.00",
        totalAmount: "550.00",
        currency: "ETB",
        status: "OVERDUE",
        openedAt: new Date("2026-10-01T00:00:00.000Z"),
        dueAt: new Date("2026-11-01T00:00:00.000Z")
      }
    });

    const reminder = await prisma.merchantInvoiceReminder.create({
      data: {
        merchantId: fixture.merchant.id,
        invoiceId: invoice.id,
        type: "SECOND_OVERDUE"
      }
    });

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: fixture.merchant.id,
        type: "INVOICE_SECOND_OVERDUE",
        sourceId: reminder.id,
        occurrenceKey: `B56-T7:${randomUUID()}`
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

    expect(await validate(notification.delivery.id)).toEqual({
      eligible: true,
      sendAuthorized: false
    });
  });
});
