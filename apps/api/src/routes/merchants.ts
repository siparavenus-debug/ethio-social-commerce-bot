import { Router } from "express";

import {
  prisma,
  PaymentStatus
} from "@ethio-commerce/database";

import { sendTelegramMessage } from "../services/telegram.js";

import {
  requireAuth,
  requireMerchantAccess
} from "../middleware/auth.js";

const router = Router();

router.use(
  requireAuth,
  requireMerchantAccess
);

/*
 * =================================================
 * LIST PAYMENT REVIEWS
 * =================================================
 *
 * GET /:merchantId/payment-review
 *
 * Returns all payments currently waiting for
 * merchant verification.
 */
router.get(
  "/:merchantId/payment-review",
  async (req, res) => {
    try {
      const { merchantId } = req.params;

      const payments =
        await prisma.payment.findMany({
          where: {
            merchantId,
            status:
              PaymentStatus.REVIEW_REQUIRED
          },

          select: {
            id: true,
            merchantId: true,
            orderId: true,
            provider: true,
            status: true,
            amount: true,
            currency: true,
            transactionReference: true,
            reviewNote: true,
            createdAt: true,
            order: {
              select: {
                orderNumber: true,
                status: true,
                total: true,
                customer: {
                  select: {
                    name: true,
                    phone: true,
                    telegramChatId: true
                  }
                },
                items: {
                  select: {
                    productName: true,
                    quantity: true,
                    unitPrice: true,
                    lineTotal: true
                  }
                }
              }
            }
          },

          orderBy: {
            createdAt: "asc"
          }
        });

      res.json(payments);
    } catch (error) {
      console.error(
        "Failed to list payment reviews:",
        error
      );

      res.status(500).json({
        error:
          "Failed to list payment reviews"
      });
    }
  }
);

/*
 * =================================================
 * GET ONE PAYMENT REVIEW
 * =================================================
 *
 * GET /:merchantId/payment-review/:paymentId
 */
router.get(
  "/:merchantId/payment-review/:paymentId",
  async (req, res) => {
    try {
      const {
        merchantId,
        paymentId
      } = req.params;

      const payment =
        await prisma.payment.findFirst({
          where: {
            id: paymentId,
            merchantId
          },

          include: {
            order: {
              include: {
                customer: true,
                items: true
              }
            }
          }
        });

      if (!payment) {
        res.status(404).json({
          error: "Payment not found"
        });

        return;
      }

      res.json(payment);
    } catch (error) {
      console.error(
        "Failed to get payment review:",
        error
      );

      res.status(500).json({
        error:
          "Failed to get payment review"
      });
    }
  }
);

/*
 * =================================================
 * VERIFY PAYMENT
 * =================================================
 *
 * POST /:merchantId/payment-review/:paymentId/verify
 *
 * IMPORTANT:
 *
 * Payment verification is the inventory commitment
 * point.
 *
 * Stock is decremented ONLY when:
 *
 * 1. Payment is REVIEW_REQUIRED
 * 2. Order is PAYMENT_REVIEW
 * 3. Every order item has a valid product
 * 4. Every product has enough stock
 *
 * Payment verification, order update and stock
 * changes happen inside ONE database transaction.
 */
router.post(
  "/:merchantId/payment-review/:paymentId/verify",
  async (req, res) => {
    try {
      const {
        merchantId,
        paymentId
      } = req.params;

      const {
        reviewNote
      } = req.body;

      const result =
        await prisma.$transaction(
          async (tx) => {
            /*
             * -----------------------------------------
             * LOAD PAYMENT
             * -----------------------------------------
             */
            const payment =
              await tx.payment.findFirst({
                where: {
                  id: paymentId,
                  merchantId
                },

                include: {
                  order: {
                    include: {
                      customer: true,
                      items: true
                    }
                  }
                }
              });

            if (!payment) {
              throw new Error(
                "Payment not found"
              );
            }

            /*
             * -----------------------------------------
             * PREVENT DOUBLE VERIFICATION
             * -----------------------------------------
             */
            if (
              payment.status !==
              PaymentStatus.REVIEW_REQUIRED
            ) {
              throw new Error(
                `Payment cannot be verified because its current status is ${payment.status}`
              );
            }

            /*
             * -----------------------------------------
             * ORDER MUST BE IN PAYMENT REVIEW
             * -----------------------------------------
             */
            if (
              payment.order.status !==
              "PAYMENT_REVIEW"
            ) {
              throw new Error(
                `Order cannot be paid because its current status is ${payment.order.status}`
              );
            }

            /*
             * -----------------------------------------
             * ORDER MUST CONTAIN ITEMS
             * -----------------------------------------
             */
            if (
              payment.order.items.length === 0
            ) {
              throw new Error(
                "Order has no items and cannot be verified"
              );
            }

            /*
             * -----------------------------------------
             * ATOMIC STOCK CHECK + DECREMENT
             * -----------------------------------------
             */

            const stockUpdates: {
              productId: string;
              quantity: number;
              remainingStock: number;
            }[] = [];

            /*
             * Aggregate quantities by product.
             *
             * This protects against duplicate product
             * lines inside the same order.
             */
            const quantityByProduct =
              new Map<string, number>();

            for (
              const item of payment.order.items
            ) {
              if (!item.productId) {
                throw new Error(
                  `Product information is missing for order item "${item.productName}"`
                );
              }

              if (
                !Number.isInteger(
                  item.quantity
                ) ||
                item.quantity <= 0
              ) {
                throw new Error(
                  `Invalid quantity for product "${item.productName}"`
                );
              }

              const existing =
                quantityByProduct.get(
                  item.productId
                ) || 0;

              quantityByProduct.set(
                item.productId,
                existing + item.quantity
              );
            }

            /*
             * Decrement every product atomically.
             */
            for (
              const [
                productId,
                quantity
              ] of quantityByProduct
            ) {
              const updated =
                await tx.product.updateMany({
                  where: {
                    id: productId,
                    merchantId,
                    stock: {
                      gte: quantity
                    }
                  },

                  data: {
                    stock: {
                      decrement: quantity
                    }
                  }
                });

              /*
               * count === 0 means:
               *
               * - product does not exist
               * - product belongs to another merchant
               * - stock is insufficient
               */
              if (
                updated.count !== 1
              ) {
                const product =
                  await tx.product.findFirst({
                    where: {
                      id: productId,
                      merchantId
                    },

                    select: {
                      name: true,
                      stock: true
                    }
                  });

                if (!product) {
                  throw new Error(
                    "A product in this order could not be found"
                  );
                }

                throw new Error(
                  `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}`
                );
              }

              /*
               * Read remaining stock.
               */
              const product =
                await tx.product.findFirst({
                  where: {
                    id: productId,
                    merchantId
                  },

                  select: {
                    id: true,
                    stock: true
                  }
                });

              if (!product) {
                throw new Error(
                  "Product disappeared during stock update"
                );
              }

              stockUpdates.push({
                productId:
                  product.id,

                quantity,

                remainingStock:
                  product.stock
              });
            }

            /*
             * -----------------------------------------
             * VERIFY PAYMENT
             * -----------------------------------------
             */
            const verifiedPayment =
              await tx.payment.update({
                where: {
                  id: payment.id
                },

                data: {
                  status:
                    PaymentStatus.VERIFIED,

                  verifiedAt:
                    new Date(),

                  reviewNote:
                    typeof reviewNote ===
                      "string" &&
                    reviewNote.trim()
                      .length > 0
                      ? reviewNote.trim()
                      : null
                }
              });

            /*
             * -----------------------------------------
             * MARK ORDER PAID
             * -----------------------------------------
             */
            const updatedOrder =
              await tx.order.update({
                where: {
                  id: payment.orderId
                },

                data: {
                  status: "PAID"
                }
              });

            return {
              payment:
                verifiedPayment,

              order:
                updatedOrder,

              customer:
                payment.order.customer,

              stockUpdates
            };
          }
        );

      /*
       * -----------------------------------------
       * VERIFICATION TELEGRAM DEBUG
       * -----------------------------------------
       */
      console.log(
        "VERIFICATION TELEGRAM DEBUG:",
        {
          merchantId,
          paymentId,

          customerId:
            result.customer?.id ??
            null,

          telegramChatId:
            result.customer
              ?.telegramChatId ??
            null,

          orderNumber:
            result.order.orderNumber,

          paymentReference:
            result.payment
              .transactionReference,

          paymentStatus:
            result.payment.status
        }
      );

      /*
       * -----------------------------------------
       * TELEGRAM CONFIRMATION
       * -----------------------------------------
       *
       * Telegram notification happens AFTER the
       * database transaction has committed.
       *
       * Telegram failure therefore cannot roll back
       * a successfully verified payment.
       */
      const chatId =
        result.customer
          ?.telegramChatId;

      if (
        chatId &&
        result.customer
      ) {
        try {
          const message =
            `Payment confirmed! ✅\n\n` +
            `Order: ${result.order.orderNumber}\n` +
            `Amount: ${result.payment.amount} ${result.payment.currency}\n\n` +
            `Your payment has been verified successfully.\n` +
            `Your order is now confirmed and will be processed.`;

          console.log(
            "VERIFICATION TELEGRAM SEND:",
            {
              chatId,

              orderNumber:
                result.order
                  .orderNumber,

              paymentId,

              paymentReference:
                result.payment
                  .transactionReference
            }
          );

          const externalId =
            await sendTelegramMessage(
              chatId,
              message
            );

          console.log(
            "VERIFICATION TELEGRAM SENT:",
            {
              chatId,
              externalId,

              orderNumber:
                result.order
                  .orderNumber
            }
          );

          const conversation =
            await prisma.conversation.findFirst(
              {
                where: {
                  merchantId,

                  customerId:
                    result.customer.id,

                  channel:
                    "TELEGRAM",

                  externalId:
                    chatId
                }
              }
            );

if (conversation) {
  /*
   * ---------------------------------------------
   * SAVE VERIFICATION TELEGRAM MESSAGE
   * ---------------------------------------------
   *
   * Telegram message persistence is idempotent.
   *
   * The Message model has a unique constraint on:
   *
   *   conversationId + externalId
   *
   * The Telegram API message has already been sent
   * successfully. Therefore, saving the same outbound
   * message must never cause payment verification to
   * fail with Prisma P2002.
   *
   * If the message already exists, update: {} leaves
   * the existing record unchanged.
   */
  await prisma.message.upsert({
    where: {
      conversationId_externalId: {
        conversationId:
          conversation.id,

        externalId
      }
    },

    create: {
      conversationId:
        conversation.id,

      direction:
        "OUTBOUND",

      externalId,

      content:
        message
    },

    update: {}
  });
} else {
  console.warn(
    "Verification Telegram message sent, but conversation was not found:",
    {
      merchantId,

      customerId:
        result.customer.id,

      chatId
    }
  );
}
        } catch (
          telegramError
        ) {
          /*
           * Payment and stock have already been
           * committed successfully.
           *
           * Telegram failure must NOT roll back
           * the successful payment.
           */
          console.error(
            "Payment verified, but Telegram notification failed:",
            telegramError
          );
        }
      } else {
        console.warn(
          "Payment verified, but Telegram notification was skipped because no chat ID was available:",
          {
            merchantId,
            paymentId,

            customerId:
              result.customer?.id ??
              null,

            telegramChatId:
              result.customer
                ?.telegramChatId ??
              null
          }
        );
      }

      res.json({
        message:
          "Payment verified successfully",

        ...result
      });
    } catch (error) {
      console.error(
        "Failed to verify payment:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : "Failed to verify payment";

      if (
        message ===
        "Payment not found"
      ) {
        res.status(404).json({
          error: message
        });

        return;
      }

      res.status(400).json({
        error: message
      });
    }
  }
);

/*
 * =================================================
 * REJECT PAYMENT
 * =================================================
 *
 * POST /:merchantId/payment-review/:paymentId/reject
 *
 * IMPORTANT:
 *
 * Rejection NEVER changes product stock.
 *
 * The customer can submit another payment
 * reference for the same order.
 */
router.post(
  "/:merchantId/payment-review/:paymentId/reject",
  async (req, res) => {
    try {
      const {
        merchantId,
        paymentId
      } = req.params;

      const {
        reviewNote
      } = req.body;

      /*
       * -----------------------------------------
       * REQUIRE REJECTION REASON
       * -----------------------------------------
       */
      if (
        typeof reviewNote !==
          "string" ||
        reviewNote.trim()
          .length === 0
      ) {
        res.status(400).json({
          error:
            "reviewNote is required when rejecting a payment"
        });

        return;
      }

      const result =
        await prisma.$transaction(
          async (tx) => {
            /*
             * -----------------------------------------
             * LOAD PAYMENT
             * -----------------------------------------
             */
            const payment =
              await tx.payment.findFirst({
                where: {
                  id: paymentId,
                  merchantId
                },

                include: {
                  order: {
                    include: {
                      customer: true
                    }
                  }
                }
              });

            if (!payment) {
              throw new Error(
                "Payment not found"
              );
            }

            /*
             * -----------------------------------------
             * PREVENT DOUBLE REJECTION
             * -----------------------------------------
             */
            if (
              payment.status !==
              PaymentStatus.REVIEW_REQUIRED
            ) {
              throw new Error(
                `Payment cannot be rejected because its current status is ${payment.status}`
              );
            }

            /*
             * -----------------------------------------
             * ORDER MUST BE IN PAYMENT REVIEW
             * -----------------------------------------
             */
            if (
              payment.order.status !==
              "PAYMENT_REVIEW"
            ) {
              throw new Error(
                `Order cannot return to payment because its current status is ${payment.order.status}`
              );
            }

            /*
             * -----------------------------------------
             * REJECT PAYMENT
             * -----------------------------------------
             *
             * STOCK IS NOT TOUCHED HERE.
             */
            const rejectedPayment =
              await tx.payment.update({
                where: {
                  id: payment.id
                },

                data: {
                  status:
                    PaymentStatus.REJECTED,

                  reviewNote:
                    reviewNote.trim()
                }
              });

            /*
             * -----------------------------------------
             * RETURN ORDER TO PAYMENT PENDING
             * -----------------------------------------
             */
            const updatedOrder =
              await tx.order.update({
                where: {
                  id: payment.orderId
                },

                data: {
                  status:
                    "PENDING_PAYMENT"
                }
              });

            return {
              payment:
                rejectedPayment,

              order:
                updatedOrder,

              customer:
                payment.order.customer
            };
          }
        );

      /*
       * -----------------------------------------
       * REJECTION TELEGRAM DEBUG
       * -----------------------------------------
       */
      console.log(
        "REJECTION TELEGRAM DEBUG:",
        {
          merchantId,
          paymentId,

          customerId:
            result.customer?.id ??
            null,

          telegramChatId:
            result.customer
              ?.telegramChatId ??
            null,

          orderNumber:
            result.order.orderNumber,

          paymentReference:
            result.payment
              .transactionReference,

          paymentStatus:
            result.payment.status,

          reviewNote:
            result.payment.reviewNote
        }
      );

      /*
       * -----------------------------------------
       * TELEGRAM REJECTION NOTIFICATION
       * -----------------------------------------
       */
      const chatId =
        result.customer
          ?.telegramChatId;

      if (
        chatId &&
        result.customer
      ) {
        try {
          const message =
            `Payment could not be verified. ❌\n\n` +
            `Order: ${result.order.orderNumber}\n` +
            `Amount: ${result.payment.amount} ${result.payment.currency}\n\n` +
            `Reason: ${result.payment.reviewNote}\n\n` +
            `Please make the payment again and send your new transaction reference here.\n\n` +
            `Your order is still pending payment.`;

          console.log(
            "REJECTION TELEGRAM SEND:",
            {
              chatId,

              orderNumber:
                result.order
                  .orderNumber,

              paymentId,

              paymentReference:
                result.payment
                  .transactionReference
            }
          );

          const externalId =
            await sendTelegramMessage(
              chatId,
              message
            );

          console.log(
            "REJECTION TELEGRAM SENT:",
            {
              chatId,
              externalId,

              orderNumber:
                result.order
                  .orderNumber
            }
          );

          const conversation =
            await prisma.conversation.findFirst(
              {
                where: {
                  merchantId,

                  customerId:
                    result.customer.id,

                  channel:
                    "TELEGRAM",

                  externalId:
                    chatId
                }
              }
            );

          if (conversation) {
            await prisma.message.create({
              data: {
                conversationId:
                  conversation.id,

                direction:
                  "OUTBOUND",

                externalId,

                content:
                  message
              }
            });
          } else {
            console.warn(
              "Rejection Telegram message sent, but conversation was not found:",
              {
                merchantId,

                customerId:
                  result.customer.id,

                chatId
              }
            );
          }
        } catch (
          telegramError
        ) {
          /*
           * Payment rejection has already been
           * committed successfully.
           *
           * Telegram failure must NOT roll back
           * the rejection.
           */
          console.error(
            "Payment rejected, but Telegram notification failed:",
            telegramError
          );
        }
      } else {
        console.warn(
          "Payment rejected, but Telegram notification was skipped because no chat ID was available:",
          {
            merchantId,
            paymentId,

            customerId:
              result.customer?.id ??
              null,

            telegramChatId:
              result.customer
                ?.telegramChatId ??
              null
          }
        );
      }

      res.json({
        message:
          "Payment rejected",

        ...result
      });
    } catch (error) {
      console.error(
        "Failed to reject payment:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : "Failed to reject payment";

      if (
        message ===
        "Payment not found"
      ) {
        res.status(404).json({
          error: message
        });

        return;
      }

      res.status(400).json({
        error: message
      });
    }
  }
);

export default router;