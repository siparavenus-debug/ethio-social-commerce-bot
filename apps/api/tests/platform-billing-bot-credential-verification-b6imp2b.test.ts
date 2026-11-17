import { describe, expect, it } from "vitest";

import {
  verifyPlatformBillingBotCredential
} from "../src/services/platform-billing-bot-credential-verification.js";

import { randomUUID } from "node:crypto";

import { prisma } from "@ethio-commerce/database";

import {
  encryptTelegramCredential
} from "../src/services/telegram-credential-encryption.js";

import {
    verifyPlatformBillingIdentityWithProvider
  } from "../src/services/platform-billing-bot-identity-verification-core.js";

async function createCredentialFixture(
    options: {
      encryptedToken?: string;
      botStatus?: "ACTIVE" | "INACTIVE";
    } = {}
  ) {
    const suffix = randomUUID();

    const identity =
      await prisma.telegramBotIdentityRegistry.create({
        data: {
            telegramBotId: String(
                100000000 + Math.floor(Math.random() * 900000000)
              )
        }
      });

    const bot =
      await prisma.platformBillingTelegramBot.create({
        data: {
          botIdentityId: identity.id,
          botTokenEncrypted:
            options.encryptedToken ??
            encryptTelegramCredential(
              "123456789:TestOnlyCredential"
            ),
          webhookSecretEncrypted: "test-only",
          webhookKey: `b6imp2b-${suffix}`,
          status: options.botStatus ?? "ACTIVE"
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

    return {
      identity,
      bot,
      reservation
    };
  }

describe("B6-IMP2-B credential verification", () => {
  it("rejects missing identifiers without authorization", async () => {
    const result = await verifyPlatformBillingBotCredential(
      "",
      ""
    );

    expect(result).toEqual({
      verified: false,
      sendAuthorized: false,
      reason: "INVALID_INPUT"
    });
  });

  it("rejects an unknown platform bot", async () => {
    const result = await verifyPlatformBillingBotCredential(
      "nonexistent-platform-bot",
      "nonexistent-bot-identity"
    );

    expect(result).toEqual({
      verified: false,
      sendAuthorized: false,
      reason: "BOT_NOT_ELIGIBLE"
    });
  });

  it("rejects an inactive platform bot", async () => {
    const fixture = await createCredentialFixture({
      botStatus: "INACTIVE"
    });

    const result = await verifyPlatformBillingBotCredential(
      fixture.bot.id,
      fixture.identity.id
    );

    expect(result).toEqual({
      verified: false,
      sendAuthorized: false,
      reason: "BOT_NOT_ELIGIBLE"
    });
  });

  it("rejects a mismatched bot identity", async () => {
    const fixture = await createCredentialFixture();

    const result = await verifyPlatformBillingBotCredential(
      fixture.bot.id,
      "different-identity"
    );

    expect(result).toEqual({
      verified: false,
      sendAuthorized: false,
      reason: "BOT_NOT_ELIGIBLE"
    });
  });

  it("rejects a released ownership reservation", async () => {
    const fixture = await createCredentialFixture();

    await prisma.telegramBotOwnershipReservation.update({
      where: {
        id: fixture.reservation.id
      },
      data: {
        status: "RELEASED",
        releasedAt: new Date()
      }
    });

    const result = await verifyPlatformBillingBotCredential(
      fixture.bot.id,
      fixture.identity.id
    );

    expect(result).toEqual({
      verified: false,
      sendAuthorized: false,
      reason: "OWNERSHIP_NOT_VERIFIED"
    });
  });

  it("rejects a credential without independent identity proof", async () => {
    const fixture = await createCredentialFixture();

    const result = await verifyPlatformBillingBotCredential(
      fixture.bot.id,
      fixture.identity.id
    );

    expect(result).toEqual({
      verified: false,
      sendAuthorized: false,
      reason: "IDENTITY_UNVERIFIABLE"
    });
  });

  it("rejects a corrupt encrypted credential", async () => {
    const fixture = await createCredentialFixture({
      encryptedToken: "invalid-encrypted-token"
    });

    const result = await verifyPlatformBillingBotCredential(
      fixture.bot.id,
      fixture.identity.id
    );

    expect(result).toEqual({
      verified: false,
      sendAuthorized: false,
      reason: "CREDENTIAL_INVALID"
    });
  });

  describe("B6-IMP2-B2/B3 mocked identity verification", () => {
    it("accepts a matching mocked identity without send authorization", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingIdentityWithProvider(
        fixture.bot.id,
        fixture.identity.id,
        async () => ({
          id: Number(fixture.identity.telegramBotId)
        })
      );

      expect(result).toEqual({
        verified: true,
        sendAuthorized: false,
        platformBotId: fixture.bot.id,
        botIdentityId: fixture.identity.id
      });
    });

    it("rejects a mismatched provider identity", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingIdentityWithProvider(
        fixture.bot.id,
        fixture.identity.id,
        async () => ({ id: 9999999999 })
      );

      expect(result).toMatchObject({
        verified: false,
        sendAuthorized: false,
        reason: "IDENTITY_MISMATCH"
      });
    });

    it("rejects provider failure", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingIdentityWithProvider(
        fixture.bot.id,
        fixture.identity.id,
        async () => {
          throw new Error("Simulated provider failure");
        }
      );

      expect(result).toMatchObject({
        verified: false,
        sendAuthorized: false,
        reason: "IDENTITY_UNVERIFIABLE"
      });
    });

    it("rejects malformed provider identity", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingIdentityWithProvider(
        fixture.bot.id,
        fixture.identity.id,
        async () => ({ id: Number.NaN })
      );

      expect(result.verified).toBe(false);
      expect(result.sendAuthorized).toBe(false);
    });

    it("rejects ownership released during verification", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingIdentityWithProvider(
        fixture.bot.id,
        fixture.identity.id,
        async () => {
          await prisma.telegramBotOwnershipReservation.update({
            where: {
              id: fixture.reservation.id
            },
            data: {
              status: "RELEASED",
              releasedAt: new Date()
            }
          });

          return {
            id: Number(fixture.identity.telegramBotId)
          };
        }
      );

      expect(result).toMatchObject({
        verified: false,
        sendAuthorized: false,
        reason: "ELIGIBILITY_CHANGED"
      });
    });

    it("rejects bot deactivation during verification", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingIdentityWithProvider(
        fixture.bot.id,
        fixture.identity.id,
        async () => {
          await prisma.platformBillingTelegramBot.update({
            where: {
              id: fixture.bot.id
            },
            data: {
              status: "INACTIVE"
            }
          });

          return {
            id: Number(fixture.identity.telegramBotId)
          };
        }
      );

      expect(result).toMatchObject({
        verified: false,
        sendAuthorized: false,
        reason: "ELIGIBILITY_CHANGED"
      });
    });

    it("rejects credential replacement during verification", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingIdentityWithProvider(
        fixture.bot.id,
        fixture.identity.id,
        async () => {
          await prisma.platformBillingTelegramBot.update({
            where: {
              id: fixture.bot.id
            },
            data: {
              botTokenEncrypted: encryptTelegramCredential(
                "123456789:ReplacementTestCredential"
              )
            }
          });

          return {
            id: Number(fixture.identity.telegramBotId)
          };
        }
      );

      expect(result).toMatchObject({
        verified: false,
        sendAuthorized: false,
        reason: "ELIGIBILITY_CHANGED"
      });
    });

    it("keeps the production verifier fail-closed", async () => {
      const fixture = await createCredentialFixture();

      const result = await verifyPlatformBillingBotCredential(
        fixture.bot.id,
        fixture.identity.id
      );

      expect(result).toEqual({
        verified: false,
        sendAuthorized: false,
        reason: "IDENTITY_UNVERIFIABLE"
      });
    });
  });
});
