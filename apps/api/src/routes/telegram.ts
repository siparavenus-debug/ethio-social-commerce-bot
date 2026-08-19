import { Router } from "express";
import {
  prisma,
  PaymentProvider,
  PaymentStatus
} from "@ethio-commerce/database";

import { env } from "../config/env.js";

import {
  sendTelegramMessage,
  getTelegramFilePath,
  downloadTelegramFile
} from "../services/telegram.js";

import {
  handleConversation
} from "../conversation/conversation-manager.js";

import {
  extractReceipt
} from "../services/receipt-vision.js";

import {
  validateReceipt,
  normalizeProvider
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

  return (
    name ||
    from.username ||
    null
  );
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
    await sendTelegramMessage(
      chatId,
      text
    );

  await prisma.message.create({
    data: {
      conversationId,
      direction: "OUTBOUND",
      externalId,
      content: text
    }
  });
}

/**
 * Convert the provider extracted by Gemini
 * into the Prisma enum.
 *
 * Unknown providers remain OTHER.
 */
function receiptProviderToEnum(
  provider: string | null
): PaymentProvider {
  const normalized =
    normalizeProvider(
      provider
    );

  switch (normalized) {
    case "TELEBIRR":
      return PaymentProvider.TELEBIRR;

    case "CBE_BIRR":
      return PaymentProvider.CBE_BIRR;

    default:
      return PaymentProvider.OTHER;
  }
}

router.post(
  "/",
  async (req, res) => {
    /*
     * ---------------------------------------------
     * TELEGRAM CONFIGURATION
     * ---------------------------------------------
     */
    if (
      !requireTelegramConfiguration()
    ) {
      res.status(503).json({
        error:
          "Telegram integration is not configured"
      });

      return;
    }

    /*
     * ---------------------------------------------
     * TELEGRAM WEBHOOK SECURITY
     * ---------------------------------------------
     */
    if (
      req.get(
        "x-telegram-bot-api-secret-token"
      ) !==
      env.telegramWebhookSecret
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
      typeof update.update_id ===
      "number"
        ? String(
            update.update_id
          )
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
      typeof text ===
        "string" &&
      text.length > 0;

    const chatId =
      message?.chat?.id;

    const userId =
      message?.from?.id;

    /*
     * Accept normal text messages
     * OR Telegram photo messages.
     */
    if (
      !eventId ||
      (!hasText && !hasPhoto) ||
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
       * ---------------------------------------------
       * DUPLICATE TELEGRAM UPDATE PROTECTION
       * ---------------------------------------------
       */
      const existingEvent =
        await prisma.webhookEvent.findUnique(
          {
            where: {
              provider_eventId: {
                provider:
                  "TELEGRAM",
                eventId
              }
            }
          }
        );

      if (
        existingEvent?.processedAt
      ) {
        res.status(200).json({
          ok: true,
          duplicate: true
        });

        return;
      }

      const merchantId =
        env.telegramMerchantId!;

      /*
       * ---------------------------------------------
       * FIND MERCHANT
       * ---------------------------------------------
       */
      const merchant =
        await prisma.merchant.findUnique(
          {
            where: {
              id: merchantId
            }
          }
        );

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
       * ---------------------------------------------
       * CUSTOMER
       * ---------------------------------------------
       */
      const customer =
        await prisma.customer.upsert(
          {
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
          }
        );

      /*
       * ---------------------------------------------
       * CONVERSATION
       * ---------------------------------------------
       */
      const conversation =
        await prisma.conversation.upsert(
          {
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
          }
        );

      /*
       * ---------------------------------------------
       * SAVE WEBHOOK EVENT + INBOUND MESSAGE
       * ---------------------------------------------
       */
      if (!existingEvent) {
        await prisma.$transaction(
          [
            prisma.webhookEvent.create(
              {
                data: {
                  merchantId,

                  provider:
                    "TELEGRAM",

                  eventId,

                  payload:
                    update as object
                }
              }
            ),

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
          ]
        );
      }

      /*
       * =================================================
       * RECEIPT PHOTO PROCESSING
       * =================================================
       */
      if (hasPhoto) {
        try {
          /*
           * Telegram sends several image sizes.
           * The last one is normally the largest.
           */
          const largestPhoto =
            photo[
              photo.length - 1
            ];

          if (
            !largestPhoto?.file_id
          ) {
            throw new Error(
              "Telegram receipt image did not contain a file_id"
            );
          }

          /*
           * Resolve Telegram file ID.
           */
          const filePath =
            await getTelegramFilePath(
              largestPhoto.file_id
            );

          /*
           * Download image.
           */
          const image =
            await downloadTelegramFile(
              filePath
            );

          /*
           * Gemini Vision extraction.
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
           * ---------------------------------------------
           * FIND EXISTING PAYMENT
           * ---------------------------------------------
           *
           * This supports the original flow where the
           * customer first typed a transaction reference.
           */
          let pendingPayment =
            await prisma.payment.findFirst(
              {
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
                      currency: true
                    }
                  }
                },

                orderBy: {
                  createdAt: "desc"
                }
              }
            );

          /*
           * ---------------------------------------------
           * IF NO PAYMENT EXISTS:
           * FIND THE CUSTOMER'S LATEST PENDING ORDER
           * ---------------------------------------------
           *
           * This is the bug fix.
           *
           * A customer is allowed to send the receipt
           * directly without first typing the reference.
           *
           * We create the payment as REVIEW_REQUIRED.
           */
          if (!pendingPayment) {
            const pendingOrder =
              await prisma.order.findFirst(
                {
                  where: {
                    merchantId,

                    customerId:
                      customer.id,

                    status:
                      "PENDING_PAYMENT"
                  },

                  select: {
                    id: true,
                    orderNumber: true,
                    total: true,
                    currency: true
                  },

                  orderBy: {
                    createdAt:
                      "desc"
                  }
                }
              );

            if (
              pendingOrder
            ) {
              const provider =
                receiptProviderToEnum(
                  receipt.provider
                );

              /*
               * Protect against an already-submitted
               * transaction reference.
               */
              if (
                receipt.transactionReference
              ) {
                const duplicateReference =
                  await prisma.payment.findUnique(
                    {
                      where: {
                        provider_transactionReference:
                          {
                            provider,
                            transactionReference:
                              receipt.transactionReference
                          }
                      }
                    }
                  );

                if (
                  duplicateReference
                ) {
                  /*
                   * Do not attach a duplicate transaction
                   * reference to another order.
                   *
                   * Keep the existing payment untouched.
                   */
                  console.warn(
                    "Duplicate receipt transaction reference detected",
                    {
                      provider,
                      transactionReference:
                        receipt.transactionReference,
                      existingPaymentId:
                        duplicateReference.id
                    }
                  );

                  pendingPayment =
                    duplicateReference.id ===
                      undefined
                      ? null
                      : await prisma.payment.findFirst(
                          {
                            where: {
                              id:
                                duplicateReference.id,

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
                                  orderNumber:
                                    true,
                                  total: true,
                                  currency:
                                    true
                                }
                              }
                            }
                          }
                        );
                } else {
                  /*
                   * Create the payment and move the order
                   * into merchant review atomically.
                   */
                  const created =
                    await prisma.$transaction(
                      async (tx) => {
                        const payment =
                          await tx.payment.create(
                            {
                              data: {
                                merchantId,

                                orderId:
                                  pendingOrder.id,

                                provider,

                                status:
                                  PaymentStatus.REVIEW_REQUIRED,

                                amount:
                                  pendingOrder.total,

                                currency:
                                  pendingOrder.currency,

                                transactionReference:
                                  receipt.transactionReference,

                                receiptMetadata:
                                  {
                                    extracted:
                                      receipt,

                                    receivedVia:
                                      "TELEGRAM_PHOTO",

                                    processedAt:
                                      new Date().toISOString()
                                  }
                              },

                              include: {
                                order: {
                                  select: {
                                    id: true,
                                    orderNumber:
                                      true,
                                    total: true,
                                    currency:
                                      true
                                  }
                                }
                              }
                            }
                          );

                        await tx.order.update(
                          {
                            where: {
                              id:
                                pendingOrder.id
                            },

                            data: {
                              status:
                                "PAYMENT_REVIEW"
                            }
                          }
                        );

                        return payment;
                      }
                    );

                  pendingPayment =
                    created;
                }
              } else {
                /*
                 * No transaction reference was extracted.
                 *
                 * We STILL create REVIEW_REQUIRED.
                 *
                 * This is important: missing information
                 * must go to merchant review, not disappear.
                 */
                const created =
                  await prisma.$transaction(
                    async (tx) => {
                      const payment =
                        await tx.payment.create(
                          {
                            data: {
                              merchantId,

                              orderId:
                                pendingOrder.id,

                              provider,

                              status:
                                PaymentStatus.REVIEW_REQUIRED,

                              amount:
                                pendingOrder.total,

                              currency:
                                pendingOrder.currency,

                              receiptMetadata:
                                {
                                  extracted:
                                    receipt,

                                  receivedVia:
                                    "TELEGRAM_PHOTO",

                                  processedAt:
                                    new Date().toISOString()
                                }
                            },

                            include: {
                              order: {
                                select: {
                                  id: true,
                                  orderNumber:
                                    true,
                                  total: true,
                                  currency:
                                    true
                                }
                              }
                            }
                          }
                        );

                      await tx.order.update(
                        {
                          where: {
                            id:
                              pendingOrder.id
                          },

                          data: {
                            status:
                              "PAYMENT_REVIEW"
                          }
                        }
                      );

                      return payment;
                    }
                  );

                pendingPayment =
                  created;
              }
            }
          }

          /*
           * ---------------------------------------------
           * VALIDATE RECEIPT
           * ---------------------------------------------
           */
          let validation:
            | ReturnType<
                typeof validateReceipt
              >
            | null = null;

          if (
            pendingPayment
          ) {
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
             * Store extraction and validation.
             *
             * NEVER verify here.
             */
            await prisma.payment.update(
              {
                where: {
                  id:
                    pendingPayment.id
                },

                data: {
                  receiptMetadata:
                    {
                      extracted:
                        receipt,

                      validation,

                      receivedVia:
                        "TELEGRAM_PHOTO",

                      processedAt:
                        new Date().toISOString()
                    }
                }
              }
            );
          }

          /*
           * ---------------------------------------------
           * CUSTOMER RESPONSE
           * ---------------------------------------------
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
                    receipt.currency ??
                    "ETB"
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

          if (
            pendingPayment &&
            validation
          ) {
            receiptMessageParts.push(
              "",
              "Your receipt has been submitted successfully.",
              "The payment is now waiting for merchant review."
            );
          } else {
            receiptMessageParts.push(
              "",
              "I could not match this receipt to a pending order.",
              "Please make sure you have an active order awaiting payment."
            );
          }

          /*
           * Explicit safety statement.
           */
          receiptMessageParts.push(
            "",
            "The receipt has NOT been verified.",
            "It requires merchant review."
          );

          await sendAndSaveMessage(
            chatIdString,
            conversation.id,
            receiptMessageParts.join(
              "\n"
            )
          );

          /*
           * Mark event processed only after all
           * receipt processing has completed.
           */
          await prisma.webhookEvent.update(
            {
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
            }
          );

          res.status(200).json({
            ok: true,
            receipt,
            validation,
            paymentId:
              pendingPayment?.id ??
              null,
            paymentStatus:
              pendingPayment?.status ??
              null
          });

          return;
        } catch (
          receiptError
        ) {
          console.error(
            "Failed to process Telegram receipt:",
            receiptError
          );

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
          } catch (
            telegramError
          ) {
            console.error(
              "Failed to send receipt error message:",
              telegramError
            );
          }

          /*
           * Return 200 so Telegram does not endlessly
           * retry an update that we have already handled.
           */
          res.status(200).json({
            ok: true,
            receiptProcessed:
              false
          });

          return;
        }
      }

      /*
       * =================================================
       * NORMAL TEXT CONVERSATION
       * =================================================
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

          text ?? ""
        );

      /*
       * Send and persist response.
       */
      await sendAndSaveMessage(
        chatIdString,
        conversation.id,
        result.reply
      );

      /*
       * Mark event processed only after
       * conversation response succeeds.
       */
      await prisma.webhookEvent.update(
        {
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
        }
      );

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
  }
);

export default router;