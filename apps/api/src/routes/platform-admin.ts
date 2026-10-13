import {
  createHash,
  randomBytes
} from "node:crypto";

import {
  MerchantAccountStatus,
  MerchantInvoiceStatus,
  MerchantSettlementStatus,
  MerchantSubscriptionStatus,
  Prisma,
  SubscriptionBillingInterval,
  prisma
} from "@ethio-commerce/database";

import { Router } from "express";

import {
  requirePlatformAuth,
  requirePlatformRole
} from "../middleware/platform-auth.js";

import {
  createPlatformPlan,
  setPlatformPlanActiveState,
  updatePlatformPlan
} from "../services/platform-plan.js";

import {
  initializeMerchantSubscription,
  transitionMerchantSubscriptionStatus
} from "../services/subscription.js";

import {
  transitionMerchantAccountStatus
} from "../services/merchant-account-enforcement.js";

import {
  getMerchantCommissionHistory,
  getMerchantInvoiceHistory,
  getMerchantSettlementHistory
} from "../services/merchant-billing-read.js";

import {
  generateMerchantInvoice
} from "../services/invoice.js";

import {
  markMerchantInvoiceOverdue,
  openMerchantInvoice
} from "../services/invoice-lifecycle.js";

import {
  rejectMerchantSettlement,
  verifyMerchantSettlement
} from "../services/merchant-settlement-review.js";

import {
  getSettlementReceipt,
  isAllowedImageType,
  SettlementReceiptNotFoundError
} from "../services/storage.js";

import {
  hashPassword
} from "../services/auth.js";

import {
  encryptMerchantInvitation
} from "../services/merchant-invitation-encryption.js";

const router = Router();

const MAX_PHONE_LENGTH = 50;
const MAX_ADDRESS_LENGTH = 1000;

const OWNER_ACTIVATION_TTL_HOURS = 24;

function createOwnerActivationToken(): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString("base64url");

  const tokenHash = createHash("sha256")
    .update(token)
    .digest("hex");

  const expiresAt = new Date(
    Date.now() +
    OWNER_ACTIVATION_TTL_HOURS * 60 * 60 * 1000
  );

  return {
    token,
    tokenHash,
    expiresAt
  };
}

function normalizeRouteParam(
  value: string | string[] | undefined
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

router.use(requirePlatformAuth);

/*
 * Platform administration is intentionally separate
 * from merchant administration.
 *
 * Every route in this router requires an authenticated
 * PlatformUser. Merchant OWNER / ADMIN / STAFF
 * credentials are rejected by requirePlatformAuth.
 */

router.get(
  "/audit",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (_req, res) => {
    try {
      const auditLogs =
        await prisma.platformAuditLog.findMany({
          include: {
            actor: {
              select: {
                id: true,
                email: true,
                displayName: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 100
        });

      res.json({
        auditLogs
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load platform audit log"
      });
    }
  }
);

router.get(
  "/billing/work/summary",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const now =
        new Date();

      const todayStart =
        new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
          )
        );

      const tomorrowStart =
        new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1
          )
        );

      const [
        draftInvoices,
        awaitingPayment,
        paymentReview,
        verifiedToday,
        rejectedToday
      ] =
        await Promise.all([
          prisma.merchantInvoice.count({
            where: {
              status:
                MerchantInvoiceStatus.DRAFT
            }
          }),
          prisma.merchantInvoice.count({
            where: {
              status:
                MerchantInvoiceStatus.OPEN
            }
          }),
          prisma.merchantSettlement.count({
            where: {
              status:
                MerchantSettlementStatus
                  .REVIEW_REQUIRED
            }
          }),
          prisma.platformAuditLog.count({
            where: {
              action:
                "MERCHANT_SETTLEMENT_VERIFIED",
              createdAt: {
                gte:
                  todayStart,
                lt:
                  tomorrowStart
              }
            }
          }),
          prisma.platformAuditLog.count({
            where: {
              action:
                "MERCHANT_SETTLEMENT_REJECTED",
              createdAt: {
                gte:
                  todayStart,
                lt:
                  tomorrowStart
              }
            }
          })
        ]);

      res.json({
        pending: {
          draftInvoices,
          awaitingPayment,
          paymentReview,
          total:
            draftInvoices +
            awaitingPayment +
            paymentReview
        },
        resolvedToday: {
          verified:
            verifiedToday,
          rejected:
            rejectedToday,
          total:
            verifiedToday +
            rejectedToday
        }
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load billing work summary"
      });
    }
  }
);

router.get(
  "/billing/settlements/review",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const settlements =
        await prisma.merchantSettlement.findMany({
          where: {
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            },
            invoice: true
          },
          orderBy: {
            submittedAt: "asc"
          }
        });

      res.json({
        settlements
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load settlements requiring review"
      });
    }
  }
);

router.get(
  "/billing/settlements/resolved",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const settlements =
        await prisma.merchantSettlement.findMany({
          where: {
            status: {
              in: [
                MerchantSettlementStatus
                  .VERIFIED,
                MerchantSettlementStatus
                  .REJECTED
              ]
            }
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            },
            invoice: true
          },
          orderBy: {
            updatedAt: "desc"
          }
        });

      res.json({
        settlements
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load resolved settlements"
      });
    }
  }
);

router.get(
  "/billing/invoices/draft",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.DRAFT
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        });

      res.json({
        invoices
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load draft invoices"
      });
    }
  }
);

router.get(
  "/billing/invoices/awaiting-payment",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.OPEN
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            }
          },
          orderBy: {
            openedAt: "asc"
          }
        });

      res.json({
        invoices
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load invoices awaiting payment"
      });
    }
  }
);

router.get(
  "/billing/revenue/monthly-summary",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const month =
        typeof req.query.month === "string"
          ? req.query.month
          : "";

      if (!/^\d{4}-\d{2}$/.test(month)) {
        res.status(400).json({
          error:
            "month must use YYYY-MM format"
        });
        return;
      }

      const [
        yearText,
        monthText
      ] =
        month.split("-");

      const year =
        Number(yearText);

      const monthIndex =
        Number(monthText) - 1;

      if (
        monthIndex < 0 ||
        monthIndex > 11
      ) {
        res.status(400).json({
          error:
            "month must use YYYY-MM format"
        });
        return;
      }

      const periodStart =
        new Date(
          Date.UTC(
            year,
            monthIndex,
            1
          )
        );

      const periodEnd =
        new Date(
          Date.UTC(
            year,
            monthIndex + 1,
            1
          )
        );

      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.PAID,
            paidAt: {
              gte: periodStart,
              lt: periodEnd
            }
          },
          select: {
            subscriptionAmount: true,
            commissionAmount: true,
            totalAmount: true,
            currency: true
          }
        });

      const totals =
        new Map<
          string,
          {
            subscriptionAmount:
            Prisma.Decimal;
            commissionAmount:
            Prisma.Decimal;
            totalAmount:
            Prisma.Decimal;
          }
        >();

      for (const invoice of invoices) {
        const existing =
          totals.get(
            invoice.currency
          ) ?? {
            subscriptionAmount:
              new Prisma.Decimal(0),
            commissionAmount:
              new Prisma.Decimal(0),
            totalAmount:
              new Prisma.Decimal(0)
          };

        totals.set(
          invoice.currency,
          {
            subscriptionAmount:
              existing.subscriptionAmount.plus(
                invoice.subscriptionAmount
              ),
            commissionAmount:
              existing.commissionAmount.plus(
                invoice.commissionAmount
              ),
            totalAmount:
              existing.totalAmount.plus(
                invoice.totalAmount
              )
          }
        );
      }

      const currencies =
        Array.from(
          totals.entries()
        )
          .sort(
            ([currencyA], [currencyB]) =>
              currencyA.localeCompare(
                currencyB
              )
          )
          .map(
            ([
              currency,
              amounts
            ]) => ({
              currency,
              subscriptionAmount:
                amounts.subscriptionAmount.toFixed(
                  2
                ),
              commissionAmount:
                amounts.commissionAmount.toFixed(
                  2
                ),
              totalAmount:
                amounts.totalAmount.toFixed(
                  2
                )
            })
          );

      res.json({
        periodStart:
          periodStart.toISOString(),
        periodEnd:
          periodEnd.toISOString(),
        currencies
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load monthly platform revenue summary"
      });
    }
  }
);

router.get(
  "/billing/revenue/range-summary",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const start =
        typeof req.query.start === "string"
          ? req.query.start
          : "";

      const end =
        typeof req.query.end === "string"
          ? req.query.end
          : "";

      const datePattern =
        /^\d{4}-\d{2}-\d{2}$/;

      if (
        !datePattern.test(start) ||
        !datePattern.test(end)
      ) {
        res.status(400).json({
          error:
            "start and end must use YYYY-MM-DD format"
        });
        return;
      }

      const periodStart =
        new Date(
          `${start}T00:00:00.000Z`
        );

      const periodEnd =
        new Date(
          `${end}T00:00:00.000Z`
        );

      if (
        Number.isNaN(
          periodStart.getTime()
        ) ||
        Number.isNaN(
          periodEnd.getTime()
        ) ||
        periodStart
          .toISOString()
          .slice(0, 10) !== start ||
        periodEnd
          .toISOString()
          .slice(0, 10) !== end ||
        periodStart >= periodEnd
      ) {
        res.status(400).json({
          error:
            "start and end must define a valid date range"
        });
        return;
      }

      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.PAID,
            paidAt: {
              gte: periodStart,
              lt: periodEnd
            }
          },
          select: {
            subscriptionAmount: true,
            commissionAmount: true,
            totalAmount: true,
            currency: true
          }
        });

      const totals =
        new Map<
          string,
          {
            subscriptionAmount:
            Prisma.Decimal;
            commissionAmount:
            Prisma.Decimal;
            totalAmount:
            Prisma.Decimal;
          }
        >();

      for (const invoice of invoices) {
        const existing =
          totals.get(
            invoice.currency
          ) ?? {
            subscriptionAmount:
              new Prisma.Decimal(0),
            commissionAmount:
              new Prisma.Decimal(0),
            totalAmount:
              new Prisma.Decimal(0)
          };

        totals.set(
          invoice.currency,
          {
            subscriptionAmount:
              existing.subscriptionAmount.plus(
                invoice.subscriptionAmount
              ),
            commissionAmount:
              existing.commissionAmount.plus(
                invoice.commissionAmount
              ),
            totalAmount:
              existing.totalAmount.plus(
                invoice.totalAmount
              )
          }
        );
      }

      const currencies =
        Array.from(
          totals.entries()
        )
          .sort(
            ([currencyA], [currencyB]) =>
              currencyA.localeCompare(
                currencyB
              )
          )
          .map(
            ([
              currency,
              amounts
            ]) => ({
              currency,
              subscriptionAmount:
                amounts.subscriptionAmount.toFixed(
                  2
                ),
              commissionAmount:
                amounts.commissionAmount.toFixed(
                  2
                ),
              totalAmount:
                amounts.totalAmount.toFixed(
                  2
                )
            })
          );

      res.json({
        periodStart:
          periodStart.toISOString(),
        periodEnd:
          periodEnd.toISOString(),
        currencies
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load platform revenue range summary"
      });
    }
  }
);

router.get(
  "/billing/revenue/range",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const start =
        typeof req.query.start === "string"
          ? req.query.start
          : "";

      const end =
        typeof req.query.end === "string"
          ? req.query.end
          : "";

      const datePattern =
        /^\d{4}-\d{2}-\d{2}$/;

      if (
        !datePattern.test(start) ||
        !datePattern.test(end)
      ) {
        res.status(400).json({
          error:
            "start and end must use YYYY-MM-DD format"
        });
        return;
      }

      const periodStart =
        new Date(
          `${start}T00:00:00.000Z`
        );

      const periodEnd =
        new Date(
          `${end}T00:00:00.000Z`
        );

      if (
        Number.isNaN(
          periodStart.getTime()
        ) ||
        Number.isNaN(
          periodEnd.getTime()
        ) ||
        periodStart
          .toISOString()
          .slice(0, 10) !== start ||
        periodEnd
          .toISOString()
          .slice(0, 10) !== end ||
        periodStart >= periodEnd
      ) {
        res.status(400).json({
          error:
            "start and end must define a valid date range"
        });
        return;
      }

      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.PAID,
            paidAt: {
              gte: periodStart,
              lt: periodEnd
            }
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            }
          },
          orderBy: [
            {
              paidAt: "asc"
            },
            {
              id: "asc"
            }
          ]
        });

      res.json({
        periodStart:
          periodStart.toISOString(),
        periodEnd:
          periodEnd.toISOString(),
        invoices:
          invoices.map(
            invoice => ({
              ...invoice,
              subscriptionAmount:
                invoice.subscriptionAmount.toFixed(
                  2
                ),
              commissionAmount:
                invoice.commissionAmount.toFixed(
                  2
                ),
              totalAmount:
                invoice.totalAmount.toFixed(
                  2
                )
            })
          )
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load platform revenue range"
      });
    }
  }
);

router.get(
  "/billing/revenue",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (_req, res) => {
    try {
      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.PAID
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            }
          },
          orderBy: {
            paidAt: "desc"
          }
        });

      res.json({
        invoices
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load platform revenue"
      });
    }
  }
);

router.get(
  "/billing/overdue/range",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const start =
        typeof req.query.start === "string"
          ? req.query.start
          : "";

      const end =
        typeof req.query.end === "string"
          ? req.query.end
          : "";

      const datePattern =
        /^\d{4}-\d{2}-\d{2}$/;

      if (
        !datePattern.test(start) ||
        !datePattern.test(end)
      ) {
        res.status(400).json({
          error:
            "start and end must use YYYY-MM-DD format"
        });
        return;
      }

      const periodStart =
        new Date(
          `${start}T00:00:00.000Z`
        );

      const periodEnd =
        new Date(
          `${end}T00:00:00.000Z`
        );

      if (
        Number.isNaN(
          periodStart.getTime()
        ) ||
        Number.isNaN(
          periodEnd.getTime()
        ) ||
        periodStart
          .toISOString()
          .slice(0, 10) !== start ||
        periodEnd
          .toISOString()
          .slice(0, 10) !== end ||
        periodStart >= periodEnd
      ) {
        res.status(400).json({
          error:
            "start and end must define a valid date range"
        });
        return;
      }

      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.OVERDUE,
            dueAt: {
              gte: periodStart,
              lt: periodEnd
            }
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            }
          },
          orderBy: [
            {
              dueAt: "asc"
            },
            {
              id: "asc"
            }
          ]
        });

      res.json({
        periodStart:
          periodStart.toISOString(),
        periodEnd:
          periodEnd.toISOString(),
        invoices:
          invoices.map(
            (invoice) => ({
              ...invoice,
              subscriptionAmount:
                invoice.subscriptionAmount.toFixed(
                  2
                ),
              commissionAmount:
                invoice.commissionAmount.toFixed(
                  2
                ),
              totalAmount:
                invoice.totalAmount.toFixed(
                  2
                )
            })
          )
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load platform overdue range"
      });
    }
  }
);

router.get(
  "/billing/overdue/range-summary",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const start =
        typeof req.query.start === "string"
          ? req.query.start
          : "";

      const end =
        typeof req.query.end === "string"
          ? req.query.end
          : "";

      const datePattern =
        /^\d{4}-\d{2}-\d{2}$/;

      if (
        !datePattern.test(start) ||
        !datePattern.test(end)
      ) {
        res.status(400).json({
          error:
            "start and end must use YYYY-MM-DD format"
        });
        return;
      }

      const periodStart =
        new Date(
          `${start}T00:00:00.000Z`
        );

      const periodEnd =
        new Date(
          `${end}T00:00:00.000Z`
        );

      if (
        Number.isNaN(
          periodStart.getTime()
        ) ||
        Number.isNaN(
          periodEnd.getTime()
        ) ||
        periodStart
          .toISOString()
          .slice(0, 10) !== start ||
        periodEnd
          .toISOString()
          .slice(0, 10) !== end ||
        periodStart >= periodEnd
      ) {
        res.status(400).json({
          error:
            "start and end must define a valid date range"
        });
        return;
      }

      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.OVERDUE,
            dueAt: {
              gte: periodStart,
              lt: periodEnd
            }
          },
          select: {
            totalAmount: true,
            currency: true
          }
        });

      const totals =
        new Map<
          string,
          {
            invoiceCount: number;
            totalAmount:
            Prisma.Decimal;
          }
        >();

      for (const invoice of invoices) {
        const existing =
          totals.get(
            invoice.currency
          ) ?? {
            invoiceCount: 0,
            totalAmount:
              new Prisma.Decimal(0)
          };

        totals.set(
          invoice.currency,
          {
            invoiceCount:
              existing.invoiceCount + 1,
            totalAmount:
              existing.totalAmount.plus(
                invoice.totalAmount
              )
          }
        );
      }

      const currencies =
        Array.from(
          totals.entries()
        )
          .sort(
            ([currencyA], [currencyB]) =>
              currencyA.localeCompare(
                currencyB
              )
          )
          .map(
            ([
              currency,
              amounts
            ]) => ({
              currency,
              invoiceCount:
                amounts.invoiceCount,
              totalAmount:
                amounts.totalAmount.toFixed(
                  2
                )
            })
          );

      res.json({
        periodStart:
          periodStart.toISOString(),
        periodEnd:
          periodEnd.toISOString(),
        currencies
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load platform overdue range summary"
      });
    }
  }
);

router.get(
  "/billing/overdue",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (_req, res) => {
    try {
      const invoices =
        await prisma.merchantInvoice.findMany({
          where: {
            status:
              MerchantInvoiceStatus.OVERDUE
          },
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                currency: true
              }
            }
          },
          orderBy: {
            dueAt: "asc"
          }
        });

      res.json({
        invoices
      });
    } catch {
      res.status(500).json({
        error:
          "Failed to load overdue invoices"
      });
    }
  }
);

router.post(
  "/merchant-onboarding/:applicationId/approve",
  requirePlatformRole("OWNER", "ADMIN"),
  async (req, res) => {
    const applicationId = normalizeRouteParam(
      req.params.applicationId
    );

    const actorPlatformUserId = req.platformAuth?.id;

    if (!actorPlatformUserId) {
      res.status(401).json({
        error: "Platform authentication required"
      });
      return;
    }

    const activation = createOwnerActivationToken();

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const application =
            await tx.merchantOnboardingApplication.findUnique({
              where: {
                id: applicationId
              }
            });

          if (!application) {
            return { outcome: "NOT_FOUND" as const };
          }

          if (application.createdById === actorPlatformUserId) {
            return { outcome: "SELF_APPROVAL" as const };
          }

          if (application.status !== "PENDING_APPROVAL") {
            return { outcome: "NOT_PENDING" as const };
          }

          const claimed =
            await tx.merchantOnboardingApplication.updateMany({
              where: {
                id: application.id,
                status: "PENDING_APPROVAL",
                merchantId: null
              },
              data: {
                status: "APPROVED",
                reviewedById: actorPlatformUserId,
                reviewedAt: new Date()
              }
            });

          if (claimed.count !== 1) {
            return { outcome: "NOT_PENDING" as const };
          }

          const approvedApplication =
            await tx.merchantOnboardingApplication.findUniqueOrThrow({
              where: {
                id: application.id
              }
            });

          const merchant = await tx.merchant.create({
            data: {
              name: approvedApplication.name,
              currency: "ETB",
              phone: approvedApplication.phone,
              alternatePhone: approvedApplication.alternatePhone,
              address: approvedApplication.address
            }
          });

          const ownerActivation =
            await tx.merchantOwnerActivation.create({
              data: {
                merchantId: merchant.id,
                ownerEmail: approvedApplication.ownerEmail,
                ownerDisplayName: approvedApplication.ownerDisplayName,
                tokenHash: activation.tokenHash,
                expiresAt: activation.expiresAt
              }
            });

          await tx.merchantInvitationDelivery.create({
            data: {
              activationId: ownerActivation.id,
              recipientEmail: approvedApplication.ownerEmail,
              encryptedToken: encryptMerchantInvitation(
                activation.token
              ),
              status: "PENDING"
            }
          });

          await tx.merchantOnboardingApplication.update({
            where: {
              id: application.id
            },
            data: {
              merchantId: merchant.id
            }
          });

          await tx.platformAuditLog.create({
            data: {
              actorPlatformUserId,
              merchantId: merchant.id,
              action: "MERCHANT_ONBOARDING_APPROVED",
              entityType: "MERCHANT_ONBOARDING_APPLICATION",
              entityId: application.id,
              metadata: {
                ownerEmail: approvedApplication.ownerEmail
              }
            }
          });

          return {
            outcome: "APPROVED" as const,
            merchantId: merchant.id
          };
        }
      );

      if (result.outcome === "NOT_FOUND") {
        res.status(404).json({
          error: "Onboarding application not found"
        });
        return;
      }

      if (result.outcome === "SELF_APPROVAL") {
        res.status(403).json({
          error: "You cannot approve your own onboarding application"
        });
        return;
      }

      if (result.outcome === "NOT_PENDING") {
        res.status(409).json({
          error: "Onboarding application is not pending approval"
        });
        return;
      }

      res.status(200).json({
        applicationId,
        merchantId: result.merchantId,
        status: "APPROVED"
      });
    } catch (error) {
      console.error(
        "Failed to approve merchant onboarding:",
        error
      );

      res.status(500).json({
        error: "Failed to approve merchant onboarding application"
      });
    }
  }
);

router.post(
  "/merchant-onboarding/:applicationId/discard",
  requirePlatformRole("OWNER", "ADMIN"),
  async (req, res) => {
    const applicationId = normalizeRouteParam(
      req.params.applicationId
    );

    const actorPlatformUserId = req.platformAuth?.id;

    if (!actorPlatformUserId) {
      res.status(401).json({
        error: "Platform authentication required"
      });
      return;
    }

    const reason =
      typeof req.body?.reason === "string"
        ? req.body.reason.trim()
        : "";

    if (!reason) {
      res.status(400).json({
        error: "Onboarding discard reason is required"
      });
      return;
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const application =
            await tx.merchantOnboardingApplication.findUnique({
              where: {
                id: applicationId
              }
            });

          if (!application) {
            return {
              outcome: "NOT_FOUND" as const
            };
          }

          if (
            application.createdById === actorPlatformUserId
          ) {
            return {
              outcome: "SELF_REVIEW" as const
            };
          }

          if (
            application.status !== "PENDING_APPROVAL" ||
            application.merchantId !== null
          ) {
            return {
              outcome: "NOT_PENDING" as const
            };
          }

          const claimed =
            await tx.merchantOnboardingApplication.updateMany({
              where: {
                id: application.id,
                status: "PENDING_APPROVAL",
                merchantId: null
              },
              data: {
                status: "DISCARDED",
                reviewedById: actorPlatformUserId,
                reviewedAt: new Date(),
                reviewReason: reason
              }
            });

          if (claimed.count !== 1) {
            return {
              outcome: "NOT_PENDING" as const
            };
          }

          await tx.platformAuditLog.create({
            data: {
              actorPlatformUserId,
              action: "MERCHANT_ONBOARDING_DISCARDED",
              entityType:
                "MERCHANT_ONBOARDING_APPLICATION",
              entityId: application.id,
              metadata: {
                reason
              }
            }
          });

          return {
            outcome: "DISCARDED" as const
          };
        }
      );

      if (result.outcome === "NOT_FOUND") {
        res.status(404).json({
          error: "Onboarding application not found"
        });
        return;
      }

      if (result.outcome === "SELF_REVIEW") {
        res.status(403).json({
          error:
            "You cannot review your own onboarding application"
        });
        return;
      }

      if (result.outcome === "NOT_PENDING") {
        res.status(409).json({
          error:
            "Onboarding application is not pending approval"
        });
        return;
      }

      res.status(200).json({
        applicationId,
        status: "DISCARDED"
      });
    } catch (error) {
      console.error(
        "Failed to discard merchant onboarding:",
        error
      );

      res.status(500).json({
        error:
          "Failed to discard merchant onboarding application"
      });
    }
  }
);

router.post(
  "/merchant-onboarding/:applicationId/reject",
  requirePlatformRole("OWNER", "ADMIN"),
  async (req, res) => {
    const applicationId =
      normalizeRouteParam(req.params.applicationId);

    const actorPlatformUserId =
      req.platformAuth?.id;

    if (!actorPlatformUserId) {
      res.status(401).json({
        error: "Platform authentication required"
      });
      return;
    }

    const reason =
      typeof req.body?.reason === "string"
        ? req.body.reason.trim()
        : "";

    if (!reason) {
      res.status(400).json({
        error: "Onboarding rejection reason is required"
      });
      return;
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const application =
            await tx.merchantOnboardingApplication.findUnique({
              where: { id: applicationId }
            });

          if (!application) {
            return { outcome: "NOT_FOUND" as const };
          }

          if (
            application.createdById === actorPlatformUserId
          ) {
            return { outcome: "SELF_REVIEW" as const };
          }

          if (application.status !== "PENDING_APPROVAL") {
            return { outcome: "NOT_PENDING" as const };
          }

          const claimed =
            await tx.merchantOnboardingApplication.updateMany({
              where: {
                id: application.id,
                status: "PENDING_APPROVAL",
                merchantId: null
              },
              data: {
                status: "REJECTED",
                reviewedById: actorPlatformUserId,
                reviewedAt: new Date(),
                reviewReason: reason
              }
            });

          if (claimed.count !== 1) {
            return { outcome: "NOT_PENDING" as const };
          }

          await tx.platformAuditLog.create({
            data: {
              actorPlatformUserId,
              action: "MERCHANT_ONBOARDING_REJECTED",
              entityType: "MERCHANT_ONBOARDING_APPLICATION",
              entityId: application.id,
              metadata: {
                reason
              }
            }
          });

          return { outcome: "REJECTED" as const };
        }
      );

      if (result.outcome === "NOT_FOUND") {
        res.status(404).json({
          error: "Onboarding application not found"
        });
        return;
      }

      if (result.outcome === "SELF_REVIEW") {
        res.status(403).json({
          error:
            "You cannot review your own onboarding application"
        });
        return;
      }

      if (result.outcome === "NOT_PENDING") {
        res.status(409).json({
          error:
            "Onboarding application is not pending approval"
        });
        return;
      }

      res.status(200).json({
        applicationId,
        status: "REJECTED"
      });
    } catch (error) {
      console.error(
        "Failed to reject merchant onboarding:",
        error
      );

      res.status(500).json({
        error:
          "Failed to reject merchant onboarding application"
      });
    }
  }
);

router.patch(
  "/merchant-onboarding/:applicationId",
  requirePlatformRole("OWNER", "ADMIN", "STAFF"),
  async (req, res) => {
    const applicationId =
      normalizeRouteParam(req.params.applicationId);
    const actorPlatformUserId = req.platformAuth?.id;

    if (!actorPlatformUserId) {
      res.status(401).json({
        error: "Platform authentication required"
      });
      return;
    }

    const fields = [
      "name",
      "phone",
      "alternatePhone",
      "address",
      "telegramUsername",
      "ownerEmail",
      "ownerDisplayName",
      "currency"
    ] as const;

    const body = req.body;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) => !fields.includes(key as typeof fields[number])
      )
    ) {
      res.status(400).json({
        error: "Invalid onboarding correction fields"
      });
      return;
    }

    const data: {
      name?: string;
      phone?: string;
      alternatePhone?: string | null;
      address?: string | null;
      telegramUsername?: string | null;
      ownerEmail?: string;
      ownerDisplayName?: string | null;
    } = {};

    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) {
        continue;
      }

      const value = body[field];

      if (field === "currency") {
        if (
          typeof value !== "string" ||
          value.trim().toUpperCase() !== "ETB"
        ) {
          res.status(400).json({
            error: "Merchant currency must be ETB"
          });
          return;
        }
        continue;
      }

      const optional = [
        "alternatePhone",
        "address",
        "telegramUsername",
        "ownerDisplayName"
      ].includes(field);

      if (
        value !== null &&
        typeof value !== "string"
      ) {
        res.status(400).json({
          error: `Invalid ${field}`
        });
        return;
      }

      if (!optional && typeof value !== "string") {
        res.status(400).json({
          error: `Invalid ${field}`
        });
        return;
      }

      const normalized =
        typeof value === "string" ? value.trim() : "";

      if (!optional && !normalized) {
        res.status(400).json({
          error: `${field} is required`
        });
        return;
      }

      if (
        (field === "phone" || field === "alternatePhone") &&
        normalized.length > MAX_PHONE_LENGTH
      ) {
        res.status(400).json({
          error: `${field} exceeds maximum length`
        });
        return;
      }

      if (
        field === "address" &&
        normalized.length > MAX_ADDRESS_LENGTH
      ) {
        res.status(400).json({
          error: "address exceeds maximum length"
        });
        return;
      }

      if (field === "ownerEmail") {
        const email = normalized.toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.status(400).json({
            error: "A valid owner email is required"
          });
          return;
        }

        data.ownerEmail = email;
      } else if (field === "name") {
        data.name = normalized;
      } else if (field === "phone") {
        data.phone = normalized;
      } else if (field === "alternatePhone") {
        data.alternatePhone = normalized || null;
      } else if (field === "address") {
        data.address = normalized || null;
      } else if (field === "telegramUsername") {
        data.telegramUsername = normalized || null;
      } else if (field === "ownerDisplayName") {
        data.ownerDisplayName = normalized || null;
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({
        error: "At least one correction field is required"
      });
      return;
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "MerchantOnboardingApplication"
          WHERE "id" = ${applicationId}
          FOR UPDATE
`        ;
        const existing =
          await tx.merchantOnboardingApplication.findUnique({
            where: { id: applicationId }
          });

        if (!existing) {
          return { outcome: "NOT_FOUND" as const };
        }

        if (existing.status !== "PENDING_APPROVAL") {
          return { outcome: "NOT_PENDING" as const };
        }

        const updated =
          await tx.merchantOnboardingApplication.updateMany({
            where: {
              id: applicationId,
              status: "PENDING_APPROVAL",
              merchantId: null
            },
            data
          });

        if (updated.count !== 1) {
          return { outcome: "NOT_PENDING" as const };
        }

        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId,
            action: "MERCHANT_ONBOARDING_CORRECTED",
            entityType: "MERCHANT_ONBOARDING_APPLICATION",
            entityId: applicationId,
            metadata: {
              changedFields: Object.keys(data),
              before: Object.fromEntries(
                Object.keys(data).map((field) => [
                  field,
                  existing[field as keyof typeof data]
                ])
              ),
              after: data
            }
          }
        });

        return { outcome: "CORRECTED" as const };
      });

      if (result.outcome === "NOT_FOUND") {
        res.status(404).json({
          error: "Onboarding application not found"
        });
        return;
      }

      if (result.outcome === "NOT_PENDING") {
        res.status(409).json({
          error: "Onboarding application is not pending approval"
        });
        return;
      }

      res.status(200).json({
        applicationId,
        status: "PENDING_APPROVAL"
      });
    } catch (error) {
      console.error(
        "Failed to correct merchant onboarding:",
        error
      );

      res.status(500).json({
        error: "Failed to correct merchant onboarding application"
      });
    }
  }
);

router.get(
  "/merchant-onboarding",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const applications =
        await prisma.merchantOnboardingApplication.findMany({
          orderBy: {
            createdAt: "desc"
          },
          select: {
            id: true,
            status: true,
            name: true,
            currency: true,
            phone: true,
            alternatePhone: true,
            address: true,
            telegramUsername: true,
            ownerEmail: true,
            ownerDisplayName: true,
            createdById: true,
            reviewedById: true,
            reviewedAt: true,
            reviewReason: true,
            merchantId: true,
            createdAt: true,
            updatedAt: true
          }
        });

      res.json({
        applications
      });
    } catch (error) {
      console.error(
        "Failed to load merchant onboarding applications:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load merchant onboarding applications"
      });
    }
  }
);

router.post(
  "/merchant-onboarding",
  requirePlatformRole("OWNER", "ADMIN", "STAFF"),
  async (req, res) => {
    const name =
      typeof req.body?.name === "string"
        ? req.body.name.trim()
        : "";

    const phone =
      typeof req.body?.phone === "string"
        ? req.body.phone.trim()
        : "";

    const ownerEmail =
      typeof req.body?.ownerEmail === "string"
        ? req.body.ownerEmail.trim().toLowerCase()
        : "";

    const optionalText = (value: unknown): string | null =>
      typeof value === "string" && value.trim()
        ? value.trim()
        : null;

    const alternatePhone =
      optionalText(req.body?.alternatePhone);
    const address =
      optionalText(req.body?.address);
    const telegramUsername =
      optionalText(req.body?.telegramUsername);
    const ownerDisplayName =
      optionalText(req.body?.ownerDisplayName);

    const currency =
      typeof req.body?.currency === "string"
        ? req.body.currency.trim().toUpperCase()
        : "ETB";

    if (!name) {
      res.status(400).json({
        error: "Merchant name is required"
      });
      return;
    }

    if (!phone || phone.length > MAX_PHONE_LENGTH) {
      res.status(400).json({
        error: `phone is required and must be at most ${MAX_PHONE_LENGTH} characters`
      });
      return;
    }

    if (
      alternatePhone &&
      alternatePhone.length > MAX_PHONE_LENGTH
    ) {
      res.status(400).json({
        error: `alternatePhone must be at most ${MAX_PHONE_LENGTH} characters`
      });
      return;
    }

    if (address && address.length > MAX_ADDRESS_LENGTH) {
      res.status(400).json({
        error: `address must be at most ${MAX_ADDRESS_LENGTH} characters`
      });
      return;
    }

    if (currency !== "ETB") {
      res.status(400).json({
        error: "Merchant currency must be ETB"
      });
      return;
    }

    if (
      !ownerEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)
    ) {
      res.status(400).json({
        error: "A valid owner email is required"
      });
      return;
    }

    const actorPlatformUserId = req.platformAuth?.id;

    if (!actorPlatformUserId) {
      res.status(401).json({
        error: "Platform authentication required"
      });
      return;
    }

    try {
      const application = await prisma.$transaction(
        async (tx) => {
          const created =
            await tx.merchantOnboardingApplication.create({
              data: {
                name,
                currency: "ETB",
                phone,
                alternatePhone,
                address,
                telegramUsername,
                ownerEmail,
                ownerDisplayName,
                createdById: actorPlatformUserId
              }
            });

          await tx.platformAuditLog.create({
            data: {
              actorPlatformUserId,
              action: "MERCHANT_ONBOARDING_SUBMITTED",
              entityType: "MERCHANT_ONBOARDING_APPLICATION",
              entityId: created.id,
              metadata: {
                status: created.status
              }
            }
          });

          return created;
        }
      );

      res.status(201).json({
        id: application.id,
        status: application.status
      });
    } catch (error) {
      console.error(
        "Merchant onboarding submission failed:",
        error
      );

      res.status(500).json({
        error: "Failed to submit merchant onboarding application"
      });
    }
  }
);

router.get(
  "/merchants",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const merchants =
        await prisma.merchant.findMany({
          orderBy: {
            createdAt: "desc"
          },
          select: {
            id: true,
            name: true,
            currency: true,
            phone: true,
            alternatePhone: true,
            address: true,
            accountStatus: true,
            accountSuspensionReason: true,
            accountSuspendedAt: true,
            createdAt: true,
            updatedAt: true,
            subscription: {
              select: {
                id: true,
                status: true,
                billingInterval: true,
                priceSnapshot: true,
                commissionRateSnapshot: true,
                currency: true,
                currentPeriodStart: true,
                currentPeriodEnd: true,
                trialEndsAt: true,
                plan: {
                  select: {
                    id: true,
                    code: true,
                    name: true
                  }
                }
              }
            },
            _count: {
              select: {
                orders: true,
                commissions: true,
                invoices: true,
                settlements: true
              }
            }
          }
        });

      res.json({
        merchants
      });
    } catch (error) {
      console.error(
        "Failed to load platform merchants:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load platform merchants"
      });
    }
  }
);

router.get(
  "/merchants/:merchantId",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const merchant =
        await prisma.merchant.findUnique({
          where: {
            id: merchantId
          },
          select: {
            id: true,
            name: true,
            currency: true,
            phone: true,
            alternatePhone: true,
            address: true,
            accountStatus: true,
            accountSuspensionReason: true,
            accountSuspendedAt: true,
            createdAt: true,
            updatedAt: true,
            subscription: {
              include: {
                plan: true
              }
            },
            _count: {
              select: {
                users: true,
                customers: true,
                products: true,
                orders: true,
                payments: true,
                commissions: true,
                commissionAdjustments: true,
                invoices: true,
                settlements: true
              }
            }
          }
        });

      if (!merchant) {
        res.status(404).json({
          error: "Merchant not found"
        });
        return;
      }

      res.json({
        merchant
      });
    } catch (error) {
      console.error(
        "Failed to load platform merchant:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load platform merchant"
      });
    }
  }
);

router.patch(
  "/merchants/:merchantId/owner/password",
  requirePlatformRole(
    "OWNER"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      const newPassword =
        typeof req.body?.newPassword ===
          "string"
          ? req.body.newPassword
          : "";

      if (!merchantId) {
        res.status(400).json({
          error:
            "Merchant ID is required"
        });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({
          error:
            "New password must be at least 8 characters"
        });
        return;
      }

      const merchant =
        await prisma.merchant.findUnique({
          where: {
            id:
              merchantId
          },
          select: {
            id: true
          }
        });

      if (!merchant) {
        res.status(404).json({
          error:
            "Merchant not found"
        });
        return;
      }

      const owners =
        await prisma.merchantUser.findMany({
          where: {
            merchantId,
            role:
              "OWNER"
          },
          select: {
            id: true,
            merchantId: true,
            email: true,
            displayName: true,
            role: true,
            tokenVersion: true
          },
          take: 2
        });

      if (owners.length !== 1) {
        res.status(409).json({
          error:
            "Merchant must have exactly one owner"
        });
        return;
      }

      const owner =
        owners[0]!;

      const passwordHash =
        await hashPassword(
          newPassword
        );

      const updatedOwner =
        await prisma.$transaction(
          async (tx) => {
            const updated =
              await tx.merchantUser.update({
                where: {
                  id:
                    owner.id
                },
                data: {
                  passwordHash,
                  tokenVersion: {
                    increment: 1
                  }
                },
                select: {
                  id: true,
                  merchantId: true,
                  email: true,
                  displayName: true,
                  role: true
                }
              });

            await tx.platformAuditLog.create({
              data: {
                actorPlatformUserId,
                merchantId,
                action:
                  "MERCHANT_OWNER_PASSWORD_RESET",
                entityType:
                  "MERCHANT_USER",
                entityId:
                  owner.id
              }
            });

            return updated;
          }
        );

      res.json({
        message:
          "Merchant owner password reset successfully",
        owner:
          updatedOwner
      });
    } catch (error) {
      console.error(
        "Failed to reset merchant owner password:",
        error
      );

      res.status(500).json({
        error:
          "Failed to reset merchant owner password"
      });
    }
  }
);

router.post(
  "/merchants/:merchantId/subscription",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const {
        planId,
        billingInterval,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        trialEndsAt
      } = req.body ?? {};

      if (
        typeof planId !== "string" ||
        !planId.trim()
      ) {
        res.status(400).json({
          error: "planId is required"
        });
        return;
      }

      if (
        !Object.values(
          SubscriptionBillingInterval
        ).includes(
          billingInterval as
          SubscriptionBillingInterval
        )
      ) {
        res.status(400).json({
          error:
            "Invalid billingInterval"
        });
        return;
      }

      if (
        !Object.values(
          MerchantSubscriptionStatus
        ).includes(
          status as
          MerchantSubscriptionStatus
        )
      ) {
        res.status(400).json({
          error:
            "Invalid subscription status"
        });
        return;
      }

      if (
        typeof currentPeriodStart !==
        "string" ||
        typeof currentPeriodEnd !==
        "string"
      ) {
        res.status(400).json({
          error:
            "currentPeriodStart and currentPeriodEnd are required"
        });
        return;
      }

      const parsedCurrentPeriodStart =
        new Date(currentPeriodStart);

      const parsedCurrentPeriodEnd =
        new Date(currentPeriodEnd);

      if (
        Number.isNaN(
          parsedCurrentPeriodStart.getTime()
        ) ||
        Number.isNaN(
          parsedCurrentPeriodEnd.getTime()
        )
      ) {
        res.status(400).json({
          error:
            "Invalid subscription period date"
        });
        return;
      }

      let parsedTrialEndsAt:
        Date | null = null;

      if (
        trialEndsAt !== undefined &&
        trialEndsAt !== null
      ) {
        if (
          typeof trialEndsAt !== "string"
        ) {
          res.status(400).json({
            error:
              "trialEndsAt must be a date string or null"
          });
          return;
        }

        parsedTrialEndsAt =
          new Date(trialEndsAt);

        if (
          Number.isNaN(
            parsedTrialEndsAt.getTime()
          )
        ) {
          res.status(400).json({
            error:
              "Invalid trialEndsAt date"
          });
          return;
        }
      }

      const subscription =
        await initializeMerchantSubscription({
          merchantId,
          planId: planId.trim(),
          billingInterval:
            billingInterval as
            SubscriptionBillingInterval,
          status:
            status as
            MerchantSubscriptionStatus,
          currentPeriodStart:
            parsedCurrentPeriodStart,
          currentPeriodEnd:
            parsedCurrentPeriodEnd,
          trialEndsAt:
            parsedTrialEndsAt,
          actorUserId: null,
          actorPlatformUserId
        });

      res.status(201).json({
        subscription
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to initialize merchant subscription";

      if (
        message === "Merchant not found" ||
        message ===
        "Subscription plan not found"
      ) {
        res.status(404).json({
          error: message
        });
        return;
      }

      if (
        message ===
        "Merchant already has a subscription"
      ) {
        res.status(409).json({
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

router.patch(
  "/merchants/:merchantId/subscription/status",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const {
        nextStatus
      } = req.body ?? {};

      if (
        !Object.values(
          MerchantSubscriptionStatus
        ).includes(
          nextStatus as
          MerchantSubscriptionStatus
        )
      ) {
        res.status(400).json({
          error:
            "Invalid subscription status"
        });
        return;
      }

      const subscription =
        await transitionMerchantSubscriptionStatus({
          merchantId,
          nextStatus:
            nextStatus as
            MerchantSubscriptionStatus,
          actorUserId: null,
          actorPlatformUserId
        });

      res.json({
        subscription
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to change merchant subscription status";

      if (
        message ===
        "Merchant subscription not found"
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

router.patch(
  "/merchants/:merchantId/account/status",
  requirePlatformRole(
    "OWNER",
    "ADMIN"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const {
        nextStatus,
        reason
      } = req.body ?? {};

      if (
        !Object.values(
          MerchantAccountStatus
        ).includes(
          nextStatus as
          MerchantAccountStatus
        )
      ) {
        res.status(400).json({
          error:
            "Invalid merchant account status"
        });
        return;
      }

      if (
        typeof reason !== "string" ||
        !reason.trim()
      ) {
        res.status(400).json({
          error:
            "Merchant account status change reason is required"
        });
        return;
      }

      const merchant =
        await transitionMerchantAccountStatus({
          merchantId,
          nextStatus:
            nextStatus as
            MerchantAccountStatus,
          reason,
          actorPlatformUserId
        });

      res.json({
        merchant
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to change merchant account status";

      if (
        message ===
        "Merchant not found"
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

router.get(
  "/plans",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (_req, res) => {
    try {
      const plans =
        await prisma.subscriptionPlan.findMany({
          orderBy: {
            createdAt: "desc"
          },
          select: {
            id: true,
            code: true,
            name: true,
            monthlyPrice: true,
            annualPrice: true,
            currency: true,
            commissionRate: true,
            features: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                subscriptions: true
              }
            }
          }
        });

      res.json({
        plans
      });
    } catch (error) {
      console.error(
        "Failed to load subscription plans:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load subscription plans"
      });
    }
  }
);

router.post(
  "/plans",
  requirePlatformRole(
    "OWNER"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const {
        code,
        name,
        monthlyPrice,
        annualPrice,
        currency,
        commissionRate,
        features,
        isActive
      } = req.body ?? {};

      if (
        typeof code !== "string" ||
        typeof name !== "string" ||
        typeof currency !== "string"
      ) {
        res.status(400).json({
          error:
            "code, name, and currency are required"
        });
        return;
      }

      if (
        monthlyPrice === undefined ||
        annualPrice === undefined ||
        commissionRate === undefined
      ) {
        res.status(400).json({
          error:
            "monthlyPrice, annualPrice, and commissionRate are required"
        });
        return;
      }

      if (
        isActive !== undefined &&
        typeof isActive !== "boolean"
      ) {
        res.status(400).json({
          error:
            "isActive must be boolean"
        });
        return;
      }

      const plan =
        await createPlatformPlan({
          actorPlatformUserId,
          code,
          name,
          monthlyPrice,
          annualPrice,
          currency,
          commissionRate,
          ...(features !== undefined
            ? { features }
            : {}),
          ...(isActive !== undefined
            ? { isActive }
            : {})
        });

      res.status(201).json({
        plan
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create subscription plan";

      if (
        message ===
        "Subscription plan code already exists"
      ) {
        res.status(409).json({
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

router.patch(
  "/plans/:planId",
  requirePlatformRole(
    "OWNER"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const planId =
        normalizeRouteParam(req.params.planId);

      if (!planId) {
        res.status(400).json({
          error: "Plan ID is required"
        });
        return;
      }

      const {
        name,
        monthlyPrice,
        annualPrice,
        currency,
        commissionRate,
        features
      } = req.body ?? {};

      if (
        name !== undefined &&
        typeof name !== "string"
      ) {
        res.status(400).json({
          error: "name must be a string"
        });
        return;
      }

      if (
        currency !== undefined &&
        typeof currency !== "string"
      ) {
        res.status(400).json({
          error:
            "currency must be a string"
        });
        return;
      }

      const plan =
        await updatePlatformPlan({
          actorPlatformUserId,
          planId,
          ...(name !== undefined
            ? { name }
            : {}),
          ...(monthlyPrice !== undefined
            ? { monthlyPrice }
            : {}),
          ...(annualPrice !== undefined
            ? { annualPrice }
            : {}),
          ...(currency !== undefined
            ? { currency }
            : {}),
          ...(commissionRate !== undefined
            ? { commissionRate }
            : {}),
          ...(features !== undefined
            ? { features }
            : {})
        });

      res.json({
        plan
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update subscription plan";

      if (
        message ===
        "Subscription plan not found"
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

router.patch(
  "/plans/:planId/active-state",
  requirePlatformRole(
    "OWNER"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const planId =
        normalizeRouteParam(req.params.planId);

      if (!planId) {
        res.status(400).json({
          error: "Plan ID is required"
        });
        return;
      }

      const {
        isActive
      } = req.body ?? {};

      if (typeof isActive !== "boolean") {
        res.status(400).json({
          error:
            "isActive must be boolean"
        });
        return;
      }

      const plan =
        await setPlatformPlanActiveState({
          actorPlatformUserId,
          planId,
          isActive
        });

      res.json({
        plan
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to change subscription plan state";

      if (
        message ===
        "Subscription plan not found"
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
 * Platform read of a merchant's commission ledger.
 */
router.get(
  "/merchants/:merchantId/billing/commissions",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const history =
        await getMerchantCommissionHistory(
          merchantId
        );

      res.json(history);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Merchant not found"
      ) {
        res.status(404).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error:
          "Failed to load platform merchant commissions"
      });
    }
  }
);

/*
 * Platform read of a merchant's persisted invoice history.
 *
 * Persisted invoice totals are authoritative.
 * Historical invoices are never reconstructed from
 * current subscription or commission data.
 */
router.get(
  "/merchants/:merchantId/billing/invoices",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const history =
        await getMerchantInvoiceHistory(
          merchantId
        );

      res.json(history);
    } catch (error) {
      console.error(
        "Failed to load platform merchant invoices:",
        error
      );

      if (
        error instanceof Error &&
        error.message ===
        "Merchant not found"
      ) {
        res.status(404).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error:
          "Failed to load platform merchant invoices"
      });
    }
  }
);

/*
 * Platform read of merchant-to-platform settlement
 * history. Customer Payment records are deliberately
 * outside this platform-billing boundary.
 */
router.get(
  "/merchants/:merchantId/billing/settlements",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const history =
        await getMerchantSettlementHistory(
          merchantId
        );

      res.json(history);
    } catch (error) {
      console.error(
        "Failed to load platform merchant settlements:",
        error
      );

      if (
        error instanceof Error &&
        error.message ===
        "Merchant not found"
      ) {
        res.status(404).json({
          error: error.message
        });
        return;
      }

      res.status(500).json({
        error:
          "Failed to load platform merchant settlements"
      });
    }
  }
);

/*
 * Platform read of one private merchant settlement receipt.
 *
 * GET /platform/merchants/:merchantId/billing/settlements/:settlementId/evidence
 *
 * This route inherits requirePlatformAuth from the
 * platform router. Merchant credentials are not valid
 * for this administration boundary.
 *
 * The private R2 object is streamed through the
 * authenticated API. No permanent public receipt URL
 * is exposed.
 */
router.get(
  "/merchants/:merchantId/billing/settlements/:settlementId/evidence",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      const settlementId =
        normalizeRouteParam(req.params.settlementId);

      if (!merchantId) {
        res.status(400).json({
          error:
            "Merchant ID is required"
        });
        return;
      }

      if (!settlementId) {
        res.status(400).json({
          error:
            "Settlement ID is required"
        });
        return;
      }

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

      const receiptMetadata =
        settlement.receiptMetadata;

      if (
        !receiptMetadata ||
        typeof receiptMetadata !==
        "object" ||
        Array.isArray(
          receiptMetadata
        )
      ) {
        res.status(404).json({
          error:
            "Settlement receipt evidence is not available"
        });
        return;
      }

      const objectKey =
        receiptMetadata.objectKey;

      if (
        typeof objectKey !==
        "string" ||
        !objectKey.trim()
      ) {
        res.status(404).json({
          error:
            "Settlement receipt evidence is not available"
        });
        return;
      }

      const receipt =
        await getSettlementReceipt(
          objectKey.trim()
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
        "Failed to read platform merchant settlement receipt evidence:",
        error
      );

      res.status(500).json({
        error:
          "Failed to read settlement receipt evidence"
      });
    }
  }
);


/*
 * Generate a persisted DRAFT merchant invoice.
 *
 * The platform operator supplies the invoice period
 * and optional due date explicitly. This route does
 * not invent billing policy or recalculate persisted
 * historical obligations.
 */
router.post(
  "/merchants/:merchantId/billing/invoices",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      const {
        invoiceNumber,
        periodStart,
        periodEnd,
        dueAt,
        subscriptionCharge
      } = req.body ?? {};

      if (
        typeof invoiceNumber !== "string" ||
        !invoiceNumber.trim()
      ) {
        res.status(400).json({
          error: "invoiceNumber is required"
        });
        return;
      }

      if (
        typeof periodStart !== "string" ||
        typeof periodEnd !== "string"
      ) {
        res.status(400).json({
          error:
            "periodStart and periodEnd are required"
        });
        return;
      }

      const parsedPeriodStart =
        new Date(periodStart);
      const parsedPeriodEnd =
        new Date(periodEnd);

      if (
        Number.isNaN(parsedPeriodStart.getTime()) ||
        Number.isNaN(parsedPeriodEnd.getTime())
      ) {
        res.status(400).json({
          error: "Invalid invoice period date"
        });
        return;
      }

      let parsedDueAt:
        Date | null = null;

      if (dueAt !== undefined && dueAt !== null) {
        if (typeof dueAt !== "string") {
          res.status(400).json({
            error:
              "dueAt must be a date string or null"
          });
          return;
        }

        parsedDueAt = new Date(dueAt);

        if (Number.isNaN(parsedDueAt.getTime())) {
          res.status(400).json({
            error: "Invalid dueAt date"
          });
          return;
        }
      }

      let parsedSubscriptionCharge:
        {
          subscriptionId: string;
          billingPeriodStart: Date;
          billingPeriodEnd: Date;
        } | null = null;

      if (
        subscriptionCharge !== undefined &&
        subscriptionCharge !== null
      ) {
        if (
          typeof subscriptionCharge !== "object" ||
          typeof subscriptionCharge.subscriptionId !==
          "string" ||
          !subscriptionCharge.subscriptionId.trim() ||
          typeof subscriptionCharge.billingPeriodStart !==
          "string" ||
          typeof subscriptionCharge.billingPeriodEnd !==
          "string"
        ) {
          res.status(400).json({
            error:
              "Invalid subscriptionCharge"
          });
          return;
        }

        const billingPeriodStart =
          new Date(
            subscriptionCharge.billingPeriodStart
          );
        const billingPeriodEnd =
          new Date(
            subscriptionCharge.billingPeriodEnd
          );

        if (
          Number.isNaN(billingPeriodStart.getTime()) ||
          Number.isNaN(billingPeriodEnd.getTime())
        ) {
          res.status(400).json({
            error:
              "Invalid subscription billing period date"
          });
          return;
        }

        parsedSubscriptionCharge = {
          subscriptionId:
            subscriptionCharge.subscriptionId.trim(),
          billingPeriodStart,
          billingPeriodEnd
        };
      }

      const invoice =
        await generateMerchantInvoice({
          merchantId,
          invoiceNumber:
            invoiceNumber.trim(),
          periodStart:
            parsedPeriodStart,
          periodEnd:
            parsedPeriodEnd,
          dueAt:
            parsedDueAt,
          actorUserId: null,
          actorPlatformUserId,
          subscriptionCharge:
            parsedSubscriptionCharge
        });

      res.status(201).json({
        invoice
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate merchant invoice";

      if (
        message === "Merchant not found" ||
        message ===
        "Merchant subscription not found"
      ) {
        res.status(404).json({ error: message });
        return;
      }

      if (
        message.includes("already used")
      ) {
        res.status(409).json({ error: message });
        return;
      }

      res.status(400).json({
        error: message
      });
    }
  }
);

/*
 * Open an existing DRAFT merchant invoice.
 * Financial transition logic remains in the frozen
 * invoice lifecycle service.
 */
router.post(
  "/merchants/:merchantId/billing/invoices/:invoiceId/open",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);
      const invoiceId =
        normalizeRouteParam(req.params.invoiceId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      if (!invoiceId) {
        res.status(400).json({
          error: "Invoice ID is required"
        });
        return;
      }

      const invoice =
        await openMerchantInvoice({
          merchantId,
          invoiceId,
          actorUserId: null,
          actorPlatformUserId
        });

      res.json({
        invoice
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to open merchant invoice";

      if (
        message === "Merchant invoice not found"
      ) {
        res.status(404).json({ error: message });
        return;
      }

      res.status(400).json({
        error: message
      });
    }
  }
);

/*
 * Mark an existing past-due OPEN merchant invoice OVERDUE.
 * Financial transition logic remains in the invoice lifecycle service.
 */
router.post(
  "/merchants/:merchantId/billing/invoices/:invoiceId/overdue",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);
      const invoiceId =
        normalizeRouteParam(req.params.invoiceId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      if (!invoiceId) {
        res.status(400).json({
          error: "Invoice ID is required"
        });
        return;
      }

      const invoice =
        await markMerchantInvoiceOverdue({
          merchantId,
          invoiceId,
          actorUserId: null,
          actorPlatformUserId
        });

      res.json({
        invoice
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to mark merchant invoice overdue";

      if (
        message === "Merchant invoice not found"
      ) {
        res.status(404).json({ error: message });
        return;
      }

      res.status(400).json({
        error: message
      });
    }
  }
);

/*
 * Verify existing merchant-to-platform settlement
 * evidence through the trusted platform review
 * boundary.
 *
 * This route does not create settlement evidence.
 * Verification logic remains in the frozen service.
 */
router.post(
  "/merchants/:merchantId/billing/settlements/:settlementId/verify",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);
      const settlementId =
        normalizeRouteParam(req.params.settlementId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      if (!settlementId) {
        res.status(400).json({
          error: "Settlement ID is required"
        });
        return;
      }

      const { reviewNote } =
        req.body ?? {};

      if (
        reviewNote !== undefined &&
        reviewNote !== null &&
        typeof reviewNote !== "string"
      ) {
        res.status(400).json({
          error:
            "reviewNote must be a string or null"
        });
        return;
      }

      const result =
        await verifyMerchantSettlement({
          merchantId,
          settlementId,
          reviewNote:
            typeof reviewNote === "string"
              ? reviewNote
              : null,
          actorPlatformUserId
        });

      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to verify merchant settlement";

      if (
        message ===
        "Merchant settlement not found"
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
 * Reject existing merchant-to-platform settlement
 * evidence. Rejection does not pay or otherwise
 * transition the associated invoice.
 */
router.post(
  "/merchants/:merchantId/billing/settlements/:settlementId/reject",
  requirePlatformRole(
    "OWNER",
    "ADMIN",
    "STAFF"
  ),
  async (req, res) => {
    try {
      const actorPlatformUserId =
        req.platformAuth?.id;

      if (!actorPlatformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });
        return;
      }

      const merchantId =
        normalizeRouteParam(req.params.merchantId);
      const settlementId =
        normalizeRouteParam(req.params.settlementId);

      if (!merchantId) {
        res.status(400).json({
          error: "Merchant ID is required"
        });
        return;
      }

      if (!settlementId) {
        res.status(400).json({
          error: "Settlement ID is required"
        });
        return;
      }

      const { reviewNote } =
        req.body ?? {};

      if (
        reviewNote !== undefined &&
        reviewNote !== null &&
        typeof reviewNote !== "string"
      ) {
        res.status(400).json({
          error:
            "reviewNote must be a string or null"
        });
        return;
      }

      const result =
        await rejectMerchantSettlement({
          merchantId,
          settlementId,
          reviewNote:
            typeof reviewNote === "string"
              ? reviewNote
              : null,
          actorPlatformUserId
        });

      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to reject merchant settlement";

      if (
        message ===
        "Merchant settlement not found"
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
