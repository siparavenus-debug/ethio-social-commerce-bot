import { Router } from "express";

import {
  prisma,
  PaymentProvider,
  PaymentStatus
} from "@ethio-commerce/database";

import { sanitizeOrderForBillingResponse } from "../services/order-response.js";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

/*
 * List payments for a merchant
 *
 * GET /merchants/:merchantId/payments
 */
router.get(
  "/:merchantId/payments",
  requireMerchantAccess,
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);

      const payments =
        await prisma.payment.findMany({
          where: {
            merchantId
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
            createdAt: "desc"
          }
        });

        res.json(
          payments.map((payment) => ({
            ...payment,
            order: sanitizeOrderForBillingResponse(
              payment.order
            )
          }))
        );
    } catch (error) {
      console.error(
        "Failed to list payments:",
        error
      );

      res.status(500).json({
        error: "Failed to list payments"
      });
    }
  }
);

/*
 * Create a payment submission
 *
 * POST /merchants/:merchantId/payments
 *
 * This endpoint is protected by merchant authentication.
 * The Telegram payment flow does not call this endpoint
 * directly; Telegram handles payment submission internally.
 */
router.post(
  "/:merchantId/payments",
  requireMerchantAccess,
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);

      const {
        orderId,
        provider,
        amount,
        currency,
        transactionReference,
        receiptUrl
      } = req.body;

      /*
       * Verify merchant exists.
       */
      const merchant =
        await prisma.merchant.findUnique({
          where: {
            id: merchantId
          }
        });

      if (!merchant) {
        res.status(404).json({
          error: "Merchant not found"
        });

        return;
      }

      /*
       * Validate order ID.
       */
      if (
        typeof orderId !== "string" ||
        orderId.trim().length === 0
      ) {
        res.status(400).json({
          error: "orderId is required"
        });

        return;
      }

      /*
       * Ensure the order belongs to this merchant.
       */
      const order =
        await prisma.order.findFirst({
          where: {
            id: orderId,
            merchantId
          }
        });

      if (!order) {
        res.status(404).json({
          error: "Order not found"
        });

        return;
      }

      /*
       * Payment submissions are only valid while
       * the order is waiting for payment.
       */
      if (
        order.status !== "PENDING_PAYMENT"
      ) {
        res.status(400).json({
          error:
            "Payment can only be submitted for an order awaiting payment"
        });

        return;
      }

      /*
       * Validate payment provider.
       */
      if (
        typeof provider !== "string" ||
        !Object.values(
          PaymentProvider
        ).includes(
          provider as PaymentProvider
        )
      ) {
        res.status(400).json({
          error:
            "provider must be TELEBIRR, CBE_BIRR, or OTHER"
        });

        return;
      }

      /*
       * Validate amount.
       */
      const numericAmount =
        Number(amount);

      if (
        !Number.isFinite(
          numericAmount
        ) ||
        numericAmount <= 0
      ) {
        res.status(400).json({
          error:
            "amount must be a positive number"
        });

        return;
      }

      /*
       * Validate transaction reference.
       */
      if (
        typeof transactionReference !==
        "string" ||
        transactionReference.trim()
          .length === 0
      ) {
        res.status(400).json({
          error:
            "transactionReference is required"
        });

        return;
      }

      /*
       * Prevent unbounded transaction-reference
       * input.
       */
      const normalizedTransactionReference =
        transactionReference.trim();

      if (
        normalizedTransactionReference.length >
        200
      ) {
        res.status(400).json({
          error:
            "transactionReference is too long"
        });

        return;
      }

      /*
       * Validate currency.
       */
      if (
        typeof currency !== "string" ||
        currency.trim().length === 0
      ) {
        res.status(400).json({
          error: "currency is required"
        });

        return;
      }

      const normalizedCurrency =
        currency
          .trim()
          .toUpperCase();

      /*
       * Payment amount must exactly match
       * the order amount.
       */
      if (
        numericAmount !==
        Number(order.total)
      ) {
        res.status(400).json({
          error:
            `Payment amount must match order total of ${order.total} ${order.currency}`
        });

        return;
      }

      /*
       * Payment currency must match the order.
       */
      if (
        normalizedCurrency !==
        order.currency
      ) {
        res.status(400).json({
          error:
            `Payment currency must be ${order.currency}`
        });

        return;
      }

      /*
       * Create payment in REVIEW_REQUIRED.
       *
       * IMPORTANT:
       * A submitted payment is NEVER automatically
       * treated as successful.
       */
      const payment =
        await prisma.$transaction(
          async (tx) => {
            const createdPayment =
              await tx.payment.create({
                data: {
                  merchantId,
                  orderId,

                  provider:
                    provider as PaymentProvider,

                  status:
                    PaymentStatus.REVIEW_REQUIRED,

                  amount:
                    numericAmount,

                  currency:
                    normalizedCurrency,

                  transactionReference:
                    normalizedTransactionReference,

                  receiptUrl:
                    typeof receiptUrl ===
                      "string" &&
                      receiptUrl.trim()
                        .length > 0
                      ? receiptUrl.trim()
                      : null
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

            await tx.order.update({
              where: {
                id: order.id
              },

              data: {
                status:
                  "PAYMENT_REVIEW"
              }
            });

            return createdPayment;
          }
        );

        res.status(201).json({
          ...payment,
          order: sanitizeOrderForBillingResponse(
            payment.order
          )
        });
    } catch (error) {
      console.error(
        "Failed to create payment:",
        error
      );

      /*
       * Transaction references must be unique.
       */
      if (
        error instanceof Error &&
        error.message.includes(
          "Unique constraint"
        )
      ) {
        res.status(409).json({
          error:
            "A payment with this transaction reference already exists"
        });

        return;
      }

      res.status(500).json({
        error:
          "Failed to create payment"
      });
    }
  }
);

export default router;
