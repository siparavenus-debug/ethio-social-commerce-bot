import {
  CommissionStatus,
  Prisma
} from "@ethio-commerce/database";

type BillingPeriodClient =
  Pick<
    Prisma.TransactionClient,
    | "merchant"
    | "merchantSubscription"
    | "commission"
    | "commissionAdjustment"
  >;

export type CalculateBillingPeriodInput = {
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
  subscriptionId?: string | null;
};

export async function calculateBillingPeriod(
  client: BillingPeriodClient,
  input: CalculateBillingPeriodInput
) {
  const merchant =
    await client.merchant.findUnique({
      where: {
        id: input.merchantId
      }
    });

  if (!merchant) {
    throw new Error(
      "Merchant not found"
    );
  }

  const commissions =
    await client.commission.findMany({
      where: {
        merchantId:
          input.merchantId,
        status:
          CommissionStatus.ACCRUED,
        createdAt: {
          gte: input.periodStart,
          lt: input.periodEnd
        },
        invoiceItem: null
      },
      orderBy: [
        {
          createdAt: "asc"
        },
        {
          id: "asc"
        }
      ]
    });

  const adjustments =
    await client.commissionAdjustment.findMany({
      where: {
        merchantId:
          input.merchantId,
        createdAt: {
          gte: input.periodStart,
          lt: input.periodEnd
        },
        invoiceItem: null
      },
      orderBy: [
        {
          createdAt: "asc"
        },
        {
          id: "asc"
        }
      ]
    });

  let subscription = null;

  if (input.subscriptionId) {
    subscription =
      await client.merchantSubscription.findFirst({
        where: {
          id: input.subscriptionId,
          merchantId:
            input.merchantId
        }
      });

    if (!subscription) {
      throw new Error(
        "Merchant subscription not found"
      );
    }

    if (
      subscription.currentPeriodStart.getTime() !==
        input.periodStart.getTime() ||
      subscription.currentPeriodEnd.getTime() !==
        input.periodEnd.getTime()
    ) {
      throw new Error(
        "Subscription billing period does not match the subscription current period"
      );
    }

    if (
      subscription.currency !==
      merchant.currency
    ) {
      throw new Error(
        "Subscription currency does not match merchant currency"
      );
    }
  }

  for (const commission of commissions) {
    if (
      commission.currency !==
      merchant.currency
    ) {
      throw new Error(
        "Commission currency does not match merchant currency"
      );
    }
  }

  for (const adjustment of adjustments) {
    if (
      adjustment.currency !==
      merchant.currency
    ) {
      throw new Error(
        "Commission adjustment currency does not match merchant currency"
      );
    }
  }

  const subscriptionAmount =
    subscription
      ? subscription.priceSnapshot
      : new Prisma.Decimal(0);

  const commissionAccrualTotal =
    commissions.reduce(
      (total, commission) =>
        total.plus(
          commission.commissionAmount
        ),
      new Prisma.Decimal(0)
    );

  const adjustmentTotal =
    adjustments.reduce(
      (total, adjustment) =>
        total.plus(
          adjustment.amount
        ),
      new Prisma.Decimal(0)
    );

  const commissionAmount =
    commissionAccrualTotal.plus(
      adjustmentTotal
    );

  const totalAmount =
    subscriptionAmount.plus(
      commissionAmount
    );

  return {
    merchant,
    subscription,
    commissions,
    adjustments,
    subscriptionAmount,
    commissionAccrualTotal,
    adjustmentTotal,
    commissionAmount,
    totalAmount
  };
}
