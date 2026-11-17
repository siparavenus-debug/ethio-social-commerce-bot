import { prisma } from "@ethio-commerce/database";

import {
  decryptTelegramCredential
} from "./telegram-credential-encryption.js";

export type BillingBotIdentityResponse = Readonly<{
  telegramBotId: string;
}>;

export type BillingBotIdentityTransport = (
  token: string
) => Promise<BillingBotIdentityResponse | null>;

export type PlatformBillingCredentialVerificationResult =
  | {
      verified: true;
      sendAuthorized: false;
      platformBotId: string;
      botIdentityId: string;
    }
  | {
      verified: false;
      sendAuthorized: false;
      reason:
        | "INVALID_INPUT"
        | "BOT_NOT_ELIGIBLE"
        | "IDENTITY_NOT_REGISTERED"
        | "OWNERSHIP_NOT_VERIFIED"
        | "CREDENTIAL_INVALID"
        | "IDENTITY_UNVERIFIABLE";
    };

function reject(
  reason: Extract<
    PlatformBillingCredentialVerificationResult,
    { verified: false }
  >["reason"]
): PlatformBillingCredentialVerificationResult {
  return {
    verified: false,
    sendAuthorized: false,
    reason
  };
}

/**
 * B6-IMP2-B:
 *
 * Fail-closed credential identity verification boundary.
 *
 * No Telegram API calls.
 * No credential disclosure.
 * No sending authorization.
 *
 * Database association and successful decryption do not
 * independently establish Telegram credential identity.
 */
export async function verifyPlatformBillingBotCredential(
  platformBotId: string,
  expectedBotIdentityId: string,
  identityTransport?: BillingBotIdentityTransport
): Promise<PlatformBillingCredentialVerificationResult> {
  if (
    !platformBotId?.trim() ||
    !expectedBotIdentityId?.trim()
  ) {
    return reject("INVALID_INPUT");
  }

  const bot =
    await prisma.platformBillingTelegramBot.findUnique({
      where: {
        id: platformBotId
      },
      select: {
        id: true,
        botIdentityId: true,
        botTokenEncrypted: true,
        status: true,
        botIdentity: {
          select: {
            id: true,
            telegramBotId: true
          }
        },
        reservations: {
          select: {
            botIdentityId: true,
            platformBillingBotId: true,
            ownerType: true,
            status: true,
            releasedAt: true,
            merchantId: true,
            merchantIntegrationId: true
          }
        }
      }
    });

  if (
    !bot ||
    bot.status !== "ACTIVE" ||
    bot.botIdentityId !== expectedBotIdentityId
  ) {
    return reject("BOT_NOT_ELIGIBLE");
  }

  if (
    bot.botIdentity.id !== expectedBotIdentityId ||
    !/^[1-9]\d*$/.test(bot.botIdentity.telegramBotId)
  ) {
    return reject("IDENTITY_NOT_REGISTERED");
  }

  const activeReservations = bot.reservations.filter(
    (reservation) =>
      reservation.botIdentityId === expectedBotIdentityId &&
      reservation.platformBillingBotId === platformBotId &&
      reservation.ownerType === "PLATFORM_BILLING" &&
      reservation.status === "RESERVED" &&
      reservation.releasedAt === null &&
      reservation.merchantId === null &&
      reservation.merchantIntegrationId === null
  );

  if (activeReservations.length !== 1) {
    return reject("OWNERSHIP_NOT_VERIFIED");
  }

  let decryptedToken: string;

  try {
    decryptedToken = decryptTelegramCredential(
      bot.botTokenEncrypted
    );
  } catch {
    return reject("CREDENTIAL_INVALID");
  }

  if (
    !decryptedToken ||
    !/^[1-9]\d*:[A-Za-z0-9_-]+$/.test(decryptedToken)
  ) {
    return reject("CREDENTIAL_INVALID");
  }

  // Production remains fail-closed without an explicitly
  // supplied authenticated identity transport.
  if (!identityTransport) {
    return reject("IDENTITY_UNVERIFIABLE");
  }

  let authenticatedIdentity: BillingBotIdentityResponse | null;

  try {
    authenticatedIdentity = await identityTransport(
      decryptedToken
    );
  } catch {
    return reject("IDENTITY_UNVERIFIABLE");
  }

  if (
    !authenticatedIdentity ||
    typeof authenticatedIdentity.telegramBotId !== "string" ||
    !/^[1-9]\d*$/.test(
      authenticatedIdentity.telegramBotId
    ) ||
    authenticatedIdentity.telegramBotId !==
      bot.botIdentity.telegramBotId
  ) {
    return reject("IDENTITY_UNVERIFIABLE");
  }

  return {
    verified: true,
    sendAuthorized: false,
    platformBotId,
    botIdentityId: expectedBotIdentityId
  };
}
