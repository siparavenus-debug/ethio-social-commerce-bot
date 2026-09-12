import {
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    Prisma,
    prisma
  } from "@ethio-commerce/database";

  import {
    createPlatformPlan,
    setPlatformPlanActiveState,
    updatePlatformPlan
  } from "./platform-plan.js";

  const tx = {
    subscriptionPlan: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    platformAuditLog: {
      create: vi.fn()
    },
    merchantSubscription: {
      update: vi.fn(),
      updateMany: vi.fn()
    }
  };

  vi.mock(
    "@ethio-commerce/database",
    async () => {
      const actual =
        await vi.importActual<
          typeof import("@ethio-commerce/database")
        >(
          "@ethio-commerce/database"
        );

      return {
        ...actual,
        prisma: {
          $transaction: vi.fn()
        }
      };
    }
  );

  const transaction =
    vi.mocked(
      prisma.$transaction
    );

  function decimal(
    value: string
  ) {
    return new Prisma.Decimal(value);
  }

  function planFixture(
    overrides: Record<string, unknown> = {}
  ) {
    return {
      id: "plan-1",
      code: "STARTER",
      name: "Starter",
      monthlyPrice:
        decimal("100.00"),
      annualPrice:
        decimal("1000.00"),
      currency: "ETB",
      commissionRate:
        decimal("0.050000"),
      features: null,
      isActive: true,
      createdAt:
        new Date(
          "2026-09-09T00:00:00.000Z"
        ),
      updatedAt:
        new Date(
          "2026-09-09T00:00:00.000Z"
        ),
      ...overrides
    };
  }

  describe(
    "platform subscription plan management",
    () => {
      beforeEach(() => {
        vi.clearAllMocks();

        transaction.mockImplementation(
          async (callback: any) =>
            callback(tx)
        );
      });

      it(
        "creates a normalized plan and platform audit record",
        async () => {
          tx.subscriptionPlan.findUnique
            .mockResolvedValueOnce(null);

          tx.subscriptionPlan.create
            .mockResolvedValueOnce(
              planFixture()
            );

          const result =
            await createPlatformPlan({
              actorPlatformUserId:
                "platform-user-1",
              code: " starter ",
              name: " Starter ",
              monthlyPrice: "100.00",
              annualPrice: "1000.00",
              currency: " etb ",
              commissionRate:
                "0.050000"
            });

          expect(
            tx.subscriptionPlan.create
          ).toHaveBeenCalledWith({
            data: {
              code: "STARTER",
              name: "Starter",
              monthlyPrice:
                decimal("100.00"),
              annualPrice:
                decimal("1000.00"),
              currency: "ETB",
              commissionRate:
                decimal("0.050000"),
              features:
                Prisma.JsonNull,
              isActive: true
            }
          });

          expect(
            tx.platformAuditLog.create
          ).toHaveBeenCalledWith({
            data: expect.objectContaining({
              actorPlatformUserId:
                "platform-user-1",
              merchantId: null,
              action:
                "SUBSCRIPTION_PLAN_CREATED",
              entityType:
                "SUBSCRIPTION_PLAN",
              entityId:
                "plan-1"
            })
          });

          expect(result.id)
            .toBe("plan-1");

          expect(transaction)
            .toHaveBeenCalledTimes(1);
        }
      );

      it(
        "rejects a duplicate normalized plan code",
        async () => {
          tx.subscriptionPlan.findUnique
            .mockResolvedValueOnce({
              id: "existing-plan"
            });

          await expect(
            createPlatformPlan({
              actorPlatformUserId:
                "platform-user-1",
              code: " starter ",
              name: "Starter",
              monthlyPrice: "100",
              annualPrice: "1000",
              currency: "ETB",
              commissionRate: "0.05"
            })
          ).rejects.toThrow(
            "Subscription plan code already exists"
          );

          expect(
            tx.subscriptionPlan.create
          ).not.toHaveBeenCalled();

          expect(
            tx.platformAuditLog.create
          ).not.toHaveBeenCalled();
        }
      );

      it.each([
        [
          "monthly price",
          {
            monthlyPrice: "-1",
            annualPrice: "1000",
            commissionRate: "0.05"
          },
          "Monthly price cannot be negative"
        ],
        [
          "annual price",
          {
            monthlyPrice: "100",
            annualPrice: "-1",
            commissionRate: "0.05"
          },
          "Annual price cannot be negative"
        ],
        [
          "commission rate",
          {
            monthlyPrice: "100",
            annualPrice: "1000",
            commissionRate: "-0.01"
          },
          "Commission rate cannot be negative"
        ]
      ])(
        "rejects a negative %s",
        async (
          _label,
          values,
          expectedMessage
        ) => {
          await expect(
            createPlatformPlan({
              actorPlatformUserId:
                "platform-user-1",
              code: "STARTER",
              name: "Starter",
              monthlyPrice:
                values.monthlyPrice,
              annualPrice:
                values.annualPrice,
              currency: "ETB",
              commissionRate:
                values.commissionRate
            })
          ).rejects.toThrow(
            expectedMessage
          );

          expect(transaction)
            .not.toHaveBeenCalled();
        }
      );

      it(
        "rejects a currency that is not three letters",
        async () => {
          await expect(
            createPlatformPlan({
              actorPlatformUserId:
                "platform-user-1",
              code: "STARTER",
              name: "Starter",
              monthlyPrice: "100",
              annualPrice: "1000",
              currency: "ET",
              commissionRate: "0.05"
            })
          ).rejects.toThrow(
            "Currency must be a 3-letter currency code"
          );

          expect(transaction)
            .not.toHaveBeenCalled();
        }
      );

      it(
        "updates only explicitly provided plan fields",
        async () => {
          const existing =
            planFixture();

          const updated =
            planFixture({
              name: "Starter Plus",
              monthlyPrice:
                decimal("125.00")
            });

          tx.subscriptionPlan.findUnique
            .mockResolvedValueOnce(
              existing
            );

          tx.subscriptionPlan.update
            .mockResolvedValueOnce(
              updated
            );

          const result =
            await updatePlatformPlan({
              actorPlatformUserId:
                "platform-user-1",
              planId: "plan-1",
              name: " Starter Plus ",
              monthlyPrice: "125.00"
            });

          expect(
            tx.subscriptionPlan.update
          ).toHaveBeenCalledWith({
            where: {
              id: "plan-1"
            },
            data: {
              name: "Starter Plus",
              monthlyPrice:
                decimal("125.00")
            }
          });

          expect(
            tx.platformAuditLog.create
          ).toHaveBeenCalledWith({
            data: expect.objectContaining({
              actorPlatformUserId:
                "platform-user-1",
              merchantId: null,
              action:
                "SUBSCRIPTION_PLAN_UPDATED",
              entityType:
                "SUBSCRIPTION_PLAN",
              entityId:
                "plan-1"
            })
          });

          expect(
            tx.merchantSubscription.update
          ).not.toHaveBeenCalled();

          expect(
            tx.merchantSubscription.updateMany
          ).not.toHaveBeenCalled();

          expect(result.name)
            .toBe("Starter Plus");
        }
      );

      it(
        "rejects an update with no fields",
        async () => {
          await expect(
            updatePlatformPlan({
              actorPlatformUserId:
                "platform-user-1",
              planId: "plan-1"
            })
          ).rejects.toThrow(
            "At least one plan field must be provided"
          );

          expect(transaction)
            .not.toHaveBeenCalled();
        }
      );

      it(
        "deactivates a plan and records the platform actor",
        async () => {
          tx.subscriptionPlan.findUnique
            .mockResolvedValueOnce(
              planFixture()
            );

          tx.subscriptionPlan.update
            .mockResolvedValueOnce(
              planFixture({
                isActive: false
              })
            );

          const result =
            await setPlatformPlanActiveState({
              actorPlatformUserId:
                "platform-user-1",
              planId: "plan-1",
              isActive: false
            });

          expect(
            tx.subscriptionPlan.update
          ).toHaveBeenCalledWith({
            where: {
              id: "plan-1"
            },
            data: {
              isActive: false
            }
          });

          expect(
            tx.platformAuditLog.create
          ).toHaveBeenCalledWith({
            data: expect.objectContaining({
              actorPlatformUserId:
                "platform-user-1",
              merchantId: null,
              action:
                "SUBSCRIPTION_PLAN_DEACTIVATED",
              entityType:
                "SUBSCRIPTION_PLAN",
              entityId:
                "plan-1"
            })
          });

          expect(result.isActive)
            .toBe(false);
        }
      );

      it(
        "activates an inactive plan and records the platform actor",
        async () => {
          tx.subscriptionPlan.findUnique
            .mockResolvedValueOnce(
              planFixture({
                isActive: false
              })
            );

          tx.subscriptionPlan.update
            .mockResolvedValueOnce(
              planFixture({
                isActive: true
              })
            );

          await setPlatformPlanActiveState({
            actorPlatformUserId:
              "platform-user-1",
            planId: "plan-1",
            isActive: true
          });

          expect(
            tx.platformAuditLog.create
          ).toHaveBeenCalledWith({
            data: expect.objectContaining({
              actorPlatformUserId:
                "platform-user-1",
              action:
                "SUBSCRIPTION_PLAN_ACTIVATED"
            })
          });
        }
      );

      it(
        "rejects an already-applied active state",
        async () => {
          tx.subscriptionPlan.findUnique
            .mockResolvedValueOnce(
              planFixture({
                isActive: false
              })
            );

          await expect(
            setPlatformPlanActiveState({
              actorPlatformUserId:
                "platform-user-1",
              planId: "plan-1",
              isActive: false
            })
          ).rejects.toThrow(
            "Subscription plan is already inactive"
          );

          expect(
            tx.subscriptionPlan.update
          ).not.toHaveBeenCalled();

          expect(
            tx.platformAuditLog.create
          ).not.toHaveBeenCalled();
        }
      );
    }
  );
