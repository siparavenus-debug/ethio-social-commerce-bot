import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";

import {
  updateBillingTelegramPreferences
} from "../src/services/merchant-billing-telegram-preferences.js";

import {
  redeemBillingTelegramLink
} from "../src/services/merchant-billing-telegram-redemption.js";

import {
  unlinkBillingTelegramDestination
} from "../src/services/merchant-billing-telegram-unlink.js";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";

describe("B3.6 database-backed billing Telegram preferences", () => {
  const expectedDatabase =
    "ethio_commerce_b2_migration_test";

  const runId = randomUUID().replace(/-/g, "");

  const createdMerchantIds = new Set<string>();
  const createdBotIds = new Set<string>();
  const createdBotIdentityIds = new Set<string>();

  let databaseInitializationSucceeded = false;

  async function requireIsolatedDatabase(): Promise<void> {
    if (process.env.API_TEST_SUITE !== "billing-telegram-b3") {
      throw new Error(
        "B3.6 database tests require the billing-telegram-b3 suite."
      );
    }

    const database = await prisma.$queryRaw<
      Array<{ database_name: string }>
    >`
      SELECT current_database() AS database_name
    `;

    if (database[0]?.database_name !== expectedDatabase) {
      throw new Error(
        "Refusing B3.6 tests outside the isolated database."
      );
    }
  }

  beforeAll(async () => {
    await requireIsolatedDatabase();
    databaseInitializationSucceeded = true;
  });

  afterAll(async () => {
    if (!databaseInitializationSucceeded) {
      return;
    }

    await requireIsolatedDatabase();

    const merchantIds = [...createdMerchantIds];
    const botIds = [...createdBotIds];
    const identityIds = [...createdBotIdentityIds];

    expect(merchantIds.length).toBe(botIds.length);
    expect(botIds.length).toBe(identityIds.length);

    if (merchantIds.length === 0) {
      return;
    }

    const merchants = await prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, name: true }
    });

    expect(merchants).toHaveLength(merchantIds.length);

    for (const merchant of merchants) {
      expect(merchant.name).toMatch(/^B3\.6 /);
      expect(merchant.name).toContain(runId);
    }

    const bots = await prisma.platformBillingTelegramBot.findMany({
      where: { id: { in: botIds } },
      select: {
        id: true,
        botIdentityId: true,
        webhookKey: true
      }
    });

    expect(bots).toHaveLength(botIds.length);

    for (const bot of bots) {
      expect(bot.webhookKey).toMatch(/^b36-/);
      expect(bot.webhookKey).toContain(runId);
    }

    const identities =
      await prisma.telegramBotIdentityRegistry.findMany({
        where: { id: { in: identityIds } },
        select: { id: true, telegramBotId: true }
      });

    expect(identities).toHaveLength(identityIds.length);

    for (const identity of identities) {
      expect(identity.telegramBotId).toMatch(/^b36-/);
      expect(identity.telegramBotId).toContain(runId);
    }

    const expectedIdentityIds = new Set(identityIds);
    const actualIdentityIds = new Set(
      bots.map((bot) => bot.botIdentityId)
    );

    expect(actualIdentityIds).toEqual(expectedIdentityIds);

    // Preserve all fixtures, including immutable audit records.
    // No database records are deleted by this hook.
  });

  it("disables notifications, suppresses a pending delivery and audits the OWNER", async () => {
    await requireIsolatedDatabase();

    const fixtureId = `${runId}-${randomUUID().replace(/-/g, "")}`;

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.6 preferences ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b36-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b36-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b36-${fixtureId}`,
        status: "ACTIVE"
      }
    });

    createdBotIds.add(bot.id);

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
          status: "ACTIVE",
          linkVersion: 1,
          consentedAt: new Date()
        }
      });

    expect(destination.notificationsEnabled).toBe(true);

    const event = await prisma.platformBillingEvent.create({
      data: {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: `b36-source-${fixtureId}`,
        occurrenceKey: `b36-event-${fixtureId}`
      }
    });

    const notification =
      await prisma.platformBillingNotification.create({
        data: {
          merchantId: merchant.id,
          eventId: event.id,
          status: "PENDING"
        }
      });

    const delivery =
      await prisma.platformBillingNotificationDelivery.create({
        data: {
          merchantId: merchant.id,
          notificationId: notification.id,
          destinationId: destination.id,
          destinationLinkVersion: destination.linkVersion,
          status: "PENDING"
        }
      });

    const attempts = await Promise.allSettled([
      updateBillingTelegramPreferences(
        merchant.id,
        owner.id,
        owner.tokenVersion,
        false
      ),
      updateBillingTelegramPreferences(
        merchant.id,
        owner.id,
        owner.tokenVersion,
        false
      )
    ]);

    expect(attempts.every(
      (attempt) => attempt.status === "fulfilled"
    )).toBe(true);

    const results = attempts.flatMap((attempt) =>
      attempt.status === "fulfilled"
        ? [attempt.value]
        : []
    );

    expect(results).toHaveLength(2);

    expect(results).toContainEqual({
      ok: true,
      notificationsEnabled: false,
      suppressedDeliveries: 1
    });

    expect(results).toContainEqual({
      ok: true,
      notificationsEnabled: false,
      suppressedDeliveries: 0
    });

    const persistedDestination =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(persistedDestination.notificationsEnabled).toBe(false);
    expect(persistedDestination.status).toBe("ACTIVE");
    expect(persistedDestination.revokedAt).toBeNull();

    const persistedDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id }
      });

    expect(persistedDelivery.status).toBe("SUPPRESSED");
    expect(persistedDelivery.terminalReason).toBe(
      "DESTINATION_NOTIFICATIONS_DISABLED"
    );
    expect(persistedDelivery.claimId).toBeNull();
    expect(persistedDelivery.processingUntil).toBeNull();

    const audits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_PREFERENCES_UPDATED",
          entityId: destination.id
        }
      });

    expect(audits).toHaveLength(1);

    expect(audits[0]).toMatchObject({
      merchantId: merchant.id,
      actorType: "MERCHANT_OWNER",
      actorMerchantUserId: owner.id,
      action: "BILLING_TELEGRAM_PREFERENCES_UPDATED",
      entityType: "MerchantBillingTelegramDestination",
      entityId: destination.id
    });

    expect(audits[0]?.sanitizedMetadata).toMatchObject({
      destinationLinkVersion: destination.linkVersion,
      previousNotificationsEnabled: true,
      notificationsEnabled: false,
      suppressedDeliveries: 1
    });
    // Repeating the same preference must not create new effects.
    const repeatedResult = await updateBillingTelegramPreferences(
      merchant.id,
      owner.id,
      owner.tokenVersion,
      false
    );

    expect(repeatedResult).toEqual({
      ok: true,
      notificationsEnabled: false,
      suppressedDeliveries: 0
    });

    const destinationAfterRepeat =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(destinationAfterRepeat.notificationsEnabled).toBe(false);
    expect(destinationAfterRepeat.status).toBe("ACTIVE");

    const deliveryAfterRepeat =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id }
      });

    expect(deliveryAfterRepeat.status).toBe("SUPPRESSED");
    expect(deliveryAfterRepeat.terminalReason).toBe(
      "DESTINATION_NOTIFICATIONS_DISABLED"
    );

    const auditCountAfterRepeat =
      await prisma.platformBillingNotificationAudit.count({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_PREFERENCES_UPDATED",
          entityId: destination.id
        }
      });

    expect(auditCountAfterRepeat).toBe(1);
    // A stale OWNER token version must be rejected.
    const staleTokenResult = await updateBillingTelegramPreferences(
      merchant.id,
      owner.id,
      owner.tokenVersion + 1,
      true
    );

    expect(staleTokenResult).toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    // An ADMIN cannot perform an OWNER-only preference change.
    const admin = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b36-admin-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "ADMIN",
        tokenVersion: 0
      }
    });

    const adminResult = await updateBillingTelegramPreferences(
      merchant.id,
      admin.id,
      admin.tokenVersion,
      true
    );

    expect(adminResult).toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    // An OWNER cannot operate on a different merchant.
    const crossMerchantResult = await updateBillingTelegramPreferences(
      `different-merchant-${fixtureId}`,
      owner.id,
      owner.tokenVersion,
      true
    );

    expect(crossMerchantResult).toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    const destinationAfterRejections =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(destinationAfterRejections.notificationsEnabled).toBe(false);
    expect(destinationAfterRejections.status).toBe("ACTIVE");

    const deliveryAfterRejections =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id }
      });

    expect(deliveryAfterRejections.status).toBe("SUPPRESSED");
    expect(deliveryAfterRejections.terminalReason).toBe(
      "DESTINATION_NOTIFICATIONS_DISABLED"
    );

    const auditCountAfterRejections =
      await prisma.platformBillingNotificationAudit.count({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_PREFERENCES_UPDATED",
          entityId: destination.id
        }
      });

    expect(auditCountAfterRejections).toBe(1);
  });
  it("rejects disabling notifications with an unsafe PROCESSING delivery", async () => {
    await requireIsolatedDatabase();

    const fixtureId =
      `${runId}-${randomUUID().replace(/-/g, "")}`;

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.6 unsafe processing ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b36-unsafe-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity =
      await prisma.telegramBotIdentityRegistry.create({
        data: {
          telegramBotId: `b36-unsafe-${fixtureId}`
        }
      });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b36-unsafe-${fixtureId}`,
        status: "ACTIVE"
      }
    });

    createdBotIds.add(bot.id);

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
          status: "ACTIVE",
          linkVersion: 1,
          consentedAt: new Date()
        }
      });

    expect(destination.notificationsEnabled).toBe(true);

    const event = await prisma.platformBillingEvent.create({
      data: {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: `b36-unsafe-source-${fixtureId}`,
        occurrenceKey: `b36-unsafe-event-${fixtureId}`
      }
    });

    const notification =
      await prisma.platformBillingNotification.create({
        data: {
          merchantId: merchant.id,
          eventId: event.id,
          status: "PENDING"
        }
      });

    const delivery =
      await prisma.platformBillingNotificationDelivery.create({
        data: {
          merchantId: merchant.id,
          notificationId: notification.id,
          destinationId: destination.id,
          destinationLinkVersion: destination.linkVersion,
          status: "PROCESSING",
          claimId: `b36-unsafe-claim-${fixtureId}`,
          processingUntil: new Date(
            Date.now() + 5 * 60 * 1000
          )
        }
      });

    const result = await updateBillingTelegramPreferences(
      merchant.id,
      owner.id,
      owner.tokenVersion,
      false
    );

    expect(result).toEqual({
      ok: false,
      reason: "UNSAFE_IN_FLIGHT"
    });

    const persistedDestination =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(persistedDestination.notificationsEnabled).toBe(true);
    expect(persistedDestination.status).toBe("ACTIVE");
    expect(persistedDestination.revokedAt).toBeNull();

    const persistedDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id }
      });

    expect(persistedDelivery.status).toBe("PROCESSING");
    expect(persistedDelivery.claimId).toBe(delivery.claimId);
    expect(persistedDelivery.processingUntil).toEqual(
      delivery.processingUntil
    );
    expect(persistedDelivery.terminalReason).toBeNull();

    const auditCount =
      await prisma.platformBillingNotificationAudit.count({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_PREFERENCES_UPDATED",
          entityId: destination.id
        }
      });

    expect(auditCount).toBe(0);
  });

  it("rejects a link token issued before an OWNER password reset", async () => {
    await requireIsolatedDatabase();

    const fixtureId = `${runId}-${randomUUID().replace(/-/g, "")}`;

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.6 password reset ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b36-reset-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b36-reset-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b36-reset-${fixtureId}`,
        status: "ACTIVE"
      }
    });

    createdBotIds.add(bot.id);

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

    const tokenHash = createHash("sha256")
      .update(`b36-reset-token-${fixtureId}`)
      .digest("hex");

    const token = await prisma.platformTelegramLinkToken.create({
      data: {
        merchantId: merchant.id,
        createdByUserId: owner.id,
        createdByTokenVersion: owner.tokenVersion,
        tokenHash,
        expiresAt: new Date(Date.now() + 600_000)
      }
    });

    const updatedOwner = await prisma.merchantUser.update({
      where: { id: owner.id },
      data: {
        tokenVersion: { increment: 1 }
      },
      select: { tokenVersion: true }
    });

    expect(updatedOwner.tokenVersion).toBe(1);

    const result = await redeemBillingTelegramLink({
      tokenHash,
      platformBotId: bot.id,
      chatId: "333333333",
      telegramUserId: "333333333"
    });

    expect(result).toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    const persistedToken =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: { id: token.id }
      });

    expect(persistedToken.createdByTokenVersion).toBe(0);
    expect(persistedToken.consumedAt).toBeNull();
    expect(persistedToken.revokedAt).toBeNull();

    const destinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: { merchantId: merchant.id }
      });

    expect(destinations).toHaveLength(0);

    const auditCount =
      await prisma.platformBillingNotificationAudit.count({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_LINKED"
        }
      });

    expect(auditCount).toBe(0);
  });

  async function createUnlinkFixture(
    scenario: string,
    deliveryStatus: "PENDING" | "REVIEW_REQUIRED"
  ) {
    await requireIsolatedDatabase();

    const fixtureId = `${runId}-${randomUUID().replace(/-/g, "")}`;

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.6 unlink ${scenario} ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });
    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b36-unlink-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b36-unlink-${fixtureId}`
      }
    });
    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b36-unlink-${fixtureId}`,
        status: "ACTIVE"
      }
    });
    createdBotIds.add(bot.id);

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
          chatId: "444444444",
          telegramUserId: "444444444",
          linkedByUserId: owner.id,
          status: "ACTIVE",
          linkVersion: 1,
          consentedAt: new Date()
        }
      });

    const event = await prisma.platformBillingEvent.create({
      data: {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: `b36-unlink-source-${fixtureId}`,
        occurrenceKey: `b36-unlink-event-${fixtureId}`
      }
    });

    const notification =
      await prisma.platformBillingNotification.create({
        data: {
          merchantId: merchant.id,
          eventId: event.id,
          status: "PENDING"
        }
      });

    const delivery =
      await prisma.platformBillingNotificationDelivery.create({
        data: {
          merchantId: merchant.id,
          notificationId: notification.id,
          destinationId: destination.id,
          destinationLinkVersion: destination.linkVersion,
          status: deliveryStatus
        }
      });

    return {
      fixtureId,
      merchant,
      owner,
      destination,
      delivery
    };
  }

  it("unlinks a destination, suppresses pending delivery, revokes tokens and audits OWNER", async () => {
    const fixture = await createUnlinkFixture(
      "success",
      "PENDING"
    );

    const { merchant, owner, destination, delivery, fixtureId } =
      fixture;

    const token = await prisma.platformTelegramLinkToken.create({
      data: {
        merchantId: merchant.id,
        createdByUserId: owner.id,
        createdByTokenVersion: owner.tokenVersion,
        tokenHash: createHash("sha256")
          .update(`b36-unlink-token-${fixtureId}`)
          .digest("hex"),
        expiresAt: new Date(Date.now() + 600_000)
      }
    });

    const result = await unlinkBillingTelegramDestination(
      merchant.id,
      owner.id,
      owner.tokenVersion
    );

    expect(result).toEqual({
      ok: true,
      unlinked: true
    });

    const persistedDestination =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(persistedDestination.status).toBe("REVOKED");
    expect(persistedDestination.revokedAt).not.toBeNull();

    const persistedDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id }
      });

    expect(persistedDelivery.status).toBe("SUPPRESSED");
    expect(persistedDelivery.terminalReason).toBe(
      "DESTINATION_UNLINKED"
    );
    expect(persistedDelivery.claimId).toBeNull();
    expect(persistedDelivery.processingUntil).toBeNull();

    const persistedToken =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: { id: token.id }
      });

    expect(persistedToken.revokedAt).not.toBeNull();
    expect(persistedToken.consumedAt).toBeNull();

    const audits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_UNLINKED",
          entityId: destination.id
        }
      });

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      merchantId: merchant.id,
      actorType: "MERCHANT_OWNER",
      actorMerchantUserId: owner.id,
      action: "BILLING_TELEGRAM_DESTINATION_UNLINKED",
      entityType: "MerchantBillingTelegramDestination",
      entityId: destination.id
    });
    expect(audits[0]?.sanitizedMetadata).toMatchObject({
      destinationLinkVersion: destination.linkVersion
    });
  });

  it("rejects unlink for REVIEW_REQUIRED delivery without unresolved attempts", async () => {
    const { merchant, owner, destination, delivery } =
      await createUnlinkFixture("review", "REVIEW_REQUIRED");

    const attempts =
      await prisma.platformBillingNotificationAttempt.count({
        where: { deliveryId: delivery.id }
      });

    expect(attempts).toBe(0);

    const result = await unlinkBillingTelegramDestination(
      merchant.id,
      owner.id,
      owner.tokenVersion
    );

    expect(result).toEqual({
      ok: false,
      reason: "UNSAFE_IN_FLIGHT"
    });

    const persistedDestination =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(persistedDestination.status).toBe("ACTIVE");
    expect(persistedDestination.revokedAt).toBeNull();

    const persistedDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id }
      });

    expect(persistedDelivery.status).toBe("REVIEW_REQUIRED");
    expect(persistedDelivery.terminalReason).toBeNull();

    const auditCount =
      await prisma.platformBillingNotificationAudit.count({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_UNLINKED"
        }
      });

    expect(auditCount).toBe(0);
  });

  it("makes repeated unlink idempotent and rejects stale and non-OWNER callers", async () => {
    const { merchant, owner, destination } =
      await createUnlinkFixture("authorization", "PENDING");

    const staleResult = await unlinkBillingTelegramDestination(
      merchant.id,
      owner.id,
      owner.tokenVersion + 1
    );

    expect(staleResult).toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    const admin = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b36-unlink-admin-${randomUUID()}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "ADMIN",
        tokenVersion: 0
      }
    });

    const adminResult = await unlinkBillingTelegramDestination(
      merchant.id,
      admin.id,
      admin.tokenVersion
    );

    expect(adminResult).toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE"
    });

    const beforeUnlink =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(beforeUnlink.status).toBe("ACTIVE");

    const firstResult = await unlinkBillingTelegramDestination(
      merchant.id,
      owner.id,
      owner.tokenVersion
    );

    expect(firstResult).toEqual({
      ok: true,
      unlinked: true
    });

    const repeatedResult = await unlinkBillingTelegramDestination(
      merchant.id,
      owner.id,
      owner.tokenVersion
    );

    expect(repeatedResult).toEqual({
      ok: true,
      unlinked: false
    });

    const audits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_UNLINKED",
          entityId: destination.id
        }
      });

    expect(audits).toHaveLength(1);

    const persistedDestination =
      await prisma.merchantBillingTelegramDestination.findUniqueOrThrow({
        where: { id: destination.id }
      });

    expect(persistedDestination.status).toBe("REVOKED");
    expect(persistedDestination.revokedAt).not.toBeNull();
  });
});
