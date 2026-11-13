import {
  createHash,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

import { Router } from "express";

import { prisma } from "@ethio-commerce/database";

import { env } from "../config/env.js";

import {
  decryptTelegramCredential
} from "../services/telegram-credential-encryption.js";

import {
  validateBillingTelegramRedemptionInput
} from "../services/merchant-billing-telegram-redemption-input.js";

import {
  redeemBillingTelegramLink
} from "../services/merchant-billing-telegram-redemption.js";
import {
  sendTelegramMessage
} from "../services/telegram.js";
const router = Router();

function secretsMatch(
  received: string,
  expected: string
): boolean {
  const receivedHash = createHash("sha256")
    .update(received)
    .digest();

  const expectedHash = createHash("sha256")
    .update(expected)
    .digest();

  return timingSafeEqual(
    receivedHash,
    expectedHash
  );
}

type TelegramUpdateEnvelope = {
  updateId: string;
  text: unknown;
  chatType: unknown;
  chatId: unknown;
  senderId: unknown;
};

function parseTelegramUpdate(
  value: unknown
): TelegramUpdateEnvelope | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const update = value as Record<string, unknown>;

  if (
    typeof update.update_id !== "number" ||
    !Number.isSafeInteger(update.update_id) ||
    update.update_id < 0
  ) {
    return null;
  }

  const message = update.message;

  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    return null;
  }

  const messageRecord =
    message as Record<string, unknown>;

  const chat = messageRecord.chat;
  const sender = messageRecord.from;

  if (
    chat === null ||
    typeof chat !== "object" ||
    Array.isArray(chat) ||
    sender === null ||
    typeof sender !== "object" ||
    Array.isArray(sender)
  ) {
    return null;
  }

  const chatRecord =
    chat as Record<string, unknown>;

  const senderRecord =
    sender as Record<string, unknown>;

  return {
    updateId: String(update.update_id),
    text: messageRecord.text,
    chatType: chatRecord.type,
    chatId: chatRecord.id,
    senderId: senderRecord.id
  };
}

type WebhookEventClaim =
  | {
      claimed: true;
      eventId: string;
      claimId: string;
    }
  | {
      claimed: false;
    };

async function claimWebhookEvent(
  platformBotId: string,
  telegramUpdateId: string
): Promise<WebhookEventClaim> {
  const claimId = randomUUID();
  const eventId = randomUUID();

  const rows = await prisma.$queryRaw<
    Array<{ id: string }>
  >`
    INSERT INTO "PlatformBillingTelegramWebhookEvent" (
      "id",
      "platformBotId",
      "telegramUpdateId",
      "status",
      "attemptCount",
      "claimId",
      "processingUntil",
      "receivedAt",
      "nextAttemptAt"
    )
    VALUES (
      ${eventId},
      ${platformBotId},
      ${telegramUpdateId},
      'PROCESSING'::"PlatformBillingWebhookStatus",
      1,
      ${claimId},
      NOW() + INTERVAL '5 minutes',
      NOW(),
      NOW()
    )
    ON CONFLICT ("platformBotId", "telegramUpdateId")
    DO NOTHING
    RETURNING "id"
  `;

  if (rows.length !== 1) {
    return {
      claimed: false
    };
  }

  return {
    claimed: true,
    eventId: rows[0].id,
    claimId
  };
}

async function reviewExpiredWebhookClaim(
  platformBotId: string,
  telegramUpdateId: string
): Promise<void> {
  await prisma.platformBillingTelegramWebhookEvent.updateMany({
    where: {
      platformBotId,
      telegramUpdateId,
      status: "PROCESSING",
      processingUntil: {
        lt: new Date()
      }
    },
    data: {
      status: "REVIEW_REQUIRED",
      terminalReason: "PROCESSING_OUTCOME_UNCERTAIN",
      claimId: null,
      processingUntil: null,
      processedAt: new Date()
    }
  });
}

type WebhookTerminalStatus =
  | "PROCESSED"
  | "REJECTED"
  | "REVIEW_REQUIRED";

async function completeWebhookClaim(
  eventId: string,
  claimId: string,
  status: WebhookTerminalStatus,
  terminalReason: string | null
): Promise<boolean> {
  const result =
    await prisma.platformBillingTelegramWebhookEvent.updateMany({
      where: {
        id: eventId,
        claimId,
        status: "PROCESSING"
      },
      data: {
        status,
        terminalReason,
        claimId: null,
        processingUntil: null,
        processedAt: new Date()
      }
    });

  return result.count === 1;
}

type ConfirmationOutcome =
  | {
      status: "SENT";
      messageId: string;
    }
  | {
      status: "REVIEW_REQUIRED";
    };

async function reserveConfirmation(
  eventId: string,
  platformBotId: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string }>
  >`
    UPDATE "PlatformBillingTelegramWebhookEvent"
    SET "sanitizedPayload" =
      jsonb_set(
        "sanitizedPayload",
        '{confirmationStatus}',
        '"SENDING"'::jsonb
      )
    WHERE "id" = ${eventId}
      AND "platformBotId" = ${platformBotId}
      AND "status" = 'PROCESSED'
      AND "sanitizedPayload"->>'confirmationStatus' = 'PENDING'
    RETURNING "id"
  `;

  return rows.length === 1;
}

async function recordConfirmationOutcome(
  eventId: string,
  platformBotId: string,
  outcome: ConfirmationOutcome
): Promise<boolean> {
  const status = outcome.status;

  const messageId =
    outcome.status === "SENT"
      ? outcome.messageId
      : null;

  const rows = await prisma.$queryRaw<
    Array<{ id: string }>
  >`
    UPDATE "PlatformBillingTelegramWebhookEvent"
    SET "sanitizedPayload" =
      CASE
        WHEN ${status}::text = 'SENT'
        THEN jsonb_set(
          jsonb_set(
            "sanitizedPayload",
            '{confirmationStatus}',
            '"SENT"'::jsonb
          ),
          '{confirmationMessageId}',
          to_jsonb(${messageId}::text)
        )
        ELSE jsonb_set(
          "sanitizedPayload" - 'confirmationMessageId',
          '{confirmationStatus}',
          '"REVIEW_REQUIRED"'::jsonb
        )
      END
    WHERE "id" = ${eventId}
      AND "platformBotId" = ${platformBotId}
      AND "status" = 'PROCESSED'
      AND "sanitizedPayload"->>'confirmationStatus' = 'SENDING'
    RETURNING "id"
  `;

  return rows.length === 1;
}
router.post(
  "/:webhookKey",
  async (req, res) => {
    const configuredSecret =
      env.platformBillingTelegramWebhookSecret;

    const receivedSecret =
      req.get("x-telegram-bot-api-secret-token");

    if (
      !configuredSecret ||
      typeof receivedSecret !== "string" ||
      !secretsMatch(
        receivedSecret,
        configuredSecret
      )
    ) {
      res.status(401).json({
        error: "Unauthorized"
      });

      return;
    }

    const webhookKey =
      req.params.webhookKey;

    if (
      typeof webhookKey !== "string" ||
      webhookKey.length === 0
    ) {
      res.status(404).json({
        error: "Not found"
      });

      return;
    }

    try {
      const bot =
        await prisma.platformBillingTelegramBot.findUnique({
          where: {
            webhookKey
          },
          select: {
            id: true,
            status: true,
            webhookSecretEncrypted: true,
            botTokenEncrypted: true
          }
        });

      if (
        !bot ||
        bot.status !== "ACTIVE"
      ) {
        res.status(404).json({
          error: "Not found"
        });

        return;
      }

      const storedSecret =
        decryptTelegramCredential(
          bot.webhookSecretEncrypted
        );

      if (
        !secretsMatch(
          storedSecret,
          configuredSecret
        )
      ) {
        res.status(503).json({
          error: "Webhook configuration unavailable"
        });

        return;
      }

      const update = parseTelegramUpdate(req.body);

      if (!update) {
        res.status(400).json({
          error: "Invalid Telegram update"
        });

        return;
      }

      const validation =
        validateBillingTelegramRedemptionInput({
          text: update.text,
          chatType: update.chatType,
          chatId: update.chatId,
          senderId: update.senderId
        });

      if (!validation.ok) {
        res.status(200).json({
          ok: true
        });

        return;
      }

      const claim = await claimWebhookEvent(
        bot.id,
        update.updateId
      );

      if (!claim.claimed) {
        await reviewExpiredWebhookClaim(
          bot.id,
          update.updateId
        );

        res.status(200).json({
          ok: true
        });

        return;
      }

      let result;

      try {
        result = await redeemBillingTelegramLink(
          {
            tokenHash: validation.value.tokenHash,
            platformBotId: bot.id,
            chatId: validation.value.chatId,
            telegramUserId: validation.value.telegramUserId
          },
          {
            eventId: claim.eventId,
            claimId: claim.claimId
          }
        );
      } catch {
        await completeWebhookClaim(
          claim.eventId,
          claim.claimId,
          "REVIEW_REQUIRED",
          "REDEMPTION_OUTCOME_UNCERTAIN"
        );

        res.status(503).json({
          error: "Webhook processing unavailable"
        });

        return;
      }

      if (!result.ok) {
        const completed = await completeWebhookClaim(
          claim.eventId,
          claim.claimId,
          "REJECTED",
          result.reason
        );

        if (!completed) {
          res.status(503).json({
            error: "Webhook completion unavailable"
          });

          return;
        }
      }

      if (result.ok) {
        const reserved = await reserveConfirmation(
          claim.eventId,
          bot.id
        );

        if (!reserved) {
          res.status(503).json({
            error: "Confirmation reservation unavailable"
          });

          return;
        }

        let messageId: string;

        try {
          const botToken = decryptTelegramCredential(
            bot.botTokenEncrypted
          );

          messageId = await sendTelegramMessage(
            botToken,
            validation.value.chatId,
            "Your billing Telegram connection is now active."
          );
        } catch {
          let reviewRecorded = false;

          try {
            reviewRecorded = await recordConfirmationOutcome(
              claim.eventId,
              bot.id,
              {
                status: "REVIEW_REQUIRED"
              }
            );
          } catch {
            // SENDING remains for manual review.
          }

          if (!reviewRecorded) {
            res.status(503).json({
              error: "Confirmation review recording unavailable"
            });

            return;
          }

          res.status(503).json({
            error: "Confirmation delivery unavailable"
          });

          return;
        }

        const recorded = await recordConfirmationOutcome(
          claim.eventId,
          bot.id,
          {
            status: "SENT",
            messageId
          }
        );

        if (!recorded) {
          res.status(503).json({
            error: "Confirmation recording unavailable"
          });

          return;
        }
      }
      res.status(200).json({
        ok: true
      });
    } catch {
      res.status(503).json({
        error: "Webhook processing unavailable"
      });
    }
  }
);

export default router;
