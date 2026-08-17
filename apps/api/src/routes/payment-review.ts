import { Router } from "express";
import {
  prisma,
  PaymentStatus
} from "@ethio-commerce/database";
import { sendTelegramMessage } from "../services/telegram.js";

const router = Router();

/*
 * List payments requiring merchant review.
 *
 * GET /:merchantId/payment-review
 */
router.get("/:merchantId/payment-review", async (req, res) => {
  try {
    const { merchantId } = req.params;

    const payments = await prisma.payment.findMany({
      where: {
        merchantId,
        status: PaymentStatus.REVIEW_REQUIRED
      },
      include: {
        order: {
          include: {
            customer: true,
            items: true
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
      error: "Failed to list payment reviews"
    });
  }
});

/*
 * Get one payment review.
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
        error: "Failed to get payment review"
      });
    }
  }
);

/*
 * Verify a payment.
 *
 * POST /:merchantId/payment-review/:paymentId/verify
 *
 * IMPORTANT:
 * Payment verification is the inventory commitment point.
 *
 * Stock is decremented ONLY when:
 *
 * 1. Payment is REVIEW_REQUIRED
 * 2. Order is PAYMENT_REVIEW
 * 3. Every order item has a valid product
 * 4. Every product has enough stock
 *
 * Everything happens inside ONE database transaction.
 *
 * If any product does not have enough stock,
 * the entire transaction rolls back:
 *
 * - payment remains REVIEW_REQUIRED
 * - order remains PAYMENT_REVIEW
 * - stock remains unchanged
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
             * Load the payment and complete order.
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
             * Prevent double verification.
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
             * Payment must belong to an order
             * currently waiting for review.
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
             * Make sure the order actually has items.
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
             *
             * We do NOT read stock first and then
             * decrement it separately.
             *
             * Instead:
             *
             * UPDATE product
             * SET stock = stock - quantity
             * WHERE id = productId
             * AND stock >= quantity
             *
             * This protects against two customers
             * buying the last item simultaneously.
             */
            const stockUpdates: {
              productId: string;
              quantity: number;
              remainingStock: number;
            }[] = [];

            /*
             * Aggregate quantities by product.
             *
             * This protects us even if an order somehow
             * contains the same product more than once.
             */
            const quantityByProduct =
              new Map<
                string,
                number
              >();

            for (const item of payment.order.items) {
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
             * Decrement each product atomically.
             */
            for (const [
              productId,
              quantity
            ] of quantityByProduct) {
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
               * updateMany returns count.
               *
               * count === 0 means:
               *
               * - product does not exist
               * - product belongs to another merchant
               * - or stock is insufficient
               *
               * The transaction will roll back.
               */
              if (updated.count !== 1) {
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
               * Read the remaining stock after the
               * atomic decrement.
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
                productId: product.id,
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
              payment: verifiedPayment,
              order: updatedOrder,
              customer:
                payment.order.customer,
              stockUpdates
            };
          }
        );

      /*
       * -----------------------------------------
       * TELEGRAM CONFIRMATION
       * -----------------------------------------
       *
       * Telegram happens AFTER the database
       * transaction has successfully committed.
       */
      const chatId =
        result.customer?.telegramChatId;

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

          const externalId =
            await sendTelegramMessage(
              chatId,
              message
            );

          const conversation =
            await prisma.conversation.findFirst(
              {
                where: {
                  merchantId,
                  customerId:
                    result.customer.id,
                  channel: "TELEGRAM",
                  externalId: chatId
                }
              }
            );

          if (conversation) {
            await prisma.message.create({
              data: {
                conversationId:
                  conversation.id,
                direction: "OUTBOUND",
                externalId,
                content: message
              }
            });
          }
        } catch (telegramError) {
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
 * Reject a payment.
 *
 * POST /:merchantId/payment-review/:paymentId/reject
 *
 * IMPORTANT:
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

      if (
        typeof reviewNote !==
          "string" ||
        reviewNote.trim().length === 0
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

            if (
              payment.status !==
              PaymentStatus.REVIEW_REQUIRED
            ) {
              throw new Error(
                `Payment cannot be rejected because its current status is ${payment.status}`
              );
            }

            if (
              payment.order.status !==
              "PAYMENT_REVIEW"
            ) {
              throw new Error(
                `Order cannot return to payment because its current status is ${payment.order.status}`
              );
            }

            /*
             * Reject the submitted payment.
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
             * Return the order to payment pending.
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
              order: updatedOrder,
              customer:
                payment.order.customer
            };
          }
        );

      /*
       * -----------------------------------------
       * TELEGRAM REJECTION NOTIFICATION
       * -----------------------------------------
       */
      const chatId =
        result.customer?.telegramChatId;

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

          const externalId =
            await sendTelegramMessage(
              chatId,
              message
            );

          const conversation =
            await prisma.conversation.findFirst(
              {
                where: {
                  merchantId,
                  customerId:
                    result.customer.id,
                  channel: "TELEGRAM",
                  externalId: chatId
                }
              }
            );

          if (conversation) {
            await prisma.message.create({
              data: {
                conversationId:
                  conversation.id,
                direction: "OUTBOUND",
                externalId,
                content: message
              }
            });
          }
        } catch (telegramError) {
          console.error(
            "Payment rejected, but Telegram notification failed:",
            telegramError
          );
        }
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