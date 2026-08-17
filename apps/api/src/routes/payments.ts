
import { Router } from "express";
import {
  prisma,
  PaymentProvider,
  PaymentStatus
} from "@ethio-commerce/database";

const router = Router();

/*
 * List payments for a merchant
 */
router.get("/:merchantId/payments", async (req, res) => {
  try {
    const { merchantId } = req.params;

    const payments = await prisma.payment.findMany({
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

    res.json(payments);
  } catch (error) {
    console.error("Failed to list payments:", error);

    res.status(500).json({
      error: "Failed to list payments"
    });
  }
});

/*
 * Create a payment submission
 *
 * This is intended for the Telegram bot/customer flow.
 */
router.post("/:merchantId/payments", async (req, res) => {
  try {
    const { merchantId } = req.params;

    const {
      orderId,
      provider,
      amount,
      currency,
      transactionReference,
      receiptUrl
    } = req.body;

    const merchant = await prisma.merchant.findUnique({
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

    if (
      typeof orderId !== "string" ||
      orderId.trim().length === 0
    ) {
      res.status(400).json({
        error: "orderId is required"
      });
      return;
    }

    const order = await prisma.order.findFirst({
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

    if (order.status !== "PENDING_PAYMENT") {
      res.status(400).json({
        error:
          "Payment can only be submitted for an order awaiting payment"
      });
      return;
    }

    if (
      typeof provider !== "string" ||
      !Object.values(PaymentProvider).includes(
        provider as PaymentProvider
      )
    ) {
      res.status(400).json({
        error: "provider must be TELEBIRR, CBE_BIRR, or OTHER"
      });
      return;
    }

    const numericAmount = Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      res.status(400).json({
        error: "amount must be a positive number"
      });
      return;
    }

    if (
      typeof transactionReference !== "string" ||
      transactionReference.trim().length === 0
    ) {
      res.status(400).json({
        error: "transactionReference is required"
      });
      return;
    }

    if (
      typeof currency !== "string" ||
      currency.trim().length === 0
    ) {
      res.status(400).json({
        error: "currency is required"
      });
      return;
    }

    if (numericAmount !== Number(order.total)) {
      res.status(400).json({
        error: `Payment amount must match order total of ${order.total} ${order.currency}`
      });
      return;
    }

    if (currency.trim().toUpperCase() !== order.currency) {
      res.status(400).json({
        error: `Payment currency must be ${order.currency}`
      });
      return;
    }

    const payment = await prisma.payment.create({
      data: {
        merchantId,
        orderId,
        provider: provider as PaymentProvider,
        status: PaymentStatus.REVIEW_REQUIRED,
        amount: numericAmount,
        currency: currency.trim().toUpperCase(),
        transactionReference:
          transactionReference.trim(),
        receiptUrl:
          typeof receiptUrl === "string" &&
          receiptUrl.trim().length > 0
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

    await prisma.order.update({
      where: {
        id: order.id
      },
      data: {
        status: "PAYMENT_REVIEW"
      }
    });

    res.status(201).json(payment);
  } catch (error) {
    console.error("Failed to create payment:", error);

    if (
      error instanceof Error &&
      error.message.includes("Unique constraint")
    ) {
      res.status(409).json({
        error:
          "A payment with this transaction reference already exists"
      });
      return;
    }

    res.status(500).json({
      error: "Failed to create payment"
    });
  }
});

export default router;
