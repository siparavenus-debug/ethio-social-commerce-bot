import {
  MerchantInvoiceReminderType,
  MerchantInvoiceStatus,
  MerchantSettlementProvider,
  MerchantSettlementStatus,
  MerchantSubscriptionStatus,
  Prisma,
  SubscriptionBillingInterval,
  prisma
} from "@ethio-commerce/database";

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";

import {
  markMerchantInvoiceOverdue,
  openMerchantInvoice,
  processOverdueMerchantInvoices,
  processSecondOverdueInvoiceReminders,
  processPastDueSubscriptionSuspensions
} from "../src/services/invoice-lifecycle.js";

import {
  submitMerchantSettlement
} from "../src/services/merchant-settlement.js";

import {
  rejectMerchantSettlement
} from "../src/services/merchant-settlement-review.js";

const testPrefix =
  "day15-invoice-lifecycle";

async function cleanup(): Promise<void> {
  const merchants =
    await prisma.merchant.findMany({
      where: {
        name: {
          startsWith:
            testPrefix
        }
      },
      select: {
        id: true
      }
    });

  const merchantIds =
    merchants.map(
      (merchant) =>
        merchant.id
    );

  if (merchantIds.length > 0) {
    await prisma.platformAuditLog.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantSettlement.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantInvoiceItem.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantInvoiceReminder.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.auditLog.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantInvoice.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantSubscription.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchant.deleteMany({
      where: {
        id: {
          in:
            merchantIds
        }
      }
    });
  }

  await prisma.subscriptionPlan.deleteMany({
    where: {
      code: {
        startsWith:
          testPrefix
      }
    }
  });

  await prisma.platformAuditLog.deleteMany({
    where: {
      actor: {
        email: {
          startsWith:
            `${testPrefix}-platform-`
        }
      }
    }
  });

  await prisma.platformUser.deleteMany({
    where: {
      email: {
        startsWith:
          `${testPrefix}-platform-`
      }
    }
  });
}
async function createFixture(
  suffix: string,
  status:
    MerchantInvoiceStatus =
      MerchantInvoiceStatus.DRAFT
) {
  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`,
        currency:
          "ETB"
      }
    });

  const periodStart =
    new Date(
      "2026-09-01T00:00:00.000Z"
    );

  const periodEnd =
    new Date(
      "2026-10-01T00:00:00.000Z"
    );

  const invoice =
    await prisma.merchantInvoice.create({
      data: {
        merchantId:
          merchant.id,
        invoiceNumber:
          `INV-${suffix}`,
        periodStart,
        periodEnd,
        subscriptionAmount:
          new Prisma.Decimal(
            "500.00"
          ),
        commissionAmount:
          new Prisma.Decimal(
            "50.00"
          ),
        totalAmount:
          new Prisma.Decimal(
            "550.00"
          ),
        currency:
          "ETB",
        status,
        openedAt:
          status ===
          MerchantInvoiceStatus.DRAFT
            ? null
            : new Date(
                "2026-10-01T00:00:00.000Z"
              ),
        paidAt:
          status ===
          MerchantInvoiceStatus.PAID
            ? new Date(
                "2026-10-02T00:00:00.000Z"
              )
            : null
      }
    });

  return {
    merchant,
    invoice
  };
}


async function createPlatformUser(
  suffix: string
) {
  return prisma.platformUser.create({
    data: {
      email:
        `${testPrefix}-platform-${suffix}@example.com`,
      passwordHash:
        "test-password-hash",
      displayName:
        `Platform Test ${suffix}`
    }
  });
}

beforeEach(
  async () => {
    await cleanup();
  }
);

afterAll(
  async () => {
    await cleanup();
    await prisma.$disconnect();
  }
);

describe(
  "merchant invoice lifecycle",
  () => {
    it(
      "opens a DRAFT invoice and sets openedAt",
      async () => {
        const fixture =
          await createFixture(
            "open"
          );

        const opened =
          await openMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id
          });

        expect(
          opened.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          opened.openedAt
        ).toBeInstanceOf(
          Date
        );

        expect(
          opened.paidAt
        ).toBeNull();
      }
    );

    it(
      "sets dueAt to seven days after openedAt",
      async () => {
        const fixture =
          await createFixture(
            "open-due-date"
          );

        const opened =
          await openMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id
          });

        expect(
          opened.openedAt
        ).toBeInstanceOf(
          Date
        );

        expect(
          opened.dueAt
        ).toBeInstanceOf(
          Date
        );

        const expectedDueAt =
          new Date(
            opened.openedAt!.getTime() +
              7 * 24 * 60 * 60 * 1000
          );

        expect(
          opened.dueAt
        ).toEqual(
          expectedDueAt
        );
      }
    );

    it(
      "creates exactly one INVOICE_OPENED audit",
      async () => {
        const fixture =
          await createFixture(
            "audit"
          );

        await openMerchantInvoice({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id
        });

        const logs =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          logs
        ).toHaveLength(
          1
        );

        expect(
          logs[0]?.metadata
        ).toMatchObject({
          previousStatus:
            MerchantInvoiceStatus.DRAFT,
          nextStatus:
            MerchantInvoiceStatus.OPEN
        });
      }
    );

    it(
      "preserves actor attribution when supplied",
      async () => {
        const fixture =
          await createFixture(
            "actor"
          );

        const actorUserId =
          "day15-test-actor";

        await openMerchantInvoice({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          actorUserId
        });

        const log =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          log?.actorUserId
        ).toBe(
          actorUserId
        );
      }
    );

    it(
      "allows a null actor for trusted internal use",
      async () => {
        const fixture =
          await createFixture(
            "null-actor"
          );

        await openMerchantInvoice({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          actorUserId:
            null
        });

        const log =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          log?.actorUserId
        ).toBeNull();
      }
    );

    it(
      "does not allow another merchant to open the invoice",
      async () => {
        const first =
          await createFixture(
            "isolation-a"
          );

        const second =
          await createFixture(
            "isolation-b"
          );

        await expect(
          openMerchantInvoice({
            merchantId:
              second.merchant.id,
            invoiceId:
              first.invoice.id
          })
        ).rejects.toThrow(
          "Merchant invoice not found"
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                first.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          MerchantInvoiceStatus.DRAFT
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                first.merchant.id,
              action:
                "INVOICE_OPENED",
              entityId:
                first.invoice.id
            }
          })
        ).toBe(
          0
        );
      }
    );

    it.each([
      MerchantInvoiceStatus.OPEN,
      MerchantInvoiceStatus.PAID,
      MerchantInvoiceStatus.OVERDUE,
      MerchantInvoiceStatus.VOID
    ])(
      "rejects opening an invoice already in %s",
      async (status) => {
        const fixture =
          await createFixture(
            `invalid-${status.toLowerCase()}`,
            status
          );

        await expect(
          openMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id
          })
        ).rejects.toThrow(
          "Only draft invoices can be opened"
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          status
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED",
              entityId:
                fixture.invoice.id
            }
          })
        ).toBe(
          0
        );
      }
    );

    it(
      "does not silently replay an already opened invoice",
      async () => {
        const fixture =
          await createFixture(
            "replay"
          );

        await openMerchantInvoice({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id
        });

        await expect(
          openMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id
          })
        ).rejects.toThrow(
          "Only draft invoices can be opened"
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED",
              entityId:
                fixture.invoice.id
            }
          })
        ).toBe(
          1
        );
      }
    );

    it(
      "allows only one concurrent opening attempt to succeed",
      async () => {
        const fixture =
          await createFixture(
            "concurrent"
          );

        const results =
          await Promise.allSettled([
            openMerchantInvoice({
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }),
            openMerchantInvoice({
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            })
          ]);

        const fulfilled =
          results.filter(
            (result) =>
              result.status ===
              "fulfilled"
          );

        const rejected =
          results.filter(
            (result) =>
              result.status ===
              "rejected"
          );

        expect(
          fulfilled
        ).toHaveLength(
          1
        );

        expect(
          rejected
        ).toHaveLength(
          1
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED",
              entityId:
                fixture.invoice.id
            }
          })
        ).toBe(
          1
        );
      }
    );

    it(
      "creates platform audit for platform-admin invoice opening",
      async () => {
        const fixture =
          await createFixture(
            "platform-audit"
          );

        const platformUser =
          await createPlatformUser(
            "invoice-open"
          );

        const opened =
          await openMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            actorUserId:
              null,
            actorPlatformUserId:
              platformUser.id
          });

        const merchantAudit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED",
              entityId:
                fixture.invoice.id
            }
          });

        const platformAudit =
          await prisma.platformAuditLog.findFirst({
            where: {
              actorPlatformUserId:
                platformUser.id,
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_INVOICE_OPENED",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          opened.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          merchantAudit
        ).not.toBeNull();

        expect(
          merchantAudit?.actorUserId
        ).toBeNull();

        expect(
          platformAudit
        ).not.toBeNull();

        expect(
          platformAudit?.actorPlatformUserId
        ).toBe(
          platformUser.id
        );
      }
    );

    it(
      "rolls back invoice opening when platform audit fails",
      async () => {
        const fixture =
          await createFixture(
            "platform-rollback"
          );

        await expect(
          openMerchantInvoice({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            actorUserId:
              null,
            actorPlatformUserId:
              "nonexistent-platform-user"
          })
        ).rejects.toThrow();

        const stored =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored.status
        ).toBe(
          MerchantInvoiceStatus.DRAFT
        );

        expect(
          stored.openedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_OPENED"
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.platformAuditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_INVOICE_OPENED"
            }
          })
        ).toBe(
          0
        );
      }
    );

    it(
      "marks a past-due OPEN invoice OVERDUE",
      async () => {
        const fixture =
          await createFixture(
            "mark-overdue",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id: fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        const overdue =
          await markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now:
              new Date(
                "2026-10-06T00:00:00.000Z"
              )
          });

        expect(
          overdue.status
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );

        expect(
          overdue.dueAt
        ).toEqual(
          dueAt
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );
      }
    );

    it(
      "creates one FIRST_OVERDUE reminder when an invoice becomes OVERDUE",
      async () => {
        const fixture =
          await createFixture(
            "overdue-first-reminder",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await markMerchantInvoiceOverdue({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          now:
            new Date(
              "2026-10-06T00:00:00.000Z"
            )
        });

        const reminders =
          await prisma.merchantInvoiceReminder.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        expect(reminders).toHaveLength(1);

        expect(
          reminders[0]?.type
        ).toBe("FIRST_OVERDUE");
      }
    );

    it(
      "moves an ACTIVE subscription to PAST_DUE when its invoice becomes OVERDUE",
      async () => {
        const fixture =
          await createFixture(
            "overdue-past-due",
            MerchantInvoiceStatus.OPEN
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-overdue-past-due`,
              name:
                "Invoice Lifecycle Overdue Plan",
              monthlyPrice:
                "500.00",
              annualPrice:
                "5000.00",
              currency:
                "ETB",
              commissionRate:
                "0.035000",
              isActive:
                true
            }
          });

        await prisma.merchantSubscription.create({
          data: {
            merchantId:
              fixture.merchant.id,
            planId:
              plan.id,
            status:
              MerchantSubscriptionStatus.ACTIVE,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            priceSnapshot:
              "500.00",
            commissionRateSnapshot:
              "0.035000",
            currency:
              "ETB",
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-10-01T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        await markMerchantInvoiceOverdue({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          now:
            new Date(
              "2026-10-06T00:00:00.000Z"
            )
        });

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

          expect(
            subscription?.status
          ).toBe(
            MerchantSubscriptionStatus.PAST_DUE
          );

          const subscriptionLogs =
            await prisma.auditLog.findMany({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED",
                entityType:
                  "MERCHANT_SUBSCRIPTION",
                entityId:
                  subscription?.id
              }
            });

          expect(
            subscriptionLogs
          ).toHaveLength(
            1
          );

          expect(
            subscriptionLogs[0]?.metadata
          ).toMatchObject({
            previousStatus:
              MerchantSubscriptionStatus.ACTIVE,
            nextStatus:
              MerchantSubscriptionStatus.PAST_DUE
          });
        }
      );

    it(
      "does not mark an OPEN invoice overdue at its exact due time",
      async () => {
        const fixture =
          await createFixture(
            "not-overdue-at-deadline",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id: fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await expect(
          markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now: dueAt
          })
        ).rejects.toThrow(
          "Invoice due date has not passed"
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );
      }
    );

    it(
      "does not mark an OPEN invoice overdue without a due date",
      async () => {
        const fixture =
          await createFixture(
            "overdue-without-due-date",
            MerchantInvoiceStatus.OPEN
          );

        await expect(
          markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now:
              new Date(
                "2026-10-06T00:00:00.000Z"
              )
          })
        ).rejects.toThrow(
          "Open invoice has no due date"
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );
      }
    );

    it.each([
      MerchantInvoiceStatus.DRAFT,
      MerchantInvoiceStatus.PAID,
      MerchantInvoiceStatus.OVERDUE,
      MerchantInvoiceStatus.VOID
    ])(
      "rejects marking an invoice overdue from %s",
      async (status) => {
        const fixture =
          await createFixture(
            `invalid-overdue-${status.toLowerCase()}`,
            status
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        await expect(
          markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now:
              new Date(
                "2026-10-06T00:00:00.000Z"
              )
          })
        ).rejects.toThrow(
          "Only open invoices can be marked overdue"
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          status
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE",
              entityId:
                fixture.invoice.id
            }
          })
        ).toBe(
          0
        );
      }
    );

    it(
      "creates exactly one INVOICE_MARKED_OVERDUE audit",
      async () => {
        const fixture =
          await createFixture(
            "overdue-audit",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        const now =
          new Date(
            "2026-10-06T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await markMerchantInvoiceOverdue({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          now
        });

        const logs =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          logs
        ).toHaveLength(
          1
        );

        expect(
          logs[0]?.metadata
        ).toMatchObject({
          previousStatus:
            MerchantInvoiceStatus.OPEN,
          nextStatus:
            MerchantInvoiceStatus.OVERDUE,
          dueAt:
            dueAt.toISOString(),
          evaluatedAt:
            now.toISOString()
        });
      }
    );

    it(
      "does not allow another merchant to mark the invoice overdue",
      async () => {
        const first =
          await createFixture(
            "overdue-isolation-a",
            MerchantInvoiceStatus.OPEN
          );

        const second =
          await createFixture(
            "overdue-isolation-b",
            MerchantInvoiceStatus.OPEN
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              first.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        await expect(
          markMerchantInvoiceOverdue({
            merchantId:
              second.merchant.id,
            invoiceId:
              first.invoice.id,
            now:
              new Date(
                "2026-10-06T00:00:00.000Z"
              )
          })
        ).rejects.toThrow(
          "Merchant invoice not found"
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                first.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                first.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE",
              entityId:
                first.invoice.id
            }
          })
        ).toBe(
          0
        );
      }
    );

    it(
      "does not silently replay an already overdue invoice",
      async () => {
        const fixture =
          await createFixture(
            "overdue-replay",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        const now =
          new Date(
            "2026-10-06T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await markMerchantInvoiceOverdue({
          merchantId:
            fixture.merchant.id,
          invoiceId:
            fixture.invoice.id,
          now
        });

        await expect(
          markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now
          })
        ).rejects.toThrow(
          "Only open invoices can be marked overdue"
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE",
              entityId:
                fixture.invoice.id
            }
          })
        ).toBe(
          1
        );
      }
    );

    it(
      "allows only one concurrent overdue attempt to succeed",
      async () => {
        const fixture =
          await createFixture(
            "overdue-concurrent",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        const now =
          new Date(
            "2026-10-06T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        const results =
          await Promise.allSettled([
            markMerchantInvoiceOverdue({
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              now
            }),
            markMerchantInvoiceOverdue({
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              now
            })
          ]);

        const fulfilled =
          results.filter(
            (result) =>
              result.status ===
              "fulfilled"
          );

        const rejected =
          results.filter(
            (result) =>
              result.status ===
              "rejected"
          );

        expect(
          fulfilled
        ).toHaveLength(
          1
        );

        expect(
          rejected
        ).toHaveLength(
          1
        );

        const stored =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored?.status
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE",
              entityId:
                fixture.invoice.id
            }
          })
        ).toBe(
          1
        );
      }
    );

    it(
      "creates platform audit for platform-admin overdue transition",
      async () => {
        const fixture =
          await createFixture(
            "overdue-platform-audit",
            MerchantInvoiceStatus.OPEN
          );

        const platformUser =
          await createPlatformUser(
            "invoice-overdue"
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        const now =
          new Date(
            "2026-10-06T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        const overdue =
          await markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now,
            actorUserId:
              null,
            actorPlatformUserId:
              platformUser.id
          });

        const merchantAudit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE",
              entityId:
                fixture.invoice.id
            }
          });

        const platformAudit =
          await prisma.platformAuditLog.findFirst({
            where: {
              actorPlatformUserId:
                platformUser.id,
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_INVOICE_MARKED_OVERDUE",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          overdue.status
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );

        expect(
          merchantAudit
        ).not.toBeNull();

        expect(
          merchantAudit?.actorUserId
        ).toBeNull();

        expect(
          platformAudit
        ).not.toBeNull();

        expect(
          platformAudit?.actorPlatformUserId
        ).toBe(
          platformUser.id
        );

        expect(
          platformAudit?.metadata
        ).toMatchObject({
          previousStatus:
            MerchantInvoiceStatus.OPEN,
          nextStatus:
            MerchantInvoiceStatus.OVERDUE,
          dueAt:
            dueAt.toISOString(),
          evaluatedAt:
            now.toISOString()
        });
      }
    );

    it(
      "rolls back overdue transition when platform audit fails",
      async () => {
        const fixture =
          await createFixture(
            "overdue-platform-rollback",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await expect(
          markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now:
              new Date(
                "2026-10-06T00:00:00.000Z"
              ),
            actorUserId:
              null,
            actorPlatformUserId:
              "nonexistent-platform-user"
          })
        ).rejects.toThrow();

        const stored =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          stored.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          stored.dueAt
        ).toEqual(
          dueAt
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE"
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.platformAuditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_INVOICE_MARKED_OVERDUE"
            }
          })
        ).toBe(
          0
        );
      }
    );

    it(
      "does not mark an invoice overdue while settlement review is pending",
      async () => {
        const fixture =
          await createFixture(
            "overdue-pending-settlement",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await prisma.merchantSettlement.create({
          data: {
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            provider:
              "TELEBIRR",
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED,
            amount:
              new Prisma.Decimal(
                "550.00"
              ),
            currency:
              "ETB",
            idempotencyKey:
              "overdue-pending-settlement",
            transactionReference:
              "TX-OVERDUE-PENDING-001"
          }
        });

        await expect(
          markMerchantInvoiceOverdue({
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            now:
              new Date(
                "2026-10-06T00:00:00.000Z"
              )
          })
        ).rejects.toThrow(
          "Invoice has a settlement awaiting review"
        );

        const storedInvoice =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          storedInvoice!.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_MARKED_OVERDUE",
              entityId:
                fixture.invoice.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "does not strand a settlement when overdue transition races settlement submission",
      async () => {
        const fixture =
          await createFixture(
            "overdue-settlement-race",
            MerchantInvoiceStatus.OPEN
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        const results =
          await Promise.allSettled([
            markMerchantInvoiceOverdue({
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              now:
                new Date(
                  "2026-10-06T00:00:00.000Z"
                )
            }),
            submitMerchantSettlement({
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              provider:
                MerchantSettlementProvider
                  .TELEBIRR,
              amount:
                new Prisma.Decimal(
                  "550.00"
                ),
              currency:
                "ETB",
              idempotencyKey:
                "overdue-settlement-race",
              transactionReference:
                "TX-OVERDUE-RACE-001"
            })
          ]);

        const storedInvoice =
          await prisma.merchantInvoice.findUnique({
            where: {
              id:
                fixture.invoice.id
            }
          });

        const pendingSettlement =
          await prisma.merchantSettlement.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              status:
                MerchantSettlementStatus
                  .REVIEW_REQUIRED
            }
          });

        expect(
          !pendingSettlement ||
            storedInvoice?.status ===
              MerchantInvoiceStatus.OPEN ||
            storedInvoice?.status ===
              MerchantInvoiceStatus.OVERDUE
        ).toBe(true);

        expect(
          results.some(
            (result) =>
              result.status === "fulfilled"
          )
        ).toBe(true);
      }
    );

    it(
      "processes only past-due OPEN invoices as overdue",
      async () => {
        const pastDue =
          await createFixture(
            "batch-past-due",
            MerchantInvoiceStatus.OPEN
          );

        const futureDue =
          await createFixture(
            "batch-future-due",
            MerchantInvoiceStatus.OPEN
          );

        const exactDue =
          await createFixture(
            "batch-exact-due",
            MerchantInvoiceStatus.OPEN
          );

        const noDueDate =
          await createFixture(
            "batch-no-due-date",
            MerchantInvoiceStatus.OPEN
          );

        const alreadyPaid =
          await createFixture(
            "batch-paid",
            MerchantInvoiceStatus.PAID
          );

        const now =
          new Date(
            "2026-10-06T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              pastDue.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              futureDue.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-07T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              exactDue.invoice.id
          },
          data: {
            dueAt: now
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              alreadyPaid.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        await processOverdueMerchantInvoices({
          now
        });

        const storedInvoices =
          await prisma.merchantInvoice.findMany({
            where: {
              id: {
                in: [
                  pastDue.invoice.id,
                  futureDue.invoice.id,
                  exactDue.invoice.id,
                  noDueDate.invoice.id,
                  alreadyPaid.invoice.id
                ]
              }
            }
          });

        const statusById =
          new Map(
            storedInvoices.map(
              (invoice) => [
                invoice.id,
                invoice.status
              ]
            )
          );

        expect(
          statusById.get(
            pastDue.invoice.id
          )
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );

        expect(
          statusById.get(
            futureDue.invoice.id
          )
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          statusById.get(
            exactDue.invoice.id
          )
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          statusById.get(
            noDueDate.invoice.id
          )
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          statusById.get(
            alreadyPaid.invoice.id
          )
        ).toBe(
          MerchantInvoiceStatus.PAID
        );
      }
    );

    it(
      "continues processing when one overdue candidate has settlement review pending",
      async () => {
        const protectedInvoice =
          await createFixture(
            "batch-pending-settlement",
            MerchantInvoiceStatus.OPEN
          );

        const eligibleInvoice =
          await createFixture(
            "batch-eligible",
            MerchantInvoiceStatus.OPEN
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        const now =
          new Date(
            "2026-10-06T00:00:00.000Z"
          );

        await prisma.merchantInvoice.updateMany({
          where: {
            id: {
              in: [
                protectedInvoice.invoice.id,
                eligibleInvoice.invoice.id
              ]
            }
          },
          data: {
            dueAt
          }
        });

        await prisma.merchantSettlement.create({
          data: {
            merchantId:
              protectedInvoice.merchant.id,
            invoiceId:
              protectedInvoice.invoice.id,
            provider:
              "TELEBIRR",
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED,
            amount:
              new Prisma.Decimal(
                "550.00"
              ),
            currency:
              "ETB",
            idempotencyKey:
              "batch-pending-settlement",
            transactionReference:
              "TX-BATCH-PENDING-001"
          }
        });

        const result =
          await processOverdueMerchantInvoices({
            now
          });

        const storedProtectedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                protectedInvoice.invoice.id
            }
          });

        const storedEligibleInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                eligibleInvoice.invoice.id
            }
          });

        expect(
          storedProtectedInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          storedEligibleInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );

        expect(result).toEqual({
          discoveredCount: 2,
          markedOverdueCount: 1,
          skippedCount: 1
        });
      }
    );

    it(
      "creates SECOND_OVERDUE reminder exactly three days after the invoice due date",
      async () => {
        const fixture =
          await createFixture(
            "second-overdue-reminder",
            MerchantInvoiceStatus.OVERDUE
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await processSecondOverdueInvoiceReminders({
          now:
            new Date(
              "2026-10-08T00:00:00.000Z"
            )
        });

        const reminders =
          await prisma.merchantInvoiceReminder.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        expect(reminders).toHaveLength(1);

        expect(
          reminders[0]?.type
        ).toBe(
          "SECOND_OVERDUE"
        );
      }
    );

    it(
      "does not create SECOND_OVERDUE reminder while settlement review is pending",
      async () => {
        const fixture =
          await createFixture(
            "second-overdue-pending-settlement",
            MerchantInvoiceStatus.OVERDUE
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        await prisma.merchantSettlement.create({
          data: {
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            provider:
              MerchantSettlementProvider.TELEBIRR,
            status:
              MerchantSettlementStatus.REVIEW_REQUIRED,
            amount:
              new Prisma.Decimal(
                "550.00"
              ),
            currency:
              "ETB",
            idempotencyKey:
              "second-overdue-pending-settlement",
            transactionReference:
              "TX-SECOND-OVERDUE-PENDING-001"
          }
        });

        const result =
          await processSecondOverdueInvoiceReminders({
            now:
              new Date(
                "2026-10-08T00:00:00.000Z"
              )
          });

        const reminders =
          await prisma.merchantInvoiceReminder.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        expect(reminders).toHaveLength(0);

        expect(result).toEqual({
          discoveredCount: 0,
          createdCount: 0,
          skippedCount: 0
        });
      }
    );

    it(
      "does not create SECOND_OVERDUE reminder before three days after the invoice due date",
      async () => {
        const fixture =
          await createFixture(
            "second-overdue-too-early",
            MerchantInvoiceStatus.OVERDUE
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        const result =
          await processSecondOverdueInvoiceReminders({
            now:
              new Date(
                "2026-10-07T23:59:59.999Z"
              )
          });

        const reminders =
          await prisma.merchantInvoiceReminder.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id
            }
          });

        expect(reminders).toHaveLength(0);

        expect(result).toEqual({
          discoveredCount: 0,
          createdCount: 0,
          skippedCount: 0
        });
      }
    );

    it(
      "does not create duplicate SECOND_OVERDUE reminders",
      async () => {
        const fixture =
          await createFixture(
            "second-overdue-idempotent",
            MerchantInvoiceStatus.OVERDUE
          );

        const dueAt =
          new Date(
            "2026-10-05T00:00:00.000Z"
          );

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt
          }
        });

        const now =
          new Date(
            "2026-10-08T00:00:00.000Z"
          );

        const firstResult =
          await processSecondOverdueInvoiceReminders({
            now
          });

        const secondResult =
          await processSecondOverdueInvoiceReminders({
            now
          });

        const reminders =
          await prisma.merchantInvoiceReminder.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              type:
                MerchantInvoiceReminderType
                  .SECOND_OVERDUE
            }
          });

        expect(reminders).toHaveLength(1);

        expect(firstResult).toEqual({
          discoveredCount: 1,
          createdCount: 1,
          skippedCount: 0
        });

        expect(secondResult).toEqual({
          discoveredCount: 0,
          createdCount: 0,
          skippedCount: 0
        });
      }
    );

    it(
      "suspends a PAST_DUE subscription exactly seven days after the invoice due date",
      async () => {
        const fixture =
          await createFixture(
            "past-due-suspension",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-past-due-suspension`,
              name:
                "Invoice Lifecycle Suspension Plan",
              monthlyPrice:
                "500.00",
              annualPrice:
                "5000.00",
              currency:
                "ETB",
              commissionRate:
                "0.035000",
              isActive:
                true
            }
          });

        await prisma.merchantSubscription.create({
          data: {
            merchantId:
              fixture.merchant.id,
            planId:
              plan.id,
            status:
              MerchantSubscriptionStatus.PAST_DUE,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            priceSnapshot:
              "500.00",
            commissionRateSnapshot:
              "0.035000",
            currency:
              "ETB",
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-10-01T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

      const now =
        new Date(
          "2026-10-12T00:00:00.000Z"
        );

      const firstResult =
        await processPastDueSubscriptionSuspensions({
          now
        });

      const secondResult =
        await processPastDueSubscriptionSuspensions({
          now
        });

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription?.status
        ).toBe(
          MerchantSubscriptionStatus.SUSPENDED
        );

        const subscriptionLogs =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SUBSCRIPTION_STATUS_CHANGED",
              entityType:
                "MERCHANT_SUBSCRIPTION",
              entityId:
                subscription?.id
            }
          });

        expect(
          subscriptionLogs
        ).toHaveLength(
          1
        );

        expect(
          subscriptionLogs[0]?.metadata
        ).toMatchObject({
          previousStatus:
            MerchantSubscriptionStatus.PAST_DUE,
          nextStatus:
            MerchantSubscriptionStatus.SUSPENDED
        });

        expect(firstResult).toEqual({
          discoveredCount: 1,
          suspendedCount: 1,
          skippedCount: 0
        });

        expect(secondResult).toEqual({
          discoveredCount: 0,
          suspendedCount: 0,
          skippedCount: 0
        });
      }
    );

    it(
      "does not suspend a PAST_DUE subscription before seven days after the invoice due date",
      async () => {
        const fixture =
          await createFixture(
            "past-due-before-suspension",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-past-due-before-suspension`,
              name:
                "Invoice Lifecycle Pre-Suspension Plan",
              monthlyPrice:
                "500.00",
              annualPrice:
                "5000.00",
              currency:
                "ETB",
              commissionRate:
                "0.035000",
              isActive:
                true
            }
          });

        await prisma.merchantSubscription.create({
          data: {
            merchantId:
              fixture.merchant.id,
            planId:
              plan.id,
            status:
              MerchantSubscriptionStatus.PAST_DUE,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            priceSnapshot:
              "500.00",
            commissionRateSnapshot:
              "0.035000",
            currency:
              "ETB",
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-10-01T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        const result =
          await processPastDueSubscriptionSuspensions({
            now:
              new Date(
                "2026-10-11T23:59:59.999Z"
              )
          });

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription?.status
        ).toBe(
          MerchantSubscriptionStatus.PAST_DUE
        );

        expect(result).toEqual({
          discoveredCount: 0,
          suspendedCount: 0,
          skippedCount: 0
        });
      }
    );

    it(
      "does not suspend a PAST_DUE subscription while settlement review is pending",
      async () => {
        const fixture =
          await createFixture(
            "past-due-suspension-pending-settlement",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-susp-pending`,
              name:
                "Invoice Lifecycle Suspension Pending Settlement Plan",
              monthlyPrice:
                "500.00",
              annualPrice:
                "5000.00",
              currency:
                "ETB",
              commissionRate:
                "0.035000",
              isActive:
                true
            }
          });

        await prisma.merchantSubscription.create({
          data: {
            merchantId:
              fixture.merchant.id,
            planId:
              plan.id,
            status:
              MerchantSubscriptionStatus.PAST_DUE,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            priceSnapshot:
              "500.00",
            commissionRateSnapshot:
              "0.035000",
            currency:
              "ETB",
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-10-01T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantSettlement.create({
          data: {
            merchantId:
              fixture.merchant.id,
            invoiceId:
              fixture.invoice.id,
            provider:
              MerchantSettlementProvider.TELEBIRR,
            status:
              MerchantSettlementStatus.REVIEW_REQUIRED,
            amount:
              new Prisma.Decimal(
                "550.00"
              ),
            currency:
              "ETB",
            idempotencyKey:
              "suspension-pending-settlement",
            transactionReference:
              "TX-SUSPENSION-PENDING-001"
          }
        });

        const result =
          await processPastDueSubscriptionSuspensions({
            now:
              new Date(
                "2026-10-12T00:00:00.000Z"
              )
          });

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription?.status
        ).toBe(
          MerchantSubscriptionStatus.PAST_DUE
        );

        expect(result).toEqual({
          discoveredCount: 0,
          suspendedCount: 0,
          skippedCount: 0
        });
      }
    );

    it(
      "suspends a PAST_DUE subscription after settlement review is rejected",
      async () => {
        const fixture =
          await createFixture(
            "past-due-suspension-rejected-settlement",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-susp-rejected`,
              name:
                "Invoice Lifecycle Rejected Settlement Suspension Plan",
              monthlyPrice:
                "500.00",
              annualPrice:
                "5000.00",
              currency:
                "ETB",
              commissionRate:
                "0.035000",
              isActive:
                true
            }
          });

        await prisma.merchantSubscription.create({
          data: {
            merchantId:
              fixture.merchant.id,
            planId:
              plan.id,
            status:
              MerchantSubscriptionStatus.PAST_DUE,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            priceSnapshot:
              "500.00",
            commissionRateSnapshot:
              "0.035000",
            currency:
              "ETB",
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-10-01T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        const settlement =
          await prisma.merchantSettlement.create({
            data: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              provider:
                MerchantSettlementProvider.TELEBIRR,
              status:
                MerchantSettlementStatus.REVIEW_REQUIRED,
              amount:
                new Prisma.Decimal(
                  "550.00"
                ),
              currency:
                "ETB",
              idempotencyKey:
                "suspension-rejected-settlement",
              transactionReference:
                "TX-SUSPENSION-REJECTED-001"
            }
          });

        const rejected =
          await rejectMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              settlement.id,
            reviewNote:
              "Platform rejected overdue invoice payment"
          });

        expect(
          rejected.settlement.status
        ).toBe(
          MerchantSettlementStatus.REJECTED
        );

        expect(
          rejected.invoice.status
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );

        const result =
          await processPastDueSubscriptionSuspensions({
            now:
              new Date(
                "2026-10-12T00:00:00.000Z"
              )
          });

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription?.status
        ).toBe(
          MerchantSubscriptionStatus.SUSPENDED
        );

        expect(result).toEqual({
          discoveredCount: 1,
          suspendedCount: 1,
          skippedCount: 0
        });
      }
    );

    it(
      "suspends a merchant only once when multiple overdue invoices are eligible",
      async () => {
        const fixture =
          await createFixture(
            "past-due-suspension-multiple-invoices",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-susp-multi`,
              name:
                "Invoice Lifecycle Multiple Invoice Suspension Plan",
              monthlyPrice:
                "500.00",
              annualPrice:
                "5000.00",
              currency:
                "ETB",
              commissionRate:
                "0.035000",
              isActive:
                true
            }
          });

        await prisma.merchantSubscription.create({
          data: {
            merchantId:
              fixture.merchant.id,
            planId:
              plan.id,
            status:
              MerchantSubscriptionStatus.PAST_DUE,
            billingInterval:
              SubscriptionBillingInterval.MONTHLY,
            priceSnapshot:
              "500.00",
            commissionRateSnapshot:
              "0.035000",
            currency:
              "ETB",
            currentPeriodStart:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            currentPeriodEnd:
              new Date(
                "2026-10-01T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.update({
          where: {
            id:
              fixture.invoice.id
          },
          data: {
            dueAt:
              new Date(
                "2026-10-04T00:00:00.000Z"
              )
          }
        });

        await prisma.merchantInvoice.create({
          data: {
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-past-due-suspension-multiple-invoices-2",
            periodStart:
              new Date(
                "2026-08-01T00:00:00.000Z"
              ),
            periodEnd:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            subscriptionAmount:
              new Prisma.Decimal(
                "500.00"
              ),
            commissionAmount:
              new Prisma.Decimal(
                "50.00"
              ),
            totalAmount:
              new Prisma.Decimal(
                "550.00"
              ),
            currency:
              "ETB",
            status:
              MerchantInvoiceStatus.OVERDUE,
            openedAt:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            dueAt:
              new Date(
                "2026-10-05T00:00:00.000Z"
              )
          }
        });

        const result =
          await processPastDueSubscriptionSuspensions({
            now:
              new Date(
                "2026-10-12T00:00:00.000Z"
              )
          });

        const subscription =
          await prisma.merchantSubscription.findUnique({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        const subscriptionLogs =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SUBSCRIPTION_STATUS_CHANGED",
              entityType:
                "MERCHANT_SUBSCRIPTION",
              entityId:
                subscription?.id
            }
          });

        expect(
          subscription?.status
        ).toBe(
          MerchantSubscriptionStatus.SUSPENDED
        );

        expect(
          subscriptionLogs
        ).toHaveLength(
          1
        );

        expect(result).toEqual({
          discoveredCount: 1,
          suspendedCount: 1,
          skippedCount: 0
        });
      }
    );

  }
);
