import { randomUUID } from "node:crypto";

import {
  MerchantInvoiceStatus,
  MerchantSettlementProvider,
  MerchantSettlementStatus,
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
  rejectMerchantSettlement,
  verifyMerchantSettlement
} from "../src/services/merchant-settlement-review.js";

import {
  submitMerchantSettlement
} from "../src/services/merchant-settlement.js";

const ROLLBACK = "UNIT_2B_SETTLEMENT_EXPECTED_ROLLBACK";

describe("B3.6 Unit 2B settlement billing events", () => {
  it("creates one settlement verification event atomically", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let settlementId = "";
    let invoiceId = "";

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `Unit 2B settlement ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `UNIT2B-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OPEN,
              openedAt: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          invoiceId = invoice.id;

          const settlement = await tx.merchantSettlement.create({
            data: {
              merchantId,
              invoiceId,
              provider: MerchantSettlementProvider.TELEBIRR,
              status: MerchantSettlementStatus.REVIEW_REQUIRED,
              amount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              idempotencyKey: `unit2b-${suffix}`,
              transactionReference: `UNIT2B-TX-${suffix}`
            }
          });

          settlementId = settlement.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const result = await verifyMerchantSettlement({
              merchantId,
              settlementId,
              reviewNote: "Unit 2B integration verification"
            });

            expect(result.settlement.status).toBe(
              MerchantSettlementStatus.VERIFIED
            );
            expect(result.invoice.status).toBe(
              MerchantInvoiceStatus.PAID
            );

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              include: {
                notification: {
                  include: { delivery: true }
                }
              }
            });

            expect(events).toHaveLength(1);

            expect(
              events.map((event) => ({
                type: event.type,
                sourceId: event.sourceId,
                occurrenceKey: event.occurrenceKey
              }))
            ).toEqual([
              {
                type: "SETTLEMENT_VERIFIED",
                sourceId: settlementId,
                occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
              }
            ]);

            for (const event of events) {
              expect(event.merchantId).toBe(merchantId);
              expect(event.notification).toMatchObject({
                status: "SUPPRESSED",
                terminalReason: "NO_NOTIFICATION_MAPPING",
                delivery: null
              });
            }
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

    expect(merchantId).not.toBe("");
    expect(settlementId).not.toBe("");
    expect(invoiceId).not.toBe("");

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `INVOICE_PAID:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });

  it("creates a durable recovery event only on PAST_DUE to ACTIVE transition and rolls back atomically", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let settlementId = "";
    let invoiceId = "";
    let subscriptionId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `B5.2 recovery ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const plan = await tx.subscriptionPlan.create({
            data: {
              code: `b52-${suffix}`,
              name: "B5.2 Recovery Plan",
              monthlyPrice: new Prisma.Decimal("500.00"),
              annualPrice: new Prisma.Decimal("5000.00"),
              currency: "ETB",
              commissionRate: new Prisma.Decimal("0.035000"),
              isActive: true
            }
          });

          const subscription = await tx.merchantSubscription.create({
            data: {
              merchantId,
              planId: plan.id,
              status: MerchantSubscriptionStatus.PAST_DUE,
              billingInterval: SubscriptionBillingInterval.MONTHLY,
              priceSnapshot: new Prisma.Decimal("500.00"),
              commissionRateSnapshot: new Prisma.Decimal("0.035000"),
              currency: "ETB",
              currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
              currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          subscriptionId = subscription.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `B52-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OVERDUE,
              openedAt: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          invoiceId = invoice.id;

          const settlement = await tx.merchantSettlement.create({
            data: {
              merchantId,
              invoiceId,
              provider: MerchantSettlementProvider.TELEBIRR,
              status: MerchantSettlementStatus.REVIEW_REQUIRED,
              amount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              idempotencyKey: `b52-${suffix}`,
              transactionReference: `B52-TX-${suffix}`
            }
          });

          settlementId = settlement.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const result = await verifyMerchantSettlement({
              merchantId,
              settlementId,
              reviewNote: "B5.2 subscription recovery verification"
            });

            expect(result.settlement.status).toBe(
              MerchantSettlementStatus.VERIFIED
            );
            expect(result.invoice.status).toBe(
              MerchantInvoiceStatus.PAID
            );

            const updatedSubscription =
              await tx.merchantSubscription.findUniqueOrThrow({
                where: { id: subscriptionId }
              });

            expect(updatedSubscription.status).toBe(
              MerchantSubscriptionStatus.ACTIVE
            );

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              orderBy: { type: "asc" }
            });

            expect(events).toHaveLength(2);

            expect(
              events.map((event) => ({
                type: event.type,
                sourceId: event.sourceId,
                occurrenceKey: event.occurrenceKey
              }))
            ).toEqual([
              {
                type: "SETTLEMENT_VERIFIED",
                sourceId: settlementId,
                occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
              },
              {
                type: "SUBSCRIPTION_RECOVERED",
                sourceId: subscriptionId,
                occurrenceKey:
                  `SUBSCRIPTION_RECOVERED:${subscriptionId}:${invoiceId}`
              }
            ]);

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
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey:
            `SUBSCRIPTION_RECOVERED:${subscriptionId}:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });
  it("does not emit recovery when subscription is already ACTIVE", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let settlementId = "";
    let invoiceId = "";
    let subscriptionId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `B5.2 recovery ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const plan = await tx.subscriptionPlan.create({
            data: {
              code: `b52-${suffix}`,
              name: "B5.2 Recovery Plan",
              monthlyPrice: new Prisma.Decimal("500.00"),
              annualPrice: new Prisma.Decimal("5000.00"),
              currency: "ETB",
              commissionRate: new Prisma.Decimal("0.035000"),
              isActive: true
            }
          });

          const subscription = await tx.merchantSubscription.create({
            data: {
              merchantId,
              planId: plan.id,
              status: MerchantSubscriptionStatus.ACTIVE,
              billingInterval: SubscriptionBillingInterval.MONTHLY,
              priceSnapshot: new Prisma.Decimal("500.00"),
              commissionRateSnapshot: new Prisma.Decimal("0.035000"),
              currency: "ETB",
              currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
              currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          subscriptionId = subscription.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `B52-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OVERDUE,
              openedAt: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          invoiceId = invoice.id;

          const settlement = await tx.merchantSettlement.create({
            data: {
              merchantId,
              invoiceId,
              provider: MerchantSettlementProvider.TELEBIRR,
              status: MerchantSettlementStatus.REVIEW_REQUIRED,
              amount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              idempotencyKey: `b52-${suffix}`,
              transactionReference: `B52-TX-${suffix}`
            }
          });

          settlementId = settlement.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const result = await verifyMerchantSettlement({
              merchantId,
              settlementId,
              reviewNote: "B5.2 subscription recovery verification"
            });

            expect(result.settlement.status).toBe(
              MerchantSettlementStatus.VERIFIED
            );
            expect(result.invoice.status).toBe(
              MerchantInvoiceStatus.PAID
            );

            const updatedSubscription =
              await tx.merchantSubscription.findUniqueOrThrow({
                where: { id: subscriptionId }
              });

            expect(updatedSubscription.status).toBe(
              MerchantSubscriptionStatus.ACTIVE
            );

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              orderBy: { type: "asc" }
            });

            expect(events).toHaveLength(1);

            expect(
              events.map((event) => ({
                type: event.type,
                sourceId: event.sourceId,
                occurrenceKey: event.occurrenceKey
              }))
            ).toEqual([
              {
                type: "SETTLEMENT_VERIFIED",
                sourceId: settlementId,
                occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
              }
            ]);

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
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey:
            `SUBSCRIPTION_RECOVERED:${subscriptionId}:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });
  it("does not emit recovery while another overdue invoice remains", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let settlementId = "";
    let invoiceId = "";
    let subscriptionId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `B5.2 recovery ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const plan = await tx.subscriptionPlan.create({
            data: {
              code: `b52-${suffix}`,
              name: "B5.2 Recovery Plan",
              monthlyPrice: new Prisma.Decimal("500.00"),
              annualPrice: new Prisma.Decimal("5000.00"),
              currency: "ETB",
              commissionRate: new Prisma.Decimal("0.035000"),
              isActive: true
            }
          });

          const subscription = await tx.merchantSubscription.create({
            data: {
              merchantId,
              planId: plan.id,
              status: MerchantSubscriptionStatus.PAST_DUE,
              billingInterval: SubscriptionBillingInterval.MONTHLY,
              priceSnapshot: new Prisma.Decimal("500.00"),
              commissionRateSnapshot: new Prisma.Decimal("0.035000"),
              currency: "ETB",
              currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
              currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          subscriptionId = subscription.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `B52-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OVERDUE,
              openedAt: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `B52-OTHER-${suffix}`,
              periodStart: new Date("2026-08-01T00:00:00.000Z"),
              periodEnd: new Date("2026-09-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OVERDUE,
              openedAt: new Date("2026-09-01T00:00:00.000Z")
            }
          });

          invoiceId = invoice.id;

          const settlement = await tx.merchantSettlement.create({
            data: {
              merchantId,
              invoiceId,
              provider: MerchantSettlementProvider.TELEBIRR,
              status: MerchantSettlementStatus.REVIEW_REQUIRED,
              amount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              idempotencyKey: `b52-${suffix}`,
              transactionReference: `B52-TX-${suffix}`
            }
          });

          settlementId = settlement.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const result = await verifyMerchantSettlement({
              merchantId,
              settlementId,
              reviewNote: "B5.2 subscription recovery verification"
            });

            expect(result.settlement.status).toBe(
              MerchantSettlementStatus.VERIFIED
            );
            expect(result.invoice.status).toBe(
              MerchantInvoiceStatus.PAID
            );

            const updatedSubscription =
              await tx.merchantSubscription.findUniqueOrThrow({
                where: { id: subscriptionId }
              });

            expect(updatedSubscription.status).toBe(
              MerchantSubscriptionStatus.PAST_DUE
            );

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              orderBy: { type: "asc" }
            });

            expect(events).toHaveLength(1);

            expect(
              events.map((event) => ({
                type: event.type,
                sourceId: event.sourceId,
                occurrenceKey: event.occurrenceKey
              }))
            ).toEqual([
              {
                type: "SETTLEMENT_VERIFIED",
                sourceId: settlementId,
                occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
              }
            ]);

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
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `SETTLEMENT_VERIFIED:${settlementId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey:
            `SUBSCRIPTION_RECOVERED:${subscriptionId}:${invoiceId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchant.findUnique({
        where: { id: merchantId }
      })
    ).toBeNull();
  });
  it("creates a durable settlement rejection event atomically", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let settlementId = "";
    let invoiceId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `Unit 2B rejected settlement ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `UNIT2B-REJECT-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OPEN,
              openedAt: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          invoiceId = invoice.id;

          const settlement = await tx.merchantSettlement.create({
            data: {
              merchantId,
              invoiceId,
              provider: MerchantSettlementProvider.TELEBIRR,
              status: MerchantSettlementStatus.REVIEW_REQUIRED,
              amount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              idempotencyKey: `unit2b-reject-${suffix}`,
              transactionReference: `UNIT2B-REJECT-TX-${suffix}`
            }
          });

          settlementId = settlement.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            const result = await rejectMerchantSettlement({
              merchantId,
              settlementId,
              reviewNote: "Unit 2B integration rejection"
            });

            expect(result.settlement.status).toBe(
              MerchantSettlementStatus.REJECTED
            );

            expect(result.invoice.status).toBe(
              MerchantInvoiceStatus.OPEN
            );

            expect(result.invoice.paidAt).toBeNull();

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              include: {
                notification: {
                  include: { delivery: true }
                }
              }
            });

            expect(events).toHaveLength(1);

            expect(events[0]).toMatchObject({
              merchantId,
              type: "SETTLEMENT_REJECTED",
              sourceId: settlementId,
              occurrenceKey: `SETTLEMENT_REJECTED:${settlementId}`,
              notification: {
                status: "SUPPRESSED",
                terminalReason: "NO_ELIGIBLE_OPT_IN",
                delivery: null
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
    expect(merchantId).not.toBe("");
    expect(settlementId).not.toBe("");
    expect(invoiceId).not.toBe("");

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `SETTLEMENT_REJECTED:${settlementId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchantSettlement.findUnique({
        where: { id: settlementId }
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

  it("creates a durable settlement submission event atomically", async () => {
    const suffix = randomUUID();
    let merchantId = "";
    let invoiceId = "";
    let settlementId = "";
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const merchant = await tx.merchant.create({
            data: {
              name: `Unit 2B submitted settlement ${suffix}`,
              currency: "ETB"
            }
          });

          merchantId = merchant.id;

          const invoice = await tx.merchantInvoice.create({
            data: {
              merchantId,
              invoiceNumber: `UNIT2B-SUBMIT-${suffix}`,
              periodStart: new Date("2026-09-01T00:00:00.000Z"),
              periodEnd: new Date("2026-10-01T00:00:00.000Z"),
              subscriptionAmount: new Prisma.Decimal("500.00"),
              commissionAmount: new Prisma.Decimal("50.00"),
              totalAmount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              status: MerchantInvoiceStatus.OPEN,
              openedAt: new Date("2026-10-01T00:00:00.000Z")
            }
          });

          invoiceId = invoice.id;

          const transactionSpy = vi.spyOn(prisma, "$transaction");
          const replaySpy = vi.spyOn(
            prisma.merchantSettlement,
            "findUnique"
          );

          try {
            transactionSpy.mockImplementation(
              (async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx)) as typeof prisma.$transaction
            );

            replaySpy.mockImplementation(
              ((args: Parameters<typeof tx.merchantSettlement.findUnique>[0]) =>
                tx.merchantSettlement.findUnique(args)) as
                typeof prisma.merchantSettlement.findUnique
            );

            const settlement = await submitMerchantSettlement({
              merchantId,
              invoiceId,
              provider: MerchantSettlementProvider.TELEBIRR,
              amount: new Prisma.Decimal("550.00"),
              currency: "ETB",
              idempotencyKey: `unit2b-submit-${suffix}`,
              transactionReference: `UNIT2B-SUBMIT-TX-${suffix}`
            });

            settlementId = settlement.id;

            expect(settlement.status).toBe(
              MerchantSettlementStatus.REVIEW_REQUIRED
            );

            const updatedInvoice =
              await tx.merchantInvoice.findUniqueOrThrow({
                where: { id: invoiceId }
              });

            expect(updatedInvoice.status).toBe(
              MerchantInvoiceStatus.OPEN
            );

            expect(updatedInvoice.paidAt).toBeNull();

            const events = await tx.platformBillingEvent.findMany({
              where: { merchantId },
              include: {
                notification: {
                  include: { delivery: true }
                }
              }
            });

            expect(events).toHaveLength(1);

            expect(events[0]).toMatchObject({
              merchantId,
              type: "SETTLEMENT_SUBMITTED",
              sourceId: settlementId,
              occurrenceKey: `SETTLEMENT_SUBMITTED:${settlementId}`,
              notification: {
                status: "SUPPRESSED",
                terminalReason: "NO_ELIGIBLE_OPT_IN",
                delivery: null
              }
            });

            completed = true;
          } finally {
            replaySpy.mockRestore();
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
    expect(merchantId).not.toBe("");
    expect(invoiceId).not.toBe("");
    expect(settlementId).not.toBe("");

    expect(
      await prisma.platformBillingEvent.findUnique({
        where: {
          occurrenceKey: `SETTLEMENT_SUBMITTED:${settlementId}`
        }
      })
    ).toBeNull();

    expect(
      await prisma.merchantSettlement.findUnique({
        where: { id: settlementId }
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
  it("B5.6-T4-A concurrent settlement verification creates one authoritative billing event", async () => {
    const suffix = randomUUID();

    const merchant = await prisma.merchant.create({
      data: {
        name: `B5.6 T4A retained ${suffix}`,
        currency: "ETB"
      }
    });

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: merchant.id,
        invoiceNumber: `B56-T4A-${suffix}`,
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
        subscriptionAmount: new Prisma.Decimal("500.00"),
        commissionAmount: new Prisma.Decimal("50.00"),
        totalAmount: new Prisma.Decimal("550.00"),
        currency: "ETB",
        status: MerchantInvoiceStatus.OPEN,
        openedAt: new Date("2026-10-01T00:00:00.000Z")
      }
    });

    const settlement = await prisma.merchantSettlement.create({
      data: {
        merchantId: merchant.id,
        invoiceId: invoice.id,
        provider: MerchantSettlementProvider.TELEBIRR,
        status: MerchantSettlementStatus.REVIEW_REQUIRED,
        amount: new Prisma.Decimal("550.00"),
        currency: "ETB",
        idempotencyKey: `b56-t4a-${suffix}`,
        transactionReference: `B56-T4A-TX-${suffix}`
      }
    });

    const results = await Promise.allSettled([
      verifyMerchantSettlement({
        merchantId: merchant.id,
        settlementId: settlement.id,
        reviewNote: "B5.6 T4A reviewer one"
      }),
      verifyMerchantSettlement({
        merchantId: merchant.id,
        settlementId: settlement.id,
        reviewNote: "B5.6 T4A reviewer two"
      })
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);

    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);

    const [finalSettlement, finalInvoice, events] =
      await Promise.all([
        prisma.merchantSettlement.findUniqueOrThrow({
          where: { id: settlement.id }
        }),
        prisma.merchantInvoice.findUniqueOrThrow({
          where: { id: invoice.id }
        }),
        prisma.platformBillingEvent.findMany({
          where: { merchantId: merchant.id }
        })
      ]);

    expect(finalSettlement.status).toBe(
      MerchantSettlementStatus.VERIFIED
    );

    expect(finalInvoice.status).toBe(
      MerchantInvoiceStatus.PAID
    );

    expect(finalInvoice.paidAt).not.toBeNull();

    expect(events).toHaveLength(1);

    expect(events[0]).toMatchObject({
      merchantId: merchant.id,
      type: "SETTLEMENT_VERIFIED",
      sourceId: settlement.id,
      occurrenceKey: `SETTLEMENT_VERIFIED:${settlement.id}`
    });

    expect(
      events.some((event) =>
        event.occurrenceKey === `INVOICE_PAID:${invoice.id}`
      )
    ).toBe(false);

    expect(
      events.some((event) =>
        event.occurrenceKey === `SETTLEMENT_REJECTED:${settlement.id}`
      )
    ).toBe(false);
  });
  it("B5.6-T4-B concurrent settlement verification versus rejection preserves one authoritative outcome", async () => {
    const suffix = randomUUID();

    const merchant = await prisma.merchant.create({
      data: {
        name: `B5.6 T4B retained ${suffix}`,
        currency: "ETB"
      }
    });

    const invoice = await prisma.merchantInvoice.create({
      data: {
        merchantId: merchant.id,
        invoiceNumber: `B56-T4B-${suffix}`,
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
        subscriptionAmount: new Prisma.Decimal("500.00"),
        commissionAmount: new Prisma.Decimal("50.00"),
        totalAmount: new Prisma.Decimal("550.00"),
        currency: "ETB",
        status: MerchantInvoiceStatus.OPEN,
        openedAt: new Date("2026-10-01T00:00:00.000Z")
      }
    });

    const settlement = await prisma.merchantSettlement.create({
      data: {
        merchantId: merchant.id,
        invoiceId: invoice.id,
        provider: MerchantSettlementProvider.TELEBIRR,
        status: MerchantSettlementStatus.REVIEW_REQUIRED,
        amount: new Prisma.Decimal("550.00"),
        currency: "ETB",
        idempotencyKey: `b56-t4b-${suffix}`,
        transactionReference: `B56-T4B-TX-${suffix}`
      }
    });

    const results = await Promise.allSettled([
      verifyMerchantSettlement({
        merchantId: merchant.id,
        settlementId: settlement.id,
        reviewNote: "B5.6 T4B verification"
      }),
      rejectMerchantSettlement({
        merchantId: merchant.id,
        settlementId: settlement.id,
        reviewNote: "B5.6 T4B rejection"
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

    const [finalSettlement, finalInvoice, events] =
      await Promise.all([
        prisma.merchantSettlement.findUniqueOrThrow({
          where: { id: settlement.id }
        }),
        prisma.merchantInvoice.findUniqueOrThrow({
          where: { id: invoice.id }
        }),
        prisma.platformBillingEvent.findMany({
          where: { merchantId: merchant.id }
        })
      ]);

    expect(events).toHaveLength(1);

    const verificationWon =
      results[0].status === "fulfilled";

    if (verificationWon) {
      expect(finalSettlement.status).toBe(
        MerchantSettlementStatus.VERIFIED
      );

      expect(finalInvoice.status).toBe(
        MerchantInvoiceStatus.PAID
      );

      expect(finalInvoice.paidAt).not.toBeNull();

      expect(events[0]).toMatchObject({
        merchantId: merchant.id,
        type: "SETTLEMENT_VERIFIED",
        sourceId: settlement.id,
        occurrenceKey: `SETTLEMENT_VERIFIED:${settlement.id}`
      });
    } else {
      expect(results[1].status).toBe("fulfilled");

      expect(finalSettlement.status).toBe(
        MerchantSettlementStatus.REJECTED
      );

      expect(finalInvoice.status).toBe(
        MerchantInvoiceStatus.OPEN
      );

      expect(finalInvoice.paidAt).toBeNull();

      expect(events[0]).toMatchObject({
        merchantId: merchant.id,
        type: "SETTLEMENT_REJECTED",
        sourceId: settlement.id,
        occurrenceKey: `SETTLEMENT_REJECTED:${settlement.id}`
      });
    }

    expect(
      events.some((event) =>
        event.occurrenceKey === `INVOICE_PAID:${invoice.id}`
      )
    ).toBe(false);
  });
});
