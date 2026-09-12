import {
    CommissionAdjustmentType,
    Prisma,
    prisma
  } from "@ethio-commerce/database";

  export type CreateCommissionAdjustmentInput = {
    merchantId: string;
    commissionId: string;
    type: CommissionAdjustmentType;
    amount: Prisma.Decimal;
    currency: string;
    reason: string;
    idempotencyKey: string;
    actorUserId?: string | null;
  };

  const MAX_SERIALIZABLE_ATTEMPTS = 3;

  function validateInput(
    input: CreateCommissionAdjustmentInput
  ): void {
    if (input.amount.isZero()) {
      throw new Error(
        "Commission adjustment amount cannot be zero"
      );
    }

    if (!input.reason.trim()) {
      throw new Error(
        "Commission adjustment reason is required"
      );
    }

    if (!input.idempotencyKey.trim()) {
      throw new Error(
        "Commission adjustment idempotency key is required"
      );
    }

    if (
      (
        input.type === CommissionAdjustmentType.REVERSAL ||
        input.type === CommissionAdjustmentType.REFUND ||
        input.type === CommissionAdjustmentType.WAIVER
      ) &&
      input.amount.greaterThanOrEqualTo(0)
    ) {
      throw new Error(
        `${input.type} adjustments must be negative`
      );
    }
  }

  async function createAdjustmentAttempt(
    input: CreateCommissionAdjustmentInput
  ) {
    return prisma.$transaction(
      async (tx) => {
        const commission =
          await tx.commission.findFirst({
            where: {
              id: input.commissionId,
              merchantId: input.merchantId
            },
            include: {
              adjustments: true
            }
          });

        if (!commission) {
          throw new Error(
            "Commission not found"
          );
        }

        if (
          input.currency !==
          commission.currency
        ) {
          throw new Error(
            "Commission adjustment currency does not match commission currency"
          );
        }

        /*
         * Idempotency is checked before calculating a
         * new financial result.
         *
         * Reusing the same key with identical input is
         * a safe replay.
         *
         * Reusing the key for a different financial
         * instruction is rejected.
         */
        const existing =
          await tx.commissionAdjustment.findUnique({
            where: {
              merchantId_idempotencyKey: {
                merchantId:
                  input.merchantId,
                idempotencyKey:
                  input.idempotencyKey.trim()
              }
            }
          });

        if (existing) {
          const sameInstruction =
            existing.commissionId ===
              commission.id &&
            existing.type ===
              input.type &&
            existing.amount.equals(
              input.amount
            ) &&
            existing.currency ===
              input.currency &&
            existing.reason ===
              input.reason.trim();

          if (!sameInstruction) {
            throw new Error(
              "Commission adjustment idempotency key was already used for a different instruction"
            );
          }

          return existing;
        }

        const existingAdjustmentTotal =
          commission.adjustments.reduce(
            (total, adjustment) =>
              total.plus(
                adjustment.amount
              ),
            new Prisma.Decimal(0)
          );

        const currentNetCommission =
          commission.commissionAmount.plus(
            existingAdjustmentTotal
          );

        const nextNetCommission =
          currentNetCommission.plus(
            input.amount
          );

        /*
         * Day 13 accounting invariant:
         *
         * a correction may reduce a commission to zero
         * but may not silently create a negative merchant
         * commission obligation.
         *
         * Positive CORRECTION entries remain possible.
         */
        if (
          nextNetCommission.lessThan(0)
        ) {
          throw new Error(
            "Commission adjustment would reduce net commission below zero"
          );
        }

        const adjustment =
          await tx.commissionAdjustment.create({
            data: {
              merchantId:
                input.merchantId,
              commissionId:
                commission.id,
              type:
                input.type,
              amount:
                input.amount,
              currency:
                input.currency,
              reason:
                input.reason.trim(),
              idempotencyKey:
                input.idempotencyKey.trim()
            }
          });

        await tx.auditLog.create({
          data: {
            merchantId:
              input.merchantId,
            actorUserId:
              input.actorUserId ?? null,
            action:
              "COMMISSION_ADJUSTED",
            entityType:
              "COMMISSION_ADJUSTMENT",
            entityId:
              adjustment.id,
            metadata: {
              commissionId:
                commission.id,
              paymentId:
                commission.paymentId,
              orderId:
                commission.orderId,
              type:
                adjustment.type,
              amount:
                adjustment.amount.toString(),
              currency:
                adjustment.currency,
              reason:
                adjustment.reason,
              idempotencyKey:
                adjustment.idempotencyKey,
              previousNetCommission:
                currentNetCommission.toString(),
              resultingNetCommission:
                nextNetCommission.toString()
            }
          }
        });

        return adjustment;
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel
            .Serializable
      }
    );
  }

  export async function createCommissionAdjustment(
    input: CreateCommissionAdjustmentInput
  ) {
    validateInput(input);

    for (
      let attempt = 1;
      attempt <= MAX_SERIALIZABLE_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await createAdjustmentAttempt(
          input
        );
      } catch (error) {
        /*
         * PostgreSQL serializable transactions may
         * intentionally abort one participant in a
         * concurrent write race.
         *
         * Prisma reports that as P2034.
         *
         * Retry so callers receive deterministic
         * financial behavior rather than having to
         * understand database serialization conflicts.
         */
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
         * A concurrent identical idempotent request may
         * lose the unique-index race instead of producing
         * P2034. Reload it and validate that it represents
         * the same instruction.
         */
        if (
          error instanceof
            Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const existing =
            await prisma
              .commissionAdjustment
              .findUnique({
                where: {
                  merchantId_idempotencyKey: {
                    merchantId:
                      input.merchantId,
                    idempotencyKey:
                      input.idempotencyKey.trim()
                  }
                }
              });

          if (
            existing &&
            existing.commissionId ===
              input.commissionId &&
            existing.type ===
              input.type &&
            existing.amount.equals(
              input.amount
            ) &&
            existing.currency ===
              input.currency &&
            existing.reason ===
              input.reason.trim()
          ) {
            return existing;
          }
        }

        throw error;
      }
    }

    throw new Error(
      "Commission adjustment could not be completed"
    );
  }
