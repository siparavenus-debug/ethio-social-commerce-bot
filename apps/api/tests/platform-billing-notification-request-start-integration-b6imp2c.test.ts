import {
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
    integratePlatformBillingRequestStart
} from "../src/services/platform-billing-notification-request-start-integration.js";

import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";

import {
    createPlatformBillingEvent
} from "../src/services/platform-billing-notification-events.js";

import {
    resolvePlatformBillingTransportContext
} from "../src/services/platform-billing-notification-transport-context.js";

import * as credentialVerifier from
  "../src/services/platform-billing-bot-credential-verification.js";

import * as attemptFence from
  "../src/services/platform-billing-notification-attempt-fence.js";

import {
  preparePlatformBillingSendCapability
} from "../src/services/platform-billing-notification-send-capability.js";


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

describe("B6-IMP2-C request-start integration", () => {
    it("rejects missing identifiers", async () => {
        const result =
            await integratePlatformBillingRequestStart(
                "",
                "",
                ""
            );

        expect(result).toEqual({
            started: false,
            sendAuthorized: false,
            reason: "INVALID_REQUEST_START_INPUT"
        });
    });

    it("rejects an unknown delivery without authorization", async () => {
        const result =
            await integratePlatformBillingRequestStart(
                "nonexistent-delivery",
                "nonexistent-claim",
                "nonexistent-attempt"
            );

        expect(result).toEqual({
            started: false,
            sendAuthorized: false,
            reason: "TRANSPORT_DELIVERY_NOT_FOUND"
        });
    });

    it(
  "preserves PREPARED when production identity verification fails closed",
  async () => {
    const f = await createFixture();

    // Prove the attempt is eligible for transport-context resolution.
    const context =
      await resolvePlatformBillingTransportContext(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      );

    expect(context).toMatchObject({
      resolved: true,
      sendAuthorized: false,
      deliveryId: f.delivery.id,
      attemptId: f.attempt.id
    });

    // Exercise the actual production-facing integration.
    const result =
      await integratePlatformBillingRequestStart(
        f.delivery.id,
        f.claimId,
        f.attempt.id
      );

    expect(result).toMatchObject({
      started: false,
      sendAuthorized: false
    });

    expect(result.reason).toMatch(/^CREDENTIAL_/);

    // The request-start fence must not have been crossed.
    const persistedAttempt =
      await prisma.platformBillingNotificationAttempt.findUniqueOrThrow({
        where: { id: f.attempt.id }
      });

    expect(persistedAttempt.outcome).toBe("PREPARED");
    expect(persistedAttempt.requestStartedAt).toBeNull();

    // Delivery ownership and processing state must remain unchanged.
    const persistedDelivery =
      await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
        where: { id: f.delivery.id }
      });

    expect(persistedDelivery.status).toBe("SENDING");
    expect(persistedDelivery.claimId).toBe(f.claimId);
    expect(persistedDelivery.attemptCount).toBe(1);
  }
);

describe("B6-IMP2-C validated binding contract", () => {
  it("returns the exact validated identifiers without authorizing sending", async () => {
    const f = await createFixture();

    vi.resetModules();

    const capabilitySpy = vi.fn(() => ({
      prepared: false as const,
      sendAuthorized: false as const,
      reason: "TRUSTED_SENDER_NOT_CONNECTED" as const
    }));

    vi.doMock(
      "../src/services/platform-billing-notification-send-capability.js",
      () => ({
        preparePlatformBillingSendCapability: capabilitySpy
      })
    );

    vi.doMock(
      "../src/services/platform-billing-bot-credential-verification.js",
      () => ({
        verifyPlatformBillingBotCredential: vi.fn(
          async () => ({
            verified: true,
            sendAuthorized: false,
            platformBotId: f.bot.id,
            botIdentityId: f.identity.id
          })
        )
      })
    );

    try {
      const { integratePlatformBillingRequestStart } =
        await import(
          "../src/services/platform-billing-notification-request-start-integration.js"
        );

      const result =
        await integratePlatformBillingRequestStart(
          f.delivery.id,
          f.claimId,
          f.attempt.id
        );

      expect(result).toEqual({
        started: true,
        sendAuthorized: false,
        attemptId: f.attempt.id,
        destinationId: f.destination.id,
        platformBotId: f.bot.id,
        botIdentityId: f.identity.id
      });

      expect(capabilitySpy).toHaveBeenCalledExactlyOnceWith({
        deliveryId: f.delivery.id,
        claimId: f.claimId,
        attemptId: f.attempt.id,
        destinationId: f.destination.id,
        platformBotId: f.bot.id,
        botIdentityId: f.identity.id
      });
    } finally {
      vi.doUnmock(
        "../src/services/platform-billing-bot-credential-verification.js",
        "../src/services/platform-billing-notification-send-capability.js"

      );
      vi.resetModules();
    }
  });
});

it(
  "rejects a post-fence binding mismatch without resetting REQUEST_STARTED",
  async () => {
    const f = await createFixture();

    vi.resetModules();

    vi.doMock(
      "../src/services/platform-billing-bot-credential-verification.js",
      () => ({
        verifyPlatformBillingBotCredential: vi.fn(
          async () => ({
            verified: true,
            sendAuthorized: false,
            platformBotId: f.bot.id,
            botIdentityId: f.identity.id
          })
        )
      })
    );

    vi.doMock(
      "../src/services/platform-billing-notification-attempt-fence.js",
      async (importOriginal) => {
        const actual = await importOriginal<
          typeof import("../src/services/platform-billing-notification-attempt-fence.js")
        >();

        return {
          ...actual,
          markPlatformBillingNotificationRequestStarted:
            vi.fn(async (
              deliveryId: string,
              claimId: string,
              attemptId: string
            ) => {
              const result =
                await actual.markPlatformBillingNotificationRequestStarted(
                  deliveryId,
                  claimId,
                  attemptId
                );

              if (!result.started) {
                return result;
              }

              // Simulate an inconsistent fence result after
              // the real durable request-start transition.
              return {
                ...result,
                destinationId: "mismatched-destination"
              };
            })
        };
      }
    );

    try {
      const { integratePlatformBillingRequestStart } =
        await import(
          "../src/services/platform-billing-notification-request-start-integration.js"
        );

      const result =
        await integratePlatformBillingRequestStart(
          f.delivery.id,
          f.claimId,
          f.attempt.id
        );

      expect(result).toEqual({
        started: false,
        sendAuthorized: false,
        reason: "FENCE_BINDING_CHANGED_REVIEW_REQUIRED"
      });

      const persistedAttempt =
        await prisma.platformBillingNotificationAttempt.findUniqueOrThrow({
          where: { id: f.attempt.id }
        });

      expect(persistedAttempt.outcome).toBe("REQUEST_STARTED");
      expect(persistedAttempt.requestStartedAt).not.toBeNull();

      const persistedDelivery =
        await prisma.platformBillingNotificationDelivery.findUniqueOrThrow({
          where: { id: f.delivery.id }
        });

      expect(persistedDelivery.status).toBe("SENDING");
      expect(persistedDelivery.claimId).toBe(f.claimId);
      expect(persistedDelivery.attemptCount).toBe(1);
    } finally {
      vi.doUnmock(
        "../src/services/platform-billing-bot-credential-verification.js"
      );

      vi.doUnmock(
        "../src/services/platform-billing-notification-attempt-fence.js"
      );

      vi.resetModules();
    }
  }
);

it(
  "keeps the validated binding fail-closed at the send-capability boundary",
  async () => {
    const f = await createFixture();

    const binding = {
      deliveryId: f.delivery.id,
      claimId: f.claimId,
      attemptId: f.attempt.id,
      destinationId: f.destination.id,
      platformBotId: f.bot.id,
      botIdentityId: f.identity.id
    };

    const result =
      preparePlatformBillingSendCapability(binding);

    expect(result).toEqual({
      prepared: false,
      sendAuthorized: false,
      reason: "TRUSTED_SENDER_NOT_CONNECTED"
    });
  }
);
});
