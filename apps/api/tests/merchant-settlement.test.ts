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
  submitMerchantSettlement
} from "../src/services/merchant-settlement.js";

const testPrefix =
  "day15-settlement-submission";

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

async function createFixture(
  suffix: string,
  status:
    MerchantInvoiceStatus =
      MerchantInvoiceStatus.OPEN
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
          `INV-SETTLEMENT-${suffix}`,
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

function baseInput(
  fixture:
    Awaited<
      ReturnType<
        typeof createFixture
      >
    >,
  suffix: string
) {
  return {
    merchantId:
      fixture.merchant.id,
    invoiceId:
      fixture.invoice.id,
    provider:
      MerchantSettlementProvider.TELEBIRR,
    amount:
      new Prisma.Decimal(
        "550.00"
      ),
    currency:
      "ETB",
    idempotencyKey:
      `settlement-${suffix}`
  };
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
  "merchant settlement submission",
  () => {
    it(
      "creates REVIEW_REQUIRED settlement from transaction reference evidence",
      async () => {
        const fixture =
          await createFixture(
            "reference"
          );

        const settlement =
          await submitMerchantSettlement({
            ...baseInput(
              fixture,
              "reference"
            ),
            transactionReference:
              "TX-REFERENCE-001"
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus
            .REVIEW_REQUIRED
        );

        expect(
          settlement.transactionReference
        ).toBe(
          "TX-REFERENCE-001"
        );

        expect(
          settlement.receiptUrl
        ).toBeNull();

        expect(
          settlement.verifiedAt
        ).toBeNull();
      }
    );

    it(
      "creates REVIEW_REQUIRED settlement from receipt-only evidence",
      async () => {
        const fixture =
          await createFixture(
            "receipt"
          );

        const settlement =
          await submitMerchantSettlement({
            ...baseInput(
              fixture,
              "receipt"
            ),
            receiptUrl:
              "https://example.test/settlement-receipt.jpg"
          });

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus
            .REVIEW_REQUIRED
        );

        expect(
          settlement.transactionReference
        ).toBeNull();

        expect(
          settlement.receiptUrl
        ).toBe(
          "https://example.test/settlement-receipt.jpg"
        );
      }
    );

    it(
      "allows both transaction reference and receipt evidence",
      async () => {
        const fixture =
          await createFixture(
            "both"
          );

        const settlement =
          await submitMerchantSettlement({
            ...baseInput(
              fixture,
              "both"
            ),
            transactionReference:
              "TX-BOTH-001",
            receiptUrl:
              "https://example.test/both.jpg",
            receiptMetadata: {
              source:
                "merchant-upload"
            }
          });

        expect(
          settlement.transactionReference
        ).toBe(
          "TX-BOTH-001"
        );

        expect(
          settlement.receiptUrl
        ).toBe(
          "https://example.test/both.jpg"
        );
      }
    );

    it(
      "rejects submission without payment evidence",
      async () => {
        const fixture =
          await createFixture(
            "no-evidence"
          );

        await expect(
          submitMerchantSettlement({
            ...baseInput(
              fixture,
              "no-evidence"
            )
          })
        ).rejects.toThrow(
          "Merchant settlement requires a transaction reference or receipt"
        );

        expect(
          await prisma
            .merchantSettlement
            .count({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            })
        ).toBe(0);
      }
    );

    it.each([
      MerchantInvoiceStatus.DRAFT,
      MerchantInvoiceStatus.PAID,
      MerchantInvoiceStatus.OVERDUE,
      MerchantInvoiceStatus.VOID
    ])(
      "rejects submission for %s invoice",
      async (status) => {
        const fixture =
          await createFixture(
            `status-${status}`,
            status
          );

        await expect(
          submitMerchantSettlement({
            ...baseInput(
              fixture,
              `status-${status}`
            ),
            transactionReference:
              `TX-${status}`
          })
        ).rejects.toThrow(
          "Merchant settlement can only be submitted for an open invoice"
        );

        expect(
          await prisma
            .merchantSettlement
            .count({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            })
        ).toBe(0);
      }
    );

    it(
      "rejects cross-merchant invoice access",
      async () => {
        const owner =
          await createFixture(
            "owner"
          );

        const other =
          await createFixture(
            "other"
          );

        await expect(
          submitMerchantSettlement({
            ...baseInput(
              owner,
              "cross"
            ),
            merchantId:
              other.merchant.id,
            transactionReference:
              "TX-CROSS-001"
          })
        ).rejects.toThrow(
          "Merchant invoice not found"
        );

        expect(
      await prisma.merchantSettlement.count({
        where: {
          merchantId:
            other.merchant.id
        }
      })
    ).toBe(0);
      }
    );

    it(
      "rejects amount mismatch",
      async () => {
        const fixture =
          await createFixture(
            "amount"
          );

        await expect(
          submitMerchantSettlement({
            ...baseInput(
              fixture,
              "amount"
            ),
            amount:
              new Prisma.Decimal(
                "500.00"
              ),
            transactionReference:
              "TX-AMOUNT-001"
          })
        ).rejects.toThrow(
          "Merchant settlement amount does not match invoice total"
        );
      }
    );

    it(
      "rejects nonpositive amount",
      async () => {
        const fixture =
          await createFixture(
            "nonpositive"
          );

        await expect(
          submitMerchantSettlement({
            ...baseInput(
              fixture,
              "nonpositive"
            ),
            amount:
              new Prisma.Decimal(
                "0.00"
              ),
            transactionReference:
              "TX-ZERO-001"
          })
        ).rejects.toThrow(
          "Merchant settlement amount must be greater than zero"
        );
      }
    );

    it(
      "normalizes currency and rejects actual currency mismatch",
      async () => {
        const fixture =
          await createFixture(
            "currency"
          );

        const normalized =
          await submitMerchantSettlement({
            ...baseInput(
              fixture,
              "currency-normalized"
            ),
            currency:
              " etb ",
            transactionReference:
              "TX-CURRENCY-OK"
          });

        expect(
          normalized.currency
        ).toBe(
          "ETB"
        );

        await expect(
          submitMerchantSettlement({
            ...baseInput(
              fixture,
              "currency-bad"
            ),
            currency:
              "USD",
            transactionReference:
              "TX-CURRENCY-BAD"
          })
        ).rejects.toThrow(
          "Merchant settlement currency does not match invoice currency"
        );
      }
    );

    it(
      "replays identical idempotency key without creating another settlement or audit",
      async () => {
        const fixture =
          await createFixture(
            "replay"
          );

        const input = {
          ...baseInput(
            fixture,
            "replay"
          ),
          transactionReference:
            "TX-REPLAY-001",
          actorUserId:
            "day15-merchant-actor"
        };

        const first =
          await submitMerchantSettlement(
            input
          );

        const second =
          await submitMerchantSettlement(
            input
          );

        expect(
          second.id
        ).toBe(
          first.id
        );

        expect(
          await prisma
            .merchantSettlement
            .count({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            })
        ).toBe(1);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_SUBMITTED"
            }
          })
        ).toBe(1);
      }
    );

    it(
      "rejects reuse of idempotency key for different instruction",
      async () => {
        const fixture =
          await createFixture(
            "idempotency-conflict"
          );

        const input = {
          ...baseInput(
            fixture,
            "conflict"
          ),
          transactionReference:
            "TX-CONFLICT-001"
        };

        await submitMerchantSettlement(
          input
        );

        await expect(
          submitMerchantSettlement({
            ...input,
            transactionReference:
              "TX-CONFLICT-002"
          })
        ).rejects.toThrow(
          "Merchant settlement idempotency key was already used for a different instruction"
        );

        expect(
          await prisma
            .merchantSettlement
            .count({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            })
        ).toBe(1);
      }
    );

    it(
      "rejects duplicate provider transaction reference under a different idempotency key",
      async () => {
        const fixture =
          await createFixture(
            "duplicate-reference"
          );

        await submitMerchantSettlement({
          ...baseInput(
            fixture,
            "duplicate-reference-a"
          ),
          transactionReference:
            "TX-DUPLICATE-001"
        });

        await expect(
          submitMerchantSettlement({
            ...baseInput(
              fixture,
              "duplicate-reference-b"
            ),
            transactionReference:
              "TX-DUPLICATE-001"
          })
        ).rejects.toThrow(
          "Merchant settlement transaction reference has already been submitted"
        );

        expect(
          await prisma
            .merchantSettlement
            .count({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            })
        ).toBe(1);
      }
    );

    it(
      "allows only one settlement and one audit for concurrent identical submission",
      async () => {
        const fixture =
          await createFixture(
            "concurrent"
          );

        const input = {
          ...baseInput(
            fixture,
            "concurrent"
          ),
          transactionReference:
            "TX-CONCURRENT-001",
          actorUserId:
            "day15-concurrent-actor"
        };

        const results =
          await Promise.all([
            submitMerchantSettlement(
              input
            ),
            submitMerchantSettlement(
              input
            )
          ]);

        expect(
          results[0].id
        ).toBe(
          results[1].id
        );

        expect(
          await prisma
            .merchantSettlement
            .count({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            })
        ).toBe(1);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_SUBMITTED"
            }
          })
        ).toBe(1);
      }
    );

    it(
      "creates SETTLEMENT_SUBMITTED audit with merchant actor attribution",
      async () => {
        const fixture =
          await createFixture(
            "audit"
          );

        const settlement =
          await submitMerchantSettlement({
            ...baseInput(
              fixture,
              "audit"
            ),
            transactionReference:
              "TX-AUDIT-001",
            actorUserId:
              "day15-test-merchant-user"
          });

        const audit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_SUBMITTED",
              entityType:
                "MERCHANT_SETTLEMENT",
              entityId:
                settlement.id
            }
          });

        expect(
          audit
        ).not.toBeNull();

        expect(
          audit?.actorUserId
        ).toBe(
          "day15-test-merchant-user"
        );

        expect(
          audit?.metadata
        ).toMatchObject({
          invoiceId:
            fixture.invoice.id,
          provider:
            MerchantSettlementProvider
              .TELEBIRR,
          status:
            MerchantSettlementStatus
              .REVIEW_REQUIRED,
          amount:
            "550",
          currency:
            "ETB"
        });
      }
    );

    it(
      "does not verify settlement or pay invoice when evidence is submitted",
      async () => {
        const fixture =
          await createFixture(
            "authorization-boundary"
          );

        const settlement =
          await submitMerchantSettlement({
            ...baseInput(
              fixture,
              "authorization-boundary"
            ),
            transactionReference:
              "TX-BOUNDARY-001",
            receiptUrl:
              "https://example.test/boundary.jpg"
          });

        const [
          storedSettlement,
          invoice
        ] =
          await Promise.all([
            prisma.merchantSettlement
              .findUnique({
                where: {
                  id:
                    settlement.id
                }
              }),
            prisma.merchantInvoice
              .findUnique({
                where: {
                  id:
                    fixture.invoice.id
                }
              })
          ]);

        expect(
          storedSettlement?.status
        ).toBe(
          MerchantSettlementStatus
            .REVIEW_REQUIRED
        );

        expect(
          storedSettlement?.verifiedAt
        ).toBeNull();

        expect(
          invoice?.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice?.paidAt
        ).toBeNull();
      }
    );
  }
);
