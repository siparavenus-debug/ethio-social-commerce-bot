import {
  MerchantInvoiceStatus,
  MerchantSettlementStatus,
  Prisma,
  prisma
} from "@ethio-commerce/database";

export type VerifyMerchantSettlementInput = {
  merchantId: string;
  settlementId: string;
  reviewNote?: string | null;
  actorPlatformUserId?: string | null;
};

export type RejectMerchantSettlementInput = {
  merchantId: string;
  settlementId: string;
  reviewNote?: string | null;
  actorPlatformUserId?: string | null;
};

const MAX_SERIALIZABLE_ATTEMPTS = 3;

function normalizeReviewInput<
  T extends {
    merchantId: string;
    settlementId: string;
    reviewNote?: string | null;
  }
>(
  input: T
) {
  return {
    ...input,
    merchantId:
      input.merchantId.trim(),
    settlementId:
      input.settlementId.trim(),
    reviewNote:
      input.reviewNote?.trim() ||
      null
  };
}

function validateReviewInput(
  input: {
    merchantId: string;
    settlementId: string;
  }
): void {
  if (!input.merchantId) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  if (!input.settlementId) {
    throw new Error(
      "Merchant settlement ID is required"
    );
  }
}

function isSerializableConflict(
  error: unknown
): boolean {
  return (
    error instanceof
    Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function verifySettlementAttempt(
  input: ReturnType<
    typeof normalizeReviewInput<
      VerifyMerchantSettlementInput
    >
  >
) {
  return prisma.$transaction(
    async (tx) => {
      const settlement =
        await tx.merchantSettlement.findFirst({
          where: {
            id:
              input.settlementId,
            merchantId:
              input.merchantId
          }
        });

      if (!settlement) {
        throw new Error(
          "Merchant settlement not found"
        );
      }

      if (
        settlement.status !==
        MerchantSettlementStatus
          .REVIEW_REQUIRED
      ) {
        throw new Error(
          "Only settlements requiring review can be verified"
        );
      }

      const invoice =
        await tx.merchantInvoice.findUnique({
          where: {
            id_merchantId: {
              id:
                settlement.invoiceId,
              merchantId:
                input.merchantId
            }
          }
        });

      if (!invoice) {
        throw new Error(
          "Merchant invoice not found"
        );
      }

      /*
       * Settlement verification may pay an invoice
       * that is still payable.
       *
       * OPEN and OVERDUE invoices remain payable.
       * Draft, paid, and void invoices cannot be
       * paid through this review.
       */
      if (
        invoice.status !==
          MerchantInvoiceStatus.OPEN &&
        invoice.status !==
          MerchantInvoiceStatus.OVERDUE
      ) {
        throw new Error(
          "Merchant settlement can only be verified for an open or overdue invoice"
        );
      }

      /*
       * Reconcile again at authorization time.
       *
       * Submission-time validation is not sufficient
       * because verification is the financial
       * authorization boundary.
       */
      if (
        !settlement.amount.equals(
          invoice.totalAmount
        )
      ) {
        throw new Error(
          "Merchant settlement amount does not match invoice total"
        );
      }

      if (
        settlement.currency !==
        invoice.currency
      ) {
        throw new Error(
          "Merchant settlement currency does not match invoice currency"
        );
      }

      const verifiedAt =
        new Date();

      /*
       * First concurrency claim:
       * only one reviewer may move this settlement
       * out of REVIEW_REQUIRED.
       */
      const settlementClaim =
        await tx.merchantSettlement.updateMany({
          where: {
            id:
              settlement.id,
            merchantId:
              input.merchantId,
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED
          },
          data: {
            status:
              MerchantSettlementStatus
                .VERIFIED,
            verifiedAt,
            reviewNote:
              input.reviewNote
          }
        });

      if (
        settlementClaim.count !== 1
      ) {
        throw new Error(
          "Merchant settlement status changed concurrently"
        );
      }

      /*
       * Second concurrency claim:
       * exactly one verified settlement may pay the
       * invoice from its validated payable status.
       *
       * If another transaction already paid it,
       * this transaction throws and PostgreSQL rolls
       * back the settlement VERIFIED transition too.
       */
      const invoiceClaim =
        await tx.merchantInvoice.updateMany({
          where: {
            id:
              invoice.id,
            merchantId:
              input.merchantId,
            status:
              invoice.status
          },
          data: {
            status:
              MerchantInvoiceStatus.PAID,
            paidAt:
              verifiedAt
          }
        });

      if (
        invoiceClaim.count !== 1
      ) {
        throw new Error(
          "Merchant invoice status changed concurrently"
        );
      }

      const verifiedSettlement =
        await tx.merchantSettlement.findFirst({
          where: {
            id:
              settlement.id,
            merchantId:
              input.merchantId
          }
        });

      if (!verifiedSettlement) {
        throw new Error(
          "Merchant settlement not found after verification"
        );
      }

      const paidInvoice =
        await tx.merchantInvoice.findUnique({
          where: {
            id_merchantId: {
              id:
                invoice.id,
              merchantId:
                input.merchantId
            }
          }
        });

      if (!paidInvoice) {
        throw new Error(
          "Merchant invoice not found after settlement verification"
        );
      }

      /*
       * Day 15 temporary platform audit bridge:
       *
       * there is intentionally no MerchantUser actor.
       * Platform administrator identity is introduced
       * separately in Day 18.
       */
      await tx.auditLog.create({
        data: {
          merchantId:
            input.merchantId,
          actorUserId:
            null,
          action:
            "SETTLEMENT_VERIFIED",
          entityType:
            "MERCHANT_SETTLEMENT",
          entityId:
            verifiedSettlement.id,
          metadata: {
            authority:
              "PLATFORM_INTERNAL",
            invoiceId:
              paidInvoice.id,
            previousStatus:
              MerchantSettlementStatus
                .REVIEW_REQUIRED,
            nextStatus:
              verifiedSettlement.status,
            amount:
              verifiedSettlement.amount
                .toString(),
            currency:
              verifiedSettlement.currency,
            verifiedAt:
              verifiedSettlement.verifiedAt
                ?.toISOString() ??
              null,
            reviewNote:
              verifiedSettlement.reviewNote
          }
        }
      });

      await tx.auditLog.create({
        data: {
          merchantId:
            input.merchantId,
          actorUserId:
            null,
          action:
            "INVOICE_PAID",
          entityType:
            "MERCHANT_INVOICE",
          entityId:
            paidInvoice.id,
          metadata: {
            authority:
              "PLATFORM_INTERNAL",
            settlementId:
              verifiedSettlement.id,
            previousStatus:
              invoice.status,
            nextStatus:
              paidInvoice.status,
            amount:
              paidInvoice.totalAmount
                .toString(),
            currency:
              paidInvoice.currency,
            paidAt:
              paidInvoice.paidAt
                ?.toISOString() ??
              null
          }
        }
      });

      if (input.actorPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId:
              input.actorPlatformUserId,
            merchantId:
              input.merchantId,
            action:
              "MERCHANT_SETTLEMENT_VERIFIED",
            entityType:
              "MERCHANT_SETTLEMENT",
            entityId:
              verifiedSettlement.id,
            metadata: {
              invoiceId:
                paidInvoice.id,
              previousStatus:
                MerchantSettlementStatus
                  .REVIEW_REQUIRED,
              nextStatus:
                verifiedSettlement.status,
              amount:
                verifiedSettlement.amount
                  .toString(),
              currency:
                verifiedSettlement.currency,
              verifiedAt:
                verifiedSettlement.verifiedAt
                  ?.toISOString() ??
                null,
              reviewNote:
                verifiedSettlement.reviewNote
            }
          }
        });

        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId:
              input.actorPlatformUserId,
            merchantId:
              input.merchantId,
            action:
              "MERCHANT_INVOICE_PAID",
            entityType:
              "MERCHANT_INVOICE",
            entityId:
              paidInvoice.id,
            metadata: {
              settlementId:
                verifiedSettlement.id,
              previousStatus:
                invoice.status,
              nextStatus:
                paidInvoice.status,
              amount:
                paidInvoice.totalAmount
                  .toString(),
              currency:
                paidInvoice.currency,
              paidAt:
                paidInvoice.paidAt
                  ?.toISOString() ??
                null
            }
          }
        });
      }

      return {
        settlement:
          verifiedSettlement,
        invoice:
          paidInvoice
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable
    }
  );
}

async function rejectSettlementAttempt(
  input: ReturnType<
    typeof normalizeReviewInput<
      RejectMerchantSettlementInput
    >
  >
) {
  return prisma.$transaction(
    async (tx) => {
      const settlement =
        await tx.merchantSettlement.findFirst({
          where: {
            id:
              input.settlementId,
            merchantId:
              input.merchantId
          }
        });

      if (!settlement) {
        throw new Error(
          "Merchant settlement not found"
        );
      }

      if (
        settlement.status !==
        MerchantSettlementStatus
          .REVIEW_REQUIRED
      ) {
        throw new Error(
          "Only settlements requiring review can be rejected"
        );
      }

      const invoice =
        await tx.merchantInvoice.findUnique({
          where: {
            id_merchantId: {
              id:
                settlement.invoiceId,
              merchantId:
                input.merchantId
            }
          }
        });

      if (!invoice) {
        throw new Error(
          "Merchant invoice not found"
        );
      }

      /*
       * Settlement rejection remains tied to a
       * payable invoice lifecycle.
       *
       * OPEN and OVERDUE invoices may have settlement
       * evidence rejected. Rejection does not mutate
       * the invoice.
       */
      if (
        invoice.status !==
          MerchantInvoiceStatus.OPEN &&
        invoice.status !==
          MerchantInvoiceStatus.OVERDUE
      ) {
        throw new Error(
          "Merchant settlement can only be rejected for an open or overdue invoice"
        );
      }

      const claim =
        await tx.merchantSettlement.updateMany({
          where: {
            id:
              settlement.id,
            merchantId:
              input.merchantId,
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED
          },
          data: {
            status:
              MerchantSettlementStatus
                .REJECTED,
            reviewNote:
              input.reviewNote,
            verifiedAt:
              null
          }
        });

      if (claim.count !== 1) {
        throw new Error(
          "Merchant settlement status changed concurrently"
        );
      }

      const rejectedSettlement =
        await tx.merchantSettlement.findFirst({
          where: {
            id:
              settlement.id,
            merchantId:
              input.merchantId
          }
        });

      if (!rejectedSettlement) {
        throw new Error(
          "Merchant settlement not found after rejection"
        );
      }

      await tx.auditLog.create({
        data: {
          merchantId:
            input.merchantId,
          actorUserId:
            null,
          action:
            "SETTLEMENT_REJECTED",
          entityType:
            "MERCHANT_SETTLEMENT",
          entityId:
            rejectedSettlement.id,
          metadata: {
            authority:
              "PLATFORM_INTERNAL",
            invoiceId:
              invoice.id,
            previousStatus:
              MerchantSettlementStatus
                .REVIEW_REQUIRED,
            nextStatus:
              rejectedSettlement.status,
            amount:
              rejectedSettlement.amount
                .toString(),
            currency:
              rejectedSettlement.currency,
            reviewNote:
              rejectedSettlement.reviewNote
          }
        }
      });

      if (input.actorPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId:
              input.actorPlatformUserId,
            merchantId:
              input.merchantId,
            action:
              "MERCHANT_SETTLEMENT_REJECTED",
            entityType:
              "MERCHANT_SETTLEMENT",
            entityId:
              rejectedSettlement.id,
            metadata: {
              invoiceId:
                invoice.id,
              previousStatus:
                MerchantSettlementStatus
                  .REVIEW_REQUIRED,
              nextStatus:
                rejectedSettlement.status,
              amount:
                rejectedSettlement.amount
                  .toString(),
              currency:
                rejectedSettlement.currency,
              reviewNote:
                rejectedSettlement.reviewNote
            }
          }
        });
      }

      return {
        settlement:
          rejectedSettlement,
        invoice
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable
    }
  );
}

export async function verifyMerchantSettlement(
  rawInput:
    VerifyMerchantSettlementInput
) {
  const input =
    normalizeReviewInput(rawInput);

  validateReviewInput(input);

  for (
    let attempt = 1;
    attempt <=
    MAX_SERIALIZABLE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await verifySettlementAttempt(
        input
      );
    } catch (error) {
      if (
        isSerializableConflict(
          error
        ) &&
        attempt <
        MAX_SERIALIZABLE_ATTEMPTS
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Merchant settlement verification could not be completed"
  );
}

export async function rejectMerchantSettlement(
  rawInput:
    RejectMerchantSettlementInput
) {
  const input =
    normalizeReviewInput(rawInput);

  validateReviewInput(input);

  for (
    let attempt = 1;
    attempt <=
    MAX_SERIALIZABLE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await rejectSettlementAttempt(
        input
      );
    } catch (error) {
      if (
        isSerializableConflict(
          error
        ) &&
        attempt <
        MAX_SERIALIZABLE_ATTEMPTS
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Merchant settlement rejection could not be completed"
  );
}
