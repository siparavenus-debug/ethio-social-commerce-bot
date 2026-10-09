import {
    MerchantSubscriptionStatus,
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
    initializeMerchantSubscription,
    transitionMerchantSubscriptionStatus
  } from "../src/services/subscription.js";

  const testPrefix =
    "day11-subscription-transition";

    async function cleanup() {
      const merchants =
        await prisma.merchant.findMany({
          where: {
            name: {
              startsWith: testPrefix
            }
          },
          select: {
            id: true
          }
        });

      const merchantIds =
        merchants.map(
          (merchant) => merchant.id
        );

      if (merchantIds.length > 0) {
        await prisma.platformAuditLog.deleteMany({
          where: {
            merchantId: {
              in: merchantIds
            }
          }
        });

        await prisma.auditLog.deleteMany({
          where: {
            merchantId: {
              in: merchantIds
            }
          }
        });

        await prisma.merchantSubscription.deleteMany({
          where: {
            merchantId: {
              in: merchantIds
            }
          }
        });

        await prisma.merchant.deleteMany({
          where: {
            id: {
              in: merchantIds
            }
          }
        });
      }

      await prisma.subscriptionPlan.deleteMany({
        where: {
          code: {
            startsWith: testPrefix
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
    status: MerchantSubscriptionStatus
  ) {
    const merchant =
      await prisma.merchant.create({
        data: {
          name: `${testPrefix}-${suffix}`
        }
      });

    const plan =
      await prisma.subscriptionPlan.create({
        data: {
          code: `${testPrefix}-${suffix}`,
          name: `Transition Plan ${suffix}`,
          monthlyPrice: "500.00",
          annualPrice: "5000.00",
          currency: "ETB",
          commissionRate: "0.035000",
          isActive: true
        }
      });

    const currentPeriodStart =
      new Date(
        "2026-09-01T00:00:00.000Z"
      );

    const currentPeriodEnd =
      new Date(
        "2026-10-01T00:00:00.000Z"
      );

    await initializeMerchantSubscription({
      merchantId: merchant.id,
      planId: plan.id,
      billingInterval:
        SubscriptionBillingInterval.MONTHLY,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      trialEndsAt:
        status ===
        MerchantSubscriptionStatus.TRIAL
          ? new Date(
              "2026-09-15T00:00:00.000Z"
            )
          : null
    });

    return {
      merchant,
      plan
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
          `Platform Test ${suffix}`,
        role: "ADMIN"
      }
    });
  }

  describe(
    "merchant subscription status transitions",
    () => {
      beforeEach(async () => {
        await cleanup();
      });

      afterAll(async () => {
        await cleanup();
        await prisma.$disconnect();
      });

      it(
        "moves ACTIVE to PAST_DUE",
        async () => {
          const { merchant } =
            await createFixture(
              "past-due",
              MerchantSubscriptionStatus.ACTIVE
            );

          const subscription =
            await transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.PAST_DUE
            });

          expect(
            subscription.status
          ).toBe(
            MerchantSubscriptionStatus.PAST_DUE
          );
        }
      );

      it(
        "recovers PAST_DUE to ACTIVE",
        async () => {
          const { merchant } =
            await createFixture(
              "recover",
              MerchantSubscriptionStatus.PAST_DUE
            );

          const subscription =
            await transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.ACTIVE
            });

          expect(
            subscription.status
          ).toBe(
            MerchantSubscriptionStatus.ACTIVE
          );
        }
      );

      it(
        "moves PAST_DUE to SUSPENDED",
        async () => {
          const { merchant } =
            await createFixture(
              "suspend",
              MerchantSubscriptionStatus.PAST_DUE
            );

          const subscription =
            await transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.SUSPENDED
            });

          expect(
            subscription.status
          ).toBe(
            MerchantSubscriptionStatus.SUSPENDED
          );
        }
      );

      it(
        "rejects an invalid lifecycle transition",
        async () => {
          const { merchant } =
            await createFixture(
              "invalid",
              MerchantSubscriptionStatus.ACTIVE
            );

          await expect(
            transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.SUSPENDED
            })
          ).rejects.toThrow(
            "Subscription cannot move from ACTIVE to SUSPENDED"
          );

          const subscription =
            await prisma.merchantSubscription.findUnique({
              where: {
                merchantId: merchant.id
              }
            });

          expect(
            subscription?.status
          ).toBe(
            MerchantSubscriptionStatus.ACTIVE
          );
        }
      );

      it(
        "rejects a no-op transition",
        async () => {
          const { merchant } =
            await createFixture(
              "noop",
              MerchantSubscriptionStatus.ACTIVE
            );

          await expect(
            transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.ACTIVE
            })
          ).rejects.toThrow(
            "Subscription is already ACTIVE"
          );
        }
      );

      it(
        "creates a status-change audit record",
        async () => {
          const { merchant } =
            await createFixture(
              "audit",
              MerchantSubscriptionStatus.ACTIVE
            );

          const subscription =
            await transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.PAST_DUE
            });

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId: merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED",
                entityId:
                  subscription.id
              }
            });

          expect(audit).not.toBeNull();

          expect(
            audit?.entityType
          ).toBe(
            "MERCHANT_SUBSCRIPTION"
          );

          expect(
            audit?.metadata
          ).toMatchObject({
            previousStatus:
              MerchantSubscriptionStatus.ACTIVE,
            nextStatus:
              MerchantSubscriptionStatus.PAST_DUE
          });
        }
      );

      it(
        "creates platform audit for platform-admin status transition",
        async () => {
          const { merchant } =
            await createFixture(
              "pf-audit",
              MerchantSubscriptionStatus.ACTIVE
            );

          const platformUser =
            await createPlatformUser(
              "pf-audit"
            );

          const subscription =
            await transitionMerchantSubscriptionStatus({
              merchantId:
                merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.PAST_DUE,
              actorPlatformUserId:
                platformUser.id
            });

          const merchantAudit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED",
                entityId:
                  subscription.id
              }
            });

          const platformAudit =
            await prisma.platformAuditLog.findFirst({
              where: {
                actorPlatformUserId:
                  platformUser.id,
                merchantId:
                  merchant.id,
                action:
                  "MERCHANT_SUBSCRIPTION_STATUS_CHANGED",
                entityType:
                  "MERCHANT_SUBSCRIPTION",
                entityId:
                  subscription.id
              }
            });

          expect(
            merchantAudit
          ).not.toBeNull();

          expect(
            merchantAudit?.actorUserId
          ).toBeNull();

          expect(
            platformAudit
          ).not.toBeNull();

          expect(
            platformAudit?.actorPlatformUserId
          ).toBe(
            platformUser.id
          );

          expect(
            platformAudit?.merchantId
          ).toBe(
            merchant.id
          );

          expect(
            platformAudit?.metadata
          ).toMatchObject({
            previousStatus:
              MerchantSubscriptionStatus.ACTIVE,
            nextStatus:
              MerchantSubscriptionStatus.PAST_DUE
          });
        }
      );

      it(
        "rolls back status transition when platform audit fails",
        async () => {
          const { merchant } =
            await createFixture(
              "pf-rollback",
              MerchantSubscriptionStatus.ACTIVE
            );

          const subscriptionBefore =
            await prisma.merchantSubscription.findUnique({
              where: {
                merchantId:
                  merchant.id
              }
            });

          expect(
            subscriptionBefore?.status
          ).toBe(
            MerchantSubscriptionStatus.ACTIVE
          );

          const merchantAuditCountBefore =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED"
              }
            });

          await expect(
            transitionMerchantSubscriptionStatus({
              merchantId:
                merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.PAST_DUE,
              actorPlatformUserId:
                "nonexistent-platform-user"
            })
          ).rejects.toThrow();

          const subscriptionAfter =
            await prisma.merchantSubscription.findUnique({
              where: {
                merchantId:
                  merchant.id
              }
            });

          const merchantAuditCountAfter =
            await prisma.auditLog.count({
              where: {
                merchantId:
                  merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED"
              }
            });

          const platformAuditCount =
            await prisma.platformAuditLog.count({
              where: {
                merchantId:
                  merchant.id,
                action:
                  "MERCHANT_SUBSCRIPTION_STATUS_CHANGED"
              }
            });

          expect(
            subscriptionAfter?.status
          ).toBe(
            MerchantSubscriptionStatus.ACTIVE
          );

          expect(
            merchantAuditCountAfter
          ).toBe(
            merchantAuditCountBefore
          );

          expect(
            platformAuditCount
          ).toBe(0);
        }
      );

      it(
        "does not create an audit record when the transition fails",
        async () => {
          const { merchant } =
            await createFixture(
              "failed-audit",
              MerchantSubscriptionStatus.ACTIVE
            );

          const auditCountBefore =
            await prisma.auditLog.count({
              where: {
                merchantId: merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED"
              }
            });

          await expect(
            transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.SUSPENDED
            })
          ).rejects.toThrow();

          const auditCountAfter =
            await prisma.auditLog.count({
              where: {
                merchantId: merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED"
              }
            });

          expect(
            auditCountAfter
          ).toBe(
            auditCountBefore
          );
        }
      );

      it(
        "rejects transition when the merchant has no subscription",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-missing`
              }
            });

          await expect(
            transitionMerchantSubscriptionStatus({
              merchantId: merchant.id,
              nextStatus:
                MerchantSubscriptionStatus.ACTIVE
            })
          ).rejects.toThrow(
            "Merchant subscription not found"
          );
        }
      );

      it(
        "allows only one concurrent transition from the same stale subscription state",
        async () => {
          const { merchant } =
            await createFixture(
              "concurrent",
              MerchantSubscriptionStatus.PAST_DUE
            );

          const results =
            await Promise.allSettled([
              transitionMerchantSubscriptionStatus({
                merchantId: merchant.id,
                nextStatus:
                  MerchantSubscriptionStatus.ACTIVE
              }),

              transitionMerchantSubscriptionStatus({
                merchantId: merchant.id,
                nextStatus:
                  MerchantSubscriptionStatus.SUSPENDED
              })
            ]);

          const fulfilled =
            results.filter(
              (result) =>
                result.status === "fulfilled"
            );

          const rejected =
            results.filter(
              (result) =>
                result.status === "rejected"
            );

          expect(fulfilled).toHaveLength(1);
          expect(rejected).toHaveLength(1);

          const subscription =
            await prisma.merchantSubscription.findUnique({
              where: {
                merchantId: merchant.id
              }
            });

          expect([
            MerchantSubscriptionStatus.ACTIVE,
            MerchantSubscriptionStatus.SUSPENDED
          ]).toContain(
            subscription?.status
          );

          const transitionAudits =
            await prisma.auditLog.findMany({
              where: {
                merchantId: merchant.id,
                action:
                  "SUBSCRIPTION_STATUS_CHANGED"
              }
            });

          expect(
            transitionAudits
          ).toHaveLength(1);
        }
      );
    });
