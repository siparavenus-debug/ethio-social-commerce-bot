import { Router } from "express";
import { prisma } from "@ethio-commerce/database";
import { env } from "../config/env.js";
import { sendTelegramMessage } from "../services/telegram.js";
import { handleConversation } from "../conversation/conversation-manager.js";

const router = Router();

type TelegramUpdate = {
  update_id?: number;

  message?: {
    message_id?: number;

    text?: string;

    chat?: {
      id?: number | string;
    };

    from?: {
      id?: number | string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
};

function customerName(
  from: NonNullable<
    NonNullable<TelegramUpdate["message"]>["from"]
  >
) {
  const name = [
    from.first_name,
    from.last_name
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || from.username || null;
}

function requireTelegramConfiguration() {
  return Boolean(
    env.telegramBotToken &&
      env.telegramWebhookSecret &&
      env.telegramMerchantId
  );
}

async function sendAndSaveMessage(
  chatId: string,
  conversationId: string,
  text: string
) {
  const externalId =
    await sendTelegramMessage(chatId, text);

  await prisma.message.create({
    data: {
      conversationId,
      direction: "OUTBOUND",
      externalId,
      content: text
    }
  });
}

router.post("/", async (req, res) => {
  /*
   * Telegram configuration
   */
  if (!requireTelegramConfiguration()) {
    res.status(503).json({
      error: "Telegram integration is not configured"
    });

    return;
  }

  /*
   * Telegram webhook security
   */
  if (
    req.get("x-telegram-bot-api-secret-token") !==
    env.telegramWebhookSecret
  ) {
    res.status(401).json({
      error: "Invalid Telegram webhook secret"
    });

    return;
  }

  const update =
    req.body as TelegramUpdate;

  const eventId =
    typeof update.update_id === "number"
      ? String(update.update_id)
      : null;

  const message = update.message;

  const text =
    message?.text?.trim();

  const chatId =
    message?.chat?.id;

  const userId =
    message?.from?.id;

  /*
   * Ignore Telegram updates that are not
   * normal text messages.
   */
  if (
    !eventId ||
    !text ||
    chatId === undefined ||
    userId === undefined ||
    !message?.message_id
  ) {
    res.status(200).json({
      ok: true,
      ignored: true
    });

    return;
  }

  try {
    /*
     * Prevent duplicate Telegram updates
     * from being processed twice.
     */
    const existingEvent =
      await prisma.webhookEvent.findUnique({
        where: {
          provider_eventId: {
            provider: "TELEGRAM",
            eventId
          }
        }
      });

    if (existingEvent?.processedAt) {
      res.status(200).json({
        ok: true,
        duplicate: true
      });

      return;
    }

    const merchantId =
      env.telegramMerchantId!;

    /*
     * Find the merchant receiving
     * the Telegram conversation.
     */
    const merchant =
      await prisma.merchant.findUnique({
        where: {
          id: merchantId
        }
      });

    if (!merchant) {
      console.error(
        "Telegram merchant was not found",
        {
          merchantId
        }
      );

      res.status(503).json({
        error:
          "Telegram merchant is not available"
      });

      return;
    }

    const chatIdString =
      String(chatId);

    const userIdString =
      String(userId);

    /*
     * Create or update customer.
     */
    const customer =
      await prisma.customer.upsert({
        where: {
          merchantId_telegramChatId: {
            merchantId,
            telegramChatId:
              chatIdString
          }
        },

        create: {
          merchantId,

          name:
            customerName(
              message.from!
            ),

          telegramChatId:
            chatIdString,

          telegramUserId:
            userIdString
        },

        update: {
          name:
            customerName(
              message.from!
            ),

          telegramUserId:
            userIdString
        }
      });

    /*
     * Create or update conversation.
     */
    const conversation =
      await prisma.conversation.upsert({
        where: {
          merchantId_channel_externalId: {
            merchantId,

            channel: "TELEGRAM",

            externalId:
              chatIdString
          }
        },

        create: {
          merchantId,

          customerId:
            customer.id,

          channel:
            "TELEGRAM",

          externalId:
            chatIdString
        },

        update: {
          customerId:
            customer.id
        }
      });

    /*
     * Save Telegram event and
     * inbound customer message.
     */
    if (!existingEvent) {
      await prisma.$transaction([
        prisma.webhookEvent.create({
          data: {
            merchantId,

            provider:
              "TELEGRAM",

            eventId,

            payload:
              update as object
          }
        }),

        prisma.message.create({
          data: {
            conversationId:
              conversation.id,

            direction:
              "INBOUND",

            externalId:
              String(
                message.message_id
              ),

            content:
              text
          }
        })
      ]);
    }

    /*
     * ------------------------------------------------
     * IMPORTANT ARCHITECTURE BOUNDARY
     * ------------------------------------------------
     *
     * Telegram transport stops here.
     *
     * Conversation Manager decides what the
     * customer message means and which commerce
     * tools need to be used.
     */
    const result =
      await handleConversation(
        {
          merchantId,

          customerId:
            customer.id,

          chatId:
            chatIdString,

          customerName:
            customerName(
              message.from!
            ),

          merchantName:
            merchant.name
        },

        text
      );

    /*
     * Send and persist the response generated
     * by the Conversation Manager.
     */
    await sendAndSaveMessage(
      chatIdString,
      conversation.id,
      result.reply
    );

    /*
     * Mark the Telegram event as processed
     * only after the conversation response
     * has successfully been handled.
     */
    await prisma.webhookEvent.update({
      where: {
        provider_eventId: {
          provider:
            "TELEGRAM",

          eventId
        }
      },

      data: {
        processedAt:
          new Date()
      }
    });

    res.status(200).json({
      ok: true
    });
  } catch (error) {
    console.error(
      "Failed to process Telegram webhook:",
      error
    );

    res.status(500).json({
      error:
        "Failed to process Telegram webhook"
    });
  }
});

export default router;