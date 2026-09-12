import {
    Prisma,
    prisma
} from "@ethio-commerce/database";

type DecimalInput =
    string |
    number |
    Prisma.Decimal;

export type CreatePlatformPlanInput = {
    actorPlatformUserId: string;
    code: string;
    name: string;
    monthlyPrice: DecimalInput;
    annualPrice: DecimalInput;
    currency: string;
    commissionRate: DecimalInput;
    features?: Prisma.InputJsonValue | null;
    isActive?: boolean;
};

export type UpdatePlatformPlanInput = {
    actorPlatformUserId: string;
    planId: string;
    name?: string;
    monthlyPrice?: DecimalInput;
    annualPrice?: DecimalInput;
    currency?: string;
    commissionRate?: DecimalInput;
    features?: Prisma.InputJsonValue | null;
};

function requireNonEmpty(
    value: string,
    fieldName: string
): string {
    const normalized =
        value.trim();

    if (!normalized) {
        throw new Error(
            `${fieldName} is required`
        );
    }

    return normalized;
}

function normalizeCode(
    value: string
): string {
    return requireNonEmpty(
        value,
        "Plan code"
    ).toUpperCase();
}

function normalizeCurrency(
    value: string
): string {
    const normalized =
        requireNonEmpty(
            value,
            "Currency"
        ).toUpperCase();

    if (normalized.length !== 3) {
        throw new Error(
            "Currency must be a 3-letter currency code"
        );
    }

    return normalized;
}

function nonNegativeDecimal(
    value: DecimalInput,
    fieldName: string
): Prisma.Decimal {
    let decimal: Prisma.Decimal;

    try {
        decimal =
            new Prisma.Decimal(value);
    } catch {
        throw new Error(
            `${fieldName} must be a valid number`
        );
    }

    if (!decimal.isFinite()) {
        throw new Error(
            `${fieldName} must be a finite number`
        );
    }

    if (decimal.isNegative()) {
        throw new Error(
            `${fieldName} cannot be negative`
        );
    }

    return decimal;
}

export async function createPlatformPlan(
    input: CreatePlatformPlanInput
) {
    const actorPlatformUserId =
        requireNonEmpty(
            input.actorPlatformUserId,
            "Platform actor ID"
        );

    const code =
        normalizeCode(input.code);

    const name =
        requireNonEmpty(
            input.name,
            "Plan name"
        );

    const monthlyPrice =
        nonNegativeDecimal(
            input.monthlyPrice,
            "Monthly price"
        );

    const annualPrice =
        nonNegativeDecimal(
            input.annualPrice,
            "Annual price"
        );

    const currency =
        normalizeCurrency(
            input.currency
        );

    const commissionRate =
        nonNegativeDecimal(
            input.commissionRate,
            "Commission rate"
        );

    return prisma.$transaction(
        async (tx) => {
            const existingPlan =
                await tx.subscriptionPlan.findUnique({
                    where: {
                        code
                    },
                    select: {
                        id: true
                    }
                });

            if (existingPlan) {
                throw new Error(
                    "Subscription plan code already exists"
                );
            }

            let plan;

            try {
                plan =
                    await tx.subscriptionPlan.create({
                        data: {
                            code,
                            name,
                            monthlyPrice,
                            annualPrice,
                            currency,
                            commissionRate,
                            features:
                                input.features ??
                                Prisma.JsonNull,
                            isActive:
                                input.isActive ?? true
                        }
                    });
            } catch (error) {
                if (
                    error instanceof
                    Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2002"
                ) {
                    throw new Error(
                        "Subscription plan code already exists"
                    );
                }

                throw error;
            }

            await tx.platformAuditLog.create({
                data: {
                    actorPlatformUserId,
                    merchantId: null,
                    action:
                        "SUBSCRIPTION_PLAN_CREATED",
                    entityType:
                        "SUBSCRIPTION_PLAN",
                    entityId:
                        plan.id,
                    metadata: {
                        code:
                            plan.code,
                        name:
                            plan.name,
                        monthlyPrice:
                            plan.monthlyPrice.toString(),
                        annualPrice:
                            plan.annualPrice.toString(),
                        currency:
                            plan.currency,
                        commissionRate:
                            plan.commissionRate.toString(),
                        isActive:
                            plan.isActive
                    }
                }
            });

            return plan;
        }
    );
}

export async function updatePlatformPlan(
    input: UpdatePlatformPlanInput
) {
    const actorPlatformUserId =
        requireNonEmpty(
            input.actorPlatformUserId,
            "Platform actor ID"
        );

    const planId =
        requireNonEmpty(
            input.planId,
            "Plan ID"
        );

    const hasUpdate =
        input.name !== undefined ||
        input.monthlyPrice !== undefined ||
        input.annualPrice !== undefined ||
        input.currency !== undefined ||
        input.commissionRate !== undefined ||
        input.features !== undefined;

    if (!hasUpdate) {
        throw new Error(
            "At least one plan field must be provided"
        );
    }

    const name =
        input.name !== undefined
            ? requireNonEmpty(
                input.name,
                "Plan name"
            )
            : undefined;

    const monthlyPrice =
        input.monthlyPrice !== undefined
            ? nonNegativeDecimal(
                input.monthlyPrice,
                "Monthly price"
            )
            : undefined;

    const annualPrice =
        input.annualPrice !== undefined
            ? nonNegativeDecimal(
                input.annualPrice,
                "Annual price"
            )
            : undefined;

    const currency =
        input.currency !== undefined
            ? normalizeCurrency(
                input.currency
            )
            : undefined;

    const commissionRate =
        input.commissionRate !== undefined
            ? nonNegativeDecimal(
                input.commissionRate,
                "Commission rate"
            )
            : undefined;

    return prisma.$transaction(
        async (tx) => {
            const existingPlan =
                await tx.subscriptionPlan.findUnique({
                    where: {
                        id: planId
                    }
                });

            if (!existingPlan) {
                throw new Error(
                    "Subscription plan not found"
                );
            }

            const updatedPlan =
                await tx.subscriptionPlan.update({
                    where: {
                        id: planId
                    },
                    data: {
                        ...(name !== undefined
                            ? { name }
                            : {}),
                        ...(monthlyPrice !== undefined
                            ? { monthlyPrice }
                            : {}),
                        ...(annualPrice !== undefined
                            ? { annualPrice }
                            : {}),
                        ...(currency !== undefined
                            ? { currency }
                            : {}),
                        ...(commissionRate !== undefined
                            ? { commissionRate }
                            : {}),
                        ...(input.features !== undefined
                            ? {
                                features:
                                    input.features ??
                                    Prisma.JsonNull
                            }
                            : {})
                    }
                });

            await tx.platformAuditLog.create({
                data: {
                    actorPlatformUserId,
                    merchantId: null,
                    action:
                        "SUBSCRIPTION_PLAN_UPDATED",
                    entityType:
                        "SUBSCRIPTION_PLAN",
                    entityId:
                        updatedPlan.id,
                    metadata: {
                        previous: {
                            name:
                                existingPlan.name,
                            monthlyPrice:
                                existingPlan.monthlyPrice.toString(),
                            annualPrice:
                                existingPlan.annualPrice.toString(),
                            currency:
                                existingPlan.currency,
                            commissionRate:
                                existingPlan.commissionRate.toString()
                        },
                        next: {
                            name:
                                updatedPlan.name,
                            monthlyPrice:
                                updatedPlan.monthlyPrice.toString(),
                            annualPrice:
                                updatedPlan.annualPrice.toString(),
                            currency:
                                updatedPlan.currency,
                            commissionRate:
                                updatedPlan.commissionRate.toString()
                        }
                    }
                }
            });

            return updatedPlan;
        }
    );
}

export async function setPlatformPlanActiveState(
    input: {
        actorPlatformUserId: string;
        planId: string;
        isActive: boolean;
    }
) {
    const actorPlatformUserId =
        requireNonEmpty(
            input.actorPlatformUserId,
            "Platform actor ID"
        );

    const planId =
        requireNonEmpty(
            input.planId,
            "Plan ID"
        );

    if (typeof input.isActive !== "boolean") {
        throw new Error(
            "Plan active state must be boolean"
        );
    }

    return prisma.$transaction(
        async (tx) => {
            const existingPlan =
                await tx.subscriptionPlan.findUnique({
                    where: {
                        id: planId
                    }
                });

            if (!existingPlan) {
                throw new Error(
                    "Subscription plan not found"
                );
            }

            if (
                existingPlan.isActive ===
                input.isActive
            ) {
                throw new Error(
                    input.isActive
                        ? "Subscription plan is already active"
                        : "Subscription plan is already inactive"
                );
            }

            const updatedPlan =
                await tx.subscriptionPlan.update({
                    where: {
                        id: planId
                    },
                    data: {
                        isActive:
                            input.isActive
                    }
                });

            await tx.platformAuditLog.create({
                data: {
                    actorPlatformUserId,
                    merchantId: null,
                    action:
                        input.isActive
                            ? "SUBSCRIPTION_PLAN_ACTIVATED"
                            : "SUBSCRIPTION_PLAN_DEACTIVATED",
                    entityType:
                        "SUBSCRIPTION_PLAN",
                    entityId:
                        updatedPlan.id,
                    metadata: {
                        previousIsActive:
                            existingPlan.isActive,
                        nextIsActive:
                            updatedPlan.isActive
                    }
                }
            });

            return updatedPlan;
        }
    );
}