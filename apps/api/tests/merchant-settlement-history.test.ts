import {
  MerchantInvoiceStatus,
  MerchantSettlementProvider,
  MerchantSettlementStatus,
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
  getMerchantSettlementHistory
} from "../src/services/merchant-billing-read.js";
import {
  rejectMerchantSettlement,
  verifyMerchantSettlement
} from "../src/services/merchant-settlement-review.js";
import {
  submitMerchantSettlement
} from "../src/services/merchant-settlement.js";

const testPrefix =
  "day17-settlement-history";

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

  if (merchantIds.length === 0) {
    return;
  }

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
  month: number
) {
  const periodStart =
    new Date(
      Date.UTC(
        2026,
        month - 1,
        1
      )
    );

  const periodEnd =
    new Date(
      Date.UTC(
        2026,
        month,
        1
      )
    );

  return prisma.merchantInvoice.create({
    data: {
      merchantId,
      invoiceNumber:
        `INV-DAY17-SETTLEMENT-${suffix}`,
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
      status:
        MerchantInvoiceStatus.OPEN,
      openedAt:
        periodEnd
    }
  });
}

async function submitFixture(
  merchantId: string,
  invoiceId: string,
  suffix: string,
  provider:
    MerchantSettlementProvider =
    MerchantSettlementProvider.TELEBIRR
) {
  return submitMerchantSettlement({
    merchantId,
    invoiceId,
    provider,
    amount:
      new Prisma.Decimal(
        "550.00"
      ),
    currency:
      "ETB",
    idempotencyKey:
      `day17-settlement-${suffix}`,
    transactionReference:
      `DAY17-SETTLEMENT-TXN-${suffix}`,
    receiptUrl:
      `https://example.test/${suffix}.jpg`
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
  "merchant settlement history",
  () => {
    it(
      "returns REVIEW_REQUIRED submission evidence unchanged",
      async () => {
        const merchant =
          await createMerchant(
            "review-required"
          );

        const invoice =
          await createInvoice(
            merchant.id,
            "review-required",
            1
          );

        const settlement =
          await submitFixture(
            merchant.id,
            invoice.id,
            "review-required"
          );

        const result =
          await getMerchantSettlementHistory(
            merchant.id
          );

        expect(
          result.merchantId
        ).toBe(
          merchant.id
        );

        expect(
          result.settlements
        ).toHaveLength(
          1
        );

        expect(
          result.settlements[0]
        ).toMatchObject({
          id:
            settlement.id,
          invoiceId:
            invoice.id,
          provider:
            MerchantSettlementProvider.TELEBIRR,
          status:
            MerchantSettlementStatus.REVIEW_REQUIRED,
          amount:
            "550",
          currency:
            "ETB",
          transactionReference:
            "DAY17-SETTLEMENT-TXN-review-required",
          receiptUrl:
            "https://example.test/review-required.jpg",
          hasReceiptEvidence:
            true,
          reviewNote:
            null,
          verifiedAt:
            null
        });

        expect(
          result.settlements[0]
            ?.submittedAt
        ).toBeInstanceOf(
          Date
        );
      }
    );

    it(
      "reports private object evidence without exposing a public receipt URL",
      async () => {
        const merchant =
          await createMerchant(
            "private-evidence"
          );

        const invoice =
          await createInvoice(
            merchant.id,
            "private-evidence",
            1
          );

        const settlement =
          await submitMerchantSettlement({
            merchantId:
              merchant.id,
            invoiceId:
              invoice.id,
            provider:
              MerchantSettlementProvider.TELEBIRR,
            amount:
              new Prisma.Decimal(
                "550.00"
              ),
            currency:
              "ETB",
            idempotencyKey:
              "day17-settlement-private-evidence",
            transactionReference:
              "DAY17-SETTLEMENT-TXN-PRIVATE-EVIDENCE",
            receiptUrl:
              null,
            receiptMetadata: {
              objectKey:
                `merchants/${merchant.id}/settlements/private-evidence.png`
            }
          });

        const result =
          await getMerchantSettlementHistory(
            merchant.id
          );

        const historySettlement =
          result.settlements.find(
            (candidate) =>
              candidate.id ===
              settlement.id
          );

        expect(
          historySettlement
        ).toBeDefined();

        expect(
          historySettlement
            ?.receiptUrl
        ).toBeNull();

        expect(
          historySettlement
            ?.hasReceiptEvidence
        ).toBe(true);

        expect(
          historySettlement
        ).not.toHaveProperty(
          "receiptMetadata"
        );

        expect(
          historySettlement
        ).not.toHaveProperty(
          "objectKey"
        );
      }
    );

    it(
      "reports no receipt evidence when a settlement has transaction-reference evidence only",
      async () => {
        const merchant =
          await createMerchant(
            "reference-only"
          );

        const invoice =
          await createInvoice(
            merchant.id,
            "reference-only",
            1
          );

        const settlement =
          await submitMerchantSettlement({
            merchantId:
              merchant.id,
            invoiceId:
              invoice.id,
            provider:
              MerchantSettlementProvider.TELEBIRR,
            amount:
              new Prisma.Decimal(
                "550.00"
              ),
            currency:
              "ETB",
            idempotencyKey:
              "day17-settlement-reference-only",
            transactionReference:
              "DAY17-SETTLEMENT-TXN-REFERENCE-ONLY",
            receiptUrl:
              null
          });

        const result =
          await getMerchantSettlementHistory(
            merchant.id
          );

        const historySettlement =
          result.settlements.find(
            (candidate) =>
              candidate.id ===
              settlement.id
          );

        expect(
          historySettlement
            ?.receiptUrl
        ).toBeNull();

        expect(
          historySettlement
            ?.hasReceiptEvidence
        ).toBe(false);
      }
    );

    it(
      "returns VERIFIED and REJECTED lifecycle state unchanged",
      async () => {
        const merchant =
          await createMerchant(
            "reviewed"
          );

        const verifiedInvoice =
          await createInvoice(
            merchant.id,
            "verified",
            1
          );

        const rejectedInvoice =
          await createInvoice(
            merchant.id,
            "rejected",
            2
          );

        const verifiedSubmission =
          await submitFixture(
            merchant.id,
            verifiedInvoice.id,
            "verified"
          );

        const rejectedSubmission =
          await submitFixture(
            merchant.id,
            rejectedInvoice.id,
            "rejected",
            MerchantSettlementProvider.CBE_BIRR
          );

        await verifyMerchantSettlement({
          merchantId:
            merchant.id,
          settlementId:
            verifiedSubmission.id,
          reviewNote:
            "Platform confirmed payment"
        });

        await rejectMerchantSettlement({
          merchantId:
            merchant.id,
          settlementId:
            rejectedSubmission.id,
          reviewNote:
            "Reference could not be confirmed"
        });

        const result =
          await getMerchantSettlementHistory(
            merchant.id
          );

        const verified =
          result.settlements.find(
            (settlement) =>
              settlement.id ===
              verifiedSubmission.id
          );

        const rejected =
          result.settlements.find(
            (settlement) =>
              settlement.id ===
              rejectedSubmission.id
          );

        expect(
          verified
        ).toMatchObject({
          invoiceId:
            verifiedInvoice.id,
          status:
            MerchantSettlementStatus.VERIFIED,
          amount:
            "550",
          currency:
            "ETB",
          reviewNote:
            "Platform confirmed payment"
        });

        expect(
          verified?.verifiedAt
        ).toBeInstanceOf(
          Date
        );

        expect(
          rejected
        ).toMatchObject({
          invoiceId:
            rejectedInvoice.id,
          provider:
            MerchantSettlementProvider.CBE_BIRR,
          status:
            MerchantSettlementStatus.REJECTED,
          amount:
            "550",
          currency:
            "ETB",
          reviewNote:
            "Reference could not be confirmed",
          verifiedAt:
            null
        });

        const paidInvoice =
          await prisma.merchantInvoice
            .findUniqueOrThrow({
              where: {
                id:
                  verifiedInvoice.id
              }
            });

        const stillOpenInvoice =
          await prisma.merchantInvoice
            .findUniqueOrThrow({
              where: {
                id:
                  rejectedInvoice.id
              }
            });

        expect(
          paidInvoice.status
        ).toBe(
          MerchantInvoiceStatus.PAID
        );

        expect(
          stillOpenInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );
      }
    );

    it(
      "returns newest submitted settlements first",
      async () => {
        const merchant =
          await createMerchant(
            "ordering"
          );

        const olderInvoice =
          await createInvoice(
            merchant.id,
            "ordering-older",
            1
          );

        const newerInvoice =
          await createInvoice(
            merchant.id,
            "ordering-newer",
            2
          );

        const older =
          await submitFixture(
            merchant.id,
            olderInvoice.id,
            "ordering-older"
          );

        const newer =
          await submitFixture(
            merchant.id,
            newerInvoice.id,
            "ordering-newer"
          );

        await prisma.merchantSettlement.update({
          where: {
            id:
              older.id
          },
          data: {
            submittedAt:
              new Date(
                "2026-09-10T10:00:00.000Z"
              )
          }
        });

        await prisma.merchantSettlement.update({
          where: {
            id:
              newer.id
          },
          data: {
            submittedAt:
              new Date(
                "2026-09-11T10:00:00.000Z"
              )
          }
        });

        const result =
          await getMerchantSettlementHistory(
            merchant.id
          );

        expect(
          result.settlements.map(
            (settlement) =>
              settlement.id
          )
        ).toEqual([
          newer.id,
          older.id
        ]);
      }
    );

    it(
      "isolates settlement history by merchant",
      async () => {
        const firstMerchant =
          await createMerchant(
            "isolation-a"
          );

        const secondMerchant =
          await createMerchant(
            "isolation-b"
          );

        const firstInvoice =
          await createInvoice(
            firstMerchant.id,
            "isolation-a",
            1
          );

        const secondInvoice =
          await createInvoice(
            secondMerchant.id,
            "isolation-b",
            1
          );

        const firstSettlement =
          await submitFixture(
            firstMerchant.id,
            firstInvoice.id,
            "isolation-a"
          );

        const secondSettlement =
          await submitFixture(
            secondMerchant.id,
            secondInvoice.id,
            "isolation-b"
          );

        const result =
          await getMerchantSettlementHistory(
            firstMerchant.id
          );

        expect(
          result.settlements.map(
            (settlement) =>
              settlement.id
          )
        ).toEqual([
          firstSettlement.id
        ]);

        expect(
          result.settlements.some(
            (settlement) =>
              settlement.id ===
              secondSettlement.id
          )
        ).toBe(
          false
        );
      }
    );
  }
);
