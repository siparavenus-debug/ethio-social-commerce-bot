import type {
    Server
} from "node:http";

import express from "express";

import {
    MerchantInvoiceStatus,
    MerchantSettlementProvider,
    MerchantSettlementStatus,
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
    beforeAll,
    beforeEach,
    describe,
    expect,
    it
} from "vitest";

import platformAdminRouter
    from "../src/routes/platform-admin.js";

import {
    createPlatformAuthToken
} from "../src/services/platform-auth.js";

import {
    accrueCommission
} from "../src/services/commission.js";

import {
    initializeMerchantSubscription
} from "../src/services/subscription.js";

const testPrefix =
    "platform-admin-routes";

let server:
    Server | null = null;

let apiBaseUrl =
    "";

async function cleanup():
    Promise<void> {
    const testMerchants =
        await prisma.merchant.findMany({
            where: {
                name: {
                    startsWith:
                        testPrefix
                }
            },
            select: {
                id: true
            }
        });

    const testMerchantIds =
        testMerchants.map(
            (merchant) =>
                merchant.id
        );

    await prisma.platformAuditLog.deleteMany({
        where: {
            OR: [
                {
                    entityId: {
                        startsWith:
                            testPrefix
                    }
                },
                {
                    actor: {
                        email: {
                            startsWith:
                                `${testPrefix}-platform-`
                        }
                    }
                },
                {
                    merchantId: {
                        in:
                            testMerchantIds
                    }
                }
            ]
        }
    });

    await prisma.auditLog.deleteMany({
        where: {
            merchant: {
                name: {
                    startsWith:
                        testPrefix
                }
            }
        }
    });

    await prisma.merchantInvoiceItem.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.merchantSettlement.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.merchantInvoiceReminder.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.merchantInvoice.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.commissionAdjustment.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.commission.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.payment.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.orderItem.deleteMany({
        where: {
            order: {
                merchantId: {
                    in:
                        testMerchantIds
                }
            }
        }
    });

    await prisma.order.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.product.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.customer.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.merchantSubscription.deleteMany({
        where: {
            merchantId: {
                in:
                    testMerchantIds
            }
        }
    });

    await prisma.merchant.deleteMany({
        where: {
            name: {
                startsWith:
                    testPrefix
            }
        }
    });

    await prisma.subscriptionPlan.deleteMany({
        where: {
          OR: [
            {
              code: {
                startsWith:
                  testPrefix
              }
            },
            {
              code: {
                startsWith:
                  testPrefix.toUpperCase()
              }
            }
          ]
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

async function createPlatformFixture(
    suffix: string
) {
    const user =
        await prisma.platformUser.create({
            data: {
                email:
                    `${testPrefix}-platform-${suffix}@example.test`,
                passwordHash:
                    "test-password-hash",
                displayName:
                    `Platform Test ${suffix}`,
                tokenVersion:
                    0
            }
        });

    const token =
        createPlatformAuthToken({
            id:
                user.id,
            tokenVersion:
                user.tokenVersion
        });

    return {
        user,
        token
    };
}

async function createMerchant(
    suffix: string
) {
    return prisma.merchant.create({
        data: {
            name:
                `${testPrefix}-${suffix}`,
            currency:
                "ETB"
        }
    });
}

async function createInvoiceFinancialFixture(
    suffix: string
) {
    const merchant =
        await createMerchant(
            suffix
        );

        const periodStart =
        new Date(
            "2026-09-01T00:00:00.000Z"
        );

    const periodEnd =
        new Date(
            "2026-10-01T00:00:00.000Z"
        );

    const plan =
        await prisma.subscriptionPlan.create({
            data: {
                code:
                    `${testPrefix}-${suffix}`,
                name:
                    `${testPrefix} ${suffix}`,
                monthlyPrice:
                    new Prisma.Decimal(
                        "500.00"
                    ),
                annualPrice:
                    new Prisma.Decimal(
                        "5000.00"
                    ),
                currency:
                    "ETB",
                commissionRate:
                    new Prisma.Decimal(
                        "0.035000"
                    ),
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
                "ACTIVE",
            currentPeriodStart:
                periodStart,
            currentPeriodEnd:
                periodEnd,
            actorUserId:
                null
        });

    const customer =
        await prisma.customer.create({
            data: {
                merchantId:
                    merchant.id,
                telegramUserId:
                    `${testPrefix}-tg-${suffix}`
            }
        });

    const product =
        await prisma.product.create({
            data: {
                merchantId:
                    merchant.id,
                name:
                    `${testPrefix}-product-${suffix}`,
                price:
                    new Prisma.Decimal(
                        "100.00"
                    ),
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
                    `${testPrefix}-order-${suffix}`,
                status:
                    OrderStatus.PAID,
                currency:
                    "ETB",
                subtotal:
                    new Prisma.Decimal(
                        "100.00"
                    ),
                total:
                    new Prisma.Decimal(
                        "100.00"
                    ),
                items: {
                    create: {
                        productId:
                            product.id,
                        productName:
                            product.name,
                        quantity:
                            1,
                        unitPrice:
                            new Prisma.Decimal(
                                "100.00"
                            ),
                        lineTotal:
                            new Prisma.Decimal(
                                "100.00"
                            )
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
                    new Prisma.Decimal(
                        "100.00"
                    ),
                currency:
                    "ETB",
                transactionReference:
                    `${testPrefix}-tx-${suffix}`
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
                            payment.id,
                        actorUserId:
                            null
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

beforeAll(
    async () => {
        await cleanup();

        const app =
            express();

        app.use(
            express.json()
        );

        app.use(
            "/platform",
            platformAdminRouter
        );

        await new Promise<void>(
            (resolve) => {
                server =
                    app.listen(
                        0,
                        "127.0.0.1",
                        () => {
                            const address =
                                server!.address();

                            if (
                                !address ||
                                typeof address ===
                                "string"
                            ) {
                                throw new Error(
                                    "Failed to start test server"
                                );
                            }

                            apiBaseUrl =
                                `http://127.0.0.1:${address.port}`;

                            resolve();
                        }
                    );
            }
        );
    }
);

beforeEach(
    async () => {
        await cleanup();
    }
);

afterAll(
    async () => {
        await cleanup();

        if (server) {
            await new Promise<void>(
                (resolve, reject) => {
                    server!.close(
                        (error) => {
                            if (error) {
                                reject(error);
                                return;
                            }

                            resolve();
                        }
                    );
                }
            );
        }
    }
);

describe(
    "platform administration routes",
    () => {
        it(
            "allows a platform user to initialize and transition a merchant subscription",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "subscription-lifecycle"
                    );

                const merchant =
                    await createMerchant(
                        "subscription-lifecycle"
                    );

                const plan =
                    await prisma.subscriptionPlan.create({
                        data: {
                            code:
                                `${testPrefix}-subscription-lifecycle`,
                            name:
                                "Platform Subscription Lifecycle Plan",
                            monthlyPrice:
                                "499.00",
                            annualPrice:
                                "4990.00",
                            currency:
                                "ETB",
                            commissionRate:
                                "0.050000",
                            features: {
                                source:
                                    testPrefix
                            },
                            isActive:
                                true
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

                const trialEndsAt =
                    new Date(
                        "2026-09-15T00:00:00.000Z"
                    );

                const initializeResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/subscription`,
                        {
                            method:
                                "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    planId:
                                        plan.id,
                                    billingInterval:
                                        "MONTHLY",
                                    status:
                                        "TRIAL",
                                    currentPeriodStart:
                                        currentPeriodStart.toISOString(),
                                    currentPeriodEnd:
                                        currentPeriodEnd.toISOString(),
                                    trialEndsAt:
                                        trialEndsAt.toISOString()
                                })
                        }
                    );

                expect(
                    initializeResponse.status
                ).toBe(
                    201
                );

                const initializeBody =
                    await initializeResponse.json() as {
                        subscription: {
                            id: string;
                            merchantId: string;
                            planId: string;
                            status: string;
                            billingInterval: string;
                        };
                    };

                expect(
                    initializeBody.subscription
                ).toMatchObject({
                    merchantId:
                        merchant.id,
                    planId:
                        plan.id,
                    status:
                        "TRIAL",
                    billingInterval:
                        "MONTHLY"
                });

                const persistedAfterInitialization =
                    await prisma.merchantSubscription.findUnique({
                        where: {
                            merchantId:
                                merchant.id
                        }
                    });

                expect(
                    persistedAfterInitialization
                ).not.toBeNull();

                expect(
                    persistedAfterInitialization?.status
                ).toBe(
                    "TRIAL"
                );

                const initializationAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_SUBSCRIPTION_INITIALIZED",
                            entityType:
                                "MERCHANT_SUBSCRIPTION",
                            entityId:
                                initializeBody.subscription.id
                        }
                    });

                expect(
                    initializationAudit
                ).not.toBeNull();

                const transitionResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/subscription/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "ACTIVE"
                                })
                        }
                    );

                expect(
                    transitionResponse.status
                ).toBe(
                    200
                );

                const transitionBody =
                    await transitionResponse.json() as {
                        subscription: {
                            id: string;
                            merchantId: string;
                            status: string;
                        };
                    };

                expect(
                    transitionBody.subscription
                ).toMatchObject({
                    id:
                        initializeBody.subscription.id,
                    merchantId:
                        merchant.id,
                    status:
                        "ACTIVE"
                });

                const persistedAfterTransition =
                    await prisma.merchantSubscription.findUnique({
                        where: {
                            merchantId:
                                merchant.id
                        }
                    });

                expect(
                    persistedAfterTransition?.status
                ).toBe(
                    "ACTIVE"
                );

                const transitionAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_SUBSCRIPTION_STATUS_CHANGED",
                            entityType:
                                "MERCHANT_SUBSCRIPTION",
                            entityId:
                                initializeBody.subscription.id
                        }
                    });

                expect(
                    transitionAudit
                ).not.toBeNull();

                expect(
                    transitionAudit?.metadata
                ).toMatchObject({
                    previousStatus:
                        "TRIAL",
                    nextStatus:
                        "ACTIVE"
                });
            }
        );

        it(
            "allows a platform user to suspend and reinstate a merchant account with reasons",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-account-enforcement"
                    );

                const merchant =
                    await createMerchant(
                        "merchant-account-enforcement"
                    );

                const suspendResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "SUSPENDED",
                                    reason:
                                        "Suspicious account activity"
                                })
                        }
                    );

                expect(
                    suspendResponse.status
                ).toBe(
                    200
                );

                const suspendBody =
                    await suspendResponse.json() as {
                        merchant: {
                            id: string;
                            accountStatus: string;
                            accountSuspensionReason:
                                string | null;
                            accountSuspendedAt:
                                string | null;
                        };
                    };

                expect(
                    suspendBody.merchant
                ).toMatchObject({
                    id:
                        merchant.id,
                    accountStatus:
                        "SUSPENDED",
                    accountSuspensionReason:
                        "Suspicious account activity"
                });

                expect(
                    suspendBody.merchant.accountSuspendedAt
                ).not.toBeNull();

                const reinstateResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "ACTIVE",
                                    reason:
                                        "Platform review completed"
                                })
                        }
                    );

                expect(
                    reinstateResponse.status
                ).toBe(
                    200
                );

                const reinstateBody =
                    await reinstateResponse.json() as {
                        merchant: {
                            id: string;
                            accountStatus: string;
                            accountSuspensionReason:
                                string | null;
                            accountSuspendedAt:
                                string | null;
                        };
                    };

                    expect(
                        reinstateBody.merchant
                    ).toMatchObject({
                        id:
                            merchant.id,
                        accountStatus:
                            "ACTIVE",
                        accountSuspensionReason:
                            null,
                        accountSuspendedAt:
                            null
                    });

                    const persistedMerchant =
                        await prisma.merchant.findUnique({
                            where: {
                                id: merchant.id
                            }
                        });

                    expect(
                        persistedMerchant
                    ).not.toBeNull();

                    expect(
                        persistedMerchant
                    ).toMatchObject({
                        accountStatus:
                            "ACTIVE",
                        accountSuspensionReason:
                            null,
                        accountSuspendedAt:
                            null
                    });

                    const accountAudits =
                        await prisma.platformAuditLog.findMany({
                            where: {
                                actorPlatformUserId:
                                    fixture.user.id,
                                merchantId:
                                    merchant.id,
                                action:
                                    "MERCHANT_ACCOUNT_STATUS_CHANGED",
                                entityType:
                                    "MERCHANT",
                                entityId:
                                    merchant.id
                            },
                            orderBy: {
                                createdAt:
                                    "asc"
                            }
                        });

                    expect(
                        accountAudits
                    ).toHaveLength(
                        2
                    );

                    expect(
                        accountAudits[0]?.metadata
                    ).toMatchObject({
                        previousStatus:
                            "ACTIVE",
                        nextStatus:
                            "SUSPENDED",
                        reason:
                            "Suspicious account activity"
                    });

                    expect(
                        accountAudits[1]?.metadata
                    ).toMatchObject({
                        previousStatus:
                            "SUSPENDED",
                        nextStatus:
                            "ACTIVE",
                        reason:
                            "Platform review completed"
                    });
                }
            );

        it(
            "rejects merchant account suspension without a reason",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-account-suspension-reason"
                    );

                const merchant =
                    await createMerchant(
                        "merchant-account-suspension-reason"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "SUSPENDED",
                                    reason:
                                        "   "
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(
                    400
                );

                const body =
                    await response.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant account status change reason is required"
                );

                const persistedMerchant =
                    await prisma.merchant.findUnique({
                        where: {
                            id: merchant.id
                        }
                    });

                expect(
                    persistedMerchant
                ).toMatchObject({
                    accountStatus:
                        "ACTIVE",
                    accountSuspensionReason:
                        null,
                    accountSuspendedAt:
                        null
                });

                const accountAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_ACCOUNT_STATUS_CHANGED"
                        }
                    });

                expect(
                    accountAudits
                ).toBe(
                    0
                );
            }
        );

        it(
            "rejects merchant account reinstatement without a reason",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-account-reinstatement-reason"
                    );

                const merchant =
                    await createMerchant(
                        "merchant-account-reinstatement-reason"
                    );

                const suspendResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "SUSPENDED",
                                    reason:
                                        "Suspicious account activity"
                                })
                        }
                    );

                expect(
                    suspendResponse.status
                ).toBe(
                    200
                );

                const reinstateResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "ACTIVE",
                                    reason:
                                        "   "
                                })
                        }
                    );

                expect(
                    reinstateResponse.status
                ).toBe(
                    400
                );

                const body =
                    await reinstateResponse.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant account status change reason is required"
                );

                const persistedMerchant =
                    await prisma.merchant.findUnique({
                        where: {
                            id: merchant.id
                        }
                    });

                expect(
                    persistedMerchant
                ).not.toBeNull();

                expect(
                    persistedMerchant
                ).toMatchObject({
                    accountStatus:
                        "SUSPENDED",
                    accountSuspensionReason:
                        "Suspicious account activity"
                });

                expect(
                    persistedMerchant?.accountSuspendedAt
                ).not.toBeNull();

                const accountAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_ACCOUNT_STATUS_CHANGED"
                        }
                    });

                expect(
                    accountAudits
                ).toHaveLength(
                    1
                );

                expect(
                    accountAudits[0]?.metadata
                ).toMatchObject({
                    previousStatus:
                        "ACTIVE",
                    nextStatus:
                        "SUSPENDED",
                    reason:
                        "Suspicious account activity"
                });
            }
        );

        it(
            "rejects an invalid merchant account status",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-account-invalid-status"
                    );

                const merchant =
                    await createMerchant(
                        "merchant-account-invalid-status"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "DISABLED",
                                    reason:
                                        "Invalid transition test"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(
                    400
                );

                const body =
                    await response.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Invalid merchant account status"
                );

                const persistedMerchant =
                    await prisma.merchant.findUnique({
                        where: {
                            id: merchant.id
                        }
                    });

                expect(
                    persistedMerchant
                ).toMatchObject({
                    accountStatus:
                        "ACTIVE",
                    accountSuspensionReason:
                        null,
                    accountSuspendedAt:
                        null
                });

                const accountAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_ACCOUNT_STATUS_CHANGED"
                        }
                    });

                expect(
                    accountAudits
                ).toBe(
                    0
                );
            }
        );

        it(
            "rejects a same-state merchant account transition",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-account-same-state"
                    );

                const merchant =
                    await createMerchant(
                        "merchant-account-same-state"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "ACTIVE",
                                    reason:
                                        "Same-state transition test"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(
                    400
                );

                const body =
                    await response.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant account is already ACTIVE"
                );

                const persistedMerchant =
                    await prisma.merchant.findUnique({
                        where: {
                            id: merchant.id
                        }
                    });

                expect(
                    persistedMerchant
                ).toMatchObject({
                    accountStatus:
                        "ACTIVE",
                    accountSuspensionReason:
                        null,
                    accountSuspendedAt:
                        null
                });

                const accountAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_ACCOUNT_STATUS_CHANGED"
                        }
                    });

                expect(
                    accountAudits
                ).toBe(
                    0
                );
            }
        );

        it(
            "returns 404 when changing account status for a nonexistent merchant",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-account-missing"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/nonexistent-merchant/account/status`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    nextStatus:
                                        "SUSPENDED",
                                    reason:
                                        "Missing merchant test"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(
                    404
                );

                const body =
                    await response.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant not found"
                );

                const accountAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                "nonexistent-merchant",
                            action:
                                "MERCHANT_ACCOUNT_STATUS_CHANGED"
                        }
                    });

                expect(
                    accountAudits
                ).toBe(
                    0
                );
            }
        );

        it(
            "allows a platform user to create, update, and deactivate a subscription plan",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "plan-lifecycle"
                    );

                const createResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/plans`,
                        {
                            method:
                                "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    code:
                                        `${testPrefix}-plan-lifecycle`,
                                    name:
                                        "Platform Plan Lifecycle",
                                    monthlyPrice:
                                        "399.00",
                                    annualPrice:
                                        "3990.00",
                                    currency:
                                        "ETB",
                                    commissionRate:
                                        "0.040000",
                                    features: {
                                        source:
                                            testPrefix
                                    },
                                    isActive:
                                        true
                                })
                        }
                    );

                expect(
                    createResponse.status
                ).toBe(
                    201
                );

                const createBody =
                    await createResponse.json() as {
                        plan: {
                            id: string;
                            code: string;
                            name: string;
                            currency: string;
                            isActive: boolean;
                        };
                    };

                expect(
                    createBody.plan
                ).toMatchObject({
                    code:
                        `${testPrefix}-plan-lifecycle`.toUpperCase(),
                    name:
                        "Platform Plan Lifecycle",
                    currency:
                        "ETB",
                    isActive:
                        true
                });

                const createdAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            action:
                                "SUBSCRIPTION_PLAN_CREATED",
                            entityType:
                                "SUBSCRIPTION_PLAN",
                            entityId:
                                createBody.plan.id
                        }
                    });

                expect(
                    createdAudit
                ).not.toBeNull();

                const updateResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/plans/${createBody.plan.id}`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    name:
                                        "Platform Plan Lifecycle Updated",
                                    monthlyPrice:
                                        "449.00",
                                    annualPrice:
                                        "4490.00",
                                    commissionRate:
                                        "0.045000",
                                    features: {
                                        source:
                                            testPrefix,
                                        updated:
                                            true
                                    }
                                })
                        }
                    );

                expect(
                    updateResponse.status
                ).toBe(
                    200
                );

                const updateBody =
                    await updateResponse.json() as {
                        plan: {
                            id: string;
                            name: string;
                            isActive: boolean;
                        };
                    };

                expect(
                    updateBody.plan
                ).toMatchObject({
                    id:
                        createBody.plan.id,
                    name:
                        "Platform Plan Lifecycle Updated",
                    isActive:
                        true
                });

                const updatedPlan =
                    await prisma.subscriptionPlan.findUnique({
                        where: {
                            id:
                                createBody.plan.id
                        }
                    });

                expect(
                    updatedPlan?.name
                ).toBe(
                    "Platform Plan Lifecycle Updated"
                );

                expect(
                    updatedPlan?.monthlyPrice.toString()
                ).toBe(
                    "449"
                );

                expect(
                    updatedPlan?.annualPrice.toString()
                ).toBe(
                    "4490"
                );

                expect(
                    updatedPlan?.commissionRate.toString()
                ).toBe(
                    "0.045"
                );

                const updatedAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            action:
                                "SUBSCRIPTION_PLAN_UPDATED",
                            entityType:
                                "SUBSCRIPTION_PLAN",
                            entityId:
                                createBody.plan.id
                        }
                    });

                expect(
                    updatedAudit
                ).not.toBeNull();

                const deactivateResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/plans/${createBody.plan.id}/active-state`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    isActive:
                                        false
                                })
                        }
                    );

                expect(
                    deactivateResponse.status
                ).toBe(
                    200
                );

                const deactivateBody =
                    await deactivateResponse.json() as {
                        plan: {
                            id: string;
                            isActive: boolean;
                        };
                    };

                expect(
                    deactivateBody.plan
                ).toMatchObject({
                    id:
                        createBody.plan.id,
                    isActive:
                        false
                });

                const persistedPlan =
                    await prisma.subscriptionPlan.findUnique({
                        where: {
                            id:
                                createBody.plan.id
                        }
                    });

                expect(
                    persistedPlan?.isActive
                ).toBe(
                    false
                );

                const deactivatedAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            action:
                                "SUBSCRIPTION_PLAN_DEACTIVATED",
                            entityType:
                                "SUBSCRIPTION_PLAN",
                            entityId:
                                createBody.plan.id
                        }
                    });

                expect(
                    deactivatedAudit
                ).not.toBeNull();

                expect(
                    deactivatedAudit?.metadata
                ).toMatchObject({
                    previousIsActive:
                        true,
                    nextIsActive:
                        false
                });
            }
        );

        it(
            "allows a platform user to generate and open a merchant invoice",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "invoice-lifecycle"
                    );

                const financialFixture =
                    await createInvoiceFinancialFixture(
                        "invoice-lifecycle"
                    );

                const invoiceNumber =
                    `${testPrefix}-invoice-lifecycle`;

                const generateResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${financialFixture.merchant.id}/billing/invoices`,
                        {
                            method:
                                "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    invoiceNumber,
                                    periodStart:
                                        "2026-09-01T00:00:00.000Z",
                                    periodEnd:
                                        "2026-10-01T00:00:00.000Z",
                                    dueAt:
                                        "2026-10-15T00:00:00.000Z"
                                })
                        }
                    );

                expect(
                    generateResponse.status
                ).toBe(
                    201
                );

                const generateBody =
                    await generateResponse.json() as {
                        invoice: {
                            id: string;
                            merchantId: string;
                            invoiceNumber: string;
                            status: string;
                        };
                    };

                expect(
                    generateBody.invoice.merchantId
                ).toBe(
                    financialFixture.merchant.id
                );

                expect(
                    generateBody.invoice.invoiceNumber
                ).toBe(
                    invoiceNumber
                );

                expect(
                    generateBody.invoice.status
                ).toBe(
                    "DRAFT"
                );

                const generatedInvoice =
                    await prisma.merchantInvoice.findUnique({
                        where: {
                            id:
                                generateBody.invoice.id
                        },
                        include: {
                            items:
                                true
                        }
                    });

                expect(
                    generatedInvoice
                ).not.toBeNull();

                expect(
                    generatedInvoice!.status
                ).toBe(
                    "DRAFT"
                );

                expect(
                    generatedInvoice!.merchantId
                ).toBe(
                    financialFixture.merchant.id
                );

                expect(
                    generatedInvoice!.items
                ).toHaveLength(
                    1
                );

                const invoicedCommission =
                    await prisma.commission.findUnique({
                        where: {
                            id:
                                financialFixture.commission.id
                        }
                    });

                    expect(
                        invoicedCommission!.status
                    ).toBe(
                        "INVOICED"
                    );

                    const commissionInvoiceItem =
                        await prisma.merchantInvoiceItem.findUnique({
                            where: {
                                commissionId:
                                    financialFixture.commission.id
                            }
                        });

                    expect(
                        commissionInvoiceItem
                    ).not.toBeNull();

                    expect(
                        commissionInvoiceItem!.invoiceId
                    ).toBe(
                        generatedInvoice!.id
                    );

                    expect(
                        commissionInvoiceItem!.merchantId
                    ).toBe(
                        financialFixture.merchant.id
                    );

                    const generationAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                financialFixture.merchant.id,
                            action:
                                "MERCHANT_INVOICE_GENERATED",
                            entityType:
                                "MERCHANT_INVOICE",
                            entityId:
                                generatedInvoice!.id
                        }
                    });

                expect(
                    generationAudit
                ).not.toBeNull();

                const openResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${financialFixture.merchant.id}/billing/invoices/${generatedInvoice!.id}/open`,
                        {
                            method:
                                "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`
                            }
                        }
                    );

                expect(
                    openResponse.status
                ).toBe(
                    200
                );

                const openBody =
                    await openResponse.json() as {
                        invoice: {
                            id: string;
                            status: string;
                            openedAt: string | null;
                        };
                    };

                expect(
                    openBody.invoice.id
                ).toBe(
                    generatedInvoice!.id
                );

                expect(
                    openBody.invoice.status
                ).toBe(
                    "OPEN"
                );

                expect(
                    openBody.invoice.openedAt
                ).not.toBeNull();

                const openedInvoice =
                    await prisma.merchantInvoice.findUnique({
                        where: {
                            id:
                                generatedInvoice!.id
                        }
                    });

                expect(
                    openedInvoice!.status
                ).toBe(
                    "OPEN"
                );

                expect(
                    openedInvoice!.openedAt
                ).not.toBeNull();

                const openingAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                financialFixture.merchant.id,
                            action:
                                "MERCHANT_INVOICE_OPENED",
                            entityType:
                                "MERCHANT_INVOICE",
                            entityId:
                                generatedInvoice!.id
                        }
                    });

                expect(
                    openingAudit
                ).not.toBeNull();

                expect(
                    openingAudit!.metadata
                ).toMatchObject({
                    previousStatus:
                        "DRAFT",
                    nextStatus:
                        "OPEN"
                });
            }
        );

        it(
            "allows an authenticated platform user to list subscription plans",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "plans"
                    );

                const plan =
                    await prisma.subscriptionPlan.create({
                        data: {
                            code:
                                `${testPrefix}-plans`,
                            name:
                                "Platform Route Test Plan",
                            monthlyPrice:
                                "499.00",
                            annualPrice:
                                "4990.00",
                            currency:
                                "ETB",
                            commissionRate:
                                "0.050000",
                            features: {
                                source:
                                    testPrefix
                            },
                            isActive:
                                true
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/plans`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        plans: Array<{
                            id: string;
                            code: string;
                            name: string;
                            currency: string;
                            isActive: boolean;
                            _count: {
                                subscriptions: number;
                            };
                        }>;
                    };

                const returnedPlan =
                    body.plans.find(
                        (candidate) =>
                            candidate.id ===
                            plan.id
                    );

                expect(
                    returnedPlan
                ).toMatchObject({
                    id:
                        plan.id,
                    code:
                        `${testPrefix}-plans`,
                    name:
                        "Platform Route Test Plan",
                    currency:
                        "ETB",
                    isActive:
                        true,
                    _count: {
                        subscriptions:
                            0
                    }
                });
            }
        );

        it(
            "returns only settlements requiring platform review",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "settlement-review"
                    );

                const merchant =
                    await createMerchant(
                        "settlement-review"
                    );

                const invoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-settlement-review`,
                            periodStart:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                new Prisma.Decimal(
                                    "500.00"
                                ),
                            commissionAmount:
                                new Prisma.Decimal(
                                    "50.00"
                                ),
                            totalAmount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OPEN,
                            openedAt:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                )
                        }
                    });

                const reviewSettlement =
                    await prisma.merchantSettlement.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceId:
                                invoice.id,
                            provider:
                                MerchantSettlementProvider
                                    .TELEBIRR,
                            status:
                                MerchantSettlementStatus
                                    .REVIEW_REQUIRED,
                            amount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            idempotencyKey:
                                `${testPrefix}-review-required`,
                            transactionReference:
                                `${testPrefix}-review-required-tx`
                        }
                    });

                const verifiedSettlement =
                    await prisma.merchantSettlement.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceId:
                                invoice.id,
                            provider:
                                MerchantSettlementProvider
                                    .CBE_BIRR,
                            status:
                                MerchantSettlementStatus
                                    .VERIFIED,
                            amount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            idempotencyKey:
                                `${testPrefix}-verified`,
                            transactionReference:
                                `${testPrefix}-verified-tx`,
                            verifiedAt:
                                new Date(
                                    "2026-10-02T10:00:00.000Z"
                                )
                        }
                    });

                const rejectedSettlement =
                    await prisma.merchantSettlement.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceId:
                                invoice.id,
                            provider:
                                MerchantSettlementProvider
                                    .TELEBIRR,
                            status:
                                MerchantSettlementStatus
                                    .REJECTED,
                            amount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            idempotencyKey:
                                `${testPrefix}-rejected`,
                            transactionReference:
                                `${testPrefix}-rejected-tx`
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/settlements/review`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        settlements: Array<{
                            id: string;
                            status: string;
                            merchant: {
                                id: string;
                                name: string;
                            };
                            invoice: {
                                id: string;
                                invoiceNumber: string;
                                status: string;
                            };
                        }>;
                    };

                expect(
                    body.settlements.some(
                        (settlement) =>
                            settlement.id ===
                            reviewSettlement.id
                    )
                ).toBe(true);

                expect(
                    body.settlements.some(
                        (settlement) =>
                            settlement.id ===
                            verifiedSettlement.id
                    )
                ).toBe(false);

                expect(
                    body.settlements.some(
                        (settlement) =>
                            settlement.id ===
                            rejectedSettlement.id
                    )
                ).toBe(false);

                const returnedSettlement =
                    body.settlements.find(
                        (settlement) =>
                            settlement.id ===
                            reviewSettlement.id
                    );

                expect(
                    returnedSettlement
                ).toMatchObject({
                    id:
                        reviewSettlement.id,
                    status:
                        "REVIEW_REQUIRED",
                    merchant: {
                        id:
                            merchant.id,
                        name:
                            merchant.name
                    },
                    invoice: {
                        id:
                            invoice.id,
                        invoiceNumber:
                            invoice.invoiceNumber,
                        status:
                            "OPEN"
                    }
                });
            }
        );

        it(
            "returns only resolved merchant settlements",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "settlement-resolved"
                    );

                const merchant =
                    await createMerchant(
                        "settlement-resolved"
                    );

                const invoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-settlement-resolved`,
                            periodStart:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                new Prisma.Decimal(
                                    "500.00"
                                ),
                            commissionAmount:
                                new Prisma.Decimal(
                                    "50.00"
                                ),
                            totalAmount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OPEN,
                            openedAt:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                )
                        }
                    });

                const reviewSettlement =
                    await prisma.merchantSettlement.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceId:
                                invoice.id,
                            provider:
                                MerchantSettlementProvider
                                    .TELEBIRR,
                            status:
                                MerchantSettlementStatus
                                    .REVIEW_REQUIRED,
                            amount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            idempotencyKey:
                                `${testPrefix}-resolved-review`,
                            transactionReference:
                                `${testPrefix}-resolved-review-tx`
                        }
                    });

                const verifiedSettlement =
                    await prisma.merchantSettlement.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceId:
                                invoice.id,
                            provider:
                                MerchantSettlementProvider
                                    .CBE_BIRR,
                            status:
                                MerchantSettlementStatus
                                    .VERIFIED,
                            amount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            idempotencyKey:
                                `${testPrefix}-resolved-verified`,
                            transactionReference:
                                `${testPrefix}-resolved-verified-tx`,
                            verifiedAt:
                                new Date(
                                    "2026-10-02T10:00:00.000Z"
                                )
                        }
                    });

                const rejectedSettlement =
                    await prisma.merchantSettlement.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceId:
                                invoice.id,
                            provider:
                                MerchantSettlementProvider
                                    .TELEBIRR,
                            status:
                                MerchantSettlementStatus
                                    .REJECTED,
                            amount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            idempotencyKey:
                                `${testPrefix}-resolved-rejected`,
                            transactionReference:
                                `${testPrefix}-resolved-rejected-tx`,
                            reviewNote:
                                "Payment evidence rejected"
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/settlements/resolved`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        settlements: Array<{
                            id: string;
                            status: string;
                            merchant: {
                                id: string;
                                name: string;
                            };
                            invoice: {
                                id: string;
                                invoiceNumber: string;
                            };
                        }>;
                    };

                expect(
                    body.settlements.some(
                        (settlement) =>
                            settlement.id ===
                            verifiedSettlement.id
                    )
                ).toBe(true);

                expect(
                    body.settlements.some(
                        (settlement) =>
                            settlement.id ===
                            rejectedSettlement.id
                    )
                ).toBe(true);

                expect(
                    body.settlements.some(
                        (settlement) =>
                            settlement.id ===
                            reviewSettlement.id
                    )
                ).toBe(false);

                expect(
                    body.settlements.find(
                        (settlement) =>
                            settlement.id ===
                            verifiedSettlement.id
                    )
                ).toMatchObject({
                    id:
                        verifiedSettlement.id,
                    status:
                        "VERIFIED",
                    merchant: {
                        id:
                            merchant.id,
                        name:
                            merchant.name
                    },
                    invoice: {
                        id:
                            invoice.id,
                        invoiceNumber:
                            invoice.invoiceNumber
                    }
                });

                expect(
                    body.settlements.find(
                        (settlement) =>
                            settlement.id ===
                            rejectedSettlement.id
                    )
                ).toMatchObject({
                    id:
                        rejectedSettlement.id,
                    status:
                        "REJECTED",
                    merchant: {
                        id:
                            merchant.id,
                        name:
                            merchant.name
                    },
                    invoice: {
                        id:
                            invoice.id,
                        invoiceNumber:
                            invoice.invoiceNumber
                    }
                });
            }
        );

        it(
            "returns only draft invoices for platform billing work",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "draft-invoices"
                    );

                const merchant =
                    await createMerchant(
                        "draft-invoices"
                    );

                const draftInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-draft-work`,
                            periodStart:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "50.00",
                            totalAmount:
                                "550.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.DRAFT
                        }
                    });

                const openInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-draft-work-open`,
                            periodStart:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-11-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "75.00",
                            totalAmount:
                                "575.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OPEN,
                            openedAt:
                                new Date(
                                    "2026-11-01T00:00:00.000Z"
                                )
                        }
                    });

                const paidInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-draft-work-paid`,
                            periodStart:
                                new Date(
                                    "2026-11-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-12-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "100.00",
                            totalAmount:
                                "600.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.PAID,
                            openedAt:
                                new Date(
                                    "2026-12-01T00:00:00.000Z"
                                ),
                            paidAt:
                                new Date(
                                    "2026-12-02T10:00:00.000Z"
                                )
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/invoices/draft`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        invoices: Array<{
                            id: string;
                            status: string;
                            invoiceNumber: string;
                            merchant: {
                                id: string;
                                name: string;
                                currency: string;
                            };
                        }>;
                    };

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            draftInvoice.id
                    )
                ).toBe(true);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            openInvoice.id
                    )
                ).toBe(false);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            paidInvoice.id
                    )
                ).toBe(false);

                const returnedInvoice =
                    body.invoices.find(
                        (invoice) =>
                            invoice.id ===
                            draftInvoice.id
                    );

                expect(
                    returnedInvoice
                ).toMatchObject({
                    id:
                        draftInvoice.id,
                    invoiceNumber:
                        draftInvoice.invoiceNumber,
                    status:
                        "DRAFT",
                    merchant: {
                        id:
                            merchant.id,
                        name:
                            merchant.name,
                        currency:
                            "ETB"
                    }
                });
            }
        );

        it(
            "returns only open invoices awaiting merchant payment",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "awaiting-payment"
                    );

                const merchant =
                    await createMerchant(
                        "awaiting-payment"
                    );

                const openInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-awaiting-payment-open`,
                            periodStart:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "75.00",
                            totalAmount:
                                "575.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OPEN,
                            openedAt:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            dueAt:
                                new Date(
                                    "2026-10-10T00:00:00.000Z"
                                )
                        }
                    });

                const draftInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-awaiting-payment-draft`,
                            periodStart:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-11-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "50.00",
                            totalAmount:
                                "550.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.DRAFT
                        }
                    });

                const overdueInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-awaiting-payment-overdue`,
                            periodStart:
                                new Date(
                                    "2026-08-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "100.00",
                            totalAmount:
                                "600.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OVERDUE,
                            openedAt:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            dueAt:
                                new Date(
                                    "2026-09-10T00:00:00.000Z"
                                )
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/invoices/awaiting-payment`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        invoices: Array<{
                            id: string;
                            invoiceNumber: string;
                            status: string;
                            merchant: {
                                id: string;
                                name: string;
                                currency: string;
                            };
                        }>;
                    };

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            openInvoice.id
                    )
                ).toBe(true);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            draftInvoice.id
                    )
                ).toBe(false);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            overdueInvoice.id
                    )
                ).toBe(false);

                const returnedInvoice =
                    body.invoices.find(
                        (invoice) =>
                            invoice.id ===
                            openInvoice.id
                    );

                expect(
                    returnedInvoice
                ).toMatchObject({
                    id:
                        openInvoice.id,
                    invoiceNumber:
                        openInvoice.invoiceNumber,
                    status:
                        "OPEN",
                    merchant: {
                        id:
                            merchant.id,
                        name:
                            merchant.name,
                        currency:
                            "ETB"
                    }
                });
            }
        );

        it(
            "returns only paid invoices from platform revenue",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "revenue"
                    );

                const merchant =
                    await createMerchant(
                        "revenue"
                    );

                const paidInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-paid`,
                            periodStart:
                                new Date(
                                    "2026-08-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-08-31T23:59:59.999Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "125.00",
                            totalAmount:
                                "625.00",
                            currency:
                                "ETB",
                            status:
                                "PAID",
                            paidAt:
                                new Date(
                                    "2026-09-05T10:00:00.000Z"
                                )
                        }
                    });

                const openInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-open`,
                            periodStart:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-09-30T23:59:59.999Z"
                                ),
                            subscriptionAmount:
                                "700.00",
                            commissionAmount:
                                "175.00",
                            totalAmount:
                                "875.00",
                            currency:
                                "ETB",
                            status:
                                "OPEN",
                            dueAt:
                                new Date(
                                    "2026-10-10T00:00:00.000Z"
                                )
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/revenue`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        invoices: Array<{
                            id: string;
                            status: string;
                            merchant: {
                                id: string;
                                name: string;
                                currency: string;
                            };
                        }>;
                    };

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            paidInvoice.id
                    )
                ).toBe(true);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            openInvoice.id
                    )
                ).toBe(false);

                const returnedInvoice =
                    body.invoices.find(
                        (invoice) =>
                            invoice.id ===
                            paidInvoice.id
                    );

                expect(
                    returnedInvoice
                ).toMatchObject({
                    id:
                        paidInvoice.id,
                    status:
                        "PAID",
                    merchant: {
                        id:
                            merchant.id,
                        name:
                            merchant.name,
                        currency:
                            "ETB"
                    }
                });
            }
        );

        it(
            "summarizes collected monthly platform revenue by currency",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "revenue-monthly-summary"
                    );

                const etbMerchant =
                    await createMerchant(
                        "revenue-monthly-summary-etb"
                    );

                const usdMerchant =
                    await createMerchant(
                        "revenue-monthly-summary-usd"
                    );

                await prisma.merchant.update({
                    where: {
                        id:
                            usdMerchant.id
                    },
                    data: {
                        currency:
                            "USD"
                    }
                });

                const createInvoice =
                    (
                        merchantId: string,
                        invoiceNumber: string,
                        periodStart: Date,
                        periodEnd: Date,
                        subscriptionAmount: string,
                        commissionAmount: string,
                        totalAmount: string,
                        currency: string,
                        status:
                            MerchantInvoiceStatus,
                        paidAt:
                            Date | null
                    ) =>
                        prisma.merchantInvoice.create({
                            data: {
                                merchantId,
                                invoiceNumber,
                                periodStart,
                                periodEnd,
                                subscriptionAmount,
                                commissionAmount,
                                totalAmount,
                                currency,
                                status,
                                paidAt
                            }
                        });

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-monthly-summary-start`,
                    new Date(
                        "2026-07-01T00:00:00.000Z"
                    ),
                    new Date(
                        "2026-08-01T00:00:00.000Z"
                    ),
                    "500.00",
                    "125.00",
                    "625.00",
                    "ETB",
                    MerchantInvoiceStatus.PAID,
                    new Date(
                        "2036-09-01T00:00:00.000Z"
                    )
                );

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-monthly-summary-etb`,
                    new Date(
                        "2026-08-01T00:00:00.000Z"
                    ),
                    new Date(
                        "2026-09-01T00:00:00.000Z"
                    ),
                    "700.00",
                    "175.00",
                    "875.00",
                    "ETB",
                    MerchantInvoiceStatus.PAID,
                    new Date(
                        "2036-09-20T12:00:00.000Z"
                    )
                );

                await createInvoice(
                    usdMerchant.id,
                    `${testPrefix}-monthly-summary-usd`,
                    new Date(
                        "2026-08-01T00:00:00.000Z"
                    ),
                    new Date(
                        "2026-09-01T00:00:00.000Z"
                    ),
                    "20.00",
                    "5.00",
                    "25.00",
                    "USD",
                    MerchantInvoiceStatus.PAID,
                    new Date(
                        "2036-09-15T08:00:00.000Z"
                    )
                );

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-monthly-summary-next-month`,
                    new Date(
                        "2026-09-01T00:00:00.000Z"
                    ),
                    new Date(
                        "2026-10-01T00:00:00.000Z"
                    ),
                    "900.00",
                    "225.00",
                    "1125.00",
                    "ETB",
                    MerchantInvoiceStatus.PAID,
                    new Date(
                        "2036-10-01T00:00:00.000Z"
                    )
                );

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-monthly-summary-open`,
                    new Date(
                        "2026-10-01T00:00:00.000Z"
                    ),
                    new Date(
                        "2026-11-01T00:00:00.000Z"
                    ),
                    "1000.00",
                    "250.00",
                    "1250.00",
                    "ETB",
                    MerchantInvoiceStatus.OPEN,
                    null
                );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/revenue/monthly-summary?month=2036-09`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        periodStart: string;
                        periodEnd: string;
                        currencies: Array<{
                            currency: string;
                            subscriptionAmount: string;
                            commissionAmount: string;
                            totalAmount: string;
                        }>;
                    };

                expect(
                    body.periodStart
                ).toBe(
                    "2036-09-01T00:00:00.000Z"
                );

                expect(
                    body.periodEnd
                ).toBe(
                    "2036-10-01T00:00:00.000Z"
                );

                expect(
                    body.currencies
                ).toEqual([
                    {
                        currency:
                            "ETB",
                        subscriptionAmount:
                            "1200.00",
                        commissionAmount:
                            "300.00",
                        totalAmount:
                            "1500.00"
                    },
                    {
                        currency:
                            "USD",
                        subscriptionAmount:
                            "20.00",
                        commissionAmount:
                            "5.00",
                        totalAmount:
                            "25.00"
                    }
                ]);
            }
        );

        it(
            "returns only overdue invoices from platform overdue billing",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "overdue"
                    );

                const merchant =
                    await createMerchant(
                        "overdue"
                    );

                const overdueInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-overdue`,
                            periodStart:
                                new Date(
                                    "2026-07-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-07-31T23:59:59.999Z"
                                ),
                            subscriptionAmount:
                                "600.00",
                            commissionAmount:
                                "150.00",
                            totalAmount:
                                "750.00",
                            currency:
                                "ETB",
                            status:
                                "OVERDUE",
                            dueAt:
                                new Date(
                                    "2026-08-10T00:00:00.000Z"
                                )
                        }
                    });

                const openInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-overdue-open`,
                            periodStart:
                                new Date(
                                    "2026-08-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-08-31T23:59:59.999Z"
                                ),
                            subscriptionAmount:
                                "800.00",
                            commissionAmount:
                                "200.00",
                            totalAmount:
                                "1000.00",
                            currency:
                                "ETB",
                            status:
                                "OPEN",
                            dueAt:
                                new Date(
                                    "2026-09-10T00:00:00.000Z"
                                )
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/overdue`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        invoices: Array<{
                            id: string;
                            status: string;
                            merchant: {
                                id: string;
                                name: string;
                                currency: string;
                            };
                        }>;
                    };

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            overdueInvoice.id
                    )
                ).toBe(true);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            openInvoice.id
                    )
                ).toBe(false);

                const returnedInvoice =
                    body.invoices.find(
                        (invoice) =>
                            invoice.id ===
                            overdueInvoice.id
                    );

                expect(
                    returnedInvoice
                ).toMatchObject({
                    id:
                        overdueInvoice.id,
                    status:
                        "OVERDUE",
                    merchant: {
                        id:
                            merchant.id,
                        name:
                            merchant.name,
                        currency:
                            "ETB"
                    }
                });
            }
        );

        it(
            "summarizes overdue invoices by due date for a custom UTC date range",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "overdue-range-summary"
                    );

                const etbMerchant =
                    await createMerchant(
                        "overdue-range-summary-etb"
                    );

                const usdMerchant =
                    await createMerchant(
                        "overdue-range-summary-usd",
                        "USD"
                    );

                let periodOffset =
                    0;

                const createInvoice =
                    (
                        merchantId: string,
                        invoiceNumber: string,
                        totalAmount: string,
                        currency: string,
                        status:
                            MerchantInvoiceStatus,
                        dueAt: Date
                    ) => {
                        const periodStart =
                            new Date(
                                Date.UTC(
                                    2037,
                                    periodOffset,
                                    1
                                )
                            );

                        const periodEnd =
                            new Date(
                                Date.UTC(
                                    2037,
                                    periodOffset + 1,
                                    1
                                )
                            );

                        periodOffset +=
                            1;

                        return prisma.merchantInvoice.create({
                            data: {
                                merchantId,
                                invoiceNumber,
                                periodStart,
                                periodEnd,
                                subscriptionAmount:
                                    totalAmount,
                                commissionAmount:
                                    "0.00",
                                totalAmount,
                                currency,
                                status,
                                openedAt:
                                    new Date(
                                        "2037-09-01T00:00:00.000Z"
                                    ),
                                dueAt
                            }
                        });
                    };

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-overdue-range-before`,
                    "100.00",
                    "ETB",
                    MerchantInvoiceStatus.OVERDUE,
                    new Date(
                        "2037-09-09T23:59:59.999Z"
                    )
                );

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-overdue-range-start`,
                    "200.00",
                    "ETB",
                    MerchantInvoiceStatus.OVERDUE,
                    new Date(
                        "2037-09-10T00:00:00.000Z"
                    )
                );

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-overdue-range-middle`,
                    "300.00",
                    "ETB",
                    MerchantInvoiceStatus.OVERDUE,
                    new Date(
                        "2037-09-20T12:00:00.000Z"
                    )
                );

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-overdue-range-end`,
                    "400.00",
                    "ETB",
                    MerchantInvoiceStatus.OVERDUE,
                    new Date(
                        "2037-10-01T00:00:00.000Z"
                    )
                );

                await createInvoice(
                    etbMerchant.id,
                    `${testPrefix}-overdue-range-open`,
                    "500.00",
                    "ETB",
                    MerchantInvoiceStatus.OPEN,
                    new Date(
                        "2037-09-15T00:00:00.000Z"
                    )
                );

                await createInvoice(
                    usdMerchant.id,
                    `${testPrefix}-overdue-range-usd`,
                    "25.00",
                    "USD",
                    MerchantInvoiceStatus.OVERDUE,
                    new Date(
                        "2037-09-25T00:00:00.000Z"
                    )
                );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/overdue/range-summary?start=2037-09-10&end=2037-10-01`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        periodStart: string;
                        periodEnd: string;
                        currencies: Array<{
                            currency: string;
                            invoiceCount: number;
                            totalAmount: string;
                        }>;
                    };

                expect(
                    body.periodStart
                ).toBe(
                    "2037-09-10T00:00:00.000Z"
                );

                expect(
                    body.periodEnd
                ).toBe(
                    "2037-10-01T00:00:00.000Z"
                );

                expect(
                    body.currencies
                ).toEqual([
                    {
                        currency:
                            "ETB",
                        invoiceCount:
                            2,
                        totalAmount:
                            "500.00"
                    },
                    {
                        currency:
                            "USD",
                        invoiceCount:
                            1,
                        totalAmount:
                            "25.00"
                    }
                ]);
            }
        );

        it(
            "summarizes collected platform revenue for a custom UTC date range",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "revenue-range-summary"
                    );

                const merchant =
                    await createMerchant(
                        "revenue-range-summary"
                    );

                const createInvoice =
                    (
                        invoiceNumber: string,
                        totalAmount: string,
                        paidAt: Date
                    ) =>
                        prisma.merchantInvoice.create({
                            data: {
                                merchantId:
                                    merchant.id,
                                invoiceNumber,
                                periodStart:
                                    paidAt,
                                periodEnd:
                                    new Date(
                                        paidAt.getTime() +
                                        4 * 60 * 60 * 1000
                                    ),
                                subscriptionAmount:
                                    totalAmount,
                                commissionAmount:
                                    "0.00",
                                totalAmount,
                                currency:
                                    "ETB",
                                status:
                                    MerchantInvoiceStatus.PAID,
                                paidAt
                            }
                        });

                await createInvoice(
                    `${testPrefix}-range-before`,
                    "100.00",
                    new Date(
                        "2036-09-09T23:59:59.999Z"
                    )
                );

                await createInvoice(
                    `${testPrefix}-range-start`,
                    "200.00",
                    new Date(
                        "2036-09-10T00:00:00.000Z"
                    )
                );

                await createInvoice(
                    `${testPrefix}-range-middle`,
                    "300.00",
                    new Date(
                        "2036-09-20T12:00:00.000Z"
                    )
                );

                await createInvoice(
                    `${testPrefix}-range-end`,
                    "400.00",
                    new Date(
                        "2036-10-01T00:00:00.000Z"
                    )
                );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/revenue/range-summary?start=2036-09-10&end=2036-10-01`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        periodStart: string;
                        periodEnd: string;
                        currencies: Array<{
                            currency: string;
                            subscriptionAmount: string;
                            commissionAmount: string;
                            totalAmount: string;
                        }>;
                    };

                expect(
                    body.periodStart
                ).toBe(
                    "2036-09-10T00:00:00.000Z"
                );

                expect(
                    body.periodEnd
                ).toBe(
                    "2036-10-01T00:00:00.000Z"
                );

                expect(
                    body.currencies
                ).toEqual([
                    {
                        currency:
                            "ETB",
                        subscriptionAmount:
                            "500.00",
                        commissionAmount:
                            "0.00",
                        totalAmount:
                            "500.00"
                    }
                ]);
            }
        );

        it(
            "returns paid invoices by paid date for a custom UTC date range",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "revenue-range-list"
                    );

                const merchant =
                    await createMerchant(
                        "revenue-range-list"
                    );

                const createInvoice =
                    (
                        invoiceNumber: string,
                        totalAmount: string,
                        paidAt: Date
                    ) =>
                        prisma.merchantInvoice.create({
                            data: {
                                merchantId:
                                    merchant.id,
                                invoiceNumber,
                                periodStart:
                                    paidAt,
                                periodEnd:
                                    new Date(
                                        paidAt.getTime() +
                                        4 * 60 * 60 * 1000
                                    ),
                                subscriptionAmount:
                                    totalAmount,
                                commissionAmount:
                                    "0.00",
                                totalAmount,
                                currency:
                                    "ETB",
                                status:
                                    MerchantInvoiceStatus.PAID,
                                paidAt
                            }
                        });

                const beforeInvoice =
                    await createInvoice(
                        `${testPrefix}-revenue-list-before`,
                        "100.00",
                        new Date(
                            "2039-09-09T23:59:59.999Z"
                        )
                    );

                const startInvoice =
                    await createInvoice(
                        `${testPrefix}-revenue-list-start`,
                        "200.00",
                        new Date(
                            "2039-09-10T00:00:00.000Z"
                        )
                    );

                const middleInvoice =
                    await createInvoice(
                        `${testPrefix}-revenue-list-middle`,
                        "300.00",
                        new Date(
                            "2039-09-20T12:00:00.000Z"
                        )
                    );

                const endInvoice =
                    await createInvoice(
                        `${testPrefix}-revenue-list-end`,
                        "400.00",
                        new Date(
                            "2039-10-01T00:00:00.000Z"
                        )
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/revenue/range?start=2039-09-10&end=2039-10-01`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        periodStart: string;
                        periodEnd: string;
                        invoices: Array<{
                            id: string;
                            invoiceNumber: string;
                            subscriptionAmount: string;
                            commissionAmount: string;
                            totalAmount: string;
                            currency: string;
                            status:
                                MerchantInvoiceStatus;
                            paidAt: string | null;
                            merchant: {
                                id: string;
                                name: string;
                                currency: string;
                            };
                        }>;
                    };

                expect(
                    body.periodStart
                ).toBe(
                    "2039-09-10T00:00:00.000Z"
                );

                expect(
                    body.periodEnd
                ).toBe(
                    "2039-10-01T00:00:00.000Z"
                );

                expect(
                    body.invoices.map(
                        invoice =>
                            invoice.id
                    )
                ).toEqual([
                    startInvoice.id,
                    middleInvoice.id
                ]);

                expect(
                    body.invoices
                ).toEqual([
                    expect.objectContaining({
                        id:
                            startInvoice.id,
                        invoiceNumber:
                            startInvoice.invoiceNumber,
                        subscriptionAmount:
                            "200.00",
                        commissionAmount:
                            "0.00",
                        totalAmount:
                            "200.00",
                        currency:
                            "ETB",
                        status:
                            MerchantInvoiceStatus.PAID,
                        paidAt:
                            "2039-09-10T00:00:00.000Z",
                        merchant: {
                            id:
                                merchant.id,
                            name:
                                merchant.name,
                            currency:
                                merchant.currency
                        }
                    }),
                    expect.objectContaining({
                        id:
                            middleInvoice.id,
                        invoiceNumber:
                            middleInvoice.invoiceNumber,
                        totalAmount:
                            "300.00",
                        paidAt:
                            "2039-09-20T12:00:00.000Z"
                    })
                ]);

                expect(
                    body.invoices.some(
                        invoice =>
                            invoice.id ===
                            beforeInvoice.id
                    )
                ).toBe(false);

                expect(
                    body.invoices.some(
                        invoice =>
                            invoice.id ===
                            endInvoice.id
                    )
                ).toBe(false);
            }
        );

        it(
            "rejects invalid calendar dates for platform revenue ranges",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "revenue-range-invalid-date"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/revenue/range-summary?start=2036-02-31&end=2036-03-10`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(400);

                expect(
                    await response.json()
                ).toEqual({
                    error:
                        "start and end must define a valid date range"
                });
            }
        );

        it(
            "returns overdue invoices by due date for a custom UTC date range",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "overdue-range-list"
                    );

                const merchant =
                    await createMerchant(
                        "overdue-range-list"
                    );

                const beforeInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-overdue-list-before`,
                            periodStart:
                                new Date(
                                    "2038-01-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2038-02-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "100.00",
                            commissionAmount:
                                "10.00",
                            totalAmount:
                                "110.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OVERDUE,
                            openedAt:
                                new Date(
                                    "2038-01-01T00:00:00.000Z"
                                ),
                            dueAt:
                                new Date(
                                    "2038-02-09T23:59:59.999Z"
                                )
                        }
                    });

                const startInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-overdue-list-start`,
                            periodStart:
                                new Date(
                                    "2038-02-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2038-03-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "200.00",
                            commissionAmount:
                                "20.00",
                            totalAmount:
                                "220.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OVERDUE,
                            openedAt:
                                new Date(
                                    "2038-02-01T00:00:00.000Z"
                                ),
                            dueAt:
                                new Date(
                                    "2038-02-10T00:00:00.000Z"
                                )
                        }
                    });

                const middleInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-overdue-list-middle`,
                            periodStart:
                                new Date(
                                    "2038-03-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2038-04-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "300.00",
                            commissionAmount:
                                "30.00",
                            totalAmount:
                                "330.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OVERDUE,
                            openedAt:
                                new Date(
                                    "2038-03-01T00:00:00.000Z"
                                ),
                            dueAt:
                                new Date(
                                    "2038-02-20T12:00:00.000Z"
                                )
                        }
                    });

                const endInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-overdue-list-end`,
                            periodStart:
                                new Date(
                                    "2038-04-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2038-05-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "400.00",
                            commissionAmount:
                                "40.00",
                            totalAmount:
                                "440.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OVERDUE,
                            openedAt:
                                new Date(
                                    "2038-04-01T00:00:00.000Z"
                                ),
                            dueAt:
                                new Date(
                                    "2038-03-01T00:00:00.000Z"
                                )
                        }
                    });

                const openInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-overdue-list-open`,
                            periodStart:
                                new Date(
                                    "2038-05-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2038-06-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                "500.00",
                            commissionAmount:
                                "50.00",
                            totalAmount:
                                "550.00",
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OPEN,
                            openedAt:
                                new Date(
                                    "2038-05-01T00:00:00.000Z"
                                ),
                            dueAt:
                                new Date(
                                    "2038-02-15T00:00:00.000Z"
                                )
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/overdue/range?start=2038-02-10&end=2038-03-01`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        periodStart: string;
                        periodEnd: string;
                        invoices: Array<{
                            id: string;
                            invoiceNumber: string;
                            subscriptionAmount: string;
                            commissionAmount: string;
                            totalAmount: string;
                            currency: string;
                            status:
                                MerchantInvoiceStatus;
                            dueAt: string | null;
                            merchant: {
                                id: string;
                                name: string;
                                currency: string;
                            };
                        }>;
                    };

                expect(
                    body.periodStart
                ).toBe(
                    "2038-02-10T00:00:00.000Z"
                );

                expect(
                    body.periodEnd
                ).toBe(
                    "2038-03-01T00:00:00.000Z"
                );

                expect(
                    body.invoices.map(
                        (invoice) =>
                            invoice.id
                    )
                ).toEqual([
                    startInvoice.id,
                    middleInvoice.id
                ]);

                expect(
                    body.invoices
                ).toEqual([
                    expect.objectContaining({
                        id:
                            startInvoice.id,
                        invoiceNumber:
                            startInvoice.invoiceNumber,
                        subscriptionAmount:
                            "200.00",
                        commissionAmount:
                            "20.00",
                        totalAmount:
                            "220.00",
                        currency:
                            "ETB",
                        status:
                            MerchantInvoiceStatus.OVERDUE,
                        dueAt:
                            "2038-02-10T00:00:00.000Z",
                        merchant: {
                            id:
                                merchant.id,
                            name:
                                merchant.name,
                            currency:
                                merchant.currency
                        }
                    }),
                    expect.objectContaining({
                        id:
                            middleInvoice.id,
                        invoiceNumber:
                            middleInvoice.invoiceNumber,
                        totalAmount:
                            "330.00",
                        dueAt:
                            "2038-02-20T12:00:00.000Z"
                    })
                ]);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            beforeInvoice.id
                    )
                ).toBe(false);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            endInvoice.id
                    )
                ).toBe(false);

                expect(
                    body.invoices.some(
                        (invoice) =>
                            invoice.id ===
                            openInvoice.id
                    )
                ).toBe(false);
            }
        );

        it(
            "rejects invalid calendar dates for platform overdue ranges",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "overdue-range-invalid-date"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/overdue/range-summary?start=2036-02-31&end=2036-03-10`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(400);

                expect(
                    await response.json()
                ).toEqual({
                    error:
                        "start and end must define a valid date range"
                });
            }
        );

        it(
            "returns platform audit records with their platform actor",
            async () => {
                const {
                    user,
                    token
                } =
                    await createPlatformFixture(
                        "audit"
                    );

                const auditLog =
                    await prisma.platformAuditLog.create({
                        data: {
                            actorPlatformUserId:
                                user.id,
                            action:
                                "TEST_PLATFORM_ROUTE",
                            entityType:
                                "TEST_ENTITY",
                            entityId:
                                `${testPrefix}-audit-entity`,
                            metadata: {
                                source:
                                    testPrefix
                            }
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/audit`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        auditLogs: Array<{
                            id: string;
                            action: string;
                            entityType: string;
                            entityId: string;
                            actor: {
                                id: string;
                                email: string;
                                displayName: string | null;
                            };
                        }>;
                    };

                const returnedAuditLog =
                    body.auditLogs.find(
                        (candidate) =>
                            candidate.id ===
                            auditLog.id
                    );

                expect(
                    returnedAuditLog
                ).toMatchObject({
                    id:
                        auditLog.id,
                    action:
                        "TEST_PLATFORM_ROUTE",
                    entityType:
                        "TEST_ENTITY",
                    entityId:
                        `${testPrefix}-audit-entity`,
                    actor: {
                        id:
                            user.id,
                        email:
                            user.email,
                        displayName:
                            user.displayName
                    }
                });
            }
        );

        it(
            "allows an authenticated platform user to mark a past-due OPEN invoice OVERDUE",
            async () => {
                const {
                    user,
                    token
                } =
                    await createPlatformFixture(
                        "mark-invoice-overdue"
                    );

                const merchant =
                    await createMerchant(
                        "mark-invoice-overdue"
                    );

                const dueAt =
                    new Date(
                        Date.now() -
                        60_000
                    );

                const invoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-mark-invoice-overdue`,
                            periodStart:
                                new Date(
                                    "2026-08-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            subscriptionAmount:
                                new Prisma.Decimal(
                                    "500.00"
                                ),
                            commissionAmount:
                                new Prisma.Decimal(
                                    "50.00"
                                ),
                            totalAmount:
                                new Prisma.Decimal(
                                    "550.00"
                                ),
                            currency:
                                "ETB",
                            status:
                                MerchantInvoiceStatus.OPEN,
                            openedAt:
                                new Date(
                                    "2026-09-01T00:00:00.000Z"
                                ),
                            dueAt
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/billing/invoices/${invoice.id}/overdue`,
                        {
                            method:
                                "POST",
                            headers: {
                                authorization:
                                    `Bearer ${token}`
                            }
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        invoice: {
                            id: string;
                            status: string;
                        };
                    };

                expect(
                    body.invoice.id
                ).toBe(
                    invoice.id
                );

                expect(
                    body.invoice.status
                ).toBe(
                    "OVERDUE"
                );

                const storedInvoice =
                    await prisma.merchantInvoice.findUnique({
                        where: {
                            id:
                                invoice.id
                        }
                    });

                expect(
                    storedInvoice!.status
                ).toBe(
                    MerchantInvoiceStatus.OVERDUE
                );

                const platformAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_INVOICE_MARKED_OVERDUE",
                            entityType:
                                "MERCHANT_INVOICE",
                            entityId:
                                invoice.id
                        }
                    });

                expect(
                    platformAudit
                ).not.toBeNull();

                expect(
                    platformAudit!.metadata
                ).toMatchObject({
                    previousStatus:
                        "OPEN",
                    nextStatus:
                        "OVERDUE",
                    dueAt:
                        dueAt.toISOString()
                });
            }
        );

    }
);
