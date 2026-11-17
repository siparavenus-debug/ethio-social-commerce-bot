import { prisma } from "@ethio-commerce/database";

import {
  decryptTelegramCredential
} from "./telegram-credential-encryption.js";

type IdentityProvider = (
  token: string
) => Promise<{ id: number }>;

type VerificationResult =
  | {
      verified: true;
      sendAuthorized: false;
      platformBotId: string;
      botIdentityId: string;
    }
  | {
      verified: false;
      sendAuthorized: false;
      reason: string;
    };

function reject(reason: string): VerificationResult {
  return {
    verified: false,
    sendAuthorized: false,
    reason
  };
}

async function loadEligibleBot(
  platformBotId: string,
  expectedBotIdentityId: string
) {
  const bot =
    await prisma.platformBillingTelegramBot.findUnique({
      where: { id: platformBotId },
      select: {
        id: true,
        status: true,
        botIdentityId: true,
        botTokenEncrypted: true,
        botIdentity: {
          select: {
            id: true,
            telegramBotId: true
          }
        },
        reservations: {
          select: {
            id: true,
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
    bot.botIdentityId !== expectedBotIdentityId ||
    bot.botIdentity.id !== expectedBotIdentityId ||
    !/^[1-9]\d*$/.test(bot.botIdentity.telegramBotId)
  ) {
    return null;
  }

  const reservations = bot.reservations.filter(
    (reservation) =>
      reservation.botIdentityId === expectedBotIdentityId &&
      reservation.platformBillingBotId === platformBotId &&
      reservation.ownerType === "PLATFORM_BILLING" &&
      reservation.status === "RESERVED" &&
      reservation.releasedAt === null &&
      reservation.merchantId === null &&
      reservation.merchantIntegrationId === null
  );

  if (
    reservations.length !== 1 ||
    bot.reservations.length !== 1
  ) {
    return null;
  }

  return {
    platformBotId: bot.id,
    botIdentityId: bot.botIdentityId,
    telegramBotId: bot.botIdentity.telegramBotId,
    encryptedToken: bot.botTokenEncrypted,
    reservationId: reservations[0].id
  };
}

/**
 * Internal verification logic.
 *
 * A supplied provider is not automatically trustworthy.
 * This function is not a production authorization boundary.
 *
 * No Telegram sending.
 * No durable request-start transition.
 * No transaction held during provider execution.
 */
export async function verifyPlatformBillingIdentityWithProvider(
  platformBotId: string,
  expectedBotIdentityId: string,
  provider: IdentityProvider
): Promise<VerificationResult> {
  if (
    !platformBotId?.trim() ||
    !expectedBotIdentityId?.trim()
  ) {
    return reject("INVALID_INPUT");
  }

  const before = await loadEligibleBot(
    platformBotId,
    expectedBotIdentityId
  );

  if (!before) {
    return reject("BOT_NOT_ELIGIBLE");
  }

  let token: string;

  try {
    token = decryptTelegramCredential(
      before.encryptedToken
    );

    if (
      !/^[1-9]\d*:[A-Za-z0-9_-]+$/.test(token)
    ) {
      return reject("CREDENTIAL_INVALID");
    }
  } catch {
    return reject("CREDENTIAL_INVALID");
  }

  let identity: { id: number };

  try {
    identity = await provider(token);
  } catch {
    return reject("IDENTITY_UNVERIFIABLE");
  }

  if (
    !identity ||
    !Number.isSafeInteger(identity.id) ||
    identity.id <= 0 ||
    String(identity.id) !== before.telegramBotId
  ) {
    return reject("IDENTITY_MISMATCH");
  }

  const after = await loadEligibleBot(
    platformBotId,
    expectedBotIdentityId
  );

  if (
    !after ||
    after.platformBotId !== before.platformBotId ||
    after.botIdentityId !== before.botIdentityId ||
    after.telegramBotId !== before.telegramBotId ||
    after.encryptedToken !== before.encryptedToken ||
    after.reservationId !== before.reservationId
  ) {
    return reject("ELIGIBILITY_CHANGED");
  }

  return {
    verified: true,
    sendAuthorized: false,
    platformBotId,
    botIdentityId: expectedBotIdentityId
  };
}
