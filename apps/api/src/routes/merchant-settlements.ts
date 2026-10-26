import {
  createHash
} from "node:crypto";

import {
  Router,
  type RequestHandler
} from "express";

import multer from "multer";

import {
  prisma,
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

import {
  deleteSettlementReceipt,
  getMaxImageSizeBytes,
  getSettlementReceipt,
  isAllowedImageType,
  SettlementReceiptNotFoundError,
  uploadSettlementReceipt
} from "../services/storage.js";

const router = Router();

const settlementReceiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getMaxImageSizeBytes(),
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImageType(file.mimetype)) {
      cb(
        new Error(
          "Only JPEG, PNG, and WebP images are allowed."
        )
      );
      return;
    }

    cb(null, true);
  }
});

const handleSettlementReceiptUpload: RequestHandler = (
  req,
  res,
  next
) => {
  settlementReceiptUpload.single("receipt")(
    req,
    res,
    (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({
            error:
              "Receipt image exceeds the maximum allowed size"
          });
          return;
        }

        res.status(400).json({
          error:
            "Invalid receipt upload"
        });
        return;
      }

      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Invalid receipt upload"
      });
    }
  );
};

function buildSettlementReceiptObjectKey(
  merchantId: string,
  invoiceId: string,
  idempotencyKey: string,
  fileBuffer: Buffer,
  mimeType: string
): string {
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/png"
        ? "png"
        : "webp";

  const invoiceHash =
    createHash("sha256")
      .update(invoiceId)
      .digest("hex")
      .slice(0, 24);

  const idempotencyHash =
    createHash("sha256")
      .update(idempotencyKey)
      .digest("hex")
      .slice(0, 24);

  const fileHash =
    createHash("sha256")
      .update(fileBuffer)
      .digest("hex")
      .slice(0, 24);

  return (
    `merchants/${merchantId}/settlements/` +
    `${invoiceHash}/` +
    `${idempotencyHash}-${fileHash}.${extension}`
  );
}

function getSettlementReceiptObjectKey(
  receiptMetadata: Prisma.JsonValue | null
): string | null {
  if (
    !receiptMetadata ||
    typeof receiptMetadata !== "object" ||
    Array.isArray(receiptMetadata)
  ) {
    return null;
  }

  const objectKey =
    receiptMetadata.objectKey;

  return typeof objectKey === "string" &&
    objectKey.trim()
    ? objectKey.trim()
    : null;
}

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
  handleSettlementReceiptUpload,
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
        transactionReference
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

      const normalizedIdempotencyKey =
        idempotencyKey.trim();

      let uploadedObjectKey:
        string | null = null;

      let serverReceiptMetadata:
        Prisma.InputJsonValue | null = null;

      if (req.file) {
        uploadedObjectKey =
          buildSettlementReceiptObjectKey(
            merchantId,
            invoiceId.trim(),
            normalizedIdempotencyKey,
            req.file.buffer,
            req.file.mimetype
          );

        const imageType =
          req.file.mimetype as
          | "image/jpeg"
          | "image/png"
          | "image/webp";

        const receiptSha256 =
          createHash("sha256")
            .update(req.file.buffer)
            .digest("hex");

        await uploadSettlementReceipt(
          uploadedObjectKey,
          req.file.buffer,
          imageType
        );

        serverReceiptMetadata = {
          receivedVia:
            "MERCHANT_DASHBOARD",
          contentType:
            req.file.mimetype,
          size:
            req.file.size,
          sha256:
            receiptSha256,
          objectKey:
            uploadedObjectKey
        };
      }

      let settlement: Awaited<ReturnType<typeof submitMerchantSettlement>>;

      try {
        settlement =
          await submitMerchantSettlement({
            merchantId,
            invoiceId:
              invoiceId.trim(),
            provider:
              provider as MerchantSettlementProvider,
            amount:
              decimalAmount,
            currency,
            idempotencyKey:
              normalizedIdempotencyKey,
            transactionReference:
              typeof transactionReference ===
                "string"
                ? transactionReference
                : null,
            receiptUrl:
              null,
            receiptMetadata:
              serverReceiptMetadata,
            actorUserId:
              req.auth!.id
          });
      } catch (error) {
        if (uploadedObjectKey) {
          const existing =
            await prisma.merchantSettlement.findUnique({
              where: {
                merchantId_idempotencyKey: {
                  merchantId,
                  idempotencyKey:
                    normalizedIdempotencyKey
                }
              },
              select: {
                receiptMetadata: true
              }
            });

          const existingObjectKey =
            getSettlementReceiptObjectKey(
              existing?.receiptMetadata ?? null
            );

          if (
            !existing ||
            existingObjectKey !==
            uploadedObjectKey
          ) {
            try {
              await deleteSettlementReceipt(
                uploadedObjectKey
              );
            } catch (cleanupError) {
              console.error(
                "Failed to clean up settlement receipt upload:",
                cleanupError
              );
            }
          }
        }

        throw error;
      }

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

/*
 * Read one private merchant settlement receipt.
 *
 * GET /merchants/:merchantId/billing/settlements/:settlementId/evidence
 *
 * Platform billing is OWNER-only.
 *
 * The settlement must belong to the authenticated merchant.
 * The private R2 object is streamed through the authenticated API.
 * No permanent public receipt URL is exposed.
 */
router.get(
  "/:merchantId/billing/settlements/:settlementId/evidence",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(
          req.params.merchantId
        );

      const settlementId =
        String(
          req.params.settlementId
        );

      const settlement =
        await prisma.merchantSettlement.findFirst({
          where: {
            id:
              settlementId,
            merchantId
          },
          select: {
            receiptMetadata: true
          }
        });

      if (!settlement) {
        res.status(404).json({
          error:
            "Merchant settlement not found"
        });
        return;
      }

      const objectKey =
        getSettlementReceiptObjectKey(
          settlement.receiptMetadata
        );

      if (!objectKey) {
        res.status(404).json({
          error:
            "Settlement receipt evidence is not available"
        });
        return;
      }

      const receipt =
        await getSettlementReceipt(
          objectKey
        );

      if (
        receipt.contentType &&
        isAllowedImageType(
          receipt.contentType
        )
      ) {
        res.type(
          receipt.contentType
        );
      } else {
        res.type(
          "application/octet-stream"
        );
      }

      res.setHeader(
        "Content-Length",
        String(
          receipt.contentLength
        )
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      res.send(
        receipt.buffer
      );
    } catch (error) {
      if (error instanceof SettlementReceiptNotFoundError) {
        res.status(404).json({
          error:
            "Settlement receipt evidence is not available"
        });

        return;
      }
      console.error(
        "Failed to read merchant settlement receipt evidence:",
        error
      );

      res.status(500).json({
        error:
          "Failed to read settlement receipt evidence"
      });
    }
  }
);

export default router;
