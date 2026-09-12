import {
    CommissionAdjustmentType,
    MerchantSubscriptionStatus,
    OrderStatus,
    PaymentProvider,
    PaymentStatus,
    Prisma,
    ProductStatus,
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
    accrueCommission
  } from "../src/services/commission.js";

  import {
    createCommissionAdjustment
  } from "../src/services/commission-adjustment.js";

  import {
    initializeMerchantSubscription
  } from "../src/services/subscription.js";

  const testPrefix =
    "day13-commission-adjustment";

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
      /*
       * Day 13:
       * adjustments reference commissions with
       * ON DELETE RESTRICT, so adjustments must
       * be cleaned first.
       */
      await prisma.commissionAdjustment.deleteMany({
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

      await prisma.commission.deleteMany({
        where: {
          merchantId: {
            in: merchantIds
          }
        }
      });

      await prisma.payment.deleteMany({
        where: {
          merchantId: {
            in: merchantIds
          }
        }
      });

      await prisma.orderItem.deleteMany({
        where: {
          order: {
            merchantId: {
              in: merchantIds
            }
          }
        }
      });

      await prisma.order.deleteMany({
        where: {
          merchantId: {
            in: merchantIds
          }
        }
      });

      await prisma.product.deleteMany({
        where: {
          merchantId: {
            in: merchantIds
          }
        }
      });

      await prisma.customer.deleteMany({
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
  }

  async function createFixture(
    suffix: string
  ) {
    const merchant =
      await prisma.merchant.create({
        data: {
          name:
            `${testPrefix}-${suffix}`,
          currency: "ETB"
        }
      });

    const plan =
      await prisma.subscriptionPlan.create({
        data: {
          code:
            `${testPrefix}-${suffix}`,
          name:
            `Day 13 Plan ${suffix}`,
          monthlyPrice:
            "500.00",
          annualPrice:
            "5000.00",
          currency:
            "ETB",
          commissionRate:
            "0.035000",
          isActive:
            true
        }
      });

    const subscription =
      await initializeMerchantSubscription({
        merchantId:
          merchant.id,
        planId:
          plan.id,
        billingInterval:
          SubscriptionBillingInterval.MONTHLY,
        status:
          MerchantSubscriptionStatus.ACTIVE,
        currentPeriodStart:
          new Date(
            "2026-09-01T00:00:00.000Z"
          ),
        currentPeriodEnd:
          new Date(
            "2026-10-01T00:00:00.000Z"
          )
      });

    const customer =
      await prisma.customer.create({
        data: {
          merchantId:
            merchant.id,
          name:
            `Day 13 Customer ${suffix}`,
          telegramChatId:
            `day13-chat-${suffix}`,
          telegramUserId:
            `day13-user-${suffix}`
        }
      });

    const product =
      await prisma.product.create({
        data: {
          merchantId:
            merchant.id,
          name:
            `Day 13 Product ${suffix}`,
          price:
            "99.00",
          currency:
            "ETB",
          stock:
            10,
          status:
            ProductStatus.ACTIVE
        }
      });

    const order =
      await prisma.order.create({
        data: {
          merchantId:
            merchant.id,
          customerId:
            customer.id,
          orderNumber:
            `DAY13-${suffix}`,
          status:
            OrderStatus.PAID,
          currency:
            "ETB",
          subtotal:
            "99.00",
          total:
            "99.00",
          items: {
            create: {
              productId:
                product.id,
              productName:
                product.name,
              quantity:
                1,
              unitPrice:
                "99.00",
              lineTotal:
                "99.00"
            }
          }
        }
      });

    const payment =
      await prisma.payment.create({
        data: {
          merchantId:
            merchant.id,
          orderId:
            order.id,
          provider:
            PaymentProvider.TELEBIRR,
          status:
            PaymentStatus.VERIFIED,
          amount:
            "99.00",
          currency:
            "ETB",
          transactionReference:
            `DAY13-TXN-${suffix}`,
          verifiedAt:
            new Date()
        }
      });

    const commission =
      await prisma.$transaction(
        async (tx) =>
          accrueCommission(
            tx,
            {
              merchantId:
                merchant.id,
              paymentId:
                payment.id
            }
          )
      );

    return {
      merchant,
      plan,
      subscription,
      customer,
      product,
      order,
      payment,
      commission
    };
  }

  describe(
    "commission adjustments",
    () => {
      beforeEach(async () => {
        await cleanup();
      });

      afterAll(async () => {
        await cleanup();
        await prisma.$disconnect();
      });

      it(
        "creates a full reversal while preserving the original commission",
        async () => {
          const fixture =
            await createFixture(
              "full-reversal"
            );

          const originalAmount =
            fixture.commission
              .commissionAmount
              .toFixed(2);

          const adjustment =
            await createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.REVERSAL,
              amount:
                new Prisma.Decimal(
                  "-3.47"
                ),
              currency:
                "ETB",
              reason:
                "Incorrect payment verification",
              idempotencyKey:
                "full-reversal-1"
            });

          expect(
            adjustment.amount.toFixed(2)
          ).toBe(
            "-3.47"
          );

          const original =
            await prisma.commission.findUnique({
              where: {
                id:
                  fixture.commission.id
              }
            });

          expect(
            original?.commissionAmount.toFixed(2)
          ).toBe(
            originalAmount
          );

          const adjustments =
            await prisma.commissionAdjustment.findMany({
              where: {
                commissionId:
                  fixture.commission.id
              }
            });

          const net =
            adjustments.reduce(
              (
                total,
                entry
              ) =>
                total.plus(
                  entry.amount
                ),
              fixture.commission
                .commissionAmount
            );

          expect(
            net.toFixed(2)
          ).toBe(
            "0.00"
          );
        }
      );

      it(
        "supports a partial correction without rewriting the original commission",
        async () => {
          const fixture =
            await createFixture(
              "partial"
            );

          await createCommissionAdjustment({
            merchantId:
              fixture.merchant.id,
            commissionId:
              fixture.commission.id,
            type:
              CommissionAdjustmentType.CORRECTION,
            amount:
              new Prisma.Decimal(
                "-1.00"
              ),
            currency:
              "ETB",
            reason:
              "Partial correction",
            idempotencyKey:
              "partial-1"
          });

          const original =
            await prisma.commission.findUnique({
              where: {
                id:
                  fixture.commission.id
              }
            });

          expect(
            original?.commissionAmount.toFixed(2)
          ).toBe(
            "3.47"
          );

          const adjustments =
            await prisma.commissionAdjustment.findMany({
              where: {
                commissionId:
                  fixture.commission.id
              }
            });

          const net =
            adjustments.reduce(
              (
                total,
                adjustment
              ) =>
                total.plus(
                  adjustment.amount
                ),
              fixture.commission
                .commissionAmount
            );

          expect(
            net.toFixed(2)
          ).toBe(
            "2.47"
          );
        }
      );

      it(
        "records commission waiver as a negative ledger entry",
        async () => {
          const fixture =
            await createFixture(
              "waiver"
            );

          const adjustment =
            await createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.WAIVER,
              amount:
                new Prisma.Decimal(
                  "-3.47"
                ),
              currency:
                "ETB",
              reason:
                "Platform-approved waiver",
              idempotencyKey:
                "waiver-1"
            });

          expect(
            adjustment.type
          ).toBe(
            CommissionAdjustmentType.WAIVER
          );

          expect(
            adjustment.amount.toFixed(2)
          ).toBe(
            "-3.47"
          );

          expect(
            await prisma.commission.count({
              where: {
                id:
                  fixture.commission.id
              }
            })
          ).toBe(1);
        }
      );

      it(
        "supports an explicit refund adjustment without inventing automatic refund policy",
        async () => {
          const fixture =
            await createFixture(
              "refund"
            );

          const adjustment =
            await createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.REFUND,
              amount:
                new Prisma.Decimal(
                  "-1.50"
                ),
              currency:
                "ETB",
              reason:
                "Explicit refund correction",
              idempotencyKey:
                "refund-1"
            });

          expect(
            adjustment.type
          ).toBe(
            CommissionAdjustmentType.REFUND
          );

          expect(
            adjustment.amount.toFixed(2)
          ).toBe(
            "-1.50"
          );

          /*
           * No automatic order/payment mutation is
           * implied by the ledger adjustment.
           */
          const [
            order,
            payment
          ] =
            await Promise.all([
              prisma.order.findUnique({
                where: {
                  id:
                    fixture.order.id
                }
              }),

              prisma.payment.findUnique({
                where: {
                  id:
                    fixture.payment.id
                }
              })
            ]);

          expect(
            order?.status
          ).toBe(
            OrderStatus.PAID
          );

          expect(
            payment?.status
          ).toBe(
            PaymentStatus.VERIFIED
          );
        }
      );

      it(
        "allows a positive correction while preserving historical accrual",
        async () => {
          const fixture =
            await createFixture(
              "positive"
            );

          const adjustment =
            await createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.CORRECTION,
              amount:
                new Prisma.Decimal(
                  "1.00"
                ),
              currency:
                "ETB",
              reason:
                "Correct prior under-adjustment",
              idempotencyKey:
                "positive-1"
            });

          expect(
            adjustment.amount.toFixed(2)
          ).toBe(
            "1.00"
          );

          const original =
            await prisma.commission.findUnique({
              where: {
                id:
                  fixture.commission.id
              }
            });

          expect(
            original?.commissionAmount.toFixed(2)
          ).toBe(
            "3.47"
          );
        }
      );

      it(
        "rejects zero-value adjustments",
        async () => {
          const fixture =
            await createFixture(
              "zero"
            );

          await expect(
            createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.CORRECTION,
              amount:
                new Prisma.Decimal(
                  "0.00"
                ),
              currency:
                "ETB",
              reason:
                "Zero correction",
              idempotencyKey:
                "zero-1"
            })
          ).rejects.toThrow(
            "Commission adjustment amount cannot be zero"
          );

          expect(
            await prisma.commissionAdjustment.count({
              where: {
                commissionId:
                  fixture.commission.id
              }
            })
          ).toBe(0);
        }
      );

      it(
        "enforces the nonzero adjustment invariant at the database level",
        async () => {
          const fixture =
            await createFixture(
              "db-zero"
            );

          await expect(
            prisma.commissionAdjustment.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                commissionId:
                  fixture.commission.id,
                type:
                  CommissionAdjustmentType.CORRECTION,
                amount:
                  new Prisma.Decimal(
                    "0.00"
                  ),
                currency:
                  "ETB",
                reason:
                  "Database constraint test",
                idempotencyKey:
                  "db-zero-1"
              }
            })
          ).rejects.toThrow();

          expect(
            await prisma.commissionAdjustment.count({
              where: {
                commissionId:
                  fixture.commission.id
              }
            })
          ).toBe(0);
        }
      );

      it(
        "rejects an adjustment that would reduce net commission below zero",
        async () => {
          const fixture =
            await createFixture(
              "over-reversal"
            );

          await expect(
            createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.REVERSAL,
              amount:
                new Prisma.Decimal(
                  "-4.00"
                ),
              currency:
                "ETB",
              reason:
                "Too large",
              idempotencyKey:
                "over-reversal-1"
            })
          ).rejects.toThrow(
            "Commission adjustment would reduce net commission below zero"
          );

          expect(
            await prisma.commissionAdjustment.count({
              where: {
                commissionId:
                  fixture.commission.id
              }
            })
          ).toBe(0);
        }
      );

      it(
        "rejects adjustment access through the wrong merchant",
        async () => {
          const fixture =
            await createFixture(
              "merchant-scope"
            );

          await expect(
            createCommissionAdjustment({
              merchantId:
                "wrong-merchant-id",
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.REVERSAL,
              amount:
                new Prisma.Decimal(
                  "-1.00"
                ),
              currency:
                "ETB",
              reason:
                "Wrong merchant",
              idempotencyKey:
                "wrong-merchant-1"
            })
          ).rejects.toThrow(
            "Commission not found"
          );
        }
      );

      it(
        "rejects adjustment currency mismatch",
        async () => {
          const fixture =
            await createFixture(
              "currency"
            );

          await expect(
            createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.REVERSAL,
              amount:
                new Prisma.Decimal(
                  "-1.00"
                ),
              currency:
                "USD",
              reason:
                "Wrong currency",
              idempotencyKey:
                "currency-1"
            })
          ).rejects.toThrow(
            "Commission adjustment currency does not match commission currency"
          );
        }
      );

      it(
        "replays the same adjustment idempotently and creates one audit",
        async () => {
          const fixture =
            await createFixture(
              "replay"
            );

          const input = {
            merchantId:
              fixture.merchant.id,
            commissionId:
              fixture.commission.id,
            type:
              CommissionAdjustmentType.REVERSAL,
            amount:
              new Prisma.Decimal(
                "-1.00"
              ),
            currency:
              "ETB",
            reason:
              "Replay-safe reversal",
            idempotencyKey:
              "replay-1",
            actorUserId:
              "day13-actor"
          };

          const first =
            await createCommissionAdjustment(
              input
            );

          const second =
            await createCommissionAdjustment(
              input
            );

          expect(
            second.id
          ).toBe(
            first.id
          );

          expect(
            await prisma.commissionAdjustment.count({
              where: {
                commissionId:
                  fixture.commission.id
              }
            })
          ).toBe(1);

          expect(
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "COMMISSION_ADJUSTED",
                entityId:
                  first.id
              }
            })
          ).toBe(1);
        }
      );

      it(
        "rejects reuse of an idempotency key for a different instruction",
        async () => {
          const fixture =
            await createFixture(
              "key-conflict"
            );

          await createCommissionAdjustment({
            merchantId:
              fixture.merchant.id,
            commissionId:
              fixture.commission.id,
            type:
              CommissionAdjustmentType.REVERSAL,
            amount:
              new Prisma.Decimal(
                "-1.00"
              ),
            currency:
              "ETB",
            reason:
              "First instruction",
            idempotencyKey:
              "conflict-key"
          });

          await expect(
            createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.REVERSAL,
              amount:
                new Prisma.Decimal(
                  "-2.00"
                ),
              currency:
                "ETB",
              reason:
                "Different instruction",
              idempotencyKey:
                "conflict-key"
            })
          ).rejects.toThrow(
            "Commission adjustment idempotency key was already used for a different instruction"
          );
        }
      );

      it(
        "allows only one row and one audit for concurrent identical replay",
        async () => {
          const fixture =
            await createFixture(
              "concurrent-replay"
            );

          const input = {
            merchantId:
              fixture.merchant.id,
            commissionId:
              fixture.commission.id,
            type:
              CommissionAdjustmentType.REVERSAL,
            amount:
              new Prisma.Decimal(
                "-1.00"
              ),
            currency:
              "ETB",
            reason:
              "Concurrent replay",
            idempotencyKey:
              "concurrent-replay-1"
          };

          const results =
            await Promise.all([
              createCommissionAdjustment(
                input
              ),
              createCommissionAdjustment(
                input
              )
            ]);

          expect(
            results[0].id
          ).toBe(
            results[1].id
          );

          expect(
            await prisma.commissionAdjustment.count({
              where: {
                commissionId:
                  fixture.commission.id
              }
            })
          ).toBe(1);

          expect(
            await prisma.auditLog.count({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "COMMISSION_ADJUSTED"
              }
            })
          ).toBe(1);
        }
      );

      it(
        "prevents concurrent competing reversals from collectively over-reversing",
        async () => {
          const fixture =
            await createFixture(
              "concurrent-over"
            );

          const results =
            await Promise.allSettled([
              createCommissionAdjustment({
                merchantId:
                  fixture.merchant.id,
                commissionId:
                  fixture.commission.id,
                type:
                  CommissionAdjustmentType.REVERSAL,
                amount:
                  new Prisma.Decimal(
                    "-2.00"
                  ),
                currency:
                  "ETB",
                reason:
                  "Concurrent reversal A",
                idempotencyKey:
                  "concurrent-over-a"
              }),

              createCommissionAdjustment({
                merchantId:
                  fixture.merchant.id,
                commissionId:
                  fixture.commission.id,
                type:
                  CommissionAdjustmentType.REVERSAL,
                amount:
                  new Prisma.Decimal(
                    "-2.00"
                  ),
                currency:
                  "ETB",
                reason:
                  "Concurrent reversal B",
                idempotencyKey:
                  "concurrent-over-b"
              })
            ]);

          expect(
            results.filter(
              (result) =>
                result.status ===
                "fulfilled"
            )
          ).toHaveLength(1);

          expect(
            results.filter(
              (result) =>
                result.status ===
                "rejected"
            )
          ).toHaveLength(1);

          const adjustments =
            await prisma.commissionAdjustment.findMany({
              where: {
                commissionId:
                  fixture.commission.id
              }
            });

          expect(
            adjustments
          ).toHaveLength(1);

          const net =
            adjustments.reduce(
              (
                total,
                adjustment
              ) =>
                total.plus(
                  adjustment.amount
                ),
              fixture.commission
                .commissionAmount
            );

          expect(
            net.toFixed(2)
          ).toBe(
            "1.47"
          );
        }
      );

      it(
        "creates an actor-attributed audit with before and after financial state",
        async () => {
          const fixture =
            await createFixture(
              "audit"
            );

          const adjustment =
            await createCommissionAdjustment({
              merchantId:
                fixture.merchant.id,
              commissionId:
                fixture.commission.id,
              type:
                CommissionAdjustmentType.REVERSAL,
              amount:
                new Prisma.Decimal(
                  "-1.00"
                ),
              currency:
                "ETB",
              reason:
                "Audit test",
              idempotencyKey:
                "audit-1",
              actorUserId:
                "day13-test-actor"
            });

          const audit =
            await prisma.auditLog.findFirst({
              where: {
                merchantId:
                  fixture.merchant.id,
                action:
                  "COMMISSION_ADJUSTED",
                entityId:
                  adjustment.id
              }
            });

          expect(
            audit
          ).not.toBeNull();

          expect(
            audit?.actorUserId
          ).toBe(
            "day13-test-actor"
          );

          expect(
            audit?.entityType
          ).toBe(
            "COMMISSION_ADJUSTMENT"
          );

          expect(
            audit?.metadata
          ).toMatchObject({
            commissionId:
              fixture.commission.id,
            paymentId:
              fixture.payment.id,
            orderId:
              fixture.order.id,
            type:
              CommissionAdjustmentType.REVERSAL,
            amount:
              "-1",
            currency:
              "ETB",
            previousNetCommission:
              "3.47",
            resultingNetCommission:
              "2.47"
          });
        }
      );

      it(
        "preserves the historical commission snapshot after the subscription rate changes",
        async () => {
          const fixture =
            await createFixture(
              "plan-change"
            );

          expect(
            fixture.commission
              .commissionRate
              .toString()
          ).toBe(
            "0.035"
          );

          expect(
            fixture.commission
              .commissionAmount
              .toFixed(2)
          ).toBe(
            "3.47"
          );

          /*
           * Day 13 does not invent a production
           * plan-change workflow.
           *
           * This direct mutation simulates a future
           * subscription snapshot change and proves
           * historical Commission rows are independent
           * from later commercial state.
           */
          await prisma.merchantSubscription.update({
            where: {
              merchantId:
                fixture.merchant.id
            },
            data: {
              commissionRateSnapshot:
                "0.050000"
            }
          });

          const historical =
            await prisma.commission.findUnique({
              where: {
                id:
                  fixture.commission.id
              }
            });

          expect(
            historical?.commissionRate.toString()
          ).toBe(
            "0.035"
          );

          expect(
            historical?.commissionAmount.toFixed(2)
          ).toBe(
            "3.47"
          );
        }
      );
    }
  );
