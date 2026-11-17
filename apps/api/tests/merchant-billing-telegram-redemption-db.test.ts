import {
  createHash,
  randomUUID
} from "node:crypto";

import {
  prisma
} from "@ethio-commerce/database";

import {
  redeemBillingTelegramLink
} from "../src/services/merchant-billing-telegram-redemption.js";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";

describe("B3.5 database-backed billing Telegram redemption", () => {
  const runId = randomUUID().replace(/-/g, "");

  const createdMerchantIds = new Set<string>();
  const createdBotIds = new Set<string>();
  const createdBotIdentityIds = new Set<string>();

  let databaseInitializationSucceeded = false;

  const expectedDatabase =
    "ethio_commerce_b2_migration_test";

  async function requireCleanupDatabase(): Promise<void> {
    if (process.env.API_TEST_SUITE !== "billing-telegram-b3") {
      throw new Error(
        "Refusing B3.5 cleanup outside the authorized test suite."
      );
    }

    const database = await prisma.$queryRaw<
      Array<{ database_name: string }>
    >`
      SELECT current_database() AS database_name
    `;

    if (database[0]?.database_name !== expectedDatabase) {
      throw new Error(
        "Refusing B3.5 cleanup outside the isolated database."
      );
    }
  }

  async function validateCleanupOwnership(): Promise<void> {
    const merchantIds = [...createdMerchantIds];
    const botIds = [...createdBotIds];
    const identityIds = [...createdBotIdentityIds];

    if (
      merchantIds.length !== botIds.length ||
      botIds.length !== identityIds.length
    ) {
      throw new Error("B3.5 fixture registry counts differ.");
    }

    if (merchantIds.length === 0) {
      return;
    }

    const merchants = await prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, name: true }
    });

    if (
      merchants.length !== merchantIds.length ||
      merchants.some(
        (merchant) => !merchant.name.startsWith("B3.5 ")
      )
    ) {
      throw new Error("B3.5 merchant ownership validation failed.");
    }

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
      bots.some((bot) => !bot.webhookKey.startsWith("b35-"))
    ) {
      throw new Error("B3.5 platform bot ownership validation failed.");
    }

    const identities =
      await prisma.telegramBotIdentityRegistry.findMany({
        where: { id: { in: identityIds } },
        select: { id: true, telegramBotId: true }
      });

    if (
      identities.length !== identityIds.length ||
      identities.some(
        (identity) => !identity.telegramBotId.startsWith("b35-")
      )
    ) {
      throw new Error("B3.5 bot identity ownership validation failed.");
    }

    const expectedIdentityIds = new Set(identityIds);
    const actualIdentityIds = new Set(
      bots.map((bot) => bot.botIdentityId)
    );

    if (
      actualIdentityIds.size !== expectedIdentityIds.size ||
      [...actualIdentityIds].some(
        (id) => !expectedIdentityIds.has(id)
      )
    ) {
      throw new Error("B3.5 bot-to-identity ownership mismatch.");
    }
  }
  beforeAll(async () => {
    if (
      process.env.API_TEST_SUITE !== "billing-telegram-b3"
    ) {
      throw new Error(
        "B3.5 database tests require the billing-telegram-b3 suite."
      );
    }

    const database = await prisma.$queryRaw<
      Array<{ database_name: string }>
    >`
      SELECT current_database() AS database_name
    `;

    if (database[0]?.database_name !== expectedDatabase) {
      throw new Error(
        "Refusing B3.5 tests outside the isolated B2/B3 database."
      );
    }

    databaseInitializationSucceeded = true;
  });

  afterAll(async () => {
    if (!databaseInitializationSucceeded) {
      return;
    }

    await requireCleanupDatabase();
    await validateCleanupOwnership();

    // Cleanup transaction will be added after ownership review.
    // No database records are deleted by this hook.
  });

  it("connects only to the authorized isolated database", async () => {
    const database = await prisma.$queryRaw<
      Array<{ database_name: string }>
    >`
      SELECT current_database() AS database_name
    `;

    expect(database).toEqual([
      { database_name: expectedDatabase }
    ]);

    expect(runId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("commits destination, token consumption and audit atomically", async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.5 redemption test ${runId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b35-${runId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b35-${runId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b35-${runId}`,
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
      .update(`b35-redemption-${runId}`)
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

    const telegramId = "123456789";

    const result = await redeemBillingTelegramLink({
      tokenHash,
      platformBotId: bot.id,
      chatId: telegramId,
      telegramUserId: telegramId
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Redemption rejected: ${result.reason}`);
    }

    expect(result.value.merchantId).toBe(merchant.id);
    expect(result.value.replacedPreviousDestination).toBe(false);

    const destinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: {
          merchantId: merchant.id,
          status: "ACTIVE"
        }
      });

    expect(destinations).toHaveLength(1);
    expect(destinations[0]?.id).toBe(result.value.destinationId);
    expect(destinations[0]?.platformBotId).toBe(bot.id);
    expect(destinations[0]?.linkedByUserId).toBe(owner.id);
    expect(destinations[0]?.chatId).toBe(telegramId);
    expect(destinations[0]?.telegramUserId).toBe(telegramId);

    const persistedToken =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: {
          id: token.id
        }
      });

    expect(persistedToken.consumedAt).not.toBeNull();
    expect(persistedToken.revokedAt).toBeNull();

    const audits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_LINKED",
          entityType: "BILLING_TELEGRAM_DESTINATION",
          entityId: result.value.destinationId
        }
      });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorType).toBe("MERCHANT_OWNER");
    expect(audits[0]?.actorMerchantUserId).toBe(owner.id);
    expect(audits[0]?.actorPlatformUserId).toBeNull();
  });

  it("serializes concurrent redemption of the same token", async () => {
    const fixtureId = randomUUID().replace(/-/g, "");

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.5 concurrency fixture ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b35-concurrent-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b35-concurrent-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b35-concurrent-${fixtureId}`,
        status: "ACTIVE"
      }
    });

    createdBotIds.add(bot.id);

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

    const tokenHash = createHash("sha256")
      .update(`b35-concurrent-${fixtureId}`)
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

    expect(merchant.accountStatus).toBe("ACTIVE");
    expect(owner.role).toBe("OWNER");
    expect(reservation.status).toBe("RESERVED");
    expect(reservation.platformBillingBotId).toBe(bot.id);
    expect(token.consumedAt).toBeNull();

    const telegramId = "123456789";

    const request = {
      tokenHash,
      platformBotId: bot.id,
      chatId: telegramId,
      telegramUserId: telegramId
    };

    const attempts = await Promise.allSettled([
      redeemBillingTelegramLink(request),
      redeemBillingTelegramLink(request)
    ]);

    const fulfilled = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<
        Awaited<ReturnType<typeof redeemBillingTelegramLink>>
      > => attempt.status === "fulfilled"
    );

    expect(fulfilled).toHaveLength(2);

    const successes = fulfilled.filter(
      (attempt) => attempt.value.ok
    );

    const rejections = fulfilled.filter(
      (attempt) =>
        !attempt.value.ok &&
        attempt.value.reason === "NOT_ELIGIBLE"
    );

    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    const destinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: {
          merchantId: merchant.id
        }
      });

    expect(destinations).toHaveLength(1);
    expect(destinations[0]?.status).toBe("ACTIVE");
    expect(destinations[0]?.platformBotId).toBe(bot.id);
    expect(destinations[0]?.chatId).toBe(telegramId);
    expect(destinations[0]?.linkedByUserId).toBe(owner.id);

    const persistedToken =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: {
          id: token.id
        }
      });

    expect(persistedToken.consumedAt).not.toBeNull();
    expect(persistedToken.revokedAt).toBeNull();

    const audits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_LINKED"
        }
      });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityId).toBe(destinations[0]?.id);
    expect(audits[0]?.actorType).toBe("MERCHANT_OWNER");
    expect(audits[0]?.actorMerchantUserId).toBe(owner.id);
  });
  it("rolls back destination and token consumption when audit insertion fails", async () => {
    const fixtureId = randomUUID().replace(/-/g, "");

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.5 rollback fixture ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b35-rollback-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b35-rollback-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b35-rollback-${fixtureId}`,
        status: "ACTIVE"
      }
    });

    createdBotIds.add(bot.id);

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

    const tokenHash = createHash("sha256")
      .update(`b35-rollback-${fixtureId}`)
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

    expect(merchant.accountStatus).toBe("ACTIVE");
    expect(owner.role).toBe("OWNER");
    expect(owner.tokenVersion).toBe(token.createdByTokenVersion);
    expect(bot.status).toBe("ACTIVE");
    expect(reservation.status).toBe("RESERVED");
    expect(reservation.platformBillingBotId).toBe(bot.id);
    expect(token.consumedAt).toBeNull();
    expect(token.revokedAt).toBeNull();
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const constraintName = `b35_rollback_${fixtureId}`;

    if (!/^b35_rollback_[a-f0-9]{32}$/.test(constraintName)) {
      throw new Error("Invalid test constraint name");
    }

    const constraintIdentifier = `"${constraintName}"`;

    const constraintExists = async () => {
      const rows = await prisma.$queryRaw<
        Array<{ constraint_name: string }>
      >`
        SELECT con.conname AS constraint_name
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public'
          AND rel.relname = 'PlatformBillingNotificationAudit'
          AND con.conname = ${constraintName}
      `;

      return rows.length > 0;
    };

    let constraintInstalled = false;

    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "PlatformBillingNotificationAudit"
        ADD CONSTRAINT ${constraintIdentifier}
        CHECK ("merchantId" IS DISTINCT FROM '${merchant.id}')
        NOT VALID
      `);

      constraintInstalled = true;

      expect(await constraintExists()).toBe(true);

      let redemptionError: unknown;

      try {
        await redeemBillingTelegramLink({
          tokenHash,
          platformBotId: bot.id,
          chatId: "987654321",
          telegramUserId: "987654321"
        });
      } catch (error) {
        redemptionError = error;
      }

      expect(redemptionError).toBeDefined();

      const outerRecord =
        redemptionError as Record<string, unknown>;

      const metadata =
        outerRecord.meta &&
        typeof outerRecord.meta === "object"
          ? outerRecord.meta as Record<string, unknown>
          : null;

      const adapterError = metadata?.driverAdapterError;

      const adapterRecord =
        adapterError &&
        typeof adapterError === "object"
          ? adapterError as Record<string, unknown>
          : null;

      const adapterCause = adapterRecord?.cause;

      const causeRecord =
        adapterCause &&
        typeof adapterCause === "object"
          ? adapterCause as Record<string, unknown>
          : null;

      expect(
        causeRecord?.code
      ).toBe("23514");

      expect(
        causeRecord?.kind
      ).toBe("postgres");

      const originalMessage =
        typeof causeRecord?.originalMessage === "string"
          ? causeRecord.originalMessage
          : null;

      expect(originalMessage).not.toBeNull();
      expect(originalMessage).toContain(constraintName);

      const destinations =
        await prisma.merchantBillingTelegramDestination.count({
          where: {
            merchantId: merchant.id
          }
        });

      expect(destinations).toBe(0);

      const persistedToken =
        await prisma.platformTelegramLinkToken.findUniqueOrThrow({
          where: {
            id: token.id
          }
        });

      expect(persistedToken.consumedAt).toBeNull();
      expect(persistedToken.revokedAt).toBeNull();

      const audits =
        await prisma.platformBillingNotificationAudit.count({
          where: {
            merchantId: merchant.id,
            action: "BILLING_TELEGRAM_DESTINATION_LINKED"
          }
        });

      expect(audits).toBe(0);
    } finally {
      if (constraintInstalled || await constraintExists()) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "PlatformBillingNotificationAudit"
          DROP CONSTRAINT IF EXISTS ${constraintIdentifier}
        `);
      }

      expect(await constraintExists()).toBe(false);
    }
  });
  it("replaces an existing ACTIVE destination atomically in PostgreSQL", async () => {
    const fixtureId = randomUUID().replace(/-/g, "");

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.5 replacement fixture ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b35-replace-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b35-replace-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b35-replace-${fixtureId}`,
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

    const oldDestination =
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

    const tokenHash = createHash("sha256")
      .update(`b35-replace-${fixtureId}`)
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

    const result = await redeemBillingTelegramLink({
      tokenHash,
      platformBotId: bot.id,
      chatId: "222222222",
      telegramUserId: "222222222"
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Replacement rejected: ${result.reason}`);
    }

    expect(result.value.merchantId).toBe(merchant.id);
    expect(result.value.replacedPreviousDestination).toBe(true);

    const destinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: { merchantId: merchant.id }
      });

    expect(destinations).toHaveLength(2);

    const previous = destinations.find(
      (destination) => destination.id === oldDestination.id
    );

    const active = destinations.filter(
      (destination) => destination.status === "ACTIVE"
    );

    expect(previous?.status).toBe("REVOKED");
    expect(previous?.revokedAt).not.toBeNull();

    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(result.value.destinationId);
    expect(active[0]?.chatId).toBe("222222222");
    expect(active[0]?.telegramUserId).toBe("222222222");
    expect(active[0]?.revokedAt).toBeNull();

    const persistedToken =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: { id: token.id }
      });

    expect(persistedToken.consumedAt).not.toBeNull();
    expect(persistedToken.revokedAt).toBeNull();

    const audits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_REPLACED",
          entityId: result.value.destinationId
        }
      });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorType).toBe("MERCHANT_OWNER");
    expect(audits[0]?.actorMerchantUserId).toBe(owner.id);
    expect(audits[0]?.sanitizedMetadata).toEqual({
      replacedPreviousDestination: true
    });
  });
  it("rolls back destination replacement when audit insertion fails", async () => {
    const fixtureId = randomUUID().replace(/-/g, "");

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.5 replacement rollback ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b35-replace-rollback-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b35-replace-rollback-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b35-replace-rollback-${fixtureId}`,
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

    const original =
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

    const tokenHash = createHash("sha256")
      .update(`b35-replacement-rollback-${fixtureId}`)
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

    const constraintName = `b35_replace_rollback_${fixtureId}`;

    if (!/^b35_replace_rollback_[a-f0-9]{32}$/.test(constraintName)) {
      throw new Error("Invalid replacement rollback constraint name");
    }

    const constraintIdentifier = `"${constraintName}"`;

    const constraintExists = async () => {
      const rows = await prisma.$queryRaw<
        Array<{ constraint_name: string }>
      >`
        SELECT con.conname AS constraint_name
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public'
          AND rel.relname = 'PlatformBillingNotificationAudit'
          AND con.conname = ${constraintName}
      `;

      return rows.length > 0;
    };

    let constraintInstalled = false;

    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "PlatformBillingNotificationAudit"
        ADD CONSTRAINT ${constraintIdentifier}
        CHECK ("merchantId" IS DISTINCT FROM '${merchant.id}')
        NOT VALID
      `);

      constraintInstalled = true;

      expect(await constraintExists()).toBe(true);

      let redemptionError: unknown;

      try {
        await redeemBillingTelegramLink({
          tokenHash,
          platformBotId: bot.id,
          chatId: "222222222",
          telegramUserId: "222222222"
        });
      } catch (error) {
        redemptionError = error;
      }

      expect(redemptionError).toBeDefined();

      const errorRecord =
        redemptionError &&
        typeof redemptionError === "object"
          ? redemptionError as Record<string, unknown>
          : null;

      const metadata =
        errorRecord?.meta &&
        typeof errorRecord.meta === "object"
          ? errorRecord.meta as Record<string, unknown>
          : null;

      const adapterError = metadata?.driverAdapterError;

      const adapterRecord =
        adapterError &&
        typeof adapterError === "object"
          ? adapterError as Record<string, unknown>
          : null;

      const adapterCause = adapterRecord?.cause;

      const causeRecord =
        adapterCause &&
        typeof adapterCause === "object"
          ? adapterCause as Record<string, unknown>
          : null;

      expect(causeRecord?.code).toBe("23514");
      expect(causeRecord?.kind).toBe("postgres");

      const originalMessage =
        typeof causeRecord?.originalMessage === "string"
          ? causeRecord.originalMessage
          : null;

      expect(originalMessage).toContain(constraintName);

      const destinations =
        await prisma.merchantBillingTelegramDestination.findMany({
          where: { merchantId: merchant.id }
        });

      expect(destinations).toHaveLength(1);
      expect(destinations[0]?.id).toBe(original.id);
      expect(destinations[0]?.status).toBe("ACTIVE");
      expect(destinations[0]?.revokedAt).toBeNull();
      expect(destinations[0]?.chatId).toBe("111111111");

      const persistedToken =
        await prisma.platformTelegramLinkToken.findUniqueOrThrow({
          where: { id: token.id }
        });

      expect(persistedToken.consumedAt).toBeNull();
      expect(persistedToken.revokedAt).toBeNull();

      const auditCount =
        await prisma.platformBillingNotificationAudit.count({
          where: {
            merchantId: merchant.id,
            action: "BILLING_TELEGRAM_DESTINATION_LINKED"
          }
        });

      expect(auditCount).toBe(0);
    } finally {
      if (constraintInstalled || await constraintExists()) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "PlatformBillingNotificationAudit"
          DROP CONSTRAINT IF EXISTS ${constraintIdentifier}
        `);
      }

      expect(await constraintExists()).toBe(false);
    }
  });
  it("blocks replacement with a PENDING delivery in PostgreSQL", async () => {
    const fixtureId = randomUUID().replace(/-/g, "");

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.5 unsafe replacement ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b35-unsafe-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b35-unsafe-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b35-unsafe-${fixtureId}`,
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

    const original =
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

    const event = await prisma.platformBillingEvent.create({
      data: {
        merchantId: merchant.id,
        type: "INVOICE_ISSUED",
        sourceId: `b35-unsafe-source-${fixtureId}`,
        occurrenceKey: `b35-unsafe-event-${fixtureId}`
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
          destinationId: original.id,
          destinationLinkVersion: original.linkVersion,
          status: "PENDING"
        }
      });

    const tokenHash = createHash("sha256")
      .update(`b35-unsafe-${fixtureId}`)
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

    const result = await redeemBillingTelegramLink({
      tokenHash,
      platformBotId: bot.id,
      chatId: "222222222",
      telegramUserId: "222222222"
    });

    expect(result).toEqual({
      ok: false,
      reason: "REPLACEMENT_UNSAFE"
    });

    const destinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: { merchantId: merchant.id }
      });

    expect(destinations).toHaveLength(1);
    expect(destinations[0]?.id).toBe(original.id);
    expect(destinations[0]?.status).toBe("ACTIVE");
    expect(destinations[0]?.revokedAt).toBeNull();
    expect(destinations[0]?.chatId).toBe("111111111");
    expect(destinations[0]?.linkVersion).toBe(original.linkVersion);

    const persistedDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id }
      });

    expect(persistedDelivery.status).toBe("PENDING");
    expect(persistedDelivery.destinationId).toBe(original.id);
    expect(persistedDelivery.destinationLinkVersion).toBe(
      original.linkVersion
    );
    expect(persistedDelivery.attemptCount).toBe(0);
    expect(persistedDelivery.claimId).toBeNull();
    expect(persistedDelivery.processingUntil).toBeNull();

    const persistedToken =
      await prisma.platformTelegramLinkToken.findUniqueOrThrow({
        where: { id: token.id }
      });

    expect(persistedToken.consumedAt).toBeNull();
    expect(persistedToken.revokedAt).toBeNull();

    const audits =
      await prisma.platformBillingNotificationAudit.count({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_LINKED"
        }
      });

    expect(audits).toBe(0);
  });
  it("rejects cross-merchant ownership of the same platform bot chat", async () => {
    const fixtureId = randomUUID().replace(/-/g, "");
    const merchants = [];
    const owners = [];
    const bots = [];
    const tokens = [];

    for (const index of [0, 1]) {
      const merchant = await prisma.merchant.create({
        data: {
          name: `B3.5 cross merchant ${fixtureId} ${index}`,
          currency: "ETB",
          accountStatus: "ACTIVE"
        }
      });
      createdMerchantIds.add(merchant.id);
      merchants.push(merchant);

      const owner = await prisma.merchantUser.create({
        data: {
          merchantId: merchant.id,
          email: `b35-cross-${fixtureId}-${index}@example.invalid`,
          passwordHash: "test-only-inert-password-hash",
          role: "OWNER",
          tokenVersion: 0
        }
      });
      owners.push(owner);

      const identity = await prisma.telegramBotIdentityRegistry.create({
        data: {
          telegramBotId: `b35-cross-${fixtureId}-${index}`
        }
      });
      createdBotIdentityIds.add(identity.id);

      const bot = await prisma.platformBillingTelegramBot.create({
        data: {
          botIdentityId: identity.id,
          botTokenEncrypted: "test-only-inert-bot-token",
          webhookSecretEncrypted: "test-only-inert-webhook-secret",
          webhookKey: `b35-cross-${fixtureId}-${index}`,
          status: "ACTIVE"
        }
      });
      createdBotIds.add(bot.id);
      bots.push(bot);

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
        .update(`b35-cross-${fixtureId}-${index}`)
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
      tokens.push(token);
    }

    const sharedBotId = bots[0]!.id;
    const sharedChatId = "987654321";

    const winner = await redeemBillingTelegramLink({
      tokenHash: tokens[0]!.tokenHash,
      platformBotId: sharedBotId,
      chatId: sharedChatId,
      telegramUserId: sharedChatId
    });

    expect(winner.ok).toBe(true);

    await expect(
      redeemBillingTelegramLink({
        tokenHash: tokens[1]!.tokenHash,
        platformBotId: sharedBotId,
        chatId: sharedChatId,
        telegramUserId: sharedChatId
      })
    ).rejects.toThrow();

    const destinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: {
          platformBotId: sharedBotId,
          chatId: sharedChatId,
          status: "ACTIVE"
        }
      });

    expect(destinations).toHaveLength(1);
    expect(destinations[0]?.merchantId).toBe(merchants[0]!.id);
    expect(destinations[0]?.linkedByUserId).toBe(owners[0]!.id);

    const losingDestinations =
      await prisma.merchantBillingTelegramDestination.count({
        where: { merchantId: merchants[1]!.id }
      });

    expect(losingDestinations).toBe(0);

    const persistedTokens =
      await prisma.platformTelegramLinkToken.findMany({
        where: {
          id: { in: tokens.map((token) => token.id) }
        }
      });

    expect(persistedTokens).toHaveLength(2);
    expect(
      persistedTokens.find((token) => token.id === tokens[0]!.id)
        ?.consumedAt
    ).not.toBeNull();
    expect(
      persistedTokens.find((token) => token.id === tokens[1]!.id)
        ?.consumedAt
    ).toBeNull();

    const winningAudits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchants[0]!.id,
          action: "BILLING_TELEGRAM_DESTINATION_LINKED"
        }
      });

    expect(winningAudits).toHaveLength(1);
    expect(winningAudits[0]?.actorMerchantUserId).toBe(owners[0]!.id);

    const losingAudits =
      await prisma.platformBillingNotificationAudit.count({
        where: {
          merchantId: merchants[1]!.id,
          action: "BILLING_TELEGRAM_DESTINATION_LINKED"
        }
      });

    expect(losingAudits).toBe(0);
  });
  it("serializes competing valid tokens replacing one destination", async () => {
    const fixtureId = randomUUID().replace(/-/g, "");

    const merchant = await prisma.merchant.create({
      data: {
        name: `B3.5 competing tokens ${fixtureId}`,
        currency: "ETB",
        accountStatus: "ACTIVE"
      }
    });

    createdMerchantIds.add(merchant.id);

    const owner = await prisma.merchantUser.create({
      data: {
        merchantId: merchant.id,
        email: `b35-competing-${fixtureId}@example.invalid`,
        passwordHash: "test-only-inert-password-hash",
        role: "OWNER",
        tokenVersion: 0
      }
    });

    const identity = await prisma.telegramBotIdentityRegistry.create({
      data: {
        telegramBotId: `b35-competing-${fixtureId}`
      }
    });

    createdBotIdentityIds.add(identity.id);

    const bot = await prisma.platformBillingTelegramBot.create({
      data: {
        botIdentityId: identity.id,
        botTokenEncrypted: "test-only-inert-bot-token",
        webhookSecretEncrypted: "test-only-inert-webhook-secret",
        webhookKey: `b35-competing-${fixtureId}`,
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

    const original =
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

    const tokenHashes = [0, 1].map((index) =>
      createHash("sha256")
        .update(`b35-competing-${fixtureId}-${index}`)
        .digest("hex")
    );

    const tokens = await Promise.all(
      tokenHashes.map((tokenHash) =>
        prisma.platformTelegramLinkToken.create({
          data: {
            merchantId: merchant.id,
            createdByUserId: owner.id,
            createdByTokenVersion: owner.tokenVersion,
            tokenHash,
            expiresAt: new Date(Date.now() + 600_000)
          }
        })
      )
    );

    const telegramIds = ["222222222", "333333333"];

    const attempts = await Promise.allSettled(
      tokenHashes.map((tokenHash, index) =>
        redeemBillingTelegramLink({
          tokenHash,
          platformBotId: bot.id,
          chatId: telegramIds[index]!,
          telegramUserId: telegramIds[index]!
        })
      )
    );

    expect(attempts).toHaveLength(2);

    for (const attempt of attempts) {
      expect(attempt.status).toBe("fulfilled");

      if (attempt.status === "fulfilled") {
        expect(attempt.value.ok).toBe(true);
        if (attempt.value.ok) {
          expect(attempt.value.value.replacedPreviousDestination).toBe(true);
        }
      }
    }

    const destinations =
      await prisma.merchantBillingTelegramDestination.findMany({
        where: { merchantId: merchant.id }
      });

    expect(destinations).toHaveLength(3);

    const active = destinations.filter(
      (destination) => destination.status === "ACTIVE"
    );

    const revoked = destinations.filter(
      (destination) => destination.status === "REVOKED"
    );

    expect(active).toHaveLength(1);
    expect(revoked).toHaveLength(2);

    expect(revoked.map((destination) => destination.id))
      .toContain(original.id);

    expect(revoked.every(
      (destination) => destination.revokedAt !== null
    )).toBe(true);

    expect(telegramIds).toContain(active[0]?.chatId);
    expect(active[0]?.revokedAt).toBeNull();

    const persistedTokens =
      await prisma.platformTelegramLinkToken.findMany({
        where: {
          id: { in: tokens.map((token) => token.id) }
        }
      });

    expect(persistedTokens).toHaveLength(2);
    expect(persistedTokens.every(
      (token) => token.consumedAt !== null
    )).toBe(true);
    expect(persistedTokens.every(
      (token) => token.revokedAt === null
    )).toBe(true);

    const audits =
      await prisma.platformBillingNotificationAudit.findMany({
        where: {
          merchantId: merchant.id,
          action: "BILLING_TELEGRAM_DESTINATION_REPLACED"
        }
      });

    expect(audits).toHaveLength(2);

    const replacementIds = destinations
      .filter((destination) => destination.id !== original.id)
      .map((destination) => destination.id);

    expect(
      audits.map((audit) => audit.entityId).sort()
    ).toEqual(replacementIds.sort());

    expect(audits.every(
      (audit) => audit.actorType === "MERCHANT_OWNER" &&
        audit.actorMerchantUserId === owner.id
    )).toBe(true);
  });
});
