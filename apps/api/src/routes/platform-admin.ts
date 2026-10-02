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
  requirePlatformAuth
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

const router = Router();

const MAX_PHONE_LENGTH = 50;
const MAX_ADDRESS_LENGTH = 1000;

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
  "/merchants",
  async (req, res) => {
    const name =
      typeof req.body?.name === "string"
        ? req.body.name.trim()
        : "";

    const currency =
      typeof req.body?.currency === "string"
        ? req.body.currency
            .trim()
            .toUpperCase()
        : "ETB";

    const phone =
      typeof req.body?.phone === "string" &&
      req.body.phone.trim()
        ? req.body.phone.trim()
        : null;

    const alternatePhone =
      typeof req.body?.alternatePhone === "string" &&
      req.body.alternatePhone.trim()
        ? req.body.alternatePhone.trim()
        : null;

    const address =
      typeof req.body?.address === "string" &&
      req.body.address.trim()
        ? req.body.address.trim()
        : null;

    const ownerEmail =
      typeof req.body?.ownerEmail === "string"
        ? req.body.ownerEmail
            .trim()
            .toLowerCase()
        : "";

    const ownerPassword =
      typeof req.body?.ownerPassword === "string"
        ? req.body.ownerPassword
        : "";

    const ownerDisplayName =
      typeof req.body?.ownerDisplayName === "string" &&
      req.body.ownerDisplayName.trim()
        ? req.body.ownerDisplayName.trim()
        : null;

    if (!name) {
      res.status(400).json({
        error:
          "Merchant name is required"
      });
      return;
    }

    if (currency.length !== 3) {
      res.status(400).json({
        error:
          "Merchant currency must be exactly 3 characters"
      });
      return;
    }

    if (
      phone &&
      phone.length > MAX_PHONE_LENGTH
    ) {
      res.status(400).json({
        error:
          `phone must be at most ${MAX_PHONE_LENGTH} characters`
      });
      return;
    }

    if (
      alternatePhone &&
      alternatePhone.length >
        MAX_PHONE_LENGTH
    ) {
      res.status(400).json({
        error:
          `alternatePhone must be at most ${MAX_PHONE_LENGTH} characters`
      });
      return;
    }

    if (
      address &&
      address.length >
        MAX_ADDRESS_LENGTH
    ) {
      res.status(400).json({
        error:
          `address must be at most ${MAX_ADDRESS_LENGTH} characters`
      });
      return;
    }

    if (
      !ownerEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        ownerEmail
      )
    ) {
      res.status(400).json({
        error:
          "A valid owner email is required"
      });
      return;
    }

    if (ownerPassword.length < 8) {
      res.status(400).json({
        error:
          "Owner password must be at least 8 characters"
      });
      return;
    }

    const actorPlatformUserId =
      req.platformAuth?.id;

    if (!actorPlatformUserId) {
      res.status(401).json({
        error:
          "Platform authentication required"
      });
      return;
    }

    try {
      const passwordHash =
        await hashPassword(
          ownerPassword
        );

      const result =
        await prisma.$transaction(
          async (tx) => {
            const merchant =
              await tx.merchant.create({
                data: {
                  name,
                  currency:
                    currency || "ETB",
                  phone,
                  alternatePhone,
                  address
                }
              });

            const owner =
              await tx.merchantUser.create({
                data: {
                  merchantId:
                    merchant.id,
                  email:
                    ownerEmail,
                  passwordHash,
                  displayName:
                    ownerDisplayName,
                  role:
                    "OWNER"
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
                merchantId:
                  merchant.id,
                action:
                  "MERCHANT_CREATED",
                entityType:
                  "MERCHANT",
                entityId:
                  merchant.id,
                metadata: {
                  ownerUserId:
                    owner.id,
                  ownerEmail:
                    owner.email
                }
              }
            });

            return {
              merchant,
              owner
            };
          }
        );

      res.status(201).json(result);
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          error:
            "An account with that email already exists"
        });
        return;
      }

      console.error(
        "Failed to create merchant:",
        error
      );

      res.status(500).json({
        error:
          "Failed to create merchant"
      });
    }
  }
);

router.get(
  "/merchants",
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
  async (req, res) => {
    try {
      const merchantId =
        req.params.merchantId?.trim();

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

router.post(
  "/merchants/:merchantId/subscription",
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
        req.params.merchantId?.trim();

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
        req.params.merchantId?.trim();

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
        req.params.merchantId?.trim();

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
        req.params.planId?.trim();

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
        req.params.planId?.trim();

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
  async (req, res) => {
    try {
      const merchantId =
        req.params.merchantId?.trim();

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
  async (req, res) => {
    try {
      const merchantId =
        req.params.merchantId?.trim();

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
  async (req, res) => {
    try {
      const merchantId =
        req.params.merchantId?.trim();

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
  async (req, res) => {
    try {
      const merchantId =
        req.params.merchantId?.trim();

      const settlementId =
        req.params.settlementId?.trim();

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
        req.params.merchantId?.trim();

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
        req.params.merchantId?.trim();
      const invoiceId =
        req.params.invoiceId?.trim();

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
        req.params.merchantId?.trim();
      const invoiceId =
        req.params.invoiceId?.trim();

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
        req.params.merchantId?.trim();
      const settlementId =
        req.params.settlementId?.trim();

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
        req.params.merchantId?.trim();
      const settlementId =
        req.params.settlementId?.trim();

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
