import { describe, expect, it } from "vitest";

import {
  renderBillingNotification
} from "../src/services/platform-billing-notification-renderer.js";

describe("B7.4-C1 billing notification renderer", () => {
  const invoice = {
    invoiceNumber: "INV-2026-001",
    amount: "1500.00",
    currency: "ETB"
  };

  it("renders an issued invoice", () => {
    const result = renderBillingNotification({
      type: "INVOICE_ISSUED",
      ...invoice,
      dueDate: "2026-11-30"
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).toContain("Invoice issued");
      expect(result.text).toContain("INV-2026-001");
      expect(result.text).toContain("ETB 1500.00");
      expect(result.text).toContain("2026-11-30");
    }
  });

  it("renders an invoice without a due date", () => {
    const result = renderBillingNotification({
      type: "INVOICE_ISSUED",
      ...invoice,
      dueDate: null
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).not.toContain("Due date:");
    }
  });

  it("renders the first overdue reminder", () => {
    const result = renderBillingNotification({
      type: "INVOICE_FIRST_OVERDUE",
      ...invoice
    });

    expect(result).toMatchObject({
      ok: true
    });

    if (result.ok) {
      expect(result.text).toContain("Payment reminder");
      expect(result.text).toContain("is overdue");
    }
  });

  it("renders the second overdue reminder", () => {
    const result = renderBillingNotification({
      type: "INVOICE_SECOND_OVERDUE",
      ...invoice
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).toContain(
        "Second payment reminder"
      );
      expect(result.text).toContain(
        "remains overdue"
      );
    }
  });

  it("renders settlement submission without claiming payment", () => {
    const result = renderBillingNotification({
      type: "SETTLEMENT_SUBMITTED",
      invoiceNumber: invoice.invoiceNumber
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).toContain(
        "Payment submitted for review"
      );
      expect(result.text).toContain(
        "not yet confirmed as paid"
      );
    }
  });

  it("renders settlement rejection", () => {
    const result = renderBillingNotification({
      type: "SETTLEMENT_REJECTED",
      invoiceNumber: invoice.invoiceNumber
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).toContain("was rejected");
    }
  });

  it("renders an invoice-paid notification", () => {
    const result = renderBillingNotification({
      type: "INVOICE_PAID",
      invoiceNumber: invoice.invoiceNumber
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).toContain("Invoice paid");
      expect(result.text).toContain(
        "following authorized verification"
      );
    }
  });

  it("renders subscription suspension", () => {
    const result = renderBillingNotification({
      type: "SUBSCRIPTION_SUSPENDED"
    });

    expect(result).toMatchObject({
      ok: true
    });

    if (result.ok) {
      expect(result.text).toContain(
        "subscription has been suspended"
      );
    }
  });

  it("renders subscription recovery", () => {
    const result = renderBillingNotification({
      type: "SUBSCRIPTION_RECOVERED"
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).toContain(
        "subscription has been restored"
      );
    }
  });

  it("rejects unsupported events", () => {
    const result = renderBillingNotification({
      type: "SETTLEMENT_VERIFIED"
    } as never);

    expect(result).toEqual({
      ok: false,
      reason: "UNSUPPORTED_EVENT"
    });
  });

  it("rejects malformed invoice numbers", () => {
    const result = renderBillingNotification({
      type: "INVOICE_PAID",
      invoiceNumber: "<script>alert(1)</script>"
    });

    expect(result).toEqual({
      ok: false,
      reason: "INVALID_TEMPLATE_INPUT"
    });
  });

  it("rejects malformed monetary amounts", () => {
    const result = renderBillingNotification({
      type: "INVOICE_ISSUED",
      ...invoice,
      amount: "NaN",
      dueDate: null
    });

    expect(result).toEqual({
      ok: false,
      reason: "INVALID_TEMPLATE_INPUT"
    });
  });

  it("rejects malformed currency codes", () => {
    const result = renderBillingNotification({
      type: "INVOICE_FIRST_OVERDUE",
      ...invoice,
      currency: "INVALID"
    });

    expect(result).toEqual({
      ok: false,
      reason: "INVALID_TEMPLATE_INPUT"
    });
  });

  it("rejects multiline invoice identifiers", () => {
    const result = renderBillingNotification({
      type: "INVOICE_PAID",
      invoiceNumber: "INV-001\nFake status: PAID"
    });

    expect(result).toEqual({
      ok: false,
      reason: "INVALID_TEMPLATE_INPUT"
    });
  });

  it("produces deterministic output", () => {
    const input = {
      type: "INVOICE_FIRST_OVERDUE" as const,
      ...invoice
    };

    expect(renderBillingNotification(input)).toEqual(
      renderBillingNotification(input)
    );
  });

  it("does not expose unrelated sensitive fields", () => {
    const result = renderBillingNotification({
      type: "SETTLEMENT_REJECTED",
      invoiceNumber: invoice.invoiceNumber,
      receiptUrl: "SECRET_RECEIPT_URL",
      reviewNote: "SECRET_REVIEW_NOTE",
      transactionReference: "SECRET_TRANSACTION_REF"
    } as never);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.text).not.toContain("SECRET_RECEIPT_URL");
      expect(result.text).not.toContain("SECRET_REVIEW_NOTE");
      expect(result.text).not.toContain("SECRET_TRANSACTION_REF");
    }
  });
});
