import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

import {
  preparePlatformBillingNotificationAttempt,
  markPlatformBillingNotificationRequestStarted
} from "../src/services/platform-billing-notification-attempt-fence.js";

import {
  reconcilePlatformBillingFailedPreSendAttempt
} from "../src/services/platform-billing-notification-pre-send-reconciliation.js";

const EXPECTED_DATABASE =
  "ethio_commerce_b53_concurrency_test";

const runId = randomUUID();
const merchantIds = new Set<string>();

async function requireIsolatedDatabase(): Promise<void> {
  if (process.env.API_TEST_SUITE !== "billing-b53-concurrency") {
    throw new Error("C4-A requires the B53 isolated test suite.");
  }

  const result = await prisma.$queryRaw<
    Array<{ database_name: string }>
  >`
    SELECT current_database() AS database_name
  `;

  if (result[0]?.database_name !== EXPECTED_DATABASE) {
    throw new Error("C4-A refused unexpected database.");
  }
}

async function createFixture() {
  await requireIsolatedDatabase();

  const suffix = randomUUID();
  const claimId = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `c4a-${runId}-${suffix}`,
      currency: "ETB"
    }
  });

  merchantIds.add(merchant.id);

  const owner = await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: `c4a-${suffix}@example.test`,
      passwordHash: "test-only-not-a-real-password",
      role: "OWNER"
    }
  });

  const identity =
    await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `c4a-${suffix}`
      }
    });

  const bot = await prisma.platformBillingTelegramBot.create({
    data: {
      botIdentityId: identity.id,
      botTokenEncrypted: "test-only-token",
      webhookSecretEncrypted: "test-only-secret",
      webhookKey: `c4a-${suffix}`,
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
      invoiceNumber: `C4A-${suffix}`,
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
      occurrenceKey: `C4A:${suffix}`
    })
  );

  const notification =
    await prisma.platformBillingNotification.findUniqueOrThrow({
      where: { eventId: event.id },
      include: { delivery: true }
    });

  if (!notification.delivery) {
    throw new Error("C4-A notification delivery missing.");
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

  const prepared =
    await preparePlatformBillingNotificationAttempt(
      deliveryId,
      claimId
    );

  if (!prepared.prepared) {
    throw new Error(
      `C4-A fixture preparation rejected: ${prepared.reason}`
    );
  }

  if (prepared.sendAuthorized !== false) {
    throw new Error("Unexpected sending authorization.");
  }

  return {
    merchantId: merchant.id,
    notificationId: notification.id,
    deliveryId,
    claimId,
    attemptId: prepared.attemptId
  };
}

async function readState(fixture: {
  deliveryId: string;
  attemptId: string;
  notificationId: string;
}) {
  const [delivery, attempt, notification] = await Promise.all([
    prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
      where: { id: fixture.deliveryId }
    }),
    prisma.platformBillingNotificationAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId }
    }),
    prisma.platformBillingNotification.findUniqueOrThrow({
      where: { id: fixture.notificationId }
    })
  ]);

  return { delivery, attempt, notification };
}

describe("B7.4-C4-A PostgreSQL reconciliation", () => {
  let databaseVerified = false;

  beforeAll(async () => {
    await requireIsolatedDatabase();
    databaseVerified = true;
  });

  afterAll(async () => {
    try {
      if (!databaseVerified || merchantIds.size === 0) {
        return;
      }

      await requireIsolatedDatabase();

      const ids = [...merchantIds];

      const merchants = await prisma.merchant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true }
      });

      if (
        merchants.length !== ids.length ||
        merchants.some(
          (merchant) =>
            !merchant.name.startsWith(`c4a-${runId}-`)
        )
      ) {
        throw new Error("C4-A fixture ownership mismatch.");
      }

      const events = await prisma.platformBillingEvent.findMany({
        where: { merchantId: { in: ids } },
        select: { id: true }
      });

      if (
        events.some(
          (event) => !event.id
        )
      ) {
        throw new Error("Invalid C4-A event.");
      }

      const destinations =
        await prisma.merchantBillingTelegramDestination.findMany({
          where: { merchantId: { in: ids } },
          select: { platformBotId: true }
        });

      const botIds = [
        ...new Set(destinations.map((d) => d.platformBotId))
      ];

      const bots = await prisma.platformBillingTelegramBot.findMany({
        where: { id: { in: botIds } },
        select: {
          id: true,
          botIdentityId: true,
          webhookKey: true
        }
      });

      if (
        bots.length !== botIds.length ||
        bots.some(
          (bot) => !bot.webhookKey.startsWith("c4a-")
        )
      ) {
        throw new Error("C4-A bot ownership mismatch.");
      }

      const identityIds = bots.map((bot) => bot.botIdentityId);

      const identities =
        await prisma.telegramBotIdentityRegistry.findMany({
          where: { id: { in: identityIds } },
          select: { id: true, telegramBotId: true }
        });

      if (
        identities.length !== identityIds.length ||
        identities.some(
          (identity) =>
            !identity.telegramBotId.startsWith("c4a-")
        )
      ) {
        throw new Error("C4-A identity ownership mismatch.");
      }

      // Preserve append-only billing events and their parent fixtures.
      // Remove only test-owned delivery state where deletion is allowed.
      await prisma.$transaction(async (tx) => {
        const deliveries =
          await tx.platformBillingNotificationDelivery.findMany({
            where: { merchantId: { in: ids } },
            select: { id: true }
          });

        const deliveryIds = deliveries.map((d) => d.id);

        await tx.platformBillingNotificationAttempt.deleteMany({
          where: { deliveryId: { in: deliveryIds } }
        });

        await tx.platformBillingDeliveryQuarantine.deleteMany({
          where: { deliveryId: { in: deliveryIds } }
        });

        await tx.platformBillingNotificationDelivery.deleteMany({
          where: { id: { in: deliveryIds } }
        });

        await tx.platformBillingNotification.deleteMany({
          where: { merchantId: { in: ids } }
        });
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("reconciles a recoverable PREPARED attempt atomically", async () => {
    const fixture = await createFixture();

    const result =
      await reconcilePlatformBillingFailedPreSendAttempt(
        fixture.deliveryId,
        fixture.claimId,
        fixture.attemptId,
        "RECOVERABLE_PRE_SEND"
      );

    expect(result).toMatchObject({
      reconciled: true,
      sendAuthorized: false,
      deliveryStatus: "PENDING"
    });

    const state = await readState(fixture);

    expect(state.attempt.outcome).toBe("FAILED_PRE_SEND");
    expect(state.attempt.requestStartedAt).toBeNull();

    expect(state.delivery.status).toBe("PENDING");
    expect(state.delivery.claimId).toBeNull();
    expect(state.delivery.processingUntil).toBeNull();

    expect(state.notification.status).toBe("PENDING");
  });

  it("rejects an expired lease without partial mutation", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.deliveryId },
      data: {
        processingUntil: new Date(Date.now() - 60_000)
      }
    });

    const result =
      await reconcilePlatformBillingFailedPreSendAttempt(
        fixture.deliveryId,
        fixture.claimId,
        fixture.attemptId,
        "RECOVERABLE_PRE_SEND"
      );

    expect(result).toMatchObject({
      reconciled: false,
      sendAuthorized: false
    });

    const state = await readState(fixture);

    expect(state.attempt.outcome).toBe("PREPARED");
    expect(state.attempt.requestStartedAt).toBeNull();

    expect(state.delivery.status).toBe("SENDING");
    expect(state.delivery.claimId).toBe(fixture.claimId);
    expect(state.notification.status).toBe("PENDING");
  });

  it("preserves REQUEST_STARTED evidence", async () => {
    const fixture = await createFixture();

    const started =
      await markPlatformBillingNotificationRequestStarted(
        fixture.deliveryId,
        fixture.claimId,
        fixture.attemptId
      );

    expect(started.sendAuthorized).toBe(false);

    const before = await readState(fixture);

    expect(before.attempt.outcome).toBe("REQUEST_STARTED");
    expect(before.attempt.requestStartedAt).not.toBeNull();

    const result =
      await reconcilePlatformBillingFailedPreSendAttempt(
        fixture.deliveryId,
        fixture.claimId,
        fixture.attemptId,
        "RECOVERABLE_PRE_SEND"
      );

    expect(result).toMatchObject({
      reconciled: false,
      sendAuthorized: false,
      reason: "ATTEMPT_NOT_PREPARED"
    });

    const after = await readState(fixture);

    expect(after.attempt.outcome).toBe("REQUEST_STARTED");
    expect(after.attempt.requestStartedAt?.getTime()).toBe(
      before.attempt.requestStartedAt?.getTime()
    );
    expect(after.delivery.status).toBe("SENDING");
    expect(after.notification.status).toBe("PENDING");
  });

  it("serializes reconciliation against request-start fencing", async () => {
    const fixture = await createFixture();

    const [reconciliation, requestStart] =
      await Promise.allSettled([
        reconcilePlatformBillingFailedPreSendAttempt(
          fixture.deliveryId,
          fixture.claimId,
          fixture.attemptId,
          "RECOVERABLE_PRE_SEND"
        ),
        markPlatformBillingNotificationRequestStarted(
          fixture.deliveryId,
          fixture.claimId,
          fixture.attemptId
        )
      ]);

    expect(reconciliation.status).toBe("fulfilled");
    expect(requestStart.status).toBe("fulfilled");

    if (
      reconciliation.status !== "fulfilled" ||
      requestStart.status !== "fulfilled"
    ) {
      throw new Error("Concurrent operation rejected unexpectedly.");
    }

    const state = await readState(fixture);

    expect(reconciliation.value.sendAuthorized).toBe(false);
    expect(requestStart.value.sendAuthorized).toBe(false);

    if (reconciliation.value.reconciled) {
      expect(state.attempt.outcome).toBe("FAILED_PRE_SEND");
      expect(state.attempt.requestStartedAt).toBeNull();
      expect(state.delivery.status).toBe("PENDING");
      expect(state.delivery.claimId).toBeNull();
    } else {
      expect(state.attempt.outcome).toBe("REQUEST_STARTED");
      expect(state.attempt.requestStartedAt).not.toBeNull();
      expect(state.delivery.status).toBe("SENDING");
      expect(state.delivery.claimId).toBe(fixture.claimId);
    }

    expect(state.notification.status).toBe("PENDING");
  });

  it("rolls back the attempt when delivery reconciliation fails", async () => {
    const fixture = await createFixture();
    const before = await readState(fixture);

    const originalTransaction = prisma.$transaction.bind(prisma);

    const transactionSpy = vi.spyOn(prisma, "$transaction");

    transactionSpy.mockImplementationOnce(
      (async (callback: any, options?: any) =>
        originalTransaction(async (tx: any) => {
          let queryCount = 0;

          const intercepted = new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "$queryRaw") {
                return (...args: any[]) => {
                  queryCount++;

                  if (queryCount === 2) {
                    throw new Error(
                      "C4A_INJECTED_DELIVERY_FAILURE"
                    );
                  }

                  return target.$queryRaw(...args);
                };
              }

              return Reflect.get(target, property, receiver);
            }
          });

          return callback(intercepted);
        }, options)) as any
    );

    try {
      await expect(
        reconcilePlatformBillingFailedPreSendAttempt(
          fixture.deliveryId,
          fixture.claimId,
          fixture.attemptId,
          "RECOVERABLE_PRE_SEND"
        )
      ).rejects.toThrow("C4A_INJECTED_DELIVERY_FAILURE");
    } finally {
      transactionSpy.mockRestore();
    }

    const after = await readState(fixture);

    expect(after.attempt.outcome).toBe("PREPARED");
    expect(after.attempt.requestStartedAt).toBeNull();
    expect(after.delivery.status).toBe("SENDING");
    expect(after.delivery.claimId).toBe(fixture.claimId);
    expect(after.delivery.processingUntil?.getTime()).toBe(
      before.delivery.processingUntil?.getTime()
    );
    expect(after.notification.status).toBe("PENDING");
  });

  it("rolls back attempt and delivery when notification update fails", async () => {
    const fixture = await createFixture();
    const before = await readState(fixture);

    const originalTransaction = prisma.$transaction.bind(prisma);

    const transactionSpy = vi.spyOn(prisma, "$transaction");

    transactionSpy.mockImplementationOnce(
      (async (callback: any, options?: any) =>
        originalTransaction(async (tx: any) => {
          const intercepted = new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "platformBillingNotification") {
                return new Proxy(
                  target.platformBillingNotification,
                  {
                    get(model, method, modelReceiver) {
                      if (method === "updateMany") {
                        return () => {
                          throw new Error(
                            "C4A_INJECTED_NOTIFICATION_FAILURE"
                          );
                        };
                      }

                      return Reflect.get(
                        model,
                        method,
                        modelReceiver
                      );
                    }
                  }
                );
              }

              return Reflect.get(target, property, receiver);
            }
          });

          return callback(intercepted);
        }, options)) as any
    );

    try {
      await expect(
        reconcilePlatformBillingFailedPreSendAttempt(
          fixture.deliveryId,
          fixture.claimId,
          fixture.attemptId,
          "PERMANENT_PRE_SEND"
        )
      ).rejects.toThrow("C4A_INJECTED_NOTIFICATION_FAILURE");
    } finally {
      transactionSpy.mockRestore();
    }

    const after = await readState(fixture);

    expect(after.attempt.outcome).toBe("PREPARED");
    expect(after.attempt.requestStartedAt).toBeNull();

    expect(after.delivery.status).toBe("SENDING");
    expect(after.delivery.claimId).toBe(fixture.claimId);
    expect(after.delivery.processingUntil?.getTime()).toBe(
      before.delivery.processingUntil?.getTime()
    );

    expect(after.notification.status).toBe("PENDING");
  });
});
