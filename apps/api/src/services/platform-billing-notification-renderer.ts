export type BillingNotificationTemplateType =
  | "INVOICE_ISSUED"
  | "INVOICE_FIRST_OVERDUE"
  | "INVOICE_SECOND_OVERDUE"
  | "SETTLEMENT_SUBMITTED"
  | "SETTLEMENT_REJECTED"
  | "INVOICE_PAID"
  | "SUBSCRIPTION_SUSPENDED"
  | "SUBSCRIPTION_RECOVERED";

type InvoiceTemplateInput = {
  invoiceNumber: string;
};

type InvoiceAmountTemplateInput =
  InvoiceTemplateInput & {
    amount: string;
    currency: string;
  };

export type BillingNotificationTemplateInput =
  | ({
      type: "INVOICE_ISSUED";
      dueDate: string | null;
    } & InvoiceAmountTemplateInput)
  | ({
      type: "INVOICE_FIRST_OVERDUE";
    } & InvoiceAmountTemplateInput)
  | ({
      type: "INVOICE_SECOND_OVERDUE";
    } & InvoiceAmountTemplateInput)
  | ({
      type: "SETTLEMENT_SUBMITTED";
    } & InvoiceTemplateInput)
  | ({
      type: "SETTLEMENT_REJECTED";
    } & InvoiceTemplateInput)
  | ({
      type: "INVOICE_PAID";
    } & InvoiceTemplateInput)
  | {
      type: "SUBSCRIPTION_SUSPENDED";
    }
  | {
      type: "SUBSCRIPTION_RECOVERED";
    };

export type BillingNotificationRenderResult =
  | {
      ok: true;
      text: string;
    }
  | {
      ok: false;
      reason:
        | "UNSUPPORTED_EVENT"
        | "INVALID_TEMPLATE_INPUT";
    };

function safeText(
  value: unknown,
  maxLength: number
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > maxLength ||
    /[\x00-\x1F\x7F<>]/.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function invoiceNumber(
  value: unknown
): string | null {
  return safeText(value, 100);
}

function money(
  amountValue: unknown,
  currencyValue: unknown
): string | null {
  const amount = safeText(amountValue, 32);
  const currency = safeText(currencyValue, 3);

  if (
    !amount ||
    !currency ||
    !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(amount) ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }

  return `${currency} ${amount}`;
}

export function renderBillingNotification(
  input: BillingNotificationTemplateInput
): BillingNotificationRenderResult {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.type !== "string"
  ) {
    return {
      ok: false,
      reason: "INVALID_TEMPLATE_INPUT"
    };
  }

  switch (input.type) {
    case "INVOICE_ISSUED": {
      const number = invoiceNumber(input.invoiceNumber);
      const total = money(input.amount, input.currency);

      const dueDate =
        input.dueDate === null
          ? null
          : safeText(input.dueDate, 40);

      if (
        !number ||
        !total ||
        (input.dueDate !== null && !dueDate)
      ) {
        return {
          ok: false,
          reason: "INVALID_TEMPLATE_INPUT"
        };
      }

      return {
        ok: true,
        text: [
          "Invoice issued",
          "",
          `Invoice: ${number}`,
          `Amount due: ${total}`,
          ...(dueDate ? [`Due date: ${dueDate}`] : []),
          "",
          "Your platform billing invoice is available for review."
        ].join("\n")
      };
    }

    case "INVOICE_FIRST_OVERDUE":
    case "INVOICE_SECOND_OVERDUE": {
      const number = invoiceNumber(input.invoiceNumber);
      const total = money(input.amount, input.currency);

      if (!number || !total) {
        return {
          ok: false,
          reason: "INVALID_TEMPLATE_INPUT"
        };
      }

      if (input.type === "INVOICE_FIRST_OVERDUE") {
        return {
          ok: true,
          text: [
            "Payment reminder",
            "",
            `Invoice ${number} is overdue.`,
            `Outstanding invoice amount: ${total}`,
            "",
            "Please review your platform billing invoice."
          ].join("\n")
        };
      }

      return {
        ok: true,
        text: [
          "Second payment reminder",
          "",
          `Invoice ${number} remains overdue.`,
          `Outstanding invoice amount: ${total}`,
          "",
          "Please resolve the outstanding invoice to avoid further account restrictions."
        ].join("\n")
      };
    }

    case "SETTLEMENT_SUBMITTED":
    case "SETTLEMENT_REJECTED":
    case "INVOICE_PAID": {
      const number = invoiceNumber(input.invoiceNumber);

      if (!number) {
        return {
          ok: false,
          reason: "INVALID_TEMPLATE_INPUT"
        };
      }

      const messages = {
        SETTLEMENT_SUBMITTED: [
          "Payment submitted for review",
          "",
          `Your payment submission for invoice ${number} has been received.`,
          "",
          "Verification is pending. Your invoice is not yet confirmed as paid."
        ],
        SETTLEMENT_REJECTED: [
          "Payment verification unsuccessful",
          "",
          `Your payment submission for invoice ${number} was rejected.`,
          "",
          "Please review your billing information and contact support if necessary."
        ],
        INVOICE_PAID: [
          "Invoice paid",
          "",
          `Invoice ${number} has been marked as paid following authorized verification.`,
          "",
          "Thank you."
        ]
      };

      return {
        ok: true,
        text: messages[input.type].join("\n")
      };
    }

    case "SUBSCRIPTION_SUSPENDED":
      return {
        ok: true,
        text: [
          "Subscription suspended",
          "",
          "Your merchant subscription has been suspended.",
          "",
          "Please review your billing status and any outstanding obligations."
        ].join("\n")
      };

    case "SUBSCRIPTION_RECOVERED":
      return {
        ok: true,
        text: [
          "Subscription restored",
          "",
          "Your merchant subscription has been restored.",
          "",
          "You may continue using the services available under your subscription."
        ].join("\n")
      };

    default:
      return {
        ok: false,
        reason: "UNSUPPORTED_EVENT"
      };
  }
}
