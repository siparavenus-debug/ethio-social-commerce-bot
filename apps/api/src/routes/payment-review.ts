import { Router } from "express";
import {
  prisma,
  PaymentStatus
} from "@ethio-commerce/database";
import { env } from "../config/env.js";
import {
  sendTelegramMessage,
  getTelegramFilePath,
  downloadTelegramFile
} from "../services/telegram.js";
import { handleConversation } from "../conversation/conversation-manager.js";
import { extractReceipt } from "../services/receipt-vision.js";
import {
  validateReceipt,
  type ReceiptValidationResult
} from "../services/receipt-validation.js";

const router = Router();

type TelegramPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramUpdate = {
  update_id?: number;

  message?: {
    message_id?: number;

    text?: string;

    caption?: string;

    photo?: TelegramPhotoSize[];

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
      error:
        "Telegram integration is not configured"
    });

    return;
  }

  /*
   * Telegram webhook security
   */
  if (
    req.get(
      "x-telegram-bot-api-secret-token"
    ) !== env.telegramWebhookSecret
  ) {
    res.status(401).json({
      error:
        "Invalid Telegram webhook secret"
    });

    return;
  }

  const update =
    req.body as TelegramUpdate;

  const eventId =
    typeof update.update_id === "number"
      ? String(update.update_id)
      : null;

  const message =
    update.message;

  const text =
    message?.text?.trim();

  const photo =
    message?.photo;

  const hasPhoto =
    Array.isArray(photo) &&
    photo.length > 0;

  const hasText =
    typeof text === "string" &&
    text.length > 0;

  const chatId =
    message?.chat?.id;

  const userId =
    message?.from?.id;

  /*
   * Accept normal text messages OR
   * Telegram photo messages.
   */
  if (
    !eventId ||
    (!hasText && !hasPhoto) ||
    chatId === undefined ||
    userId === undefined ||
    !message?.message_id ||
    !message?.from
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
              message.from
            ),

          telegramChatId:
            chatIdString,

          telegramUserId:
            userIdString
        },

        update: {
          name:
            customerName(
              message.from
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

            channel:
              "TELEGRAM",

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
              text ??
              message.caption ??
              "[Receipt image]"
          }
        })
      ]);
    }

    /*
     * ------------------------------------------------
     * RECEIPT PHOTO PROCESSING
     * ------------------------------------------------
     */
    if (hasPhoto) {
      try {
        /*
         * Telegram sends multiple photo sizes.
         * The last item is normally the largest.
         */
        const largestPhoto =
          photo![photo!.length - 1];

        if (!largestPhoto?.file_id) {
          throw new Error(
            "Telegram receipt image did not contain a file_id"
          );
        }

        /*
         * Resolve Telegram file_id into
         * a downloadable file path.
         */
        const filePath =
          await getTelegramFilePath(
            largestPhoto.file_id
          );

        /*
         * Download receipt image.
         */
        const image =
          await downloadTelegramFile(
            filePath
          );

        /*
         * Extract receipt information
         * using Gemini Vision.
         *
         * IMPORTANT:
         * Extraction is informational only.
         * It never verifies a payment.
         */
        const receipt =
          await extractReceipt(
            image,
            "image/jpeg"
          );

        console.log(
          "Receipt extracted:",
          receipt
        );

        /*
         * Find the customer's latest payment
         * waiting for payment/review.
         */
        const pendingPayment =
          await prisma.payment.findFirst({
            where: {
              merchantId,

              order: {
                customerId:
                  customer.id,

                status: {
                  in: [
                    "PENDING_PAYMENT",
                    "PAYMENT_REVIEW"
                  ]
                }
              },

              status: {
                in: [
                  "PENDING",
                  "REVIEW_REQUIRED"
                ]
              }
            },

            include: {
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  total: true,
                  currency: true,
                  status: true
                }
              }
            },

            orderBy: {
              createdAt: "desc"
            }
          });

        /*
         * ------------------------------------------------
         * RECEIPT VALIDATION
         * ------------------------------------------------
         */
        let validation: ReceiptValidationResult | null = null;

        if (pendingPayment) {
          validation =
            validateReceipt({
              receipt,

              expectedAmount:
                Number(
                  pendingPayment.amount
                ),

              expectedCurrency:
                pendingPayment.currency,

              expectedProvider:
                pendingPayment.provider
            });

          console.log(
            "Receipt validation:",
            validation
          );

          /*
           * ------------------------------------------------
           * CRITICAL PAYMENT STATE TRANSITION
           * ------------------------------------------------
           *
           * A receipt has now been successfully processed.
           *
           * We move:
           *
           * Payment:
           * PENDING -> REVIEW_REQUIRED
           *
           * Order:
           * PENDING_PAYMENT -> PAYMENT_REVIEW
           *
           * IMPORTANT:
           *
           * We NEVER change the payment to VERIFIED here.
           *
           * Even if validation.status === "MATCH",
           * the merchant must still explicitly verify it
           * from the merchant dashboard.
           *
           * The payment metadata, payment status, and order
           * status are updated in ONE database transaction.
           */
          await prisma.$transaction(
            async (tx) => {
              /*
               * Re-read the payment inside the transaction
               * so the state transition is based on the
               * latest database state.
               */
              const currentPayment =
                await tx.payment.findFirst({
                  where: {
                    id:
                      pendingPayment.id,

                    merchantId,

                    order: {
                      customerId:
                        customer.id
                    }
                  },

                  include: {
                    order: {
                      select: {
                        id: true,
                        status: true
                      }
                    }
                  }
                });

              if (!currentPayment) {
                throw new Error(
                  "The pending payment is no longer available"
                );
              }

              /*
               * If another process has already moved the
               * payment beyond review, do not overwrite it.
               */
              if (
                currentPayment.status !==
                  PaymentStatus.PENDING &&
                currentPayment.status !==
                  PaymentStatus.REVIEW_REQUIRED
              ) {
                throw new Error(
                  `Payment cannot accept this receipt because its current status is ${currentPayment.status}`
                );
              }

              /*
               * If the payment is already under review,
               * keep it under review while updating its
               * receipt metadata.
               */
              if (
                currentPayment.status ===
                PaymentStatus.REVIEW_REQUIRED
              ) {
                await tx.payment.update({
                  where: {
                    id:
                      currentPayment.id
                  },

                  data: {
                    receiptMetadata: {
                      extracted:
                        receipt,

                      validation,

                      processedAt:
                        new Date().toISOString()
                    },

                    /*
                     * If the receipt contains a transaction
                     * reference, preserve it for merchant
                     * review.
                     *
                     * We do not clear an existing reference
                     * when OCR cannot detect one.
                     */
                    ...(receipt.transactionReference?.trim()
                      ? {
                          transactionReference:
                            receipt.transactionReference.trim()
                        }
                      : {})
                  }
                });

                /*
                 * Keep the order in PAYMENT_REVIEW.
                 */
                if (
                  currentPayment.order.status !==
                  "PAYMENT_REVIEW"
                ) {
                  await tx.order.update({
                    where: {
                      id:
                        currentPayment.order.id
                    },

                    data: {
                      status:
                        "PAYMENT_REVIEW"
                    }
                  });
                }

                return;
              }

              /*
               * First-time receipt submission:
               *
               * PENDING -> REVIEW_REQUIRED
               */
              await tx.payment.update({
                where: {
                  id:
                    currentPayment.id
                },

                data: {
                  status:
                    PaymentStatus.REVIEW_REQUIRED,

                  receiptMetadata: {
                    extracted:
                      receipt,

                    validation,

                    processedAt:
                      new Date().toISOString()
                  },

                  /*
                   * Store the OCR-detected transaction
                   * reference so the merchant can see it
                   * during payment review.
                   */
                  ...(receipt.transactionReference?.trim()
                    ? {
                        transactionReference:
                          receipt.transactionReference.trim()
                      }
                    : {})
                }
              });

              /*
               * PENDING_PAYMENT -> PAYMENT_REVIEW
               */
              await tx.order.update({
                where: {
                  id:
                    currentPayment.order.id
                },

                data: {
                  status:
                    "PAYMENT_REVIEW"
                }
              });
            }
          );
        }

        /*
         * Build customer-facing message.
         */
        const receiptMessageParts = [
          "Receipt received. 📷",
          "",
          `Provider: ${
            receipt.provider ??
            "Not detected"
          }`,
          `Transaction reference: ${
            receipt.transactionReference ??
            "Not detected"
          }`,
          `Amount: ${
            receipt.amount !== null &&
            receipt.amount !== undefined
              ? `${receipt.amount} ${
                  receipt.currency ?? "ETB"
                }`
              : "Not detected"
          }`,
          `Currency: ${
            receipt.currency ??
            "Not detected"
          }`,
          `Date: ${
            receipt.transactionDate ??
            "Not detected"
          }`,
          `Time: ${
            receipt.transactionTime ??
            "Not detected"
          }`,
          "",
          `Extraction confidence: ${
            Math.round(
              receipt.confidence * 100
            )
          }%`
        ];

        /*
         * Tell the customer exactly what happened.
         *
         * A successful receipt submission now means
         * the payment is waiting for merchant review.
         */
        if (pendingPayment && validation) {
          receiptMessageParts.push(
            "",
            "Receipt validation completed.",
            "",
            "Your payment has been submitted for merchant review.",
            "",
            "The payment has NOT been verified automatically."
          );
        } else {
          receiptMessageParts.push(
            "",
            "No matching pending payment was found.",
            "",
            "The receipt will require merchant review."
          );
        }

        receiptMessageParts.push(
          "",
          "Please wait for confirmation."
        );

        await sendAndSaveMessage(
          chatIdString,
          conversation.id,
          receiptMessageParts.join("\n")
        );

        /*
         * Mark Telegram event processed only after
         * receipt processing and customer notification
         * succeed.
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
          ok: true,
          receipt,
          validation,
          paymentStatus:
            pendingPayment
              ? PaymentStatus.REVIEW_REQUIRED
              : null,
          orderStatus:
            pendingPayment
              ? "PAYMENT_REVIEW"
              : null
        });

        return;
      } catch (receiptError) {
        console.error(
          "Failed to process Telegram receipt:",
          receiptError
        );

        /*
         * Tell the customer the image could
         * not be read or processed.
         */
        try {
          await sendAndSaveMessage(
            chatIdString,
            conversation.id,
            [
              "I couldn't process that payment receipt. 📷",
              "",
              "Please send a clear screenshot or photo of the receipt.",
              "",
              "Make sure the transaction reference, amount, provider, and date are visible."
            ].join("\n")
          );
        } catch (telegramError) {
          console.error(
            "Failed to send receipt error message:",
            telegramError
          );
        }

        /*
         * Return 200 so Telegram does not repeatedly
         * deliver the same receipt update.
         */
        res.status(200).json({
          ok: true,
          receiptProcessed: false
        });

        return;
      }
    }

    /*
     * ------------------------------------------------
     * NORMAL TEXT CONVERSATION
     * ------------------------------------------------
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
              message.from
            ),

          merchantName:
            merchant.name
        },

        text ?? ""
      );

    /*
     * Send and persist the response generated
     * by Conversation Manager.
     */
    await sendAndSaveMessage(
      chatIdString,
      conversation.id,
      result.reply
    );

    /*
     * Mark Telegram event processed only after
     * the conversation response succeeds.
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