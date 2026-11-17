import type {
  Prisma,
  PlatformBillingEventType
} from "@ethio-commerce/database";

import {
  renderBillingNotification,
  type BillingNotificationTemplateInput
} from "./platform-billing-notification-renderer.js";

export type BillingEventForResolution = {
  merchantId: string;
  sourceId: string;
  type: PlatformBillingEventType;
};

export type BillingTemplateResolution =
  | {
      ok: true;
      input: BillingNotificationTemplateInput;
    }
  | {
      ok: false;
      reason:
        | "UNSUPPORTED_EVENT"
        | "SOURCE_NOT_FOUND"
        | "INVALID_SOURCE_DATA";
    };

const failure = (
  reason: Extract<
    BillingTemplateResolution,
    { ok: false }
  >["reason"]
): BillingTemplateResolution => ({
  ok: false,
  reason
});

function validated(
  input: BillingNotificationTemplateInput
): BillingTemplateResolution {
  const result = renderBillingNotification(input);

  if (!result.ok) {
    return failure("INVALID_SOURCE_DATA");
  }

  return { ok: true, input };
}

export async function resolvePlatformBillingNotification(
  tx: Prisma.TransactionClient,
  event: BillingEventForResolution
): Promise<BillingTemplateResolution> {
  if (
    !event ||
    typeof event.merchantId !== "string" ||
    !event.merchantId.trim() ||
    typeof event.sourceId !== "string" ||
    !event.sourceId.trim()
  ) {
    return failure("INVALID_SOURCE_DATA");
  }

  switch (event.type) {
    case "INVOICE_ISSUED":
    case "INVOICE_PAID": {
      const invoice = await tx.merchantInvoice.findFirst({
        where: {
          id: event.sourceId,
          merchantId: event.merchantId
        },
        select: {
          invoiceNumber: true,
          totalAmount: true,
          currency: true,
          dueAt: true
        }
      });

      if (!invoice) {
        return failure("SOURCE_NOT_FOUND");
      }

      if (event.type === "INVOICE_PAID") {
        return validated({
          type: "INVOICE_PAID",
          invoiceNumber: invoice.invoiceNumber
        });
      }

      if (
        invoice.dueAt !== null &&
        (
          !(invoice.dueAt instanceof Date) ||
          !Number.isFinite(invoice.dueAt.getTime())
        )
      ) {
        return failure("INVALID_SOURCE_DATA");
      }

      return validated({
        type: "INVOICE_ISSUED",
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.totalAmount.toString(),
        currency: invoice.currency,
        dueDate: invoice.dueAt
          ? invoice.dueAt.toISOString().slice(0, 10)
          : null
      });
    }

    case "INVOICE_FIRST_OVERDUE":
    case "INVOICE_SECOND_OVERDUE": {
      const reminder = await tx.merchantInvoiceReminder.findFirst({
        where: {
          id: event.sourceId,
          merchantId: event.merchantId,
          type: event.type === "INVOICE_FIRST_OVERDUE"
            ? "FIRST_OVERDUE"
            : "SECOND_OVERDUE"
        },
        select: {
          invoice: {
            select: {
              merchantId: true,
              invoiceNumber: true,
              totalAmount: true,
              currency: true
            }
          }
        }
      });

      if (!reminder) {
        return failure("SOURCE_NOT_FOUND");
      }

      if (reminder.invoice.merchantId !== event.merchantId) {
        return failure("SOURCE_NOT_FOUND");
      }

      return validated({
        type: event.type,
        invoiceNumber: reminder.invoice.invoiceNumber,
        amount: reminder.invoice.totalAmount.toString(),
        currency: reminder.invoice.currency
      });
    }

    case "SETTLEMENT_SUBMITTED":
    case "SETTLEMENT_REJECTED": {
      const settlement = await tx.merchantSettlement.findFirst({
        where: {
          id: event.sourceId,
          merchantId: event.merchantId
        },
        select: {
          invoice: {
            select: {
              merchantId: true,
              invoiceNumber: true
            }
          }
        }
      });

      if (!settlement) {
        return failure("SOURCE_NOT_FOUND");
      }

      if (settlement.invoice.merchantId !== event.merchantId) {
        return failure("SOURCE_NOT_FOUND");
      }

      return validated({
        type: event.type,
        invoiceNumber: settlement.invoice.invoiceNumber
      });
    }

    case "SUBSCRIPTION_SUSPENDED":
    case "SUBSCRIPTION_RECOVERED": {
      const subscription =
        await tx.merchantSubscription.findFirst({
          where: {
            id: event.sourceId,
            merchantId: event.merchantId
          },
          select: {
            id: true
          }
        });

      if (!subscription) {
        return failure("SOURCE_NOT_FOUND");
      }

      return validated({
        type: event.type
      });
    }

    default:
      return failure("UNSUPPORTED_EVENT");
  }
}
