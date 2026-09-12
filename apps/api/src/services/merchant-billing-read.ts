import {
  Prisma,
  prisma
} from "@ethio-commerce/database";

import {
  calculateBillingPeriod
} from "./billing-period-calculation.js";

export type MerchantBillingEstimateStatus =
  | "ESTIMATE"
  | "INVOICED"
  | "NEGATIVE_TOTAL_REQUIRES_REVIEW"
  | "NO_SUBSCRIPTION";

export async function getMerchantBillingSummary(
  merchantId: string
) {
  if (!merchantId.trim()) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  const merchant =
    await prisma.merchant.findUnique({
      where: {
        id: merchantId
      },
      select: {
        id: true,
        currency: true
      }
    });

  if (!merchant) {
    throw new Error(
      "Merchant not found"
    );
  }

  const subscription =
    await prisma.merchantSubscription.findUnique({
      where: {
        merchantId
      },
      include: {
        plan: {
          select: {
            code: true,
            name: true
          }
        }
      }
    });

  if (!subscription) {
    return {
      merchantId:
        merchant.id,
      subscription:
        null,
      currentPeriod: {
        status:
          "NO_SUBSCRIPTION" as const,
        periodStart:
          null,
        periodEnd:
          null,
        subscriptionAmount:
          null,
        commissionAmount:
          null,
        totalAmount:
          null,
        currency:
          merchant.currency,
        invoiceId:
          null,
        invoiceNumber:
          null,
        invoiceStatus:
          null
      }
    };
  }

  const existingInvoice =
    await prisma.merchantInvoice.findUnique({
      where: {
        merchantId_periodStart_periodEnd: {
          merchantId,
          periodStart:
            subscription.currentPeriodStart,
          periodEnd:
            subscription.currentPeriodEnd
        }
      }
    });

  const subscriptionView = {
    id:
      subscription.id,
    plan: {
      code:
        subscription.plan.code,
      name:
        subscription.plan.name
    },
    status:
      subscription.status,
    billingInterval:
      subscription.billingInterval,
    priceSnapshot:
      subscription.priceSnapshot.toString(),
    commissionRateSnapshot:
      subscription.commissionRateSnapshot.toString(),
    currency:
      subscription.currency,
    currentPeriodStart:
      subscription.currentPeriodStart,
    currentPeriodEnd:
      subscription.currentPeriodEnd,
    trialEndsAt:
      subscription.trialEndsAt
  };

  if (existingInvoice) {
    return {
      merchantId:
        merchant.id,
      subscription:
        subscriptionView,
      currentPeriod: {
        status:
          "INVOICED" as const,
        periodStart:
          subscription.currentPeriodStart,
        periodEnd:
          subscription.currentPeriodEnd,
        subscriptionAmount:
          existingInvoice.subscriptionAmount.toString(),
        commissionAmount:
          existingInvoice.commissionAmount.toString(),
        totalAmount:
          existingInvoice.totalAmount.toString(),
        currency:
          existingInvoice.currency,
        invoiceId:
          existingInvoice.id,
        invoiceNumber:
          existingInvoice.invoiceNumber,
        invoiceStatus:
          existingInvoice.status
      }
    };
  }

  const calculation =
    await calculateBillingPeriod(
      prisma,
      {
        merchantId,
        periodStart:
          subscription.currentPeriodStart,
        periodEnd:
          subscription.currentPeriodEnd,
        subscriptionId:
          subscription.id
      }
    );

  return {
    merchantId:
      merchant.id,
    subscription:
      subscriptionView,
    currentPeriod: {
      status:
        calculation.totalAmount.lessThan(0)
          ? "NEGATIVE_TOTAL_REQUIRES_REVIEW" as const
          : "ESTIMATE" as const,
      periodStart:
        subscription.currentPeriodStart,
      periodEnd:
        subscription.currentPeriodEnd,
      subscriptionAmount:
        calculation.subscriptionAmount.toString(),
      commissionAmount:
        calculation.commissionAmount.toString(),
      totalAmount:
        calculation.totalAmount.toString(),
      currency:
        merchant.currency,
      invoiceId:
        null,
      invoiceNumber:
        null,
      invoiceStatus:
        null
    }
  };
}
export async function getMerchantCommissionHistory(
  merchantId: string
) {
  if (!merchantId.trim()) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  const merchant =
    await prisma.merchant.findUnique({
      where: {
        id: merchantId
      },
      select: {
        id: true
      }
    });

  if (!merchant) {
    throw new Error(
      "Merchant not found"
    );
  }

  const commissions =
    await prisma.commission.findMany({
      where: {
        merchantId
      },
      include: {
        adjustments: {
          orderBy: [
            {
              createdAt: "asc"
            },
            {
              id: "asc"
            }
          ]
        }
      },
      orderBy: [
        {
          createdAt: "desc"
        },
        {
          id: "desc"
        }
      ]
    });

  return {
    merchantId:
      merchant.id,
    commissions:
      commissions.map(
        (commission) => {
          const adjustmentTotal =
            commission.adjustments.reduce(
              (total, adjustment) =>
                total.plus(
                  adjustment.amount
                ),
              new Prisma.Decimal(0)
            );

          const netCommissionAmount =
            commission.commissionAmount.plus(
              adjustmentTotal
            );

          return {
            id:
              commission.id,
            paymentId:
              commission.paymentId,
            orderId:
              commission.orderId,
            subscriptionId:
              commission.subscriptionId,
            transactionAmount:
              commission.transactionAmount.toString(),
            commissionRate:
              commission.commissionRate.toString(),
            commissionAmount:
              commission.commissionAmount.toString(),
            adjustmentAmount:
              adjustmentTotal.toString(),
            netCommissionAmount:
              netCommissionAmount.toString(),
            currency:
              commission.currency,
            status:
              commission.status,
            createdAt:
              commission.createdAt,
            adjustments:
              commission.adjustments.map(
                (adjustment) => ({
                  id:
                    adjustment.id,
                  type:
                    adjustment.type,
                  amount:
                    adjustment.amount.toString(),
                  currency:
                    adjustment.currency,
                  reason:
                    adjustment.reason,
                  createdAt:
                    adjustment.createdAt
                })
              )
          };
        }
      )
  };
}



export async function getMerchantInvoiceHistory(
  merchantId: string
) {
  if (!merchantId.trim()) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  const merchant =
    await prisma.merchant.findUnique({
      where: {
        id: merchantId
      },
      select: {
        id: true
      }
    });

  if (!merchant) {
    throw new Error(
      "Merchant not found"
    );
  }

  const invoices =
    await prisma.merchantInvoice.findMany({
      where: {
        merchantId
      },
      orderBy: [
        {
          periodStart: "desc"
        },
        {
          createdAt: "desc"
        },
        {
          id: "desc"
        }
      ]
    });

  return {
    merchantId:
      merchant.id,
    invoices:
      invoices.map(
        (invoice) => ({
          id:
            invoice.id,
          invoiceNumber:
            invoice.invoiceNumber,
          periodStart:
            invoice.periodStart,
          periodEnd:
            invoice.periodEnd,
          subscriptionAmount:
            invoice.subscriptionAmount.toString(),
          commissionAmount:
            invoice.commissionAmount.toString(),
          totalAmount:
            invoice.totalAmount.toString(),
          currency:
            invoice.currency,
          status:
            invoice.status,
          dueAt:
            invoice.dueAt,
          openedAt:
            invoice.openedAt,
          paidAt:
            invoice.paidAt,
          createdAt:
            invoice.createdAt
        })
      )
  };
}

export async function getMerchantSettlementHistory(
  merchantId: string
) {
  if (!merchantId.trim()) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  const merchant =
    await prisma.merchant.findUnique({
      where: {
        id: merchantId
      },
      select: {
        id: true
      }
    });

  if (!merchant) {
    throw new Error(
      "Merchant not found"
    );
  }

  const settlements =
    await prisma.merchantSettlement.findMany({
      where: {
        merchantId
      },
      orderBy: [
        {
          submittedAt: "desc"
        },
        {
          createdAt: "desc"
        },
        {
          id: "desc"
        }
      ]
    });

  return {
    merchantId:
      merchant.id,
    settlements:
      settlements.map(
        (settlement) => ({
          id:
            settlement.id,
          invoiceId:
            settlement.invoiceId,
          provider:
            settlement.provider,
          status:
            settlement.status,
          amount:
            settlement.amount.toString(),
          currency:
            settlement.currency,
          transactionReference:
            settlement.transactionReference,
          receiptUrl:
            settlement.receiptUrl,
          reviewNote:
            settlement.reviewNote,
          submittedAt:
            settlement.submittedAt,
          verifiedAt:
            settlement.verifiedAt,
          createdAt:
            settlement.createdAt
        })
      )
  };
}
