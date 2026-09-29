import {
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
  rejectMerchantSettlement,
  verifyMerchantSettlement
} from "../src/services/merchant-settlement-review.js";

const testPrefix =
  "day15-settlement-review";

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

    await prisma.auditLog.deleteMany({
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
  invoiceStatus:
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

  const invoice =
    await prisma.merchantInvoice.create({
      data: {
        merchantId:
          merchant.id,
        invoiceNumber:
          `INV-REVIEW-${suffix}`,
        periodStart:
          new Date(
            "2026-09-01T00:00:00.000Z"
          ),
        periodEnd:
          new Date(
            "2026-10-01T00:00:00.000Z"
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
          invoiceStatus,
        openedAt:
          invoiceStatus ===
          MerchantInvoiceStatus.DRAFT
            ? null
            : new Date(
                "2026-10-01T00:00:00.000Z"
              ),
        paidAt:
          invoiceStatus ===
          MerchantInvoiceStatus.PAID
            ? new Date(
                "2026-10-02T00:00:00.000Z"
              )
            : null
      }
    });

  const settlement =
    await prisma.merchantSettlement.create({
      data: {
        merchantId:
          merchant.id,
        invoiceId:
          invoice.id,
        provider:
          MerchantSettlementProvider
            .TELEBIRR,
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
          `review-${suffix}`,
        transactionReference:
          `TX-REVIEW-${suffix}`
      }
    });

  return {
    merchant,
    invoice,
    settlement
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

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe(
  "merchant settlement trusted review",
  () => {
    it(
      "verifies settlement and pays invoice atomically",
      async () => {
        const fixture =
          await createFixture(
            "verify"
          );

        const result =
          await verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Platform confirmed payment"
          });

        expect(
          result.settlement.status
        ).toBe(
          MerchantSettlementStatus.VERIFIED
        );

        expect(
          result.settlement.verifiedAt
        ).not.toBeNull();

        expect(
          result.invoice.status
        ).toBe(
          MerchantInvoiceStatus.PAID
        );

        expect(
          result.invoice.paidAt
        ).not.toBeNull();

        expect(
          result.invoice.paidAt
            ?.getTime()
        ).toBe(
          result.settlement.verifiedAt
            ?.getTime()
        );
      }
    );

    it(
      "creates platform-side verification and invoice-paid audits",
      async () => {
        const fixture =
          await createFixture(
            "verify-audit"
          );

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id
        });

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id
            },
            orderBy: {
              createdAt:
                "asc"
            }
          });

        expect(
          audits
        ).toHaveLength(2);

        expect(
          audits.map(
            (audit) =>
              audit.action
          )
        ).toEqual([
          "SETTLEMENT_VERIFIED",
          "INVOICE_PAID"
        ]);

        expect(
          audits.every(
            (audit) =>
              audit.actorUserId ===
              null
          )
        ).toBe(true);

        expect(
          audits.every(
            (audit) =>
              (
                audit.metadata as
                  | {
                      authority?: string;
                    }
                  | null
              )?.authority ===
              "PLATFORM_INTERNAL"
          )
        ).toBe(true);
      }
    );

    it(
      "rejects settlement while leaving invoice open",
      async () => {
        const fixture =
          await createFixture(
            "reject"
          );

        const result =
          await rejectMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Reference could not be confirmed"
          });

        expect(
          result.settlement.status
        ).toBe(
          MerchantSettlementStatus.REJECTED
        );

        expect(
          result.settlement.verifiedAt
        ).toBeNull();

        expect(
          result.settlement.reviewNote
        ).toBe(
          "Reference could not be confirmed"
        );

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "creates only a settlement rejection audit",
      async () => {
        const fixture =
          await createFixture(
            "reject-audit"
          );

        await rejectMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id
        });

        const audits =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          audits
        ).toHaveLength(1);

        expect(
          audits[0]?.action
        ).toBe(
          "SETTLEMENT_REJECTED"
        );

        expect(
          audits[0]?.actorUserId
        ).toBeNull();
      }
    );

    it(
      "rejects cross-merchant verification",
      async () => {
        const owner =
          await createFixture(
            "cross-owner"
          );

        const other =
          await createFixture(
            "cross-other"
          );

        await expect(
          verifyMerchantSettlement({
            merchantId:
              other.merchant.id,
            settlementId:
              owner.settlement.id
          })
        ).rejects.toThrow(
          "Merchant settlement not found"
        );

        const stored =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                owner.settlement.id
            }
          });

        expect(
          stored.status
        ).toBe(
          MerchantSettlementStatus
            .REVIEW_REQUIRED
        );
      }
    );

    it(
      "rejects cross-merchant rejection",
      async () => {
        const owner =
          await createFixture(
            "cross-reject-owner"
          );

        const other =
          await createFixture(
            "cross-reject-other"
          );

        await expect(
          rejectMerchantSettlement({
            merchantId:
              other.merchant.id,
            settlementId:
              owner.settlement.id
          })
        ).rejects.toThrow(
          "Merchant settlement not found"
        );

        const stored =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                owner.settlement.id
            }
          });

        expect(
          stored.status
        ).toBe(
          MerchantSettlementStatus
            .REVIEW_REQUIRED
        );
      }
    );

    it(
      "cannot verify a settlement twice",
      async () => {
        const fixture =
          await createFixture(
            "double-verify"
          );

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id
        });

        await expect(
          verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id
          })
        ).rejects.toThrow(
          "Only settlements requiring review can be verified"
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_VERIFIED"
            }
          })
        ).toBe(1);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_PAID"
            }
          })
        ).toBe(1);
      }
    );

    it(
      "cannot reject an already verified settlement",
      async () => {
        const fixture =
          await createFixture(
            "reject-after-verify"
          );

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id
        });

        await expect(
          rejectMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id
          })
        ).rejects.toThrow(
          "Only settlements requiring review can be rejected"
        );
      }
    );

    it(
      "cannot verify an already rejected settlement",
      async () => {
        const fixture =
          await createFixture(
            "verify-after-reject"
          );

        await rejectMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id
        });

        await expect(
          verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id
          })
        ).rejects.toThrow(
          "Only settlements requiring review can be verified"
        );
      }
    );

    it(
      "rejects verification if invoice is not open",
      async () => {
        const fixture =
          await createFixture(
            "paid-invoice",
            MerchantInvoiceStatus.PAID
          );

        await expect(
          verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id
          })
        ).rejects.toThrow(
          "Merchant settlement can only be verified for an open or overdue invoice"
        );

        const stored =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                fixture.settlement.id
            }
          });

        expect(
          stored.status
        ).toBe(
          MerchantSettlementStatus
            .REVIEW_REQUIRED
        );
      }
    );

    it(
      "reconciles amount again at verification time",
      async () => {
        const fixture =
          await createFixture(
            "amount-reconcile"
          );

        await prisma.merchantSettlement.update({
          where: {
            id:
              fixture.settlement.id
          },
          data: {
            amount:
              new Prisma.Decimal(
                "500.00"
              )
          }
        });

        await expect(
          verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id
          })
        ).rejects.toThrow(
          "Merchant settlement amount does not match invoice total"
        );

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          invoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "reconciles currency again at verification time",
      async () => {
        const fixture =
          await createFixture(
            "currency-reconcile"
          );

        await prisma.merchantSettlement.update({
          where: {
            id:
              fixture.settlement.id
          },
          data: {
            currency:
              "USD"
          }
        });

        await expect(
          verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id
          })
        ).rejects.toThrow(
          "Merchant settlement currency does not match invoice currency"
        );

        const invoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );
      }
    );

    it(
      "allows only one of two concurrent verifications to succeed",
      async () => {
        const fixture =
          await createFixture(
            "concurrent-verify"
          );

        const results =
          await Promise.allSettled([
            verifyMerchantSettlement({
              merchantId:
                fixture.merchant.id,
              settlementId:
                fixture.settlement.id
            }),
            verifyMerchantSettlement({
              merchantId:
                fixture.merchant.id,
              settlementId:
                fixture.settlement.id
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
        ).toHaveLength(1);

        expect(
          rejected
        ).toHaveLength(1);

        const [
          settlement,
          invoice
        ] =
          await Promise.all([
            prisma.merchantSettlement
              .findUniqueOrThrow({
                where: {
                  id:
                    fixture.settlement.id
                }
              }),
            prisma.merchantInvoice
              .findUniqueOrThrow({
                where: {
                  id:
                    fixture.invoice.id
                }
              })
          ]);

        expect(
          settlement.status
        ).toBe(
          MerchantSettlementStatus.VERIFIED
        );

        expect(
          invoice.status
        ).toBe(
          MerchantInvoiceStatus.PAID
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_VERIFIED"
            }
          })
        ).toBe(1);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_PAID"
            }
          })
        ).toBe(1);
      }
    );

    it(
      "only one settlement can pay an invoice",
      async () => {
        const fixture =
          await createFixture(
            "two-settlements"
          );

        const second =
          await prisma.merchantSettlement.create({
            data: {
              merchantId:
                fixture.merchant.id,
              invoiceId:
                fixture.invoice.id,
              provider:
                MerchantSettlementProvider
                  .CBE_BIRR,
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
                "review-two-settlements-second",
              transactionReference:
                "TX-REVIEW-TWO-SECOND"
            }
          });

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id
        });

        await expect(
          verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              second.id
          })
        ).rejects.toThrow(
          "Merchant settlement can only be verified for an open or overdue invoice"
        );

        const storedSecond =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                second.id
            }
          });

        expect(
          storedSecond.status
        ).toBe(
          MerchantSettlementStatus
            .REVIEW_REQUIRED
        );
      }
    );

    it(
      "attributes platform-admin settlement verification",
      async () => {
        const fixture =
          await createFixture(
            "platform-verify"
          );

        const platformUser =
          await createPlatformUser(
            "verify"
          );

        const result =
          await verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Platform administrator verified settlement",
            actorPlatformUserId:
              platformUser.id
          });

        expect(
          result.settlement.status
        ).toBe(
          MerchantSettlementStatus.VERIFIED
        );

        expect(
          result.invoice.status
        ).toBe(
          MerchantInvoiceStatus.PAID
        );

        const platformAudits =
          await prisma.platformAuditLog.findMany({
            where: {
              actorPlatformUserId:
                platformUser.id,
              merchantId:
                fixture.merchant.id
            }
          });

        const actions =
          platformAudits
            .map(
              (audit) =>
                audit.action
            )
            .sort();

        expect(actions).toEqual(
          [
            "MERCHANT_INVOICE_PAID",
            "MERCHANT_SETTLEMENT_VERIFIED"
          ].sort()
        );
      }
    );

    it(
      "rolls back settlement verification when platform audit fails",
      async () => {
        const fixture =
          await createFixture(
            "platform-verify-rollback"
          );

        await expect(
          verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Platform verification rollback test",
            actorPlatformUserId:
              "nonexistent-platform-user"
          })
        ).rejects.toThrow();

        const storedSettlement =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                fixture.settlement.id
            }
          });

        const storedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          storedSettlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          storedSettlement.verifiedAt
        ).toBeNull();

        expect(
          storedInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          storedInvoice.paidAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action: {
                in: [
                  "SETTLEMENT_VERIFIED",
                  "INVOICE_PAID"
                ]
              }
            }
          })
        ).toBe(
          0
        );

        expect(
          await prisma.platformAuditLog.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(
          0
        );
      }
    );

    it(
      "attributes platform-admin settlement rejection",
      async () => {
        const fixture =
          await createFixture(
            "platform-reject"
          );

        const platformUser =
          await createPlatformUser(
            "reject"
          );

        const result =
          await rejectMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Platform administrator rejected settlement",
            actorPlatformUserId:
              platformUser.id
          });

        expect(
          result.settlement.status
        ).toBe(
          MerchantSettlementStatus.REJECTED
        );

        expect(
          result.invoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        const platformAudit =
          await prisma.platformAuditLog.findFirst({
            where: {
              actorPlatformUserId:
                platformUser.id,
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_SETTLEMENT_REJECTED",
              entityType:
                "MERCHANT_SETTLEMENT",
              entityId:
                fixture.settlement.id
            }
          });

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
      "rolls back settlement rejection when platform audit fails",
      async () => {
        const fixture =
          await createFixture(
            "platform-reject-rollback"
          );

        await expect(
          rejectMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Platform rejection rollback test",
            actorPlatformUserId:
              "nonexistent-platform-user"
          })
        ).rejects.toThrow();

        const storedSettlement =
          await prisma.merchantSettlement.findUniqueOrThrow({
            where: {
              id:
                fixture.settlement.id
            }
          });

        const storedInvoice =
          await prisma.merchantInvoice.findUniqueOrThrow({
            where: {
              id:
                fixture.invoice.id
            }
          });

        expect(
          storedSettlement.status
        ).toBe(
          MerchantSettlementStatus.REVIEW_REQUIRED
        );

        expect(
          storedInvoice.status
        ).toBe(
          MerchantInvoiceStatus.OPEN
        );

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SETTLEMENT_REJECTED"
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
                "MERCHANT_SETTLEMENT_REJECTED"
            }
          })
        ).toBe(
          0
        );
      }
    );

    it(
      "verifies settlement for an OVERDUE invoice and pays the invoice",
      async () => {
        const fixture =
          await createFixture(
            "verify-overdue",
            MerchantInvoiceStatus.OVERDUE
          );

        const result =
          await verifyMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Platform confirmed overdue invoice payment"
          });

        expect(
          result.settlement.status
        ).toBe(
          MerchantSettlementStatus.VERIFIED
        );

        expect(
          result.settlement.verifiedAt
        ).not.toBeNull();

        expect(
          result.invoice.status
        ).toBe(
          MerchantInvoiceStatus.PAID
        );

        expect(
          result.invoice.paidAt
        ).not.toBeNull();

        expect(
          result.invoice.paidAt
            ?.getTime()
        ).toBe(
          result.settlement.verifiedAt
            ?.getTime()
        );
      }
    );

    it(
      "recovers a PAST_DUE subscription to ACTIVE when its overdue invoice is paid",
      async () => {
        const fixture =
          await createFixture(
            "verify-overdue-recovery",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-verify-overdue-recovery`,
              name:
                "Settlement Recovery Plan",
              monthlyPrice:
                new Prisma.Decimal(
                  "500.00"
                ),
              annualPrice:
                new Prisma.Decimal(
                  "5000.00"
                ),
              currency:
                "ETB",
              commissionRate:
                new Prisma.Decimal(
                  "0.035000"
                ),
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
              new Prisma.Decimal(
                "500.00"
              ),
            commissionRateSnapshot:
              new Prisma.Decimal(
                "0.035000"
              ),
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

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id,
          reviewNote:
            "Platform confirmed overdue invoice payment"
        });

        const subscription =
          await prisma.merchantSubscription.findUniqueOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription.status
        ).toBe(
          MerchantSubscriptionStatus.ACTIVE
        );

        const subscriptionAuditLogs =
          await prisma.auditLog.findMany({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "SUBSCRIPTION_STATUS_CHANGED",
              entityType:
                "MERCHANT_SUBSCRIPTION",
              entityId:
                subscription.id
            }
          });

        expect(
          subscriptionAuditLogs
        ).toHaveLength(1);

        expect(
          subscriptionAuditLogs[0]?.metadata
        ).toMatchObject({
          previousStatus:
            MerchantSubscriptionStatus.PAST_DUE,
          nextStatus:
            MerchantSubscriptionStatus.ACTIVE
        });
      }
    );

    it(
      "keeps a PAST_DUE subscription when another overdue invoice remains",
      async () => {
        const fixture =
          await createFixture(
            "verify-overdue-still-delinquent",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-still-due`,
              name:
                "Settlement Delinquency Plan",
              monthlyPrice:
                new Prisma.Decimal(
                  "500.00"
                ),
              annualPrice:
                new Prisma.Decimal(
                  "5000.00"
                ),
              currency:
                "ETB",
              commissionRate:
                new Prisma.Decimal(
                  "0.035000"
                ),
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
              new Prisma.Decimal(
                "500.00"
              ),
            commissionRateSnapshot:
              new Prisma.Decimal(
                "0.035000"
              ),
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

        await prisma.merchantInvoice.create({
          data: {
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-REVIEW-VERIFY-OVERDUE-STILL-DELINQUENT-OTHER",
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
              )
          }
        });

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id,
          reviewNote:
            "Platform confirmed one overdue invoice payment"
        });

        const subscription =
          await prisma.merchantSubscription.findUniqueOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription.status
        ).toBe(
          MerchantSubscriptionStatus.PAST_DUE
        );
      }
    );

    it(
      "keeps a PAST_DUE subscription when another open invoice is already past due",
      async () => {
        const fixture =
          await createFixture(
            "verify-overdue-open-past-due",
            MerchantInvoiceStatus.OVERDUE
          );

        const plan =
          await prisma.subscriptionPlan.create({
            data: {
              code:
                `${testPrefix}-open-due`,
              name:
                "Settlement Open Delinquency Plan",
              monthlyPrice:
                new Prisma.Decimal(
                  "500.00"
                ),
              annualPrice:
                new Prisma.Decimal(
                  "5000.00"
                ),
              currency:
                "ETB",
              commissionRate:
                new Prisma.Decimal(
                  "0.035000"
                ),
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
              new Prisma.Decimal(
                "500.00"
              ),
            commissionRateSnapshot:
              new Prisma.Decimal(
                "0.035000"
              ),
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

        await prisma.merchantInvoice.create({
          data: {
            merchantId:
              fixture.merchant.id,
            invoiceNumber:
              "INV-REVIEW-OPEN-PAST-DUE-OTHER",
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
              MerchantInvoiceStatus.OPEN,
            openedAt:
              new Date(
                "2026-09-01T00:00:00.000Z"
              ),
            dueAt:
              new Date(
                "2026-09-08T00:00:00.000Z"
              )
          }
        });

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id,
          reviewNote:
            "Platform confirmed one overdue invoice payment"
        });

        const subscription =
          await prisma.merchantSubscription.findUniqueOrThrow({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(
          subscription.status
        ).toBe(
          MerchantSubscriptionStatus.PAST_DUE
        );
      }
    );

    it(
      "rejects settlement for an OVERDUE invoice while leaving it OVERDUE",
      async () => {
        const fixture =
          await createFixture(
            "reject-overdue",
            MerchantInvoiceStatus.OVERDUE
          );

        const result =
          await rejectMerchantSettlement({
            merchantId:
              fixture.merchant.id,
            settlementId:
              fixture.settlement.id,
            reviewNote:
              "Platform rejected overdue invoice payment"
          });

        expect(
          result.settlement.status
        ).toBe(
          MerchantSettlementStatus.REJECTED
        );

        expect(
          result.invoice.status
        ).toBe(
          MerchantInvoiceStatus.OVERDUE
        );

        expect(
          result.invoice.paidAt
        ).toBeNull();
      }
    );

    it(
      "records OVERDUE as the previous invoice status when verification pays an overdue invoice",
      async () => {
        const fixture =
          await createFixture(
            "verify-overdue-audit",
            MerchantInvoiceStatus.OVERDUE
          );

        const platformUser =
          await createPlatformUser(
            "verify-overdue-audit"
          );

        await verifyMerchantSettlement({
          merchantId:
            fixture.merchant.id,
          settlementId:
            fixture.settlement.id,
          reviewNote:
            "Platform confirmed overdue invoice payment",
          actorPlatformUserId:
            platformUser.id
        });

        const merchantAudit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              action:
                "INVOICE_PAID",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          merchantAudit
        ).not.toBeNull();

        expect(
          merchantAudit?.metadata
        ).toMatchObject({
          settlementId:
            fixture.settlement.id,
          previousStatus:
            MerchantInvoiceStatus.OVERDUE,
          nextStatus:
            MerchantInvoiceStatus.PAID
        });

        const platformAudit =
          await prisma.platformAuditLog.findFirst({
            where: {
              actorPlatformUserId:
                platformUser.id,
              merchantId:
                fixture.merchant.id,
              action:
                "MERCHANT_INVOICE_PAID",
              entityType:
                "MERCHANT_INVOICE",
              entityId:
                fixture.invoice.id
            }
          });

        expect(
          platformAudit
        ).not.toBeNull();

        expect(
          platformAudit?.metadata
        ).toMatchObject({
          settlementId:
            fixture.settlement.id,
          previousStatus:
            MerchantInvoiceStatus.OVERDUE,
          nextStatus:
            MerchantInvoiceStatus.PAID
        });
      }
    );
  }
);
