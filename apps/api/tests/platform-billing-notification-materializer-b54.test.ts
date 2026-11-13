import { randomUUID } from "node:crypto";

import {
  prisma
} from "@ethio-commerce/database";

import {
  afterAll,
  describe,
  expect,
  it
} from "vitest";

import {
  createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

const prefix = "b54-materializer-";

async function createFixture(
  withDestination: boolean
) {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `${prefix}${suffix}`,
      currency: "ETB"
    }
  });

  if (!withDestination) {
    return { merchant, destination: null };
  }

  const owner = await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: `b54-${suffix}@example.test`,
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
        webhookKey: `b54-${suffix}`,
        status: "ACTIVE"
      }
    });

  const destination =
    await prisma.merchantBillingTelegramDestination.create({
      data: {
        merchantId: merchant.id,
        platformBotId: bot.id,
        chatId: `chat-${suffix}`,
        telegramUserId: `user-${suffix}`,
        linkedByUserId: owner.id,
        consentedAt: new Date("2020-01-01T00:00:00.000Z"),
        notificationsEnabled: true,
        status: "ACTIVE",
        linkVersion: 3
      }
    });

  return { merchant, destination };
}

describe("B5.4 PostgreSQL notification materialization", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates one destination-bound delivery for eligible OWNER consent", async () => {
    const { merchant, destination } =
      await createFixture(true);

    if (!destination) {
      throw new Error("Expected destination fixture");
    }

    const event = await prisma.$transaction(
      async (tx) =>
        createPlatformBillingEvent(tx, {
          merchantId: merchant.id,
          type: "INVOICE_ISSUED",
          sourceId: randomUUID(),
          occurrenceKey: `B54-ELIGIBLE:${randomUUID()}`
        })
    );

    const notification =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: {
          eventId: event.id
        },
        include: {
          delivery: true
        }
      });

    expect(notification.status).toBe("PENDING");
    expect(notification.terminalReason).toBeNull();

    expect(notification.delivery).toMatchObject({
      merchantId: merchant.id,
      destinationId: destination.id,
      destinationLinkVersion: 3,
      status: "PENDING"
    });
  });

  it("suppresses notifications when no eligible destination exists", async () => {
    const { merchant } = await createFixture(false);

    const event = await prisma.$transaction(
      async (tx) =>
        createPlatformBillingEvent(tx, {
          merchantId: merchant.id,
          type: "INVOICE_ISSUED",
          sourceId: randomUUID(),
          occurrenceKey: `B54-NO-DESTINATION:${randomUUID()}`
        })
    );

    const notification =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: {
          eventId: event.id
        },
        include: {
          delivery: true
        }
      });

    expect(notification.status).toBe("SUPPRESSED");
    expect(notification.terminalReason).toBe(
      "NO_ELIGIBLE_OPT_IN"
    );
    expect(notification.delivery).toBeNull();
  });

  // B5.4 destination eligibility regression cases
  it.each([
    "notifications-disabled",
    "destination-revoked",
    "consent-after-event",
    "platform-bot-inactive"
  ])("suppresses an ineligible destination: %s", async (scenario) => {
    const { merchant, destination } = await createFixture(true);

    if (!destination) {
      throw new Error("Expected destination fixture");
    }

    if (scenario === "notifications-disabled") {
      await prisma.merchantBillingTelegramDestination.update({
        where: { id: destination.id },
        data: { notificationsEnabled: false }
      });
    }

    if (scenario === "destination-revoked") {
      await prisma.merchantBillingTelegramDestination.update({
        where: { id: destination.id },
        data: {
          status: "REVOKED",
          revokedAt: new Date()
        }
      });
    }

    if (scenario === "consent-after-event") {
      await prisma.merchantBillingTelegramDestination.update({
        where: { id: destination.id },
        data: {
          consentedAt: new Date("2099-01-01T00:00:00.000Z")
        }
      });
    }

    if (scenario === "platform-bot-inactive") {
      await prisma.platformBillingTelegramBot.update({
        where: { id: destination.platformBotId },
        data: { status: "INACTIVE" }
      });
    }

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: randomUUID(),
        occurrenceKey: `B54-${scenario}:${randomUUID()}`
      })
    );

    const notification =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { eventId: event.id },
        include: { delivery: true }
      });

    expect(notification.status).toBe("SUPPRESSED");
    expect(notification.terminalReason).toBe("NO_ELIGIBLE_OPT_IN");
    expect(notification.delivery).toBeNull();
  });

  it("preserves authorized consent after the linking OWNER changes role", async () => {
    const { merchant, destination } = await createFixture(true);

    if (!destination) {
      throw new Error("Expected destination fixture");
    }

    await prisma.merchantUser.update({
      where: { id: destination.linkedByUserId },
      data: { role: "ADMIN" }
    });

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: randomUUID(),
        occurrenceKey: `B54-OWNER-ROLE-CHANGE:${randomUUID()}`
      })
    );

    const notification =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { eventId: event.id },
        include: { delivery: true }
      });

    expect(notification.status).toBe("PENDING");
    expect(notification.terminalReason).toBeNull();
    expect(notification.delivery).toMatchObject({
      destinationId: destination.id,
      destinationLinkVersion: destination.linkVersion,
      status: "PENDING"
    });
  });
  // B5.4 database invariant regression cases
  it("prevents duplicate notification materialization for one occurrence key", async () => {
    const { merchant, destination } = await createFixture(true);

    if (!destination) {
      throw new Error("Expected destination fixture");
    }

    const occurrenceKey = `B54-DUPLICATE:${randomUUID()}`;

    const input = {
      merchantId: merchant.id,
      type: "INVOICE_ISSUED" as const,
      sourceId: randomUUID(),
      occurrenceKey
    };

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, input)
    );

    await expect(
      prisma.$transaction((tx) =>
        createPlatformBillingEvent(tx, input)
      )
    ).rejects.toThrow();

    const events = await prisma.platformBillingEvent.findMany({
      where: { occurrenceKey }
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(event.id);

    const notifications =
      await prisma.platformBillingNotification.findMany({
        where: { eventId: event.id },
        include: { delivery: true }
      });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.delivery).toMatchObject({
      destinationId: destination.id,
      status: "PENDING"
    });
  });

  it("rolls back the billing event when materialization fails", async () => {
    const { merchant } = await createFixture(false);

    const occurrenceKey = `B54-ROLLBACK:${randomUUID()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        const event = await createPlatformBillingEvent(tx, {
          merchantId: merchant.id,
          type: "INVOICE_ISSUED",
          sourceId: randomUUID(),
          occurrenceKey
        });

        await tx.platformBillingNotification.create({
          data: {
            merchantId: merchant.id,
            eventId: event.id,
            status: "SUPPRESSED",
            terminalReason: "FORCED_TEST_FAILURE"
          }
        });
      })
    ).rejects.toThrow();

    const events = await prisma.platformBillingEvent.findMany({
      where: { occurrenceKey }
    });

    expect(events).toHaveLength(0);
  });
  it("rolls back when the materializer delivery insert fails", async () => {
    const { merchant } = await createFixture(true);
    const occurrenceKey = `B54-INTERNAL-FAILURE:${randomUUID()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        const originalCreate =
          tx.platformBillingNotificationDelivery.create.bind(
            tx.platformBillingNotificationDelivery
          );

        const failingTx = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "platformBillingNotificationDelivery") {
              return new Proxy(
                target.platformBillingNotificationDelivery,
                {
                  get(delegate, method) {
                    if (method === "create") {
                      return async () => {
                        throw new Error("B54_FORCED_DELIVERY_FAILURE");
                      };
                    }

                    return Reflect.get(delegate, method);
                  }
                }
              );
            }

            return Reflect.get(target, property, receiver);
          }
        });

        await createPlatformBillingEvent(failingTx, {
          merchantId: merchant.id,
          type: "INVOICE_ISSUED",
          sourceId: randomUUID(),
          occurrenceKey
        });

        void originalCreate;
      })
    ).rejects.toThrow("B54_FORCED_DELIVERY_FAILURE");

    const events = await prisma.platformBillingEvent.findMany({
      where: { occurrenceKey }
    });

    expect(events).toHaveLength(0);
  });
  // B5.4 final acceptance regression cases

  it("suppresses SETTLEMENT_VERIFIED without a notification mapping", async () => {
    const { merchant } = await createFixture(true);

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: "SETTLEMENT_VERIFIED",
        sourceId: randomUUID(),
        occurrenceKey: `B54-NO-MAPPING:${randomUUID()}`
      })
    );

    const notification =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { eventId: event.id },
        include: { delivery: true }
      });

    expect(notification.status).toBe("SUPPRESSED");
    expect(notification.terminalReason).toBe("NO_NOTIFICATION_MAPPING");
    expect(notification.delivery).toBeNull();
  });

  it("suppresses delivery for a suspended merchant", async () => {
    const { merchant } = await createFixture(true);

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { accountStatus: "SUSPENDED" }
    });

    const event = await prisma.$transaction((tx) =>
      createPlatformBillingEvent(tx, {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: randomUUID(),
        occurrenceKey: `B54-SUSPENDED:${randomUUID()}`
      })
    );

    const notification =
      await prisma.platformBillingNotification.findUniqueOrThrow({
        where: { eventId: event.id },
        include: { delivery: true }
      });

    expect(notification.status).toBe("SUPPRESSED");
    expect(notification.terminalReason).toBe("MERCHANT_NOT_ACTIVE");
    expect(notification.delivery).toBeNull();
  });

  it("enforces one active billing destination per merchant", async () => {
    const { merchant, destination } = await createFixture(true);

    if (!destination) {
      throw new Error("Expected destination fixture");
    }

    await expect(
      prisma.merchantBillingTelegramDestination.create({
        data: {
          merchantId: merchant.id,
          platformBotId: destination.platformBotId,
          chatId: `second-chat-${randomUUID()}`,
          telegramUserId: `second-user-${randomUUID()}`,
          linkedByUserId: destination.linkedByUserId,
          consentedAt: new Date("2020-01-01T00:00:00.000Z"),
          notificationsEnabled: true,
          status: "ACTIVE",
          linkVersion: 1
        }
      })
    ).rejects.toMatchObject({
      code: "P2002"
    });

    const activeDestinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: {
          merchantId: merchant.id,
          status: "ACTIVE"
        }
      });

    expect(activeDestinations).toHaveLength(1);
    expect(activeDestinations[0]?.id).toBe(destination.id);
  });
});