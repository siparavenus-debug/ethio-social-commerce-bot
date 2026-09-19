import type {
    Server
} from "node:http";

import express from "express";

import {
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
    }
);
