import {
    CommissionStatus,
    PaymentStatus,
    Prisma
  } from "@ethio-commerce/database";

  import {
    calculateCommission
  } from "../domain/commission-calculation.js";

  export type AccrueCommissionInput = {
    merchantId: string;
    paymentId: string;
    actorUserId?: string | null;
  };

  export async function accrueCommission(
    tx: Prisma.TransactionClient,
    input: AccrueCommissionInput
  ) {
    const {
      merchantId,
      paymentId,
      actorUserId = null
    } = input;

    /*
     * The commission engine may only operate on the
     * merchant's own verified financial event.
     */
    const payment =
      await tx.payment.findFirst({
        where: {
          id: paymentId,
          merchantId
        },
        select: {
          id: true,
          merchantId: true,
          orderId: true,
          status: true,
          amount: true,
          currency: true
        }
      });

    if (!payment) {
      throw new Error(
        "Payment not found"
      );
    }

    if (
      payment.status !==
      PaymentStatus.VERIFIED
    ) {
      throw new Error(
        "Commission can only accrue from a verified payment"
      );
    }

    /*
     * A commission must always be attributable to a
     * real commercial subscription snapshot.
     *
     * Missing subscription does NOT mean zero
     * commission and must never be silently ignored.
     */
    const subscription =
      await tx.merchantSubscription.findUnique({
        where: {
          merchantId
        },
        select: {
          id: true,
          merchantId: true,
          commissionRateSnapshot: true,
          currency: true
        }
      });

    if (!subscription) {
      throw new Error(
        "Merchant subscription not found"
      );
    }

    /*
     * Currency conversion is not part of Day 12.
     *
     * Never calculate a commission across mismatched
     * currencies without an explicit FX policy.
     */
    if (
      payment.currency !==
      subscription.currency
    ) {
      throw new Error(
        "Payment currency does not match subscription currency"
      );
    }

    const calculation =
      calculateCommission({
        transactionAmount:
          payment.amount,
        commissionRate:
          subscription.commissionRateSnapshot
      });

    /*
     * Commission.paymentId is UNIQUE.
     *
     * createMany + skipDuplicates makes the operation
     * replay-safe without relying on application timing:
     *
     * - first caller inserts the ledger row
     * - later/concurrent callers insert zero rows
     *
     * Only the caller that actually inserts the
     * commission creates the accrual audit record.
     */
    const created =
      await tx.commission.createMany({
        data: [
          {
            merchantId,
            paymentId:
              payment.id,
            orderId:
              payment.orderId,
            subscriptionId:
              subscription.id,
            transactionAmount:
              calculation.transactionAmount,
            commissionRate:
              calculation.commissionRate,
            commissionAmount:
              calculation.commissionAmount,
            currency:
              payment.currency,
            status:
              CommissionStatus.ACCRUED
          }
        ],
        skipDuplicates: true
      });

    const commission =
      await tx.commission.findUnique({
        where: {
          paymentId:
            payment.id
        }
      });

    if (!commission) {
      throw new Error(
        "Commission could not be loaded after accrual"
      );
    }

    /*
     * A replay must not generate a second financial
     * audit event.
     */
    if (created.count === 1) {
      await tx.auditLog.create({
        data: {
          merchantId,
          actorUserId,
          action:
            "COMMISSION_ACCRUED",
          entityType:
            "COMMISSION",
          entityId:
            commission.id,
          metadata: {
            paymentId:
              payment.id,
            orderId:
              payment.orderId,
            subscriptionId:
              subscription.id,
            transactionAmount:
              commission.transactionAmount.toString(),
            commissionRate:
              commission.commissionRate.toString(),
            commissionAmount:
              commission.commissionAmount.toString(),
            currency:
              commission.currency
          }
        }
      });
    }

    return commission;
  }
