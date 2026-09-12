import {
    Prisma
  } from "@ethio-commerce/database";

  export type CommissionCalculationInput = {
    transactionAmount: Prisma.Decimal;
    commissionRate: Prisma.Decimal;
  };

  export type CommissionCalculationResult = {
    transactionAmount: Prisma.Decimal;
    commissionRate: Prisma.Decimal;
    commissionAmount: Prisma.Decimal;
  };

  export function calculateCommission(
    input: CommissionCalculationInput
  ): CommissionCalculationResult {
    const {
      transactionAmount,
      commissionRate
    } = input;

    if (transactionAmount.isNegative()) {
      throw new Error(
        "Transaction amount cannot be negative"
      );
    }

    if (
      commissionRate.isNegative() ||
      commissionRate.greaterThan(1)
    ) {
      throw new Error(
        "Commission rate must be between 0 and 1"
      );
    }

    const commissionAmount =
      transactionAmount
        .mul(commissionRate)
        .toDecimalPlaces(
          2,
          Prisma.Decimal.ROUND_HALF_UP
        );

    return {
      transactionAmount,
      commissionRate,
      commissionAmount
    };
  }
