import {
  MerchantInvoiceStatus,
  MerchantSettlementProvider,
  MerchantSettlementStatus,
  Prisma,
  prisma
} from "@ethio-commerce/database";

export type SubmitMerchantSettlementInput = {
  merchantId: string;
  invoiceId: string;
  provider: MerchantSettlementProvider;
  amount: Prisma.Decimal;
  currency: string;
  idempotencyKey: string;
  transactionReference?: string | null;
  receiptUrl?: string | null;
  receiptMetadata?: Prisma.InputJsonValue | null;
  actorUserId?: string | null;
};

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_TRANSACTION_REFERENCE_LENGTH = 200;

// objectKey must come from server-controlled receipt metadata.
function getReceiptIdentity(
  evidence: {
    receiptMetadata?: Prisma.InputJsonValue | Prisma.JsonValue | null;
    receiptUrl?: string | null;
  }
): string | null {
  const metadata =
    evidence.receiptMetadata;

  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "objectKey" in metadata &&
    typeof metadata.objectKey === "string" &&
    metadata.objectKey.trim()
  ) {
    return metadata.objectKey;
  }

  return evidence.receiptUrl ?? null;
}

function normalizeInput(
  input: SubmitMerchantSettlementInput
) {
  const merchantId =
    input.merchantId.trim();

  const invoiceId =
    input.invoiceId.trim();

  const currency =
    input.currency.trim().toUpperCase();

  const idempotencyKey =
    input.idempotencyKey.trim();

  const transactionReference =
    input.transactionReference?.trim() ||
    null;

  const receiptUrl =
    input.receiptUrl?.trim() ||
    null;

  return {
    ...input,
    merchantId,
    invoiceId,
    currency,
    idempotencyKey,
    transactionReference,
    receiptUrl
  };
}

function validateInput(
  input: ReturnType<typeof normalizeInput>
): void {
  if (!input.merchantId) {
    throw new Error(
      "Merchant ID is required"
    );
  }

  if (!input.invoiceId) {
    throw new Error(
      "Merchant invoice ID is required"
    );
  }

  if (
    !Object.values(
      MerchantSettlementProvider
    ).includes(input.provider)
  ) {
    throw new Error(
      "Merchant settlement provider is invalid"
    );
  }

  if (
    input.amount.lessThanOrEqualTo(0)
  ) {
    throw new Error(
      "Merchant settlement amount must be greater than zero"
    );
  }

  if (!input.currency) {
    throw new Error(
      "Merchant settlement currency is required"
    );
  }

  if (input.currency.length !== 3) {
    throw new Error(
      "Merchant settlement currency must use a 3-letter code"
    );
  }

  if (!input.idempotencyKey) {
    throw new Error(
      "Merchant settlement idempotency key is required"
    );
  }

  if (
    input.idempotencyKey.length >
    MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new Error(
      "Merchant settlement idempotency key is too long"
    );
  }

  if (
    input.transactionReference &&
    input.transactionReference.length >
      MAX_TRANSACTION_REFERENCE_LENGTH
  ) {
    throw new Error(
      "Merchant settlement transaction reference is too long"
    );
  }

  /*
   * Day 15 evidence invariant:
   *
   * a merchant must submit at least one piece of
   * payment evidence. A provider reference and a
   * receipt may both be supplied.
   *
   * Evidence is never verification.
   */
  if (
    !input.transactionReference &&
    !getReceiptIdentity(input)
  ) {
    throw new Error(
      "Merchant settlement requires a transaction reference or receipt"
    );
  }
}

function isSameInstruction(
  settlement: {
    invoiceId: string;
    provider: MerchantSettlementProvider;
    amount: Prisma.Decimal;
    currency: string;
    transactionReference: string | null;
    receiptUrl: string | null;
    receiptMetadata: Prisma.JsonValue;
  },
  input: ReturnType<typeof normalizeInput>
): boolean {
  return (
    settlement.invoiceId ===
      input.invoiceId &&
    settlement.provider ===
      input.provider &&
    settlement.amount.equals(
      input.amount
    ) &&
    settlement.currency ===
      input.currency &&
    settlement.transactionReference ===
      input.transactionReference &&
    getReceiptIdentity(settlement) ===
      getReceiptIdentity(input)
  );
}

async function loadReplay(
  input: ReturnType<typeof normalizeInput>
) {
  const existing =
    await prisma.merchantSettlement.findUnique({
      where: {
        merchantId_idempotencyKey: {
          merchantId:
            input.merchantId,
          idempotencyKey:
            input.idempotencyKey
        }
      }
    });

  if (!existing) {
    return null;
  }

  if (
    !isSameInstruction(
      existing,
      input
    )
  ) {
    throw new Error(
      "Merchant settlement idempotency key was already used for a different instruction"
    );
  }

  return existing;
}

async function submitSettlementAttempt(
  input: ReturnType<typeof normalizeInput>
) {
  return prisma.$transaction(
    async (tx) => {
      const invoice =
        await tx.merchantInvoice.findUnique({
          where: {
            id_merchantId: {
              id:
                input.invoiceId,
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
       * Settlement evidence may only be submitted
       * against an invoice that has actually been
       * issued to the merchant and remains payable.
       *
       * Submission never opens a DRAFT invoice.
       */
      if (
        invoice.status !==
          MerchantInvoiceStatus.OPEN &&
        invoice.status !==
          MerchantInvoiceStatus.OVERDUE
      ) {
        throw new Error(
          "Merchant settlement can only be submitted for an open or overdue invoice"
        );
      }

      /*
       * Day 15 MVP reconciliation is deliberately
       * exact because no partial-payment policy has
       * been defined.
       */
      if (
        !invoice.totalAmount.equals(
          input.amount
        )
      ) {
        throw new Error(
          "Merchant settlement amount does not match invoice total"
        );
      }

      if (
        invoice.currency !==
        input.currency
      ) {
        throw new Error(
          "Merchant settlement currency does not match invoice currency"
        );
      }

      /*
       * Check idempotency inside the transaction
       * before creating another financial review
       * record.
       */
      const existing =
        await tx.merchantSettlement.findUnique({
          where: {
            merchantId_idempotencyKey: {
              merchantId:
                input.merchantId,
              idempotencyKey:
                input.idempotencyKey
            }
          }
        });

      if (existing) {
        if (
          !isSameInstruction(
            existing,
            input
          )
        ) {
          throw new Error(
            "Merchant settlement idempotency key was already used for a different instruction"
          );
        }

        return existing;
      }

      /*
       * The provider reference is a second,
       * independent duplicate boundary.
       *
       * PostgreSQL allows multiple NULL values in
       * the unique index, so receipt-only requests
       * are protected by the merchant-scoped
       * idempotency key instead.
       */
      if (
        input.transactionReference
      ) {
        const duplicateReference =
          await tx.merchantSettlement.findFirst({
            where: {
              provider:
                input.provider,
              transactionReference:
                input.transactionReference
            }
          });

        if (duplicateReference) {
          throw new Error(
            "Merchant settlement transaction reference has already been submitted"
          );
        }
      }

      const settlement =
        await tx.merchantSettlement.create({
          data: {
            merchantId:
              input.merchantId,
            invoiceId:
              invoice.id,
            provider:
              input.provider,
            status:
              MerchantSettlementStatus
                .REVIEW_REQUIRED,
            amount:
              input.amount,
            currency:
              input.currency,
            idempotencyKey:
              input.idempotencyKey,
            transactionReference:
              input.transactionReference,
            receiptUrl:
              input.receiptUrl,
            receiptMetadata:
              input.receiptMetadata ??
              Prisma.JsonNull
          }
        });

      await tx.auditLog.create({
        data: {
          merchantId:
            input.merchantId,
          actorUserId:
            input.actorUserId ??
            null,
          action:
            "SETTLEMENT_SUBMITTED",
          entityType:
            "MERCHANT_SETTLEMENT",
          entityId:
            settlement.id,
          metadata: {
            invoiceId:
              invoice.id,
            provider:
              settlement.provider,
            status:
              settlement.status,
            amount:
              settlement.amount.toString(),
            currency:
              settlement.currency,
            idempotencyKey:
              settlement.idempotencyKey,
            transactionReference:
              settlement.transactionReference,
            receiptUrl:
              settlement.receiptUrl
          }
        }
      });

      /*
       * Critical Day 15 authorization boundary:
       *
       * submitting evidence does NOT mutate the
       * invoice and does NOT verify the settlement.
       *
       * Invoice remains OPEN.
       * Settlement remains REVIEW_REQUIRED.
       */
      return settlement;
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable
    }
  );
}

export async function submitMerchantSettlement(
  rawInput: SubmitMerchantSettlementInput
) {
  const input =
    normalizeInput(rawInput);

  validateInput(input);

  /*
   * Resolve ordinary replays before opening a new
   * serializable transaction.
   */
  const replay =
    await loadReplay(input);

  if (replay) {
    return replay;
  }

  for (
    let attempt = 1;
    attempt <=
      MAX_SERIALIZABLE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await submitSettlementAttempt(
        input
      );
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt <
          MAX_SERIALIZABLE_ATTEMPTS
      ) {
        continue;
      }

      /*
       * Concurrent identical submissions can race
       * on either unique index.
       *
       * The merchant-scoped idempotency key is the
       * authoritative replay identity.
       */
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing =
          await prisma
            .merchantSettlement
            .findUnique({
              where: {
                merchantId_idempotencyKey: {
                  merchantId:
                    input.merchantId,
                  idempotencyKey:
                    input.idempotencyKey
                }
              }
            });

        if (existing) {
          if (
            isSameInstruction(
              existing,
              input
            )
          ) {
            return existing;
          }

          throw new Error(
            "Merchant settlement idempotency key was already used for a different instruction"
          );
        }

        if (
          input.transactionReference
        ) {
          const duplicateReference =
            await prisma
              .merchantSettlement
              .findFirst({
                where: {
                  provider:
                    input.provider,
                  transactionReference:
                    input.transactionReference
                }
              });

          if (duplicateReference) {
            throw new Error(
              "Merchant settlement transaction reference has already been submitted"
            );
          }
        }
      }

      throw error;
    }
  }

  throw new Error(
    "Merchant settlement submission could not be completed"
  );
}
