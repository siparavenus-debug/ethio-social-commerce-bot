import { randomUUID } from "node:crypto";

import {
  MerchantInvoiceReminderType,
  MerchantInvoiceStatus,
  Prisma,
  prisma
} from "@ethio-commerce/database";

import {
  afterAll,
  describe,
  expect,
  it
} from "vitest";

import {
  markMerchantInvoiceOverdue,
  processSecondOverdueInvoiceReminders
} from "../src/services/invoice-lifecycle.js";

const testPrefix = "b53-concurrency-";

const now = new Date("2026-11-11T12:00:00.000Z");
const dueAt = new Date("2026-11-01T12:00:00.000Z");

async function createFixture(
  status: MerchantInvoiceStatus
) {
  const suffix = randomUUID();

  const merchant = await prisma.merchant.create({
    data: {
      name: `${testPrefix}${suffix}`,
      currency: "ETB"
    }
  });

  const invoice = await prisma.merchantInvoice.create({
    data: {
      merchantId: merchant.id,
      invoiceNumber: `B53-${suffix}`,
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-01T00:00:00.000Z"),
      subscriptionAmount: new Prisma.Decimal("500.00"),
      commissionAmount: new Prisma.Decimal("50.00"),
      totalAmount: new Prisma.Decimal("550.00"),
      currency: "ETB",
      status,
      openedAt: new Date("2026-10-01T00:00:00.000Z"),
      dueAt
    }
  });

  return { merchant, invoice };
}

async function assertSingleReminderAndEvent(
  merchantId: string,
  invoiceId: string,
  reminderType: MerchantInvoiceReminderType,
  eventType: "INVOICE_FIRST_OVERDUE" | "INVOICE_SECOND_OVERDUE"
) {
  const reminders = await prisma.merchantInvoiceReminder.findMany({
    where: {
      merchantId,
      invoiceId,
      type: reminderType
    }
  });

  expect(reminders).toHaveLength(1);

  const events = await prisma.platformBillingEvent.findMany({
    where: {
      merchantId,
      sourceId: invoiceId,
      type: eventType
    }
  });

  expect(events).toHaveLength(1);

  expect(events[0]).toMatchObject({
    merchantId,
    sourceId: invoiceId,
    type: eventType,
    occurrenceKey: `${eventType}:${reminders[0].id}`
  });
}

describe("B5.3 real PostgreSQL invoice lifecycle concurrency", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("commits exactly one FIRST_OVERDUE reminder and event", async () => {
    const { merchant, invoice } =
      await createFixture(MerchantInvoiceStatus.OPEN);

    const results = await Promise.allSettled([
      markMerchantInvoiceOverdue({
        merchantId: merchant.id,
        invoiceId: invoice.id,
        now
      }),
      markMerchantInvoiceOverdue({
        merchantId: merchant.id,
        invoiceId: invoice.id,
        now
      })
    ]);

    const fulfilled = results.filter(
      (result) => result.status === "fulfilled"
    );

    const rejected = results.filter(
      (result) => result.status === "rejected"
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const stored = await prisma.merchantInvoice.findUniqueOrThrow({
      where: { id: invoice.id }
    });

    expect(stored.status).toBe(MerchantInvoiceStatus.OVERDUE);

    await assertSingleReminderAndEvent(
      merchant.id,
      invoice.id,
      MerchantInvoiceReminderType.FIRST_OVERDUE,
      "INVOICE_FIRST_OVERDUE"
    );

    expect(
      await prisma.auditLog.count({
        where: {
          merchantId: merchant.id,
          action: "INVOICE_MARKED_OVERDUE",
          entityId: invoice.id
        }
      })
    ).toBe(1);
  });

  it("commits exactly one SECOND_OVERDUE reminder and event", async () => {
    const { merchant, invoice } =
      await createFixture(MerchantInvoiceStatus.OVERDUE);

    const results = await Promise.allSettled([
      processSecondOverdueInvoiceReminders({ now }),
      processSecondOverdueInvoiceReminders({ now })
    ]);

    expect(
      results.every((result) => result.status === "fulfilled")
    ).toBe(true);

    const createdCount = results.reduce(
      (total, result) =>
        total +
        (result.status === "fulfilled"
          ? result.value.createdCount
          : 0),
      0
    );

    expect(createdCount).toBeGreaterThanOrEqual(1);

    await assertSingleReminderAndEvent(
      merchant.id,
      invoice.id,
      MerchantInvoiceReminderType.SECOND_OVERDUE,
      "INVOICE_SECOND_OVERDUE"
    );

    const replay = await processSecondOverdueInvoiceReminders({ now });

    expect(replay.createdCount).toBe(0);

    await assertSingleReminderAndEvent(
      merchant.id,
      invoice.id,
      MerchantInvoiceReminderType.SECOND_OVERDUE,
      "INVOICE_SECOND_OVERDUE"
    );

    const stored = await prisma.merchantInvoice.findUniqueOrThrow({
      where: { id: invoice.id }
    });

    expect(stored.status).toBe(MerchantInvoiceStatus.OVERDUE);
  });
});
