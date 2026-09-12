import {
  MerchantInvoiceStatus,
  Prisma,
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
  openMerchantInvoice
} from "../src/services/invoice-lifecycle.js";

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

    await prisma.merchant.deleteMany({
      where: {
        id: {
          in:
            merchantIds
        }
      }
    });
  }

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
  }
);
