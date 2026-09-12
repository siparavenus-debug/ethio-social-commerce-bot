import {
  MerchantInvoiceStatus,
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
  getMerchantInvoiceHistory
} from "../src/services/merchant-billing-read.js";

const testPrefix =
  "day17-invoice-history";

async function cleanup() {
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
    await prisma.merchantInvoiceItem.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchantSettlement.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchantInvoice.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.auditLog.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchant.deleteMany({
      where: {
        id: {
          in: merchantIds
        }
      }
    });
  }
}

async function createMerchant(
  suffix: string
) {
  return prisma.merchant.create({
    data: {
      name:
        `${testPrefix}-${suffix}`,
      currency:
        "ETB"
    }
  });
}

async function createInvoice(
  merchantId: string,
  suffix: string,
  options?: {
    periodStart?: Date;
    periodEnd?: Date;
    subscriptionAmount?: string;
    commissionAmount?: string;
    totalAmount?: string;
    status?: MerchantInvoiceStatus;
    dueAt?: Date | null;
    openedAt?: Date | null;
    paidAt?: Date | null;
  }
) {
  return prisma.merchantInvoice.create({
    data: {
      merchantId,
      invoiceNumber:
        `DAY17-INV-${suffix}`,
      periodStart:
        options?.periodStart ??
        new Date(
          "2026-09-01T00:00:00.000Z"
        ),
      periodEnd:
        options?.periodEnd ??
        new Date(
          "2026-10-01T00:00:00.000Z"
        ),
      subscriptionAmount:
        options?.subscriptionAmount ??
        "500.00",
      commissionAmount:
        options?.commissionAmount ??
        "35.00",
      totalAmount:
        options?.totalAmount ??
        "535.00",
      currency:
        "ETB",
      status:
        options?.status ??
        MerchantInvoiceStatus.DRAFT,
      dueAt:
        options?.dueAt ?? null,
      openedAt:
        options?.openedAt ?? null,
      paidAt:
        options?.paidAt ?? null
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
  "merchant invoice history",
  () => {
    it(
      "returns persisted invoice amounts and lifecycle timestamps unchanged",
      async () => {
        const merchant =
          await createMerchant(
            "persisted"
          );

        const dueAt =
          new Date(
            "2026-10-10T00:00:00.000Z"
          );

        const openedAt =
          new Date(
            "2026-10-01T08:00:00.000Z"
          );

        const paidAt =
          new Date(
            "2026-10-05T09:00:00.000Z"
          );

        const invoice =
          await createInvoice(
            merchant.id,
            "PERSISTED",
            {
              subscriptionAmount:
                "500.00",
              commissionAmount:
                "30.00",
              totalAmount:
                "530.00",
              status:
                MerchantInvoiceStatus.PAID,
              dueAt,
              openedAt,
              paidAt
            }
          );

        const result =
          await getMerchantInvoiceHistory(
            merchant.id
          );

        expect(
          result.merchantId
        ).toBe(
          merchant.id
        );

        expect(
          result.invoices
        ).toHaveLength(1);

        expect(
          result.invoices[0]
        ).toMatchObject({
          id:
            invoice.id,
          invoiceNumber:
            invoice.invoiceNumber,
          subscriptionAmount:
            "500",
          commissionAmount:
            "30",
          totalAmount:
            "530",
          currency:
            "ETB",
          status:
            MerchantInvoiceStatus.PAID,
          dueAt,
          openedAt,
          paidAt
        });

        expect(
          result.invoices[0].periodStart
        ).toEqual(
          invoice.periodStart
        );

        expect(
          result.invoices[0].periodEnd
        ).toEqual(
          invoice.periodEnd
        );
      }
    );

    it(
      "keeps all persisted invoice statuses visible",
      async () => {
        const merchant =
          await createMerchant(
            "statuses"
          );

        const statuses = [
          MerchantInvoiceStatus.DRAFT,
          MerchantInvoiceStatus.OPEN,
          MerchantInvoiceStatus.PAID,
          MerchantInvoiceStatus.OVERDUE,
          MerchantInvoiceStatus.VOID
        ];

        for (
          let index = 0;
          index < statuses.length;
          index += 1
        ) {
          const month =
            index + 1;

          await createInvoice(
            merchant.id,
            `STATUS-${statuses[index]}`,
            {
              periodStart:
                new Date(
                  Date.UTC(
                    2026,
                    month - 1,
                    1
                  )
                ),
              periodEnd:
                new Date(
                  Date.UTC(
                    2026,
                    month,
                    1
                  )
                ),
              status:
                statuses[index]
            }
          );
        }

        const result =
          await getMerchantInvoiceHistory(
            merchant.id
          );

        expect(
          result.invoices
        ).toHaveLength(
          statuses.length
        );

        expect(
          new Set(
            result.invoices.map(
              (invoice) =>
                invoice.status
            )
          )
        ).toEqual(
          new Set(statuses)
        );
      }
    );

    it(
      "returns newest billing periods first",
      async () => {
        const merchant =
          await createMerchant(
            "ordering"
          );

        const older =
          await createInvoice(
            merchant.id,
            "OLDER",
            {
              periodStart:
                new Date(
                  "2026-08-01T00:00:00.000Z"
                ),
              periodEnd:
                new Date(
                  "2026-09-01T00:00:00.000Z"
                )
            }
          );

        const newer =
          await createInvoice(
            merchant.id,
            "NEWER",
            {
              periodStart:
                new Date(
                  "2026-09-01T00:00:00.000Z"
                ),
              periodEnd:
                new Date(
                  "2026-10-01T00:00:00.000Z"
                )
            }
          );

        const result =
          await getMerchantInvoiceHistory(
            merchant.id
          );

        expect(
          result.invoices.map(
            (invoice) =>
              invoice.id
          )
        ).toEqual([
          newer.id,
          older.id
        ]);
      }
    );

    it(
      "isolates invoice history by merchant",
      async () => {
        const merchantA =
          await createMerchant(
            "isolation-a"
          );

        const merchantB =
          await createMerchant(
            "isolation-b"
          );

        const invoiceA =
          await createInvoice(
            merchantA.id,
            "ISOLATION-A"
          );

        const invoiceB =
          await createInvoice(
            merchantB.id,
            "ISOLATION-B"
          );

        const result =
          await getMerchantInvoiceHistory(
            merchantA.id
          );

        expect(
          result.invoices.map(
            (invoice) =>
              invoice.id
          )
        ).toEqual([
          invoiceA.id
        ]);

        expect(
          result.invoices.some(
            (invoice) =>
              invoice.id ===
              invoiceB.id
          )
        ).toBe(false);
      }
    );
  }
);
