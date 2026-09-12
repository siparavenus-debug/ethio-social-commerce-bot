import {
  CommissionStatus,
  MerchantInvoiceItemType,
  MerchantInvoiceStatus,
  Prisma,
  prisma
} from "@ethio-commerce/database";
import {
  calculateBillingPeriod
} from "./billing-period-calculation.js";

export type GenerateMerchantInvoiceInput = {
  merchantId: string;
  invoiceNumber: string;
  periodStart: Date;
  periodEnd: Date;
  dueAt?: Date | null;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;

  subscriptionCharge?: {
    subscriptionId: string;
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
  } | null;
};

const MAX_SERIALIZABLE_ATTEMPTS = 3;

function sameDate(
  left: Date | null | undefined,
  right: Date | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.getTime() === right.getTime();
}

function validateDate(
  value: Date,
  name: string
): void {
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.getTime())
  ) {
    throw new Error(
      `${name} must be a valid date`
    );
  }
}

function validateInput(
  input: GenerateMerchantInvoiceInput
): void {
  if (!input.merchantId.trim()) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  if (!input.invoiceNumber.trim()) {
    throw new Error(
      "Invoice number is required"
    );
  }

  validateDate(
    input.periodStart,
    "Invoice period start"
  );

  validateDate(
    input.periodEnd,
    "Invoice period end"
  );

  if (
    input.periodEnd.getTime() <=
    input.periodStart.getTime()
  ) {
    throw new Error(
      "Invoice period end must be after period start"
    );
  }

  if (input.dueAt) {
    validateDate(
      input.dueAt,
      "Invoice due date"
    );
  }

  if (input.subscriptionCharge) {
    validateDate(
      input.subscriptionCharge
        .billingPeriodStart,
      "Subscription billing period start"
    );

    validateDate(
      input.subscriptionCharge
        .billingPeriodEnd,
      "Subscription billing period end"
    );

    if (
      input.subscriptionCharge
        .billingPeriodEnd.getTime() <=
      input.subscriptionCharge
        .billingPeriodStart.getTime()
    ) {
      throw new Error(
        "Subscription billing period end must be after period start"
      );
    }

    /*
     * Day 14 deliberately does not invent an
     * aggregation or proration policy.
     *
     * A subscription line therefore represents
     * exactly the billing period of this invoice.
     */
    if (
      !sameDate(
        input.subscriptionCharge
          .billingPeriodStart,
        input.periodStart
      ) ||
      !sameDate(
        input.subscriptionCharge
          .billingPeriodEnd,
        input.periodEnd
      )
    ) {
      throw new Error(
        "Subscription billing period must match invoice period"
      );
    }
  }
}

async function loadReplay(
  input: GenerateMerchantInvoiceInput
) {
  const existing =
    await prisma.merchantInvoice.findUnique({
      where: {
        merchantId_periodStart_periodEnd: {
          merchantId:
            input.merchantId,
          periodStart:
            input.periodStart,
          periodEnd:
            input.periodEnd
        }
      },
      include: {
        items: true
      }
    });

  if (!existing) {
    return null;
  }

  if (
    existing.invoiceNumber !==
    input.invoiceNumber.trim() ||
    !sameDate(
      existing.dueAt,
      input.dueAt ?? null
    )
  ) {
    throw new Error(
      "Invoice period was already used for a different instruction"
    );
  }

  const subscriptionItems =
    existing.items.filter(
      (item) =>
        item.type ===
        MerchantInvoiceItemType.SUBSCRIPTION
    );

  if (!input.subscriptionCharge) {
    if (subscriptionItems.length !== 0) {
      throw new Error(
        "Invoice period was already used for a different instruction"
      );
    }

    return existing;
  }

  if (subscriptionItems.length !== 1) {
    throw new Error(
      "Invoice period was already used for a different instruction"
    );
  }

  const subscriptionItem =
    subscriptionItems[0];

  if (
    subscriptionItem.subscriptionId !==
    input.subscriptionCharge
      .subscriptionId ||
    !sameDate(
      subscriptionItem.billingPeriodStart,
      input.subscriptionCharge
        .billingPeriodStart
    ) ||
    !sameDate(
      subscriptionItem.billingPeriodEnd,
      input.subscriptionCharge
        .billingPeriodEnd
    )
  ) {
    throw new Error(
      "Invoice period was already used for a different instruction"
    );
  }

  return existing;
}

async function generateInvoiceAttempt(
  input: GenerateMerchantInvoiceInput
) {
  return prisma.$transaction(
    async (tx) => {
      const {
        merchant,
        subscription,
        commissions,
        adjustments,
        subscriptionAmount,
        commissionAmount,
        totalAmount
      } =
        await calculateBillingPeriod(
          tx,
          {
            merchantId:
              input.merchantId,
            periodStart:
              input.periodStart,
            periodEnd:
              input.periodEnd,
            subscriptionId:
              input.subscriptionCharge
                ?.subscriptionId ??
              null
          }
        );

      /*
       * Invoice creation policy remains stricter
       * than the reusable billing-period
       * calculation.
       *
       * Signed adjustments may make the commission
       * subtotal negative, but the payable invoice
       * itself may never be negative.
       */
      if (totalAmount.lessThan(0)) {
        throw new Error(
          "Invoice total cannot be negative"
        );
      }
      const sourceCount =
        commissions.length +
        adjustments.length +
        (subscription ? 1 : 0);

      if (sourceCount === 0) {
        throw new Error(
          "Invoice has no financial source items"
        );
      }

      const invoice =
        await tx.merchantInvoice.create({
          data: {
            merchantId:
              input.merchantId,
            invoiceNumber:
              input.invoiceNumber.trim(),
            periodStart:
              input.periodStart,
            periodEnd:
              input.periodEnd,
            subscriptionAmount,
            commissionAmount,
            totalAmount,
            currency:
              merchant.currency,
            status:
              MerchantInvoiceStatus.DRAFT,
            dueAt:
              input.dueAt ?? null
          }
        });

      if (subscription) {
        await tx.merchantInvoiceItem.create({
          data: {
            merchantId:
              input.merchantId,
            invoiceId:
              invoice.id,
            type:
              MerchantInvoiceItemType.SUBSCRIPTION,
            description:
              "Subscription charge",
            amount:
              subscription.priceSnapshot,
            currency:
              subscription.currency,
            subscriptionId:
              subscription.id,
            billingPeriodStart:
              input.subscriptionCharge!
                .billingPeriodStart,
            billingPeriodEnd:
              input.subscriptionCharge!
                .billingPeriodEnd,
            metadata: {
              planId:
                subscription.planId,
              billingInterval:
                subscription.billingInterval,
              priceSnapshot:
                subscription.priceSnapshot
                  .toString()
            }
          }
        });
      }

      for (const commission of commissions) {
        await tx.merchantInvoiceItem.create({
          data: {
            merchantId:
              input.merchantId,
            invoiceId:
              invoice.id,
            type:
              MerchantInvoiceItemType.COMMISSION,
            description:
              "Transaction commission",
            amount:
              commission.commissionAmount,
            currency:
              commission.currency,
            commissionId:
              commission.id,
            metadata: {
              paymentId:
                commission.paymentId,
              orderId:
                commission.orderId,
              subscriptionId:
                commission.subscriptionId,
              transactionAmount:
                commission.transactionAmount
                  .toString(),
              commissionRate:
                commission.commissionRate
                  .toString()
            }
          }
        });
      }

      for (const adjustment of adjustments) {
        await tx.merchantInvoiceItem.create({
          data: {
            merchantId:
              input.merchantId,
            invoiceId:
              invoice.id,
            type:
              MerchantInvoiceItemType.ADJUSTMENT,
            description:
              adjustment.reason,
            amount:
              adjustment.amount,
            currency:
              adjustment.currency,
            adjustmentId:
              adjustment.id,
            metadata: {
              commissionId:
                adjustment.commissionId,
              adjustmentType:
                adjustment.type,
              reason:
                adjustment.reason,
              idempotencyKey:
                adjustment.idempotencyKey
            }
          }
        });
      }

      /*
       * Creating the immutable COMMISSION invoice
       * items and changing ACCRUED -> INVOICED are
       * one atomic financial operation.
       *
       * The conditional update also acts as a final
       * state claim inside this transaction.
       */
      if (commissions.length > 0) {
        const commissionIds =
          commissions.map(
            (commission) =>
              commission.id
          );

        const claimed =
          await tx.commission.updateMany({
            where: {
              merchantId:
                input.merchantId,
              id: {
                in:
                  commissionIds
              },
              status:
                CommissionStatus.ACCRUED
            },
            data: {
              status:
                CommissionStatus.INVOICED
            }
          });

        if (
          claimed.count !==
          commissions.length
        ) {
          throw new Error(
            "One or more commissions could not be claimed for invoicing"
          );
        }
      }

      await tx.auditLog.create({
        data: {
          merchantId:
            input.merchantId,
          actorUserId:
            input.actorUserId ?? null,
          action:
            "INVOICE_GENERATED",
          entityType:
            "MERCHANT_INVOICE",
          entityId:
            invoice.id,
          metadata: {
            invoiceNumber:
              invoice.invoiceNumber,
            periodStart:
              invoice.periodStart
                .toISOString(),
            periodEnd:
              invoice.periodEnd
                .toISOString(),
            subscriptionAmount:
              invoice.subscriptionAmount
                .toString(),
            commissionAmount:
              invoice.commissionAmount
                .toString(),
            totalAmount:
              invoice.totalAmount
                .toString(),
            currency:
              invoice.currency,
            subscriptionItemCount:
              subscription ? 1 : 0,
            commissionItemCount:
              commissions.length,
            adjustmentItemCount:
              adjustments.length
          }
        }
      });

      if (input.actorPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId:
              input.actorPlatformUserId,
            merchantId:
              input.merchantId,
            action:
              "MERCHANT_INVOICE_GENERATED",
            entityType:
              "MERCHANT_INVOICE",
            entityId:
              invoice.id,
            metadata: {
              invoiceNumber:
                invoice.invoiceNumber,
              periodStart:
                invoice.periodStart
                  .toISOString(),
              periodEnd:
                invoice.periodEnd
                  .toISOString(),
              subscriptionAmount:
                invoice.subscriptionAmount
                  .toString(),
              commissionAmount:
                invoice.commissionAmount
                  .toString(),
              totalAmount:
                invoice.totalAmount
                  .toString(),
              currency:
                invoice.currency,
              subscriptionItemCount:
                subscription ? 1 : 0,
              commissionItemCount:
                commissions.length,
              adjustmentItemCount:
                adjustments.length
            }
          }
        });
      }

      const generated =
        await tx.merchantInvoice.findUnique({
          where: {
            id:
              invoice.id
          },
          include: {
            items: {
              orderBy: [
                {
                  type:
                    "asc"
                },
                {
                  createdAt:
                    "asc"
                },
                {
                  id:
                    "asc"
                }
              ]
            }
          }
        });

      if (!generated) {
        throw new Error(
          "Generated invoice could not be loaded"
        );
      }

      return generated;
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable
    }
  );
}

export async function generateMerchantInvoice(
  input: GenerateMerchantInvoiceInput
) {
  validateInput(input);

  for (
    let attempt = 1;
    attempt <= MAX_SERIALIZABLE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await generateInvoiceAttempt(
        input
      );
    } catch (error) {
      if (
        error instanceof
        Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt <
        MAX_SERIALIZABLE_ATTEMPTS
      ) {
        continue;
      }

      /*
       * Concurrent identical generation attempts
       * normally meet at one of the database unique
       * constraints:
       *
       * - merchant + invoice period
       * - merchant + invoice number
       * - immutable source-event identity
       *
       * Only an already-committed invoice matching
       * the same generation instruction is a safe
       * replay.
       */
      if (
        error instanceof
        Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing =
          await loadReplay(input);

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  throw new Error(
    "Merchant invoice generation could not be completed"
  );
}
