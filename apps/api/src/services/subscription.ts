import {
  MerchantSubscriptionStatus,
  Prisma,
  SubscriptionBillingInterval,
  prisma
} from "@ethio-commerce/database";

import {
  applySubscriptionStatusTransition
} from "../domain/subscription-state.js";

export type InitializeMerchantSubscriptionInput = {
  merchantId: string;
  planId: string;
  billingInterval: SubscriptionBillingInterval;
  status: MerchantSubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt?: Date | null;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
};

export async function initializeMerchantSubscription(
  input: InitializeMerchantSubscriptionInput
) {
  const {
    merchantId,
    planId,
    billingInterval,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    trialEndsAt = null,
    actorUserId = null,
    actorPlatformUserId = null
  } = input;

  if (currentPeriodEnd <= currentPeriodStart) {
    throw new Error(
      "Subscription period end must be after subscription period start"
    );
  }

  if (status === MerchantSubscriptionStatus.TRIAL) {
    if (!trialEndsAt) {
      throw new Error(
        "Trial subscriptions must have a trial end date"
      );
    }

    if (trialEndsAt <= currentPeriodStart) {
      throw new Error(
        "Trial end date must be after subscription period start"
      );
    }

    if (trialEndsAt > currentPeriodEnd) {
      throw new Error(
        "Trial end date cannot be after subscription period end"
      );
    }
  } else if (trialEndsAt) {
    throw new Error(
      "Only trial subscriptions may have a trial end date"
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const merchant =
        await tx.merchant.findUnique({
          where: {
            id: merchantId
          },
          select: {
            id: true
          }
        });

      if (!merchant) {
        throw new Error(
          "Merchant not found"
        );
      }

      const plan =
        await tx.subscriptionPlan.findUnique({
          where: {
            id: planId
          },
          select: {
            id: true,
            monthlyPrice: true,
            annualPrice: true,
            currency: true,
            commissionRate: true,
            isActive: true
          }
        });

      if (!plan) {
        throw new Error(
          "Subscription plan not found"
        );
      }

      if (!plan.isActive) {
        throw new Error(
          "Subscription plan is inactive"
        );
      }

      const existingSubscription =
        await tx.merchantSubscription.findUnique({
          where: {
            merchantId
          },
          select: {
            id: true
          }
        });

      if (existingSubscription) {
        throw new Error(
          "Merchant already has a subscription"
        );
      }

      const priceSnapshot =
        billingInterval ===
          SubscriptionBillingInterval.MONTHLY
          ? plan.monthlyPrice
          : plan.annualPrice;

      let subscription: Awaited<ReturnType<typeof tx.merchantSubscription.create>>;

      try {
        subscription =
          await tx.merchantSubscription.create({
            data: {
              merchantId,
              planId: plan.id,
              status,
              billingInterval,
              priceSnapshot,
              commissionRateSnapshot:
                plan.commissionRate,
              currency: plan.currency,
              currentPeriodStart,
              currentPeriodEnd,
              trialEndsAt
            }
          });
      } catch (error) {
        /*
         * The explicit lookup above provides a clear
         * application-level error in the normal case.
         *
         * MerchantSubscription.merchantId is also UNIQUE
         * in PostgreSQL. That database constraint is the
         * final protection against concurrent attempts to
         * initialize two subscriptions for one merchant.
         */
        if (
          error instanceof
          Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new Error(
            "Merchant already has a subscription"
          );
        }

        throw error;
      }

      await tx.auditLog.create({
        data: {
          merchantId,
          actorUserId,
          action: "SUBSCRIPTION_INITIALIZED",
          entityType: "MERCHANT_SUBSCRIPTION",
          entityId: subscription.id,
          metadata: {
            planId: plan.id,
            billingInterval,
            status,
            priceSnapshot:
              subscription.priceSnapshot.toString(),
            commissionRateSnapshot:
              subscription.commissionRateSnapshot.toString(),
            currency:
              subscription.currency,
            currentPeriodStart:
              currentPeriodStart.toISOString(),
            currentPeriodEnd:
              currentPeriodEnd.toISOString(),
            trialEndsAt:
              trialEndsAt?.toISOString() ?? null
          }
        }
      });

      if (actorPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId,
            merchantId,
            action:
              "MERCHANT_SUBSCRIPTION_INITIALIZED",
            entityType:
              "MERCHANT_SUBSCRIPTION",
            entityId:
              subscription.id,
            metadata: {
              planId: plan.id,
              billingInterval,
              status,
              priceSnapshot:
                subscription.priceSnapshot.toString(),
              commissionRateSnapshot:
                subscription.commissionRateSnapshot.toString(),
              currency:
                subscription.currency,
              currentPeriodStart:
                currentPeriodStart.toISOString(),
              currentPeriodEnd:
                currentPeriodEnd.toISOString(),
              trialEndsAt:
                trialEndsAt?.toISOString() ?? null
            }
          }
        });
      }

      return subscription;
    }
  );
}

export type TransitionMerchantSubscriptionInput = {
  merchantId: string;
  nextStatus: MerchantSubscriptionStatus;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
};

export async function transitionMerchantSubscriptionStatus(
  input: TransitionMerchantSubscriptionInput
) {
  const {
    merchantId,
    nextStatus,
    actorUserId = null,
    actorPlatformUserId = null
  } = input;

  return prisma.$transaction(
    async (tx) => {
      const subscription =
        await tx.merchantSubscription.findUnique({
          where: {
            merchantId
          }
        });

      if (!subscription) {
        throw new Error(
          "Merchant subscription not found"
        );
      }

      const previousStatus =
        subscription.status;

      const resolvedNextStatus =
        applySubscriptionStatusTransition(
          previousStatus,
          nextStatus
        );

      /*
       * The status in the WHERE clause is intentional.
       *
       * It prevents two concurrent actors from both
       * successfully mutating the same stale subscription
       * state after reading it.
       */
      const claim =
        await tx.merchantSubscription.updateMany({
          where: {
            id: subscription.id,
            merchantId,
            status: previousStatus
          },
          data: {
            status: resolvedNextStatus
          }
        });

      if (claim.count !== 1) {
        throw new Error(
          "Subscription status changed concurrently"
        );
      }

      const updatedSubscription =
        await tx.merchantSubscription.findUnique({
          where: {
            id: subscription.id
          }
        });

      if (!updatedSubscription) {
        throw new Error(
          "Merchant subscription not found after status transition"
        );
      }

      await tx.auditLog.create({
        data: {
          merchantId,
          actorUserId,
          action:
            "SUBSCRIPTION_STATUS_CHANGED",
          entityType:
            "MERCHANT_SUBSCRIPTION",
          entityId:
            updatedSubscription.id,
          metadata: {
            previousStatus,
            nextStatus:
              updatedSubscription.status
          }
        }
      });

      if (actorPlatformUserId) {
        await tx.platformAuditLog.create({
          data: {
            actorPlatformUserId,
            merchantId,
            action:
              "MERCHANT_SUBSCRIPTION_STATUS_CHANGED",
            entityType:
              "MERCHANT_SUBSCRIPTION",
            entityId:
              updatedSubscription.id,
            metadata: {
              previousStatus,
              nextStatus:
                updatedSubscription.status
            }
          }
        });
      }

      return updatedSubscription;
    }
  );
}