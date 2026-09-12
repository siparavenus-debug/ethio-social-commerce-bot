import { Router } from "express";
import {
  MerchantSettlementProvider,
  Prisma
} from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../middleware/auth.js";

import {
  submitMerchantSettlement
} from "../services/merchant-settlement.js";

import {
  getMerchantBillingSummary,
  getMerchantCommissionHistory,
  getMerchantInvoiceHistory,
  getMerchantSettlementHistory
} from "../services/merchant-billing-read.js";

const router = Router();

router.use(requireAuth);

/*
 * Read the merchant's platform-billing summary.
 *
 * GET /merchants/:merchantId/billing/summary
 *
 * Platform billing is OWNER-only.
 *
 * Deliberately does not use subscription-entitlement
 * middleware: suspended, cancelled, and unsubscribed
 * merchants must retain billing/recovery access.
 */
router.get(
  "/:merchantId/billing/summary",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(
          req.params.merchantId
        );

      const summary =
        await getMerchantBillingSummary(
          merchantId
        );

      res.json(
        summary
      );
    } catch (error) {
      console.error(
        "Failed to read merchant billing summary:",
        error
      );

      if (
        error instanceof Error &&
        error.message ===
          "Merchant not found"
      ) {
        res.status(404).json({
          error:
            error.message
        });
        return;
      }

      res.status(500).json({
        error:
          "Failed to read merchant billing summary"
      });
    }
  }
);

/*
 * Read the merchant's platform commission history.
 *
 * GET /merchants/:merchantId/billing/commissions
 *
 * Platform billing is OWNER-only.
 *
 * Historical commission values come from persisted
 * commission snapshots and append-only adjustments.
 * They are never recalculated from the current plan.
 */
router.get(
  "/:merchantId/billing/commissions",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(
          req.params.merchantId
        );

      const history =
        await getMerchantCommissionHistory(
          merchantId
        );

      res.json(
        history
      );
    } catch (error) {
      console.error(
        "Failed to read merchant commission history:",
        error
      );

      if (
        error instanceof Error &&
        error.message ===
          "Merchant not found"
      ) {
        res.status(404).json({
          error:
            error.message
        });
        return;
      }

      res.status(500).json({
        error:
          "Failed to read merchant commission history"
      });
    }
  }
);

/*
 * Read the merchant's persisted invoice history.
 *
 * GET /merchants/:merchantId/billing/invoices
 *
 * Platform billing is OWNER-only.
 *
 * Persisted invoice totals are authoritative.
 * Historical invoices are never reconstructed from
 * current subscription or commission data.
 */
router.get(
  "/:merchantId/billing/invoices",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(
          req.params.merchantId
        );

      const history =
        await getMerchantInvoiceHistory(
          merchantId
        );

      res.json(
        history
      );
    } catch (error) {
      console.error(
        "Failed to read merchant invoice history:",
        error
      );

      if (
        error instanceof Error &&
        error.message ===
          "Merchant not found"
      ) {
        res.status(404).json({
          error:
            error.message
        });
        return;
      }

      res.status(500).json({
        error:
          "Failed to read merchant invoice history"
      });
    }
  }
);

/*
 * Read the merchant's platform settlement history.
 *
 * GET /merchants/:merchantId/billing/settlements
 *
 * Platform billing is OWNER-only.
 *
 * This reads MerchantSettlement records only.
 * Customer Payment records are deliberately outside
 * this platform-billing history.
 */
router.get(
  "/:merchantId/billing/settlements",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(
          req.params.merchantId
        );

      const history =
        await getMerchantSettlementHistory(
          merchantId
        );

      res.json(
        history
      );
    } catch (error) {
      console.error(
        "Failed to read merchant settlement history:",
        error
      );

      if (
        error instanceof Error &&
        error.message ===
          "Merchant not found"
      ) {
        res.status(404).json({
          error:
            error.message
        });
        return;
      }

      res.status(500).json({
        error:
          "Failed to read merchant settlement history"
      });
    }
  }
);

/*
 * Submit merchant-to-platform settlement evidence.
 *
 * POST /merchants/:merchantId/billing/settlements
 *
 * IMPORTANT:
 * This is PLATFORM BILLING.
 *
 * It is intentionally separate from customer
 * Payment records and payment-review routes.
 *
 * Submission creates REVIEW_REQUIRED evidence only.
 * It never verifies the settlement and never marks
 * the invoice PAID.
 */
router.post(
  "/:merchantId/billing/settlements",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(
          req.params.merchantId
        );

      const {
        invoiceId,
        provider,
        amount,
        currency,
        idempotencyKey,
        transactionReference,
        receiptUrl,
        receiptMetadata
      } = req.body;

      if (
        typeof invoiceId !==
          "string" ||
        invoiceId.trim().length ===
          0
      ) {
        res.status(400).json({
          error:
            "invoiceId is required"
        });
        return;
      }

      if (
        typeof provider !==
          "string" ||
        !Object.values(
          MerchantSettlementProvider
        ).includes(
          provider as MerchantSettlementProvider
        )
      ) {
        res.status(400).json({
          error:
            "provider must be TELEBIRR, CBE_BIRR, or OTHER"
        });
        return;
      }

      if (
        !(
          typeof amount ===
            "string" ||
          typeof amount ===
            "number"
        )
      ) {
        res.status(400).json({
          error:
            "amount must be a positive number"
        });
        return;
      }

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

      let decimalAmount:
        Prisma.Decimal;

      try {
        decimalAmount =
          new Prisma.Decimal(
            String(amount)
          );
      } catch {
        res.status(400).json({
          error:
            "amount must be a positive number"
        });
        return;
      }

      if (
        typeof currency !==
          "string" ||
        currency.trim().length ===
          0
      ) {
        res.status(400).json({
          error:
            "currency is required"
        });
        return;
      }

      if (
        typeof idempotencyKey !==
          "string" ||
        idempotencyKey.trim()
          .length === 0
      ) {
        res.status(400).json({
          error:
            "idempotencyKey is required"
        });
        return;
      }

      if (
        transactionReference !==
          undefined &&
        transactionReference !==
          null &&
        typeof transactionReference !==
          "string"
      ) {
        res.status(400).json({
          error:
            "transactionReference must be a string"
        });
        return;
      }

      if (
        receiptUrl !== undefined &&
        receiptUrl !== null &&
        typeof receiptUrl !==
          "string"
      ) {
        res.status(400).json({
          error:
            "receiptUrl must be a string"
        });
        return;
      }

      const settlement =
        await submitMerchantSettlement({
          merchantId,
          invoiceId:
            invoiceId.trim(),
          provider:
            provider as MerchantSettlementProvider,
          amount:
            decimalAmount,
          currency,
          idempotencyKey,
          transactionReference:
            typeof transactionReference ===
              "string"
              ? transactionReference
              : null,
          receiptUrl:
            typeof receiptUrl ===
              "string"
              ? receiptUrl
              : null,
          receiptMetadata:
            receiptMetadata ===
              undefined ||
            receiptMetadata ===
              null
              ? null
              : receiptMetadata as
                  Prisma.InputJsonValue,
          actorUserId:
            req.auth!.id
        });

      res.status(201).json(
        settlement
      );
    } catch (error) {
      console.error(
        "Failed to submit merchant settlement:",
        error
      );

      if (
        error instanceof Error
      ) {
        if (
          error.message ===
          "Merchant invoice not found"
        ) {
          res.status(404).json({
            error:
              error.message
          });
          return;
        }

        if (
          error.message.includes(
            "idempotency key was already used"
          ) ||
          error.message.includes(
            "transaction reference has already been submitted"
          )
        ) {
          res.status(409).json({
            error:
              error.message
          });
          return;
        }

        if (
          error.message.startsWith(
            "Merchant settlement"
          )
        ) {
          res.status(400).json({
            error:
              error.message
          });
          return;
        }
      }

      res.status(500).json({
        error:
          "Failed to submit merchant settlement"
      });
    }
  }
);

export default router;
