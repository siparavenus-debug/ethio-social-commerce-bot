import { describe, expect, it, vi } from "vitest";

import {
  resolvePlatformBillingNotification
} from "../src/services/platform-billing-notification-resolver.js";

function fixture() {
  const invoice = vi.fn();
  const reminder = vi.fn();
  const settlement = vi.fn();
  const subscription = vi.fn();

  const tx = {
    merchantInvoice: { findFirst: invoice },
    merchantInvoiceReminder: { findFirst: reminder },
    merchantSettlement: { findFirst: settlement },
    merchantSubscription: { findFirst: subscription }
  };

  return {
    tx: tx as never,
    invoice,
    reminder,
    settlement,
    subscription
  };
}

const base = {
  merchantId: "merchant-A",
  sourceId: "source-A"
};

const amount = {
  toString: () => "125.50"
};

describe("B7.4-C2 merchant-scoped resolver", () => {
  it("resolves an issued invoice", async () => {
    const f = fixture();

    f.invoice.mockResolvedValue({
      invoiceNumber: "INV-100",
      totalAmount: amount,
      currency: "ETB",
      dueAt: new Date("2026-11-30T00:00:00.000Z")
    });

    const result = await resolvePlatformBillingNotification(
      f.tx,
      { ...base, type: "INVOICE_ISSUED" }
    );

    expect(result).toEqual({
      ok: true,
      input: {
        type: "INVOICE_ISSUED",
        invoiceNumber: "INV-100",
        amount: "125.50",
        currency: "ETB",
        dueDate: "2026-11-30"
      }
    });

    expect(f.invoice).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "source-A",
          merchantId: "merchant-A"
        }
      })
    );
  });

  it("supports an invoice without a due date", async () => {
    const f = fixture();

    f.invoice.mockResolvedValue({
      invoiceNumber: "INV-101",
      totalAmount: amount,
      currency: "ETB",
      dueAt: null
    });

    const result = await resolvePlatformBillingNotification(
      f.tx,
      { ...base, type: "INVOICE_ISSUED" }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.input).toMatchObject({
        dueDate: null
      });
    }
  });

  it.each([
    ["INVOICE_FIRST_OVERDUE", "FIRST_OVERDUE"],
    ["INVOICE_SECOND_OVERDUE", "SECOND_OVERDUE"]
  ] as const)(
    "resolves %s using its reminder",
    async (type, reminderType) => {
      const f = fixture();

      f.reminder.mockResolvedValue({
        invoice: {
          merchantId: "merchant-A",
          invoiceNumber: "INV-102",
          totalAmount: amount,
          currency: "ETB"
        }
      });

      const result = await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type }
      );

      expect(result).toEqual({
        ok: true,
        input: {
          type,
          invoiceNumber: "INV-102",
          amount: "125.50",
          currency: "ETB"
        }
      });

      expect(f.reminder).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "source-A",
            merchantId: "merchant-A",
            type: reminderType
          }
        })
      );
    }
  );

  it.each([
    "SETTLEMENT_SUBMITTED",
    "SETTLEMENT_REJECTED"
  ] as const)(
    "resolves %s without private settlement fields",
    async (type) => {
      const f = fixture();

      f.settlement.mockResolvedValue({
        invoice: {
          merchantId: "merchant-A",
          invoiceNumber: "INV-103"
        }
      });

      const result = await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type }
      );

      expect(result).toEqual({
        ok: true,
        input: {
          type,
          invoiceNumber: "INV-103"
        }
      });

      const query = f.settlement.mock.calls[0][0];

      expect(query.where).toEqual({
        id: "source-A",
        merchantId: "merchant-A"
      });

      expect(JSON.stringify(query.select)).not.toMatch(
        /receiptUrl|receiptMetadata|reviewNote|transactionReference|idempotencyKey/
      );
    }
  );

  it("resolves invoice paid without claiming payment eligibility", async () => {
    const f = fixture();

    f.invoice.mockResolvedValue({
      invoiceNumber: "INV-104",
      totalAmount: amount,
      currency: "ETB",
      dueAt: null
    });

    const result = await resolvePlatformBillingNotification(
      f.tx,
      { ...base, type: "INVOICE_PAID" }
    );

    expect(result).toEqual({
      ok: true,
      input: {
        type: "INVOICE_PAID",
        invoiceNumber: "INV-104"
      }
    });
  });

  it.each([
    "SUBSCRIPTION_SUSPENDED",
    "SUBSCRIPTION_RECOVERED"
  ] as const)(
    "resolves %s without asserting occurrence eligibility",
    async (type) => {
      const f = fixture();

      f.subscription.mockResolvedValue({
        id: "source-A"
      });

      const result = await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type }
      );

      expect(result).toEqual({
        ok: true,
        input: { type }
      });

      expect(f.subscription).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "source-A",
            merchantId: "merchant-A"
          }
        })
      );
    }
  );

  it("fails closed when a source is missing", async () => {
    const f = fixture();

    f.invoice.mockResolvedValue(null);

    expect(
      await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type: "INVOICE_ISSUED" }
      )
    ).toEqual({
      ok: false,
      reason: "SOURCE_NOT_FOUND"
    });
  });

  it("rejects a cross-merchant reminder relation", async () => {
    const f = fixture();

    f.reminder.mockResolvedValue({
      invoice: {
        merchantId: "merchant-B",
        invoiceNumber: "INV-OTHER",
        totalAmount: amount,
        currency: "ETB"
      }
    });

    expect(
      await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type: "INVOICE_FIRST_OVERDUE" }
      )
    ).toEqual({
      ok: false,
      reason: "SOURCE_NOT_FOUND"
    });
  });

  it("rejects a cross-merchant settlement relation", async () => {
    const f = fixture();

    f.settlement.mockResolvedValue({
      invoice: {
        merchantId: "merchant-B",
        invoiceNumber: "INV-OTHER"
      }
    });

    expect(
      await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type: "SETTLEMENT_SUBMITTED" }
      )
    ).toEqual({
      ok: false,
      reason: "SOURCE_NOT_FOUND"
    });
  });

  it("rejects malformed invoice numbers", async () => {
    const f = fixture();

    f.invoice.mockResolvedValue({
      invoiceNumber: "<script>",
      totalAmount: amount,
      currency: "ETB",
      dueAt: null
    });

    expect(
      await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type: "INVOICE_ISSUED" }
      )
    ).toEqual({
      ok: false,
      reason: "INVALID_SOURCE_DATA"
    });
  });

  it("rejects an invalid due date", async () => {
    const f = fixture();

    f.invoice.mockResolvedValue({
      invoiceNumber: "INV-105",
      totalAmount: amount,
      currency: "ETB",
      dueAt: new Date("invalid")
    });

    expect(
      await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type: "INVOICE_ISSUED" }
      )
    ).toEqual({
      ok: false,
      reason: "INVALID_SOURCE_DATA"
    });
  });

  it("rejects unsupported settlement verification", async () => {
    const f = fixture();

    expect(
      await resolvePlatformBillingNotification(
        f.tx,
        { ...base, type: "SETTLEMENT_VERIFIED" }
      )
    ).toEqual({
      ok: false,
      reason: "UNSUPPORTED_EVENT"
    });

    expect(f.invoice).not.toHaveBeenCalled();
    expect(f.settlement).not.toHaveBeenCalled();
  });

  it("rejects missing merchant identifiers", async () => {
    const f = fixture();

    expect(
      await resolvePlatformBillingNotification(
        f.tx,
        {
          merchantId: "",
          sourceId: "source-A",
          type: "INVOICE_ISSUED"
        }
      )
    ).toEqual({
      ok: false,
      reason: "INVALID_SOURCE_DATA"
    });
  });

  it("never performs database writes", async () => {
    const f = fixture();

    f.subscription.mockResolvedValue({
      id: "source-A"
    });

    const result = await resolvePlatformBillingNotification(
      f.tx,
      { ...base, type: "SUBSCRIPTION_RECOVERED" }
    );

    expect(result.ok).toBe(true);

    expect(Object.keys(f.tx)).toEqual([
      "merchantInvoice",
      "merchantInvoiceReminder",
      "merchantSettlement",
      "merchantSubscription"
    ]);
  });
});
