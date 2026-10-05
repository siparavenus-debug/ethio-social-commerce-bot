import { Router } from "express";

import {
  MerchantAccountStatus,
  prisma,
  PaymentProvider,
  PaymentStatus
} from "@ethio-commerce/database";

import {
  sendTelegramMessage,
  sendTelegramPhoto,
  getTelegramFilePath,
  downloadTelegramFile
} from "../services/telegram.js";

import {
  getActiveMerchantTelegramWebhookIntegration
} from "../services/merchant-telegram-integration.js";

import {
  handleConversation
} from "../conversation/conversation-manager.js";

import {
  getConversationState
} from "../conversation/conversation-state.js";

import {
  extractReceipt
} from "../services/receipt-vision.js";

import {
  validateReceipt,
  normalizeProvider
} from "../services/receipt-validation.js";

import {
  uploadReceiptImage
} from "../services/storage.js";

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

async function sendAndSaveMessage(
  botToken: string,
  chatId: string,
  conversationId: string,
  text: string,
  imageUrl?: string
) {
  const externalId = imageUrl
    ? await sendTelegramPhoto(
      botToken,
      chatId,
      imageUrl,
      text
    )
    : await sendTelegramMessage(
      botToken,
      chatId,
      text
    );

  await prisma.message.upsert({
    where: {
      conversationId_externalId: {
        conversationId,
        externalId
      }
    },

    create: {
      conversationId,
      direction: "OUTBOUND",
      externalId,
      content: text
    },

    update: {}
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
  "/:webhookKey",
  async (req, res) => {
    /*
     * ---------------------------------------------
     * TELEGRAM INTEGRATION
     * ---------------------------------------------
     */
    const webhookKey =
      String(
        req.params.webhookKey
      ).trim();

    if (!webhookKey) {
      res.status(404).json({
        error:
          "Telegram integration was not found"
      });

      return;
    }

    try {
      const integration =
        await getActiveMerchantTelegramWebhookIntegration(
          webhookKey
        );

      if (!integration) {
        res.status(404).json({
          error:
            "Telegram integration was not found"
        });

        return;
      }

      const {
        merchantId,
        botToken,
        webhookSecret
      } = integration;

      /*
       * ---------------------------------------------
       * TELEGRAM WEBHOOK SECURITY
       * ---------------------------------------------
       */
      if (
        req.get(
          "x-telegram-bot-api-secret-token"
        ) !==
        webhookSecret
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

      /*
       * ---------------------------------------------
       * DUPLICATE TELEGRAM UPDATE PROTECTION
       * ---------------------------------------------
       */
      const existingEvent =
        await prisma.webhookEvent.findUnique(
          {
            where: {
              merchantId_provider_eventId: {
                merchantId,
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

      if (
        merchant.accountStatus ===
        MerchantAccountStatus.SUSPENDED
      ) {
        if (!existingEvent) {
          await prisma.webhookEvent.create({
            data: {
              merchantId,

              provider:
                "TELEGRAM",

              eventId,

              payload:
                update as object,

              processedAt:
                new Date()
            }
          });
        } else {
          await prisma.webhookEvent.update({
            where: {
              merchantId_provider_eventId: {
                merchantId,

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
        }

        res.status(200).json({
          ok: true
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
       *
       * Telegram may retry the same update.
       *
       * Message has a unique constraint on:
       *
       *   conversationId + externalId
       *
       * Therefore inbound messages must be persisted
       * idempotently. A duplicate Telegram delivery must
       * NEVER cause the webhook to return HTTP 500.
       */
      if (!existingEvent) {
        await prisma.webhookEvent.create({
          data: {
            merchantId,

            provider:
              "TELEGRAM",

            eventId,

            payload:
              update as object
          }
        });
      }

      /*
       * ---------------------------------------------
       * IDEMPOTENT INBOUND MESSAGE
       * ---------------------------------------------
       *
       * Telegram message_id is used as externalId.
       *
       * If Telegram retries the same message, update the
       * existing record instead of attempting a duplicate
       * insert.
       */
      await prisma.message.upsert({
        where: {
          conversationId_externalId: {
            conversationId:
              conversation.id,

            externalId:
              String(
                message.message_id
              )
          }
        },

        create: {
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
        },

        update: {}
      });

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
           * ---------------------------------------------
           * AI RECEIPT IMAGE SECURITY
           * ---------------------------------------------
           *
           * Do not download or send oversized images to
           * Gemini. This protects against unnecessary
           * memory usage and AI-provider abuse.
           */
          const MAX_RECEIPT_IMAGE_BYTES =
            5 * 1024 * 1024;

          if (
            largestPhoto.file_size !== undefined &&
            largestPhoto.file_size >
            MAX_RECEIPT_IMAGE_BYTES
          ) {
            throw new Error(
              "Telegram receipt image exceeds the maximum allowed size"
            );
          }

          /*
           * Resolve Telegram file ID.
           */
          const filePath =
            await getTelegramFilePath(
              botToken,
              largestPhoto.file_id
            );
          /*
          * Download image.
          */
          const image =
            await downloadTelegramFile(
              botToken,
              filePath
            );

          /*
          * Verify the actual downloaded payload too.
          *
          * The Telegram metadata is not sufficient by itself.
          */
          if (
            image.length === 0
          ) {
            throw new Error(
              "Telegram receipt image is empty"
            );
          }

          if (
            image.length >
            MAX_RECEIPT_IMAGE_BYTES
          ) {
            throw new Error(
              "Downloaded receipt image exceeds the maximum allowed size"
            );
          }

          /*
          * Gemini Vision extraction.
          *
          * The current Telegram photo flow provides the
          * image as JPEG to the existing receipt-vision
          * service. MIME validation is additionally enforced
          * inside extractReceipt().
          */
          const receipt =
            await extractReceipt(
              image,
              "image/jpeg"
            );


            console.log(
              "Receipt extracted:",
              {
                provider: receipt.provider,
                hasTransactionReference:
                  Boolean(
                    receipt.transactionReference
                  ),
                hasAmount:
                  receipt.amount !== null &&
                  receipt.amount !== undefined,
                hasCurrency:
                  Boolean(receipt.currency),
                hasTransactionDate:
                  Boolean(receipt.transactionDate),
                hasTransactionTime:
                  Boolean(receipt.transactionTime),
                confidence:
                  receipt.confidence
              }
            );

          /*
           * ---------------------------------------------
           * RESOLVE THE ORDER FOR THIS RECEIPT
           * ---------------------------------------------
           *
           * A Telegram chat can contain multiple orders.
           * Never choose an old PAYMENT_REVIEW order merely
           * because it is the latest payment record.
           *
           * Priority:
           *   1. The customer's newest PENDING_PAYMENT order.
           *   2. If there is no pending order, the conversation's
           *      current order when it is already in PAYMENT_REVIEW.
           *
           * This makes a newly-created dress/shawl order the target
           * for the next receipt instead of overwriting the receipt
           * belonging to an older order.
           */
          const conversationState =
            getConversationState(chatIdString);

          const currentPendingOrderId =
            conversationState.pendingOrderId;

          let targetOrder = null;

          /*
           * ---------------------------------------------
           * RESOLVE THE ORDER FOR THIS RECEIPT
           * ---------------------------------------------
           *
           * Day 2 correlation rule:
           *
           * 1. If the conversation has an explicit pendingOrderId,
           *    that exact order is authoritative.
           *
           * 2. The order must belong to this merchant AND customer.
           *
           * 3. The order must still be awaiting payment/review.
           *
           * 4. Only when there is no valid conversation order do
           *    we fall back to the customer's newest pending order.
           *
           * This prevents a newer order from accidentally replacing
           * the order currently associated with this conversation.
           */

          if (currentPendingOrderId) {
            targetOrder =
              await prisma.order.findFirst({
                where: {
                  id: currentPendingOrderId,
                  merchantId,
                  customerId: customer.id,
                  status: {
                    in: [
                      "PENDING_PAYMENT",
                      "PAYMENT_REVIEW"
                    ]
                  }
                },
                select: {
                  id: true,
                  orderNumber: true,
                  total: true,
                  currency: true
                }
              });
          }

          /*
           * Only fall back to the newest pending order when the
           * conversation does not contain a valid current order.
           */
          if (!targetOrder) {
            targetOrder =
              await prisma.order.findFirst({
                where: {
                  merchantId,
                  customerId: customer.id,
                  status: "PENDING_PAYMENT"
                },
                select: {
                  id: true,
                  orderNumber: true,
                  total: true,
                  currency: true
                },
                orderBy: {
                  createdAt: "desc"
                }
              });
          }

          let pendingPayment = null;

          /*
           * First find an existing payment belonging to the exact
           * target order. We never search the customer's payments
           * globally because that can attach a new receipt to an
           * older order.
           */
          if (targetOrder) {
            pendingPayment =
              await prisma.payment.findFirst({
                where: {
                  merchantId,
                  orderId: targetOrder.id,
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
              });
          }

          /*
           * ---------------------------------------------
           * CREATE PAYMENT FOR A NEW PENDING ORDER
           * ---------------------------------------------
           */
          if (!pendingPayment && targetOrder) {
            const provider =
              receiptProviderToEnum(
                receipt.provider
              );

            const receiptObjectKey =
              `receipts/${merchantId}/${targetOrder.id}/${Date.now()}-${largestPhoto.file_id}.jpg`;

            const receiptUrl =
              await uploadReceiptImage(
                receiptObjectKey,
                image,
                "image/jpeg"
              );

            let transactionReference =
              receipt.transactionReference;

            let duplicateReference = null;

            if (transactionReference) {
              duplicateReference =
                await prisma.payment.findUnique({
                  where: {
                    provider_transactionReference: {
                      provider,
                      transactionReference
                    }
                  }
                });
            }

            /*
             * A duplicate reference must NEVER overwrite or reuse
             * another payment. Keep this new receipt as a separate
             * review item with the extracted reference stored in
             * receiptMetadata for the merchant to investigate.
             */
            if (duplicateReference) {
              console.warn(
                "Duplicate receipt transaction reference detected",
                {
                  provider,
                  transactionReference,
                  existingPaymentId:
                    duplicateReference.id,
                  newOrderId:
                    targetOrder.id
                }
              );

              transactionReference = null;
            }

            const created =
              await prisma.$transaction(
                async (tx) => {
                  const payment =
                    await tx.payment.create({
                      data: {
                        merchantId,
                        orderId:
                          targetOrder.id,
                        provider,
                        status:
                          PaymentStatus.REVIEW_REQUIRED,
                        amount:
                          targetOrder.total,
                        currency:
                          targetOrder.currency,
                        transactionReference,
                        receiptUrl,
                        receiptMetadata: {
                          extracted: receipt,
                          receivedVia:
                            "TELEGRAM_PHOTO",
                          processedAt:
                            new Date().toISOString(),
                          ...(duplicateReference
                            ? {
                              duplicateTransactionReference:
                                true,
                              duplicatePaymentId:
                                duplicateReference.id
                            }
                            : {})
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
                      }
                    });

                  await tx.order.update({
                    where: {
                      id: targetOrder.id
                    },
                    data: {
                      status:
                        "PAYMENT_REVIEW"
                    }
                  });

                  return payment;
                }
              );

            pendingPayment = created;
          }

          /*
           * ---------------------------------------------
           * UPDATE AN EXISTING PAYMENT WITH THE NEW RECEIPT
           * ---------------------------------------------
           *
           * This is the normal path when the customer first typed
           * a transaction reference and then sends the receipt.
           * The image is uploaded to a key containing the exact
           * order ID, so receipts remain isolated per order.
           */
          if (pendingPayment) {
            const receiptObjectKey =
              `receipts/${merchantId}/${pendingPayment.orderId}/${Date.now()}-${largestPhoto.file_id}.jpg`;

            const receiptUrl =
              await uploadReceiptImage(
                receiptObjectKey,
                image,
                "image/jpeg"
              );

            const existingMetadata =
              pendingPayment.receiptMetadata &&
                typeof pendingPayment.receiptMetadata ===
                "object" &&
                !Array.isArray(
                  pendingPayment.receiptMetadata
                )
                ? pendingPayment.receiptMetadata
                : {};

            await prisma.payment.update({
              where: {
                id: pendingPayment.id
              },
              data: {
                receiptUrl,
                receiptMetadata: {
                  ...existingMetadata,
                  extracted: receipt,
                  receivedVia:
                    "TELEGRAM_PHOTO",
                  processedAt:
                    new Date().toISOString()
                }
              }
            });

            pendingPayment =
              await prisma.payment.findUnique({
                where: {
                  id: pendingPayment.id
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
                }
              });
          }
          /*
           * ---------------------------------------------
           * VALIDATE RECEIPT
           * ---------------------------------------------
           *
           * Validation NEVER verifies payment.
           * The merchant must explicitly verify it.
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
                  pendingPayment.provider,

                expectedReference:
                  pendingPayment.transactionReference
              });

              console.log(
                "Receipt validation:",
                {
                  status: validation.status,
                  amountMatches:
                    validation.amountMatches,
                  currencyMatches:
                    validation.currencyMatches,
                  providerMatches:
                    validation.providerMatches,
                  referencePresent:
                    validation.referencePresent,
                  referenceMatches:
                    validation.referenceMatches
                }
              );

            /*
             * Store extraction and validation.
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
            "Your payment receipt was received and is being processed.",
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
            botToken,
            chatIdString,
            conversation.id,
            receiptMessageParts.join(
              "\n"
            )
          );

          /*
           * Mark event processed only after
           * receipt processing completes.
           */
          await prisma.webhookEvent.update(
            {
              where: {
                merchantId_provider_eventId: {
                  merchantId,

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
              botToken,
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
        botToken,
        chatIdString,
        conversation.id,
        result.reply,
        result.imageUrl
      );

      /*
       * Mark event processed only after
       * conversation response succeeds.
       */
      await prisma.webhookEvent.update(
        {
          where: {
            merchantId_provider_eventId: {
              merchantId,

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