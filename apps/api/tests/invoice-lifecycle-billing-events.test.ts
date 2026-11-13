import { randomUUID } from "node:crypto";

import {
  MerchantInvoiceStatus,
  MerchantInvoiceReminderType,
  MerchantSubscriptionStatus,
  SubscriptionBillingInterval,
  Prisma,
  prisma
} from "@ethio-commerce/database";

import {
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  openMerchantInvoice,
  markMerchantInvoiceOverdue,
  processSecondOverdueInvoiceReminders,
  processPastDueSubscriptionSuspensions
} from "../src/services/invoice-lifecycle.js";

const ROLLBACK = "UNIT_2B_INVOICE_EXPECTED_ROLLBACK";

describe("B3.6 Unit 2B invoice lifecycle billing events", () => {
  it("creates INVOICE_ISSUED atomically", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let invoiceId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `Unit 2B issued invoice ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `UNIT2B-ISSUED-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.DRAFT
            }
          });

          invoiceId = invoice.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const opened = await openMerchantInvoice({
              merchantId,
              invoiceId
            });

            expect(opened.status).toBe(MerchantInvoiceStatus.OPEN);
            expect(opened.openedAt).not.toBeNull();
            expect(opened.dueAt).not.toBeNull();

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              include: { notification: true }
            });

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
              merchantId,
              type: "INVOICE_ISSUED",
              sourceId: invoiceId,
              occurrenceKey: `INVOICE_ISSUED:${invoiceId}`,
              notification: {
                status: "SUPPRESSED",
                terminalReason: "NO_ELIGIBLE_OPT_IN"
              }
            });

            completed = true;
          } finally {
            transactionSpy.mockRestore();
          }

          throw new Error(ROLLBACK);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000
        }
      );
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK) {
        throw error;
      }
    }

    expect(completed).toBe(true);

    expect(
      await prisma.platformBillingEvent.count({
        where: { merchantId }
      })
    ).toBe(0);

    expect(
      await prisma.platformBillingNotification.count({
        where: { merchantId }
      })
    ).toBe(0);
    expect(merchantId).not.toBe("");
    expect(invoiceId).not.toBe("");

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `INVOICE_ISSUED:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchantInvoice.findUnique({
        where: { id: invoiceId }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });

  it("creates INVOICE_FIRST_OVERDUE atomically", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let invoiceId = "";
    let completed = false;

    const now = new Date("2026-11-11T12:00:00.000Z");
    const dueAt = new Date("2026-11-01T12:00:00.000Z");

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `Unit 2B overdue invoice ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `UNIT2B-OVERDUE-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OPEN,
              openedAt: new Date("2026-10-01T00:00:00.000Z"),
              dueAt
            }
          });

          invoiceId = invoice.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const overdue = await markMerchantInvoiceOverdue({
              merchantId,
              invoiceId,
              now
            });

            expect(overdue.status).toBe(
              MerchantInvoiceStatus.OVERDUE
            );

            const reminders = await tx.merchantInvoiceReminder.findMany({
              where: { merchantId, invoiceId }
            });

            expect(reminders).toHaveLength(1);
            expect(reminders[0].type).toBe(
              MerchantInvoiceReminderType.FIRST_OVERDUE
            );

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              include: { notification: true }
            });

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
              merchantId,
              type: "INVOICE_FIRST_OVERDUE",
              sourceId: invoiceId,
              occurrenceKey: `INVOICE_FIRST_OVERDUE:${reminders[0].id}`,
              notification: {
                status: "SUPPRESSED",
                terminalReason: "NO_ELIGIBLE_OPT_IN"
              }
            });

            completed = true;
          } finally {
            transactionSpy.mockRestore();
          }

          throw new Error(ROLLBACK);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000
        }
      );
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK) {
        throw error;
      }
    }

    expect(completed).toBe(true);

    expect(
      await prisma.platformBillingEvent.count({
        where: { merchantId }
      })
    ).toBe(0);

    expect(
      await prisma.platformBillingNotification.count({
        where: { merchantId }
      })
    ).toBe(0);
    expect(merchantId).not.toBe("");
    expect(invoiceId).not.toBe("");

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `INVOICE_FIRST_OVERDUE:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchantInvoiceReminder.count({
        where: { merchantId, invoiceId }
      })
    ).toBe(0);

    expect(
      await prisma.merchantInvoice.findUnique({
        where: { id: invoiceId }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });
  it("creates INVOICE_SECOND_OVERDUE atomically", async () => {
    const suffix = randomUUID();
    const now = new Date("2026-11-11T12:00:00.000Z");
    const dueAt = new Date("2026-11-01T12:00:00.000Z");

    let merchantId = "";
    let invoiceId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `Unit 2B second overdue ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `UNIT2B-SECOND-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OVERDUE,
              openedAt: new Date("2026-10-01T00:00:00.000Z"),
              dueAt
            }
          });

          invoiceId = invoice.id;

          const findManySpy = vi.spyOn(
            prisma.merchantInvoice,
            "findMany"
          );

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            findManySpy.mockImplementation(
              ((args: Parameters<typeof tx.merchantInvoice.findMany>[0]) =>
                tx.merchantInvoice.findMany(args)) as
                typeof prisma.merchantInvoice.findMany
            );

            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const result =
              await processSecondOverdueInvoiceReminders({ now });

            expect(result).toMatchObject({
              discoveredCount: 1,
              createdCount: 1,
              skippedCount: 0
            });

            const reminders =
              await tx.merchantInvoiceReminder.findMany({
                where: { merchantId, invoiceId }
              });

            expect(reminders).toHaveLength(1);
            expect(reminders[0].type).toBe(
              MerchantInvoiceReminderType.SECOND_OVERDUE
            );

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              include: { notification: true }
            });

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
              merchantId,
              type: "INVOICE_SECOND_OVERDUE",
              sourceId: invoiceId,
              occurrenceKey: `INVOICE_SECOND_OVERDUE:${reminders[0].id}`,
              notification: {
                status: "SUPPRESSED",
                terminalReason: "NO_ELIGIBLE_OPT_IN"
              }
            });

            completed = true;
          } finally {
            findManySpy.mockRestore();
            transactionSpy.mockRestore();
          }

          throw new Error(ROLLBACK);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000
        }
      );
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK) {
        throw error;
      }
    }

    expect(completed).toBe(true);

    expect(
      await prisma.platformBillingEvent.count({
        where: { merchantId }
      })
    ).toBe(0);

    expect(
      await prisma.platformBillingNotification.count({
        where: { merchantId }
      })
    ).toBe(0);

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `INVOICE_SECOND_OVERDUE:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchantInvoiceReminder.count({
        where: { merchantId, invoiceId }
      })
    ).toBe(0);

    expect(
      await prisma.merchantInvoice.findUnique({
        where: { id: invoiceId }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });

  it("creates SUBSCRIPTION_SUSPENDED atomically", async () => {
    const suffix = randomUUID();
    const now = new Date("2026-11-11T12:00:00.000Z");
    const dueAt = new Date("2026-11-01T12:00:00.000Z");

    let merchantId = "";
    let invoiceId = "";
    let subscriptionId = "";
    let planId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `Unit 2B suspension ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const plan = await tx.subscriptionPlan.create({
            data: {
              code: `U2B-${suffix.slice(0, 12)}`,
              name: "Unit 2B Suspension Test Plan",
              monthlyPrice: "500.00",
              annualPrice: "5000.00",
              currency: "ETB",
              commissionRate: "0.035000",
              isActive: true
            }
          });

          planId = plan.id;

          const subscription =
            await tx.merchantSubscription.create({
              data: {
                merchantId,
                planId,
                status: MerchantSubscriptionStatus.PAST_DUE,
                billingInterval: SubscriptionBillingInterval.MONTHLY,
                priceSnapshot: "500.00",
                commissionRateSnapshot: "0.035000",
                currency: "ETB",
                currentPeriodStart:
                  new Date("2026-09-01T00:00:00.000Z"),
                currentPeriodEnd:
                  new Date("2026-10-01T00:00:00.000Z")
              }
            });

          subscriptionId = subscription.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `UNIT2B-SUSPEND-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OVERDUE,
              openedAt: new Date("2026-10-01T00:00:00.000Z"),
              dueAt
            }
          });

          invoiceId = invoice.id;

          const findManySpy = vi.spyOn(
            prisma.merchantInvoice,
            "findMany"
          );

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            findManySpy.mockImplementation(
              ((args: Parameters<typeof tx.merchantInvoice.findMany>[0]) =>
                tx.merchantInvoice.findMany(args)) as
                typeof prisma.merchantInvoice.findMany
            );

            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const result =
              await processPastDueSubscriptionSuspensions({ now });

            expect(result).toMatchObject({
              discoveredCount: 1,
              suspendedCount: 1,
              skippedCount: 0
            });

            const updated =
              await tx.merchantSubscription.findUnique({
                where: { merchantId }
              });

            expect(updated?.status).toBe(
              MerchantSubscriptionStatus.SUSPENDED
            );

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              include: { notification: true }
            });

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
              merchantId,
              type: "SUBSCRIPTION_SUSPENDED",
              sourceId: subscriptionId,
              occurrenceKey:
                `SUBSCRIPTION_SUSPENDED:${subscriptionId}:${invoiceId}`,
              notification: {
                status: "SUPPRESSED",
                terminalReason: "NO_ELIGIBLE_OPT_IN"
              }
            });

            completed = true;
          } finally {
            findManySpy.mockRestore();
            transactionSpy.mockRestore();
          }

          throw new Error(ROLLBACK);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000
        }
      );
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK) {
        throw error;
      }
    }

    expect(completed).toBe(true);

    expect(
      await prisma.platformBillingEvent.count({
        where: { merchantId }
      })
    ).toBe(0);

    expect(
      await prisma.platformBillingNotification.count({
        where: { merchantId }
      })
    ).toBe(0);

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey:
            `SUBSCRIPTION_SUSPENDED:${subscriptionId}:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchantSubscription.findUnique({
        where: { merchantId }
      })
    ).toBeNull();

    expect(
      await prisma.merchantInvoice.findUnique({
        where: { id: invoiceId }
      })
    ).toBeNull();

    expect(
      await prisma.subscriptionPlan.findUnique({
        where: { id: planId }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });
});
