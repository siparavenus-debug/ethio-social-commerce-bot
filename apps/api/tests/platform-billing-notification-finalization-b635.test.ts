import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";
import { afterAll, describe, expect, it } from "vitest";

import { createPlatformBillingEvent } from "../src/services/platform-billing-notification-events.js";
import { finalizePlatformBillingNotification } from "../src/services/platform-billing-notification-finalization.js";

async function createFixture() {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `b635-finalization-${suffix}`,
      currency: "ETB"
    }
  });

  const owner = await prisma.merchantUser.create({
    data: {
      merchantId: merchant.id,
      email: `b635-${suffix}@example.test`,
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
      webhookKey: `b635-${suffix}`,
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
      occurrenceKey: `B635:INVOICE_ISSUED:${randomUUID()}`
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

  await prisma.platformBillingNotificationDelivery.update({
    where: { id: notification.delivery.id },
    data: {
      status: "SENDING",
      claimId,
      processingUntil: new Date(Date.now() + 120_000),
      attemptCount: 1
    }
  });

  const attempt =
    await prisma.platformBillingNotificationAttempt.create({
      data: {
        merchantId: merchant.id,
        deliveryId: notification.delivery.id,
        attemptNumber: 1,
        claimId,
        outcome: "REQUEST_STARTED",
        requestStartedAt: new Date()
      }
    });

  return {
    merchant,
    notification,
    delivery: notification.delivery,
    claimId,
    attempt
  };
}

describe("B6.3/B6.4 finalization", () => {
  it("persists confirmed Telegram acceptance atomically", async () => {
    const fixture = await createFixture();

    const result = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "ACCEPTED",
        telegramMessageId: "123456"
      }
    );

    expect(result).toEqual({
      finalized: true,
      disposition: "SENT"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: {
          notification: true,
          attempts: true
        }
      });

    expect(delivery.status).toBe("SENT");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(delivery.notification.status).toBe("COMPLETED");
    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].outcome).toBe("SUCCEEDED");
    expect(delivery.attempts[0].telegramMessageId).toBe("123456");
    expect(delivery.attempts[0].responseReceivedAt).not.toBeNull();
  });
  it("persists confirmed permanent rejection without marking success", async () => {
    const fixture = await createFixture();

    const result = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "PERMANENT_FAILURE",
        reason: "BOT_BLOCKED"
      }
    );

    expect(result).toEqual({
      finalized: true,
      disposition: "FAILED"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: {
          notification: true,
          attempts: true
        }
      });

    expect(delivery.status).toBe("FAILED");
    expect(delivery.terminalReason).toBe("BOT_BLOCKED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();

    expect(delivery.notification.status).toBe("COMPLETED");
    expect(delivery.notification.terminalReason).toBe("BOT_BLOCKED");

    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].outcome).toBe("REQUEST_STARTED");
    expect(delivery.attempts[0].sanitizedError).toBe("BOT_BLOCKED");
    expect(delivery.attempts[0].telegramMessageId).toBeNull();
    expect(delivery.attempts[0].responseReceivedAt).not.toBeNull();
  });
  it("quarantines an ambiguous Telegram timeout after request start", async () => {
    const fixture = await createFixture();

    const result = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "AMBIGUOUS",
        reason: "TIMEOUT"
      }
    );

    expect(result).toEqual({
      finalized: true,
      disposition: "REVIEW_REQUIRED"
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
    expect(delivery.terminalReason).toBe("TIMEOUT");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();

    expect(delivery.notification.status).toBe("REVIEW_REQUIRED");

    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].outcome).toBe("UNCERTAIN");
    expect(delivery.attempts[0].sanitizedError).toBe("TIMEOUT");
    expect(delivery.attempts[0].telegramMessageId).toBeNull();

    expect(delivery.quarantine).not.toBeNull();
    expect(delivery.quarantine?.reason).toBe(
      "TELEGRAM_OUTCOME_REVIEW_REQUIRED"
    );
  });
  it("preserves rate-limit evidence and quarantines after request start", async () => {
    const fixture = await createFixture();

    const result = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "TRANSIENT_FAILURE",
        reason: "RATE_LIMITED",
        retryAfterSeconds: 37
      }
    );

    expect(result).toEqual({
      finalized: true,
      disposition: "REVIEW_REQUIRED"
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
    expect(delivery.terminalReason).toBe("RATE_LIMITED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();

    expect(delivery.notification.status).toBe("REVIEW_REQUIRED");

    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].outcome).toBe("UNCERTAIN");
    expect(delivery.attempts[0].sanitizedError).toBe("RATE_LIMITED");
    expect(delivery.attempts[0].retryAfterSeconds).toBe(37);
    expect(delivery.attempts[0].telegramMessageId).toBeNull();

    expect(delivery.quarantine).not.toBeNull();
    expect(delivery.quarantine?.reason).toBe(
      "TELEGRAM_OUTCOME_REVIEW_REQUIRED"
    );
  });
  it("rejects stale claim ownership without changing persisted state", async () => {
    const fixture = await createFixture();

    const result = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      randomUUID(),
      fixture.attempt.id,
      {
        kind: "ACCEPTED",
        telegramMessageId: "123456"
      }
    );

    expect(result).toEqual({
      finalized: false,
      reason: "DELIVERY_CLAIM_NOT_CURRENT"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { notification: true, attempts: true }
      });

    expect(delivery.status).toBe("SENDING");
    expect(delivery.claimId).toBe(fixture.claimId);
    expect(delivery.notification.status).toBe("PENDING");
    expect(delivery.attempts[0].outcome).toBe("REQUEST_STARTED");
    expect(delivery.attempts[0].responseReceivedAt).toBeNull();
  });

  it("rejects expired claim leases without finalizing", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotificationDelivery.update({
      where: { id: fixture.delivery.id },
      data: {
        processingUntil: new Date(Date.now() - 60_000)
      }
    });

    const result = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "ACCEPTED",
        telegramMessageId: "123456"
      }
    );

    expect(result).toEqual({
      finalized: false,
      reason: "CLAIM_LEASE_EXPIRED"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: { notification: true, attempts: true }
      });

    expect(delivery.status).toBe("SENDING");
    expect(delivery.notification.status).toBe("PENDING");
    expect(delivery.attempts[0].outcome).toBe("REQUEST_STARTED");
    expect(delivery.attempts[0].responseReceivedAt).toBeNull();
  });
  it("rejects duplicate finalization without overwriting the first result", async () => {
    const fixture = await createFixture();

    const first = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "ACCEPTED",
        telegramMessageId: "123456"
      }
    );

    expect(first).toEqual({
      finalized: true,
      disposition: "SENT"
    });

    const second = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "PERMANENT_FAILURE",
        reason: "BOT_BLOCKED"
      }
    );

    expect(second).toEqual({
      finalized: false,
      reason: "DELIVERY_CLAIM_NOT_CURRENT"
    });

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: {
          notification: true,
          attempts: true
        }
      });

    expect(delivery.status).toBe("SENT");
    expect(delivery.notification.status).toBe("COMPLETED");
    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].outcome).toBe("SUCCEEDED");
    expect(delivery.attempts[0].telegramMessageId).toBe("123456");
    expect(delivery.attempts[0].sanitizedError).toBeNull();
  });
  it("allows only one concurrent finalization for the same claim", async () => {
    const fixture = await createFixture();

    const results = await Promise.all([
      finalizePlatformBillingNotification(
        fixture.delivery.id,
        fixture.claimId,
        fixture.attempt.id,
        {
          kind: "ACCEPTED",
          telegramMessageId: "123456"
        }
      ),
      finalizePlatformBillingNotification(
        fixture.delivery.id,
        fixture.claimId,
        fixture.attempt.id,
        {
          kind: "PERMANENT_FAILURE",
          reason: "BOT_BLOCKED"
        }
      )
    ]);

    expect(results.filter((result) => result.finalized)).toHaveLength(1);
    expect(results.filter((result) => !result.finalized)).toHaveLength(1);

    const delivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: {
          notification: true,
          attempts: true
        }
      });

    expect(["SENT", "FAILED"]).toContain(delivery.status);
    expect(delivery.notification.status).toBe("COMPLETED");
    expect(delivery.claimId).toBeNull();
    expect(delivery.processingUntil).toBeNull();
    expect(delivery.attempts).toHaveLength(1);

    if (delivery.status === "SENT") {
      expect(delivery.attempts[0].outcome).toBe("SUCCEEDED");
      expect(delivery.attempts[0].telegramMessageId).toBe("123456");
    } else {
      expect(delivery.attempts[0].outcome).toBe("REQUEST_STARTED");
      expect(delivery.attempts[0].sanitizedError).toBe("BOT_BLOCKED");
    }
  });
  it("rolls back attempt, delivery and quarantine when notification fencing fails", async () => {
    const fixture = await createFixture();

    await prisma.platformBillingNotification.update({
      where: { id: fixture.notification.id },
      data: { status: "COMPLETED" }
    });

    const before =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: {
          notification: true,
          attempts: true,
          quarantine: true
        }
      });

    const result = await finalizePlatformBillingNotification(
      fixture.delivery.id,
      fixture.claimId,
      fixture.attempt.id,
      {
        kind: "AMBIGUOUS",
        reason: "TIMEOUT"
      }
    );

    expect(result).toEqual({
      finalized: false,
      reason: "DELIVERY_CLAIM_NOT_CURRENT"
    });

    const after =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: fixture.delivery.id },
        include: {
          notification: true,
          attempts: true,
          quarantine: true
        }
      });

    expect(after.status).toBe(before.status);
    expect(after.claimId).toBe(before.claimId);
    expect(after.processingUntil).toEqual(before.processingUntil);
    expect(after.notification.status).toBe("COMPLETED");
    expect(after.attempts[0].outcome).toBe("REQUEST_STARTED");
    expect(after.attempts[0].responseReceivedAt).toBeNull();
    expect(after.quarantine).toBeNull();
  });
  it("rolls back partial finalization writes after a database failure", async () => {
    const fixture = await createFixture();

    const triggerName = `b635_rollback_${randomUUID().replace(/-/g, "")}`;
    const functionName = `${triggerName}_fn`;

    try {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.id = '${fixture.notification.id}'
             AND NEW.status = 'REVIEW_REQUIRED' THEN
            RAISE EXCEPTION 'B635_INJECTED_NOTIFICATION_FAILURE';
          END IF;
          RETURN NEW;
        END;
        $$
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE UPDATE ON "PlatformBillingNotification"
        FOR EACH ROW
        EXECUTE FUNCTION "${functionName}"()
      `);

      await expect(
        finalizePlatformBillingNotification(
          fixture.delivery.id,
          fixture.claimId,
          fixture.attempt.id,
          {
            kind: "AMBIGUOUS",
            reason: "TIMEOUT"
          }
        )
      ).rejects.toThrow();

      const delivery =
        await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
          where: { id: fixture.delivery.id },
          include: {
            notification: true,
            attempts: true,
            quarantine: true
          }
        });

      expect(delivery.status).toBe("SENDING");
      expect(delivery.claimId).toBe(fixture.claimId);
      expect(delivery.processingUntil).not.toBeNull();
      expect(delivery.notification.status).toBe("PENDING");
      expect(delivery.attempts).toHaveLength(1);
      expect(delivery.attempts[0].outcome).toBe("REQUEST_STARTED");
      expect(delivery.attempts[0].responseReceivedAt).toBeNull();
      expect(delivery.quarantine).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "PlatformBillingNotification"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS "${functionName}"()`
      );
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
