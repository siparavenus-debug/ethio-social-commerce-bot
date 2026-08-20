
import { Router } from "express";
import {
  prisma,
  PaymentProvider,
  PaymentMethodStatus
} from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess
} from "../middleware/auth.js";

const router = Router();

router.use(
  requireAuth,
  requireMerchantAccess
);

router.get("/:merchantId/payment-methods", async (req, res) => {
  try {
    const { merchantId } = req.params;

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

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: {
        merchantId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    res.json(paymentMethods);
  } catch (error) {
    console.error("Failed to list payment methods:", error);

    res.status(500).json({
      error: "Failed to list payment methods"
    });
  }
});

router.post("/:merchantId/payment-methods", async (req, res) => {
  try {
    const { merchantId } = req.params;
    const {
      provider,
      accountName,
      accountNumber,
      status
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

    if (
      typeof accountName !== "string" ||
      accountName.trim().length === 0
    ) {
      res.status(400).json({
        error: "accountName is required"
      });
      return;
    }

    if (
      typeof accountNumber !== "string" ||
      accountNumber.trim().length === 0
    ) {
      res.status(400).json({
        error: "accountNumber is required"
      });
      return;
    }

    if (
      status !== undefined &&
      (typeof status !== "string" ||
        !Object.values(PaymentMethodStatus).includes(
          status as PaymentMethodStatus
        ))
    ) {
      res.status(400).json({
        error: "status must be ACTIVE or INACTIVE"
      });
      return;
    }

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        merchantId,
        provider: provider as PaymentProvider,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        status:
          status === undefined
            ? PaymentMethodStatus.ACTIVE
            : (status as PaymentMethodStatus)
      }
    });

    res.status(201).json(paymentMethod);
  } catch (error) {
    console.error("Failed to create payment method:", error);

    if (
      error instanceof Error &&
      error.message.includes("Unique constraint")
    ) {
      res.status(409).json({
        error: "A payment method for this provider already exists"
      });
      return;
    }

    res.status(500).json({
      error: "Failed to create payment method"
    });
  }
});

router.patch(
  "/:merchantId/payment-methods/:paymentMethodId",
  async (req, res) => {
    try {
      const {
        merchantId,
        paymentMethodId
      } = req.params;

      const {
        accountName,
        accountNumber,
        status
      } = req.body;

      const existing = await prisma.paymentMethod.findFirst({
        where: {
          id: paymentMethodId,
          merchantId
        }
      });

      if (!existing) {
        res.status(404).json({
          error: "Payment method not found"
        });
        return;
      }

      if (
        accountName !== undefined &&
        (typeof accountName !== "string" ||
          accountName.trim().length === 0)
      ) {
        res.status(400).json({
          error: "accountName must be a non-empty string"
        });
        return;
      }

      if (
        accountNumber !== undefined &&
        (typeof accountNumber !== "string" ||
          accountNumber.trim().length === 0)
      ) {
        res.status(400).json({
          error: "accountNumber must be a non-empty string"
        });
        return;
      }

      if (
        status !== undefined &&
        (typeof status !== "string" ||
          !Object.values(PaymentMethodStatus).includes(
            status as PaymentMethodStatus
          ))
      ) {
        res.status(400).json({
          error: "status must be ACTIVE or INACTIVE"
        });
        return;
      }

      const paymentMethod =
        await prisma.paymentMethod.update({
          where: {
            id: paymentMethodId
          },
          data: {
            ...(accountName !== undefined
              ? {
                  accountName: accountName.trim()
                }
              : {}),
            ...(accountNumber !== undefined
              ? {
                  accountNumber: accountNumber.trim()
                }
              : {}),
            ...(status !== undefined
              ? {
                  status: status as PaymentMethodStatus
                }
              : {})
          }
        });

      res.json(paymentMethod);
    } catch (error) {
      console.error(
        "Failed to update payment method:",
        error
      );

      res.status(500).json({
        error: "Failed to update payment method"
      });
    }
  }
);

export default router;
