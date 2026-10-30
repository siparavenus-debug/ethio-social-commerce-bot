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

import authRouter
    from "../src/routes/auth.js";

import {
    authenticateUser,
    createAuthToken,
    hashPassword,
    verifyPassword
} from "../src/services/auth.js";

import {
    createPlatformAuthToken
} from "../src/services/platform-auth.js";

import {
    accrueCommission
} from "../src/services/commission.js";

import {
    initializeMerchantSubscription
} from "../src/services/subscription.js";

import {
    decryptMerchantInvitation
} from "../src/services/merchant-invitation-encryption.js";

import { kMaxLength } from "node:buffer";

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

    await prisma.merchantOnboardingApplication.deleteMany({
        where: {
            name: {
                startsWith: testPrefix
            }
        }
    });

    await prisma.merchantInvitationDelivery.deleteMany({
        where: {
            activation: {
                merchantId: {
                    in: testMerchantIds
                }
            }
        }
    });

    await prisma.merchantOwnerActivation.deleteMany({
        where: {
            merchantId: {
                in: testMerchantIds
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
    suffix: string,
    role:
        "OWNER" |
        "ADMIN" |
        "STAFF" =
        "OWNER"
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
                role,
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

    await prisma.commission.update({
        where: {
            id:
                commission.id
        },
        data: {
            createdAt:
                new Date(
                    "2026-09-15T00:00:00.000Z"
                )
        }
    });

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

        app.use(
            "/auth",
            authRouter
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
            "allows STAFF to list pending onboarding applications",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "onboarding-staff-list",
                        "STAFF"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Staff Listing`,
                            currency: "ETB",
                            phone: "+251911000002",
                            ownerEmail:
                                `${testPrefix}-staff-list@example.com`,
                            createdById: fixture.user.id
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`
                            }
                        }
                    );

                expect(response.status).toBe(200);

                const body =
                    await response.json() as {
                        applications: Array<{
                            id: string;
                            status: string;
                            createdById: string;
                        }>;
                    };

                expect(body.applications).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            id: application.id,
                            status: "PENDING_APPROVAL",
                            createdById: fixture.user.id
                        })
                    ])
                );
            }
        );

        it(
            "rejects merchant OWNER access to onboarding application listing",
            async () => {
                const merchant =
                    await createMerchant(
                        "onboarding-list-boundary"
                    );

                const owner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId: merchant.id,
                            email:
                                `${testPrefix}-list-boundary-owner@example.test`,
                            passwordHash:
                                await hashPassword(
                                    "BoundaryOwnerPassword123!"
                                ),
                            displayName: "Boundary Owner",
                            role: "OWNER",
                            tokenVersion: 0
                        }
                    });

                const merchantToken =
                    createAuthToken({
                        id: owner.id,
                        merchantId: merchant.id,
                        role: owner.role,
                        tokenVersion: owner.tokenVersion
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${merchantToken}`
                            }
                        }
                    );

                expect(response.status).toBe(403);
            }
        );

        it(
            "rejects unauthenticated onboarding application listing",
            async () => {
                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`
                    );

                expect(response.status).toBe(401);
            }
        );

        it(
            "allows STAFF to submit onboarding without provisioning a merchant",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "onboarding-staff-create",
                        "STAFF"
                    );

                const merchantName =
                    `${testPrefix} Pending Onboarding Merchant`;

                const ownerEmail =
                    `${testPrefix}-pending-onboarding-owner@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name: merchantName,
                                currency: "ETB",
                                phone: "+251911000001",
                                ownerEmail,
                                ownerDisplayName:
                                    "Pending Merchant Owner"
                            })
                        }
                    );

                expect(response.status).toBe(201);

                const body =
                    await response.json() as {
                        id: string;
                        status: string;
                    };

                expect(body.id).toBeTruthy();

                expect(body.status).toBe(
                    "PENDING_APPROVAL"
                );

                const savedApplication =
                    await prisma.merchantOnboardingApplication.findUnique({
                        where: {
                            id: body.id
                        }
                    });

                expect(savedApplication).not.toBeNull();

                expect(savedApplication).toMatchObject({
                    name: merchantName,
                    currency: "ETB",
                    phone: "+251911000001",
                    ownerEmail,
                    status: "PENDING_APPROVAL",
                    createdById: fixture.user.id,
                    reviewedById: null,
                    merchantId: null
                });

                const auditLog =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId: fixture.user.id,
                            action: "MERCHANT_ONBOARDING_SUBMITTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: body.id
                        }
                    });

                expect(auditLog).not.toBeNull();

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name: merchantName
                        }
                    });

                expect(merchant).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email: ownerEmail
                        }
                    });

                expect(owner).toBeNull();
            }
        );

        it(
            "rejects unauthenticated merchant onboarding submission",
            async () => {
                const merchantName =
                    `${testPrefix} Unauthenticated Onboarding`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                name: merchantName,
                                currency: "ETB",
                                phone: "+251911000002",
                                ownerEmail:
                                    `${testPrefix}-unauthenticated-onboarding@example.com`
                            })
                        }
                    );

                expect(response.status).toBe(401);

                const application =
                    await prisma.merchantOnboardingApplication.findFirst({
                        where: {
                            name: merchantName
                        }
                    });

                expect(application).toBeNull();

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name: merchantName
                        }
                    });

                expect(merchant).toBeNull();
            }
        );

        it(
            "rejects merchant OWNER access to platform onboarding",
            async () => {
                const merchant =
                    await createMerchant(
                        "onboarding-merchant-boundary"
                    );

                const owner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId: merchant.id,
                            email:
                                `${testPrefix}-onboarding-boundary-owner@example.test`,
                            passwordHash:
                                await hashPassword(
                                    "BoundaryOwnerPassword123!"
                                ),
                            displayName: "Boundary Owner",
                            role: "OWNER",
                            tokenVersion: 0
                        }
                    });

                const merchantToken =
                    createAuthToken({
                        id: owner.id,
                        merchantId: merchant.id,
                        role: owner.role,
                        tokenVersion: owner.tokenVersion
                    });

                const applicationName =
                    `${testPrefix} Merchant Boundary Onboarding`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${merchantToken}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name: applicationName,
                                currency: "ETB",
                                phone: "+251911000003",
                                ownerEmail:
                                    `${testPrefix}-boundary-applicant@example.test`
                            })
                        }
                    );

                expect(response.status).toBe(403);

                const application =
                    await prisma.merchantOnboardingApplication.findFirst({
                        where: {
                            name: applicationName
                        }
                    });

                expect(application).toBeNull();

                const provisionedMerchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name: applicationName
                        }
                    });

                expect(provisionedMerchant).toBeNull();
            }
        );

        it(
            "denies STAFF approval of merchant onboarding",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "onboarding-staff-approval",
                        "STAFF"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Staff Approval Boundary`,
                            currency: "ETB",
                            phone: "+251911000004",
                            ownerEmail:
                                `${testPrefix}-staff-approval@example.test`,
                            createdById: fixture.user.id
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                expect(response.status).toBe(403);

                const unchanged =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(unchanged.status).toBe(
                    "PENDING_APPROVAL"
                );
                expect(unchanged.reviewedById).toBeNull();
                expect(unchanged.merchantId).toBeNull();

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name: application.name
                        }
                    });

                expect(merchant).toBeNull();
            }
        );

        it(
            "allows ADMIN to approve a pending merchant onboarding application",
            async () => {
                const staff =
                    await createPlatformFixture(
                        "onboarding-approval-creator",
                        "STAFF"
                    );

                const admin =
                    await createPlatformFixture(
                        "onboarding-approval-reviewer",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Approved Onboarding`,
                            currency: "ETB",
                            phone: "+251911000005",
                            ownerEmail:
                                `${testPrefix}-approved-onboarding@example.test`,
                            ownerDisplayName: "Approved Owner",
                            createdById: staff.user.id
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${admin.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                expect(response.status).toBe(200);

                const approved =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(approved.status).toBe("APPROVED");
                expect(approved.reviewedById).toBe(admin.user.id);
                expect(approved.reviewedAt).not.toBeNull();
                expect(approved.merchantId).not.toBeNull();

                const merchant =
                    await prisma.merchant.findUniqueOrThrow({
                        where: {
                            id: approved.merchantId!
                        }
                    });

                expect(merchant).toMatchObject({
                    name: application.name,
                    currency: "ETB",
                    phone: application.phone
                });

                const auditLog =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId: admin.user.id,
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(auditLog).not.toBeNull();

                const activations =
                    await prisma.merchantOwnerActivation.findMany({
                        where: {
                            merchantId: merchant.id
                        }
                    });

                expect(activations).toHaveLength(1);

                const activation = activations[0]!;

                const deliveries =
                    await prisma.merchantInvitationDelivery.findMany({
                        where: {
                            activationId: activation.id
                        }
                    });

                expect(deliveries).toHaveLength(1);

                expect(deliveries[0]).toMatchObject({
                    activationId: activation.id,
                    recipientEmail: application.ownerEmail,
                    status: "PENDING",
                    attemptCount: 0
                });

                expect(deliveries[0]!.encryptedToken).toMatch(
                    /^v1\.[^.]+\.[^.]+\.[^.]+$/
                );

                expect(deliveries[0]!.sentAt).toBeNull();
                expect(deliveries[0]!.processingUntil).toBeNull();
            }
        );

        it(
            "prevents ADMIN from approving their own merchant onboarding application",
            async () => {
                const admin =
                    await createPlatformFixture(
                        "onboarding-self-approval",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Self Approval Blocked`,
                            currency: "ETB",
                            phone: "+251911000006",
                            ownerEmail:
                                `${testPrefix}-self-approval@example.test`,
                            createdById: admin.user.id
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${admin.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                expect(response.status).toBe(403);

                const unchanged =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(unchanged.status).toBe("PENDING_APPROVAL");
                expect(unchanged.reviewedById).toBeNull();
                expect(unchanged.reviewedAt).toBeNull();
                expect(unchanged.merchantId).toBeNull();

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name: application.name
                        }
                    });

                expect(merchant).toBeNull();

                const activationCount =
                    await prisma.merchantOwnerActivation.count({
                        where: {
                            ownerEmail: application.ownerEmail
                        }
                    });

                expect(activationCount).toBe(0);

                const approvalAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(approvalAudit).toBeNull();
            }
        );

        it(
            "prevents duplicate approval of a merchant onboarding application",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-duplicate-creator",
                        "STAFF"
                    );

                const firstAdmin =
                    await createPlatformFixture(
                        "onboarding-duplicate-first-admin",
                        "ADMIN"
                    );

                const secondAdmin =
                    await createPlatformFixture(
                        "onboarding-duplicate-second-admin",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Duplicate Approval Blocked`,
                            currency: "ETB",
                            phone: "+251911000007",
                            ownerEmail:
                                `${testPrefix}-duplicate-approval@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const approvalUrl =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/approve`;

                const approveAs = (token: string) =>
                    fetch(approvalUrl, {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({})
                    });

                const firstResponse =
                    await approveAs(firstAdmin.token);

                expect(firstResponse.status).toBe(200);

                const firstApproved =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(firstApproved.status).toBe("APPROVED");
                expect(firstApproved.merchantId).not.toBeNull();
                expect(firstApproved.reviewedById).toBe(
                    firstAdmin.user.id
                );

                const secondResponse =
                    await approveAs(secondAdmin.token);

                expect(secondResponse.status).toBe(409);

                const afterSecondAttempt =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(afterSecondAttempt.status).toBe("APPROVED");
                expect(afterSecondAttempt.merchantId).toBe(
                    firstApproved.merchantId
                );
                expect(afterSecondAttempt.reviewedById).toBe(
                    firstAdmin.user.id
                );
                expect(afterSecondAttempt.reviewedAt).toEqual(
                    firstApproved.reviewedAt
                );

                const merchantCount =
                    await prisma.merchant.count({
                        where: {
                            name: application.name
                        }
                    });

                expect(merchantCount).toBe(1);

                const activationCount =
                    await prisma.merchantOwnerActivation.count({
                        where: {
                            merchantId: firstApproved.merchantId!
                        }
                    });

                expect(activationCount).toBe(1);

                const deliveryCount =
                    await prisma.merchantInvitationDelivery.count({
                        where: {
                            activation: {
                                merchantId: firstApproved.merchantId!
                            }
                        }
                    });

                expect(deliveryCount).toBe(1);

                const approvalAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(approvalAudits).toHaveLength(1);
                expect(approvalAudits[0]?.actorPlatformUserId).toBe(
                    firstAdmin.user.id
                );
            }
        );

        it(
            "returns 404 when approving a nonexistent merchant onboarding application",
            async () => {
                const admin =
                    await createPlatformFixture(
                        "onboarding-approval-missing",
                        "ADMIN"
                    );

                const applicationId =
                    "nonexistent-onboarding-application";

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${applicationId}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${admin.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                expect(response.status).toBe(404);

                expect(await response.json()).toEqual({
                    error: "Onboarding application not found"
                });

                const applicationCount =
                    await prisma.merchantOnboardingApplication.count({
                        where: {
                            id: applicationId
                        }
                    });

                expect(applicationCount).toBe(0);

                const approvalAuditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: applicationId
                        }
                    });

                expect(approvalAuditCount).toBe(0);
            }
        );

        it(
            "allows ADMIN to reject a pending merchant onboarding application",
            async () => {
                const staff =
                    await createPlatformFixture(
                        "onboarding-rejection-creator",
                        "STAFF"
                    );

                const admin =
                    await createPlatformFixture(
                        "onboarding-rejection-reviewer",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Rejected Onboarding`,
                            currency: "ETB",
                            phone: "+251911000008",
                            ownerEmail:
                                `${testPrefix}-rejected-onboarding@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const reason =
                    "Merchant application details require correction";

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/reject`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${admin.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                reason
                            })
                        }
                    );

                expect(response.status).toBe(200);

                const rejected =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(rejected.status).toBe("REJECTED");
                expect(rejected.reviewedById).toBe(admin.user.id);
                expect(rejected.reviewedAt).not.toBeNull();
                expect(rejected.reviewReason).toBe(reason);
                expect(rejected.merchantId).toBeNull();

                const merchantCount =
                    await prisma.merchant.count({
                        where: {
                            name: application.name
                        }
                    });

                expect(merchantCount).toBe(0);

                const activationCount =
                    await prisma.merchantOwnerActivation.count({
                        where: {
                            ownerEmail: application.ownerEmail
                        }
                    });

                expect(activationCount).toBe(0);

                const auditLogs =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            actorPlatformUserId: admin.user.id,
                            action: "MERCHANT_ONBOARDING_REJECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(auditLogs).toHaveLength(1);
                expect(auditLogs[0]?.metadata).toMatchObject({
                    reason
                });
            }
        );

        it(
            "denies STAFF rejection of merchant onboarding",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-staff-reject-creator",
                        "STAFF"
                    );

                const reviewer =
                    await createPlatformFixture(
                        "onboarding-staff-reject-reviewer",
                        "STAFF"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Staff Rejection Denied`,
                            currency: "ETB",
                            phone: "+251911000009",
                            ownerEmail:
                                `${testPrefix}-staff-reject@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/reject`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${reviewer.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                reason: "Rejected by unauthorized STAFF"
                            })
                        }
                    );

                expect(response.status).toBe(403);

                const unchanged =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(unchanged.status).toBe("PENDING_APPROVAL");
                expect(unchanged.reviewedById).toBeNull();
                expect(unchanged.reviewedAt).toBeNull();
                expect(unchanged.reviewReason).toBeNull();
                expect(unchanged.merchantId).toBeNull();

                const rejectionAuditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_REJECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(rejectionAuditCount).toBe(0);
            }
        );

        it(
            "rejects merchant onboarding rejection without a valid reason",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-reason-creator",
                        "STAFF"
                    );

                const admin =
                    await createPlatformFixture(
                        "onboarding-reason-reviewer",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Rejection Reason Required`,
                            currency: "ETB",
                            phone: "+251911000010",
                            ownerEmail:
                                `${testPrefix}-reason-required@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const url =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/reject`;

                for (const body of [
                    {},
                    { reason: "" },
                    { reason: "   " },
                    { reason: null },
                    { reason: 123 }
                ]) {
                    const response =
                        await fetch(url, {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${admin.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify(body)
                        });

                    expect(response.status).toBe(400);

                    expect(await response.json()).toEqual({
                        error:
                            "Onboarding rejection reason is required"
                    });
                }

                const unchanged =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(unchanged.status).toBe("PENDING_APPROVAL");
                expect(unchanged.reviewedById).toBeNull();
                expect(unchanged.reviewedAt).toBeNull();
                expect(unchanged.reviewReason).toBeNull();
                expect(unchanged.merchantId).toBeNull();

                const rejectionAuditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_REJECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(rejectionAuditCount).toBe(0);
            }
        );

        it(
            "prevents ADMIN from rejecting their own merchant onboarding application",
            async () => {
                const admin =
                    await createPlatformFixture(
                        "onboarding-self-rejection",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Self Rejection Blocked`,
                            currency: "ETB",
                            phone: "+251911000011",
                            ownerEmail:
                                `${testPrefix}-self-rejection@example.test`,
                            createdById: admin.user.id
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/reject`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${admin.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                reason: "Attempted self-rejection"
                            })
                        }
                    );

                expect(response.status).toBe(403);

                const unchanged =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(unchanged.status).toBe("PENDING_APPROVAL");
                expect(unchanged.reviewedById).toBeNull();
                expect(unchanged.reviewedAt).toBeNull();
                expect(unchanged.reviewReason).toBeNull();
                expect(unchanged.merchantId).toBeNull();

                const merchantCount =
                    await prisma.merchant.count({
                        where: {
                            name: application.name
                        }
                    });

                expect(merchantCount).toBe(0);

                const rejectionAuditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_REJECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(rejectionAuditCount).toBe(0);
            }
        );

        it(
            "prevents duplicate rejection of a merchant onboarding application",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-duplicate-reject-creator",
                        "STAFF"
                    );

                const firstAdmin =
                    await createPlatformFixture(
                        "onboarding-duplicate-reject-first",
                        "ADMIN"
                    );

                const secondAdmin =
                    await createPlatformFixture(
                        "onboarding-duplicate-reject-second",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Duplicate Rejection Blocked`,
                            currency: "ETB",
                            phone: "+251911000012",
                            ownerEmail:
                                `${testPrefix}-duplicate-rejection@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const url =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/reject`;

                const rejectAs = (
                    token: string,
                    reason: string
                ) =>
                    fetch(url, {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({ reason })
                    });

                const firstReason =
                    "Application details are incomplete";

                const firstResponse =
                    await rejectAs(
                        firstAdmin.token,
                        firstReason
                    );

                expect(firstResponse.status).toBe(200);

                const firstRejected =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(firstRejected.status).toBe("REJECTED");
                expect(firstRejected.reviewedById).toBe(
                    firstAdmin.user.id
                );
                expect(firstRejected.reviewReason).toBe(
                    firstReason
                );
                expect(firstRejected.reviewedAt).not.toBeNull();

                const secondResponse =
                    await rejectAs(
                        secondAdmin.token,
                        "Attempt to overwrite rejection"
                    );

                expect(secondResponse.status).toBe(409);

                const afterSecondAttempt =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: {
                            id: application.id
                        }
                    });

                expect(afterSecondAttempt.status).toBe("REJECTED");
                expect(afterSecondAttempt.reviewedById).toBe(
                    firstRejected.reviewedById
                );
                expect(afterSecondAttempt.reviewedAt).toEqual(
                    firstRejected.reviewedAt
                );
                expect(afterSecondAttempt.reviewReason).toBe(
                    firstReason
                );
                expect(afterSecondAttempt.merchantId).toBeNull();

                const rejectionAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_REJECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(rejectionAudits).toHaveLength(1);
                expect(
                    rejectionAudits[0]?.actorPlatformUserId
                ).toBe(firstAdmin.user.id);

                const merchantCount =
                    await prisma.merchant.count({
                        where: {
                            name: application.name
                        }
                    });

                expect(merchantCount).toBe(0);
            }
        );

        it(
            "prevents conflicting approval and rejection of merchant onboarding",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-conflict-creator",
                        "STAFF"
                    );

                const admin =
                    await createPlatformFixture(
                        "onboarding-conflict-reviewer",
                        "ADMIN"
                    );

                for (const initialAction of ["approve", "reject"] as const) {
                    const application =
                        await prisma.merchantOnboardingApplication.create({
                            data: {
                                name:
                                    `${testPrefix} Conflict ${initialAction}`,
                                currency: "ETB",
                                phone: "+251911000013",
                                ownerEmail:
                                    `${testPrefix}-conflict-${initialAction}@example.test`,
                                createdById: creator.user.id
                            }
                        });

                    const requestReview = (
                        action: "approve" | "reject"
                    ) =>
                        fetch(
                            `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/${action}`,
                            {
                                method: "POST",
                                headers: {
                                    authorization: `Bearer ${admin.token}`,
                                    "content-type": "application/json"
                                },
                                body: JSON.stringify({
                                    reason: "Application review decision"
                                })
                            }
                        );

                    const firstResponse =
                        await requestReview(initialAction);

                    expect(firstResponse.status).toBe(200);

                    const firstReviewed =
                        await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                            where: { id: application.id }
                        });

                    const conflictingAction =
                        initialAction === "approve"
                            ? "reject"
                            : "approve";

                    const secondResponse =
                        await requestReview(conflictingAction);

                    expect(secondResponse.status).toBe(409);

                    const unchanged =
                        await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                            where: { id: application.id }
                        });

                    expect(unchanged).toMatchObject({
                        status: firstReviewed.status,
                        reviewedById: firstReviewed.reviewedById,
                        reviewedAt: firstReviewed.reviewedAt,
                        reviewReason: firstReviewed.reviewReason,
                        merchantId: firstReviewed.merchantId
                    });

                    const approvalCount =
                        await prisma.platformAuditLog.count({
                            where: {
                                action: "MERCHANT_ONBOARDING_APPROVED",
                                entityType: "MERCHANT_ONBOARDING_APPLICATION",
                                entityId: application.id
                            }
                        });

                    const rejectionCount =
                        await prisma.platformAuditLog.count({
                            where: {
                                action: "MERCHANT_ONBOARDING_REJECTED",
                                entityType: "MERCHANT_ONBOARDING_APPLICATION",
                                entityId: application.id
                            }
                        });

                    expect(approvalCount).toBe(
                        initialAction === "approve" ? 1 : 0
                    );

                    expect(rejectionCount).toBe(
                        initialAction === "reject" ? 1 : 0
                    );

                    const merchantCount =
                        await prisma.merchant.count({
                            where: { name: application.name }
                        });

                    expect(merchantCount).toBe(
                        initialAction === "approve" ? 1 : 0
                    );

                    const activationCount =
                        await prisma.merchantOwnerActivation.count({
                            where: {
                                ownerEmail: application.ownerEmail
                            }
                        });

                    expect(activationCount).toBe(
                        initialAction === "approve" ? 1 : 0
                    );
                }
            }
        );

        it(
            "uses corrected application details when approving onboarding",
            async () => {
                const creator = await createPlatformFixture(
                    "corrected-approval-creator",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "corrected-approval-admin",
                    "ADMIN"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Original Approval`,
                            currency: "ETB",
                            phone: "+251911000030",
                            ownerEmail:
                                `${testPrefix}-original-approval@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const correctedName =
                    `${testPrefix} Corrected Approval`;
                const correctedPhone = "+251911000031";
                const correctedEmail =
                    `${testPrefix}-corrected-approval@example.test`;

                const correction = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${creator.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            name: correctedName,
                            phone: correctedPhone,
                            ownerEmail: correctedEmail
                        })
                    }
                );

                expect(correction.status).toBe(200);

                const approval = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/approve`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${admin.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({})
                    }
                );

                expect(approval.status).toBe(200);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored.status).toBe("APPROVED");
                expect(stored.merchantId).not.toBeNull();

                const merchant =
                    await prisma.merchant.findUniqueOrThrow({
                        where: { id: stored.merchantId! }
                    });

                expect(merchant.name).toBe(correctedName);
                expect(merchant.phone).toBe(correctedPhone);

                const activations =
                    await prisma.merchantOwnerActivation.findMany({
                        where: { merchantId: merchant.id }
                    });

                expect(activations).toHaveLength(1);
                expect(activations[0]?.ownerEmail).toBe(correctedEmail);

                const deliveries =
                    await prisma.merchantInvitationDelivery.findMany({
                        where: { activationId: activations[0]!.id }
                    });

                expect(deliveries).toHaveLength(1);
                expect(deliveries[0]?.recipientEmail).toBe(correctedEmail);

                const approvalAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(approvalAudits).toHaveLength(1);
                expect(
                    (approvalAudits[0]?.metadata as {
                        ownerEmail?: string
                    })?.ownerEmail
                ).toBe(correctedEmail);
            }
        );

        it(
            "keeps onboarding details consistent during concurrent correction and approval",
            async () => {
                const creator = await createPlatformFixture(
                    "correction-race-creator",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "correction-race-admin",
                    "ADMIN"
                );

                const originalName = `${testPrefix} Correction Race Original`;
                const originalPhone = "+251911000040";
                const originalEmail =
                    `${testPrefix}-correction-race-original@example.test`;

                const correctedName = `${testPrefix} Correction Race Updated`;
                const correctedPhone = "+251911000041";
                const correctedEmail =
                    `${testPrefix}-correction-race-updated@example.test`;

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: originalName,
                            currency: "ETB",
                            phone: originalPhone,
                            ownerEmail: originalEmail,
                            createdById: creator.user.id
                        }
                    });

                const baseUrl =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`;

                const [correction, approval] = await Promise.all([
                    fetch(baseUrl, {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${creator.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            name: correctedName,
                            phone: correctedPhone,
                            ownerEmail: correctedEmail
                        })
                    }),
                    fetch(`${baseUrl}/approve`, {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${admin.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({})
                    })
                ]);

                expect(approval.status).toBe(200);
                expect([200, 409]).toContain(correction.status);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored.status).toBe("APPROVED");
                expect(stored.merchantId).not.toBeNull();

                const expectedName =
                    correction.status === 200 ? correctedName : originalName;
                const expectedPhone =
                    correction.status === 200 ? correctedPhone : originalPhone;
                const expectedEmail =
                    correction.status === 200 ? correctedEmail : originalEmail;

                expect(stored.name).toBe(expectedName);
                expect(stored.phone).toBe(expectedPhone);
                expect(stored.ownerEmail).toBe(expectedEmail);

                const merchant =
                    await prisma.merchant.findUniqueOrThrow({
                        where: { id: stored.merchantId! }
                    });

                expect(merchant.name).toBe(expectedName);
                expect(merchant.phone).toBe(expectedPhone);

                const activations =
                    await prisma.merchantOwnerActivation.findMany({
                        where: { merchantId: merchant.id }
                    });

                expect(activations).toHaveLength(1);
                expect(activations[0]?.ownerEmail).toBe(expectedEmail);

                const deliveries =
                    await prisma.merchantInvitationDelivery.findMany({
                        where: { activationId: activations[0]!.id }
                    });

                expect(deliveries).toHaveLength(1);
                expect(deliveries[0]?.recipientEmail).toBe(expectedEmail);

                const approvalAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(approvalAudits).toHaveLength(1);
                expect(
                    (approvalAudits[0]?.metadata as {
                        ownerEmail?: string
                    })?.ownerEmail
                ).toBe(expectedEmail);
            }
        );

        it(
            "allows only one concurrent merchant onboarding approval",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-race-creator",
                        "STAFF"
                    );

                const firstAdmin =
                    await createPlatformFixture(
                        "onboarding-race-first",
                        "ADMIN"
                    );

                const secondAdmin =
                    await createPlatformFixture(
                        "onboarding-race-second",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Concurrent Approval`,
                            currency: "ETB",
                            phone: "+251911000014",
                            ownerEmail:
                                `${testPrefix}-concurrent-approval@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const url =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/approve`;

                const approveAs = (token: string) =>
                    fetch(url, {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({})
                    });

                const results =
                    await Promise.allSettled([
                        approveAs(firstAdmin.token),
                        approveAs(secondAdmin.token)
                    ]);

                expect(
                    results.every(
                        (result) => result.status === "fulfilled"
                    )
                ).toBe(true);

                const responses = results
                    .filter(
                        (result): result is PromiseFulfilledResult<Response> =>
                            result.status === "fulfilled"
                    )
                    .map((result) => result.value);

                const statuses =
                    responses.map((response) => response.status).sort();

                expect(statuses).toEqual([200, 409]);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored.status).toBe("APPROVED");
                expect(stored.merchantId).not.toBeNull();

                expect(
                    [firstAdmin.user.id, secondAdmin.user.id]
                ).toContain(stored.reviewedById);

                const merchants =
                    await prisma.merchant.findMany({
                        where: { name: application.name }
                    });

                expect(merchants).toHaveLength(1);
                expect(stored.merchantId).toBe(merchants[0]?.id);

                const activations =
                    await prisma.merchantOwnerActivation.findMany({
                        where: { merchantId: stored.merchantId! }
                    });

                expect(activations).toHaveLength(1);

                const deliveries =
                    await prisma.merchantInvitationDelivery.findMany({
                        where: {
                            activationId: activations[0]!.id
                        }
                    });

                expect(deliveries).toHaveLength(1);

                expect(deliveries[0]).toMatchObject({
                    activationId: activations[0]!.id,
                    recipientEmail: application.ownerEmail,
                    status: "PENDING",
                    attemptCount: 0
                });

                expect(deliveries[0]!.encryptedToken).toMatch(
                    /^v1\.[^.]+\.[^.]+\.[^.]+$/
                );

                const approvalAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(approvalAudits).toHaveLength(1);
                expect(
                    approvalAudits[0]?.actorPlatformUserId
                ).toBe(stored.reviewedById);
            }
        );

        it(
            "allows only one concurrent conflicting onboarding review",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-race-conflict-creator",
                        "STAFF"
                    );

                const approvingAdmin =
                    await createPlatformFixture(
                        "onboarding-race-conflict-approve",
                        "ADMIN"
                    );

                const rejectingAdmin =
                    await createPlatformFixture(
                        "onboarding-race-conflict-reject",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Concurrent Review Conflict`,
                            currency: "ETB",
                            phone: "+251911000015",
                            ownerEmail:
                                `${testPrefix}-race-conflict@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const baseUrl =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`;

                const results =
                    await Promise.allSettled([
                        fetch(`${baseUrl}/approve`, {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${approvingAdmin.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({})
                        }),
                        fetch(`${baseUrl}/reject`, {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${rejectingAdmin.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                reason: "Application requires correction"
                            })
                        })
                    ]);

                expect(
                    results.every(
                        (result) => result.status === "fulfilled"
                    )
                ).toBe(true);

                const responses = results.map(
                    (result) =>
                        (result as PromiseFulfilledResult<Response>).value
                );

                expect(
                    responses.map((response) => response.status).sort()
                ).toEqual([200, 409]);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(["APPROVED", "REJECTED"]).toContain(
                    stored.status
                );

                const approved =
                    stored.status === "APPROVED";

                expect(stored.reviewedById).toBe(
                    approved
                        ? approvingAdmin.user.id
                        : rejectingAdmin.user.id
                );

                expect(stored.reviewedAt).not.toBeNull();

                const merchants =
                    await prisma.merchant.findMany({
                        where: { name: application.name }
                    });

                expect(merchants).toHaveLength(approved ? 1 : 0);

                expect(stored.merchantId).toBe(
                    approved ? merchants[0]?.id : null
                );

                const activations =
                    await prisma.merchantOwnerActivation.findMany({
                        where: {
                            ownerEmail: application.ownerEmail
                        }
                    });

                expect(activations).toHaveLength(approved ? 1 : 0);

                const approvalAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                const rejectionAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_REJECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(approvalAudits).toBe(approved ? 1 : 0);
                expect(rejectionAudits).toBe(approved ? 0 : 1);
                expect(approvalAudits + rejectionAudits).toBe(1);

                expect(stored.reviewReason).toBe(
                    approved
                        ? null
                        : "Application requires correction"
                );
            }
        );

        it(
            "allows only one concurrent merchant onboarding rejection",
            async () => {
                const creator =
                    await createPlatformFixture(
                        "onboarding-race-reject-creator",
                        "STAFF"
                    );

                const firstAdmin =
                    await createPlatformFixture(
                        "onboarding-race-reject-first",
                        "ADMIN"
                    );

                const secondAdmin =
                    await createPlatformFixture(
                        "onboarding-race-reject-second",
                        "ADMIN"
                    );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name:
                                `${testPrefix} Concurrent Rejection`,
                            currency: "ETB",
                            phone: "+251911000016",
                            ownerEmail:
                                `${testPrefix}-concurrent-rejection@example.test`,
                            createdById: creator.user.id
                        }
                    });

                const url =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/reject`;

                const firstReason = "Missing business documentation";
                const secondReason = "Invalid merchant contact information";

                const rejectAs = (token: string, reason: string) =>
                    fetch(url, {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({ reason })
                    });

                const results =
                    await Promise.allSettled([
                        rejectAs(firstAdmin.token, firstReason),
                        rejectAs(secondAdmin.token, secondReason)
                    ]);

                expect(
                    results.every(
                        (result) => result.status === "fulfilled"
                    )
                ).toBe(true);

                const responses = results
                    .filter(
                        (result): result is PromiseFulfilledResult<Response> =>
                            result.status === "fulfilled"
                    )
                    .map((result) => result.value);

                expect(
                    responses.map((response) => response.status).sort()
                ).toEqual([200, 409]);

                const winnerIndex =
                    responses.findIndex((response) => response.status === 200);

                const expectedReviewerId =
                    winnerIndex === 0
                        ? firstAdmin.user.id
                        : secondAdmin.user.id;

                const expectedReason =
                    winnerIndex === 0
                        ? firstReason
                        : secondReason;

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored.status).toBe("REJECTED");
                expect(stored.reviewedById).toBe(expectedReviewerId);
                expect(stored.reviewReason).toBe(expectedReason);
                expect(stored.reviewedAt).not.toBeNull();
                expect(stored.merchantId).toBeNull();

                const rejectionAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_REJECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(rejectionAudits).toHaveLength(1);
                expect(rejectionAudits[0]?.actorPlatformUserId).toBe(
                    expectedReviewerId
                );

                const merchantCount =
                    await prisma.merchant.count({
                        where: { name: application.name }
                    });

                expect(merchantCount).toBe(0);

                const activationCount =
                    await prisma.merchantOwnerActivation.count({
                        where: { ownerEmail: application.ownerEmail }
                    });

                expect(activationCount).toBe(0);
            }
        );

        it(
            "allows STAFF to correct a pending merchant onboarding application",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-correction-staff",
                    "STAFF"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Original Merchant`,
                            currency: "ETB",
                            phone: "+251911000017",
                            ownerEmail: `${testPrefix}-original@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${staff.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            name: `${testPrefix} Corrected Merchant`,
                            phone: "+251911000018",
                            ownerEmail: `${testPrefix}-corrected@example.test`,
                            telegramUsername: "corrected_merchant"
                        })
                    }
                );

                expect(response.status).toBe(200);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    status: "PENDING_APPROVAL",
                    name: `${testPrefix} Corrected Merchant`,
                    currency: "ETB",
                    phone: "+251911000018",
                    ownerEmail: `${testPrefix}-corrected@example.test`,
                    telegramUsername: "corrected_merchant",
                    createdById: staff.user.id,
                    reviewedById: null,
                    merchantId: null
                });

                const correctionAudits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_CORRECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(correctionAudits).toHaveLength(1);

                expect(correctionAudits[0]?.actorPlatformUserId).toBe(
                    staff.user.id
                );

                expect(correctionAudits[0]?.metadata).toMatchObject({
                    changedFields: expect.arrayContaining([
                        "name",
                        "phone",
                        "ownerEmail",
                        "telegramUsername"
                    ]),
                    before: {
                        name: `${testPrefix} Original Merchant`,
                        phone: "+251911000017",
                        ownerEmail: `${testPrefix}-original@example.test`,
                        telegramUsername: null
                    },
                    after: {
                        name: `${testPrefix} Corrected Merchant`,
                        phone: "+251911000018",
                        ownerEmail: `${testPrefix}-corrected@example.test`,
                        telegramUsername: "corrected_merchant"
                    }
                });

                expect(
                    await prisma.merchant.count({
                        where: {
                            name: `${testPrefix} Corrected Merchant`
                        }
                    })
                ).toBe(0);
            }
        );

        it(
            "records accurate audit history for concurrent onboarding corrections",
            async () => {
                const staff = await createPlatformFixture(
                    "concurrent-correction-audit-staff",
                    "STAFF"
                );

                const originalName = `${testPrefix} Audit Original`;
                const firstName = `${testPrefix} Audit First`;
                const secondName = `${testPrefix} Audit Second`;

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: originalName,
                            currency: "ETB",
                            phone: "+251911000060",
                            ownerEmail:
                                `${testPrefix}-concurrent-audit@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const url =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`;

                const [firstResponse, secondResponse] =
                    await Promise.all([
                        fetch(url, {
                            method: "PATCH",
                            headers: {
                                authorization: `Bearer ${staff.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                name: firstName
                            })
                        }),
                        fetch(url, {
                            method: "PATCH",
                            headers: {
                                authorization: `Bearer ${staff.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                name: secondName
                            })
                        })
                    ]);

                expect(firstResponse.status).toBe(200);
                expect(secondResponse.status).toBe(200);

                const audits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            action: "MERCHANT_ONBOARDING_CORRECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(audits).toHaveLength(2);

                const transitions = audits.map((audit) => {
                    const metadata = audit.metadata as {
                        before: { name: string };
                        after: { name: string };
                    };

                    return {
                        before: metadata.before.name,
                        after: metadata.after.name
                    };
                });

                const firstTransition = transitions.find(
                    (transition) => transition.before === originalName
                );

                expect(firstTransition).toBeDefined();

                const secondTransition = transitions.find(
                    (transition) =>
                        transition.before === firstTransition?.after &&
                        transition.after !== firstTransition?.after
                );

                expect(secondTransition).toBeDefined();

                expect(
                    new Set(transitions.map((transition) => transition.after))
                ).toEqual(new Set([firstName, secondName]));

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored.name).toBe(secondTransition?.after);
                expect(stored.status).toBe("PENDING_APPROVAL");
                expect(stored.merchantId).toBeNull();
            }
        );

        it(
            "prevents correction of finalized merchant onboarding applications",
            async () => {
                const creator = await createPlatformFixture(
                    "onboarding-finalized-correction-creator",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "onboarding-finalized-correction-admin",
                    "ADMIN"
                );

                for (const finalStatus of ["APPROVED", "REJECTED"] as const) {
                    const application =
                        await prisma.merchantOnboardingApplication.create({
                            data: {
                                name: `${testPrefix} Finalized ${finalStatus}`,
                                currency: "ETB",
                                phone: "+251911000019",
                                ownerEmail:
                                    `${testPrefix}-finalized-${finalStatus.toLowerCase()}@example.test`,
                                createdById: creator.user.id
                            }
                        });

                    const reviewResponse = await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/${finalStatus === "APPROVED" ? "approve" : "reject"
                        }`,
                        {
                            method: "POST",
                            headers: {
                                authorization: `Bearer ${admin.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                reason: "Application review completed"
                            })
                        }
                    );

                    expect(reviewResponse.status).toBe(200);

                    const before =
                        await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                            where: { id: application.id }
                        });

                    const correctionResponse = await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                        {
                            method: "PATCH",
                            headers: {
                                authorization: `Bearer ${creator.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                name: `${testPrefix} Unauthorized Correction`,
                                phone: "+251911999999"
                            })
                        }
                    );

                    expect(correctionResponse.status).toBe(409);

                    const after =
                        await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                            where: { id: application.id }
                        });

                    expect(after).toMatchObject({
                        name: before.name,
                        phone: before.phone,
                        ownerEmail: before.ownerEmail,
                        status: before.status,
                        reviewedById: before.reviewedById,
                        reviewedAt: before.reviewedAt,
                        merchantId: before.merchantId
                    });

                    const correctionAudits =
                        await prisma.platformAuditLog.count({
                            where: {
                                action: "MERCHANT_ONBOARDING_CORRECTED",
                                entityType: "MERCHANT_ONBOARDING_APPLICATION",
                                entityId: application.id
                            }
                        });

                    expect(correctionAudits).toBe(0);
                }
            }
        );

        it(
            "rejects merchant OWNER access to onboarding correction",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-correction-auth-staff",
                    "STAFF"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Correction Authorization`,
                            currency: "ETB",
                            phone: "+251911000020",
                            ownerEmail:
                                `${testPrefix}-correction-auth@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const merchant = await createMerchant(
                    "onboarding-correction-merchant-owner"
                );

                const owner = await prisma.merchantUser.create({
                    data: {
                        merchantId: merchant.id,
                        email:
                            `${testPrefix}-correction-boundary-owner@example.test`,
                        passwordHash: await hashPassword(
                            "BoundaryOwnerPassword123!"
                        ),
                        displayName: "Correction Boundary Owner",
                        role: "OWNER",
                        tokenVersion: 0
                    }
                });

                const merchantToken = createAuthToken({
                    id: owner.id,
                    merchantId: merchant.id,
                    role: owner.role,
                    tokenVersion: owner.tokenVersion
                });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${merchantToken}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            name: `${testPrefix} Unauthorized Merchant Edit`
                        })
                    }
                );

                expect([401, 403]).toContain(response.status);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored.name).toBe(
                    `${testPrefix} Correction Authorization`
                );
                expect(stored.status).toBe("PENDING_APPROVAL");

                const correctionAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_CORRECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(correctionAudits).toBe(0);
            }
        );

        it(
            "rejects non-ETB currency during merchant onboarding correction",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-currency-correction-staff",
                    "STAFF"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Currency Correction`,
                            currency: "ETB",
                            phone: "+251911000021",
                            ownerEmail:
                                `${testPrefix}-currency-correction@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${staff.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            currency: "USD",
                            name: `${testPrefix} Modified Currency Merchant`
                        })
                    }
                );

                expect(response.status).toBe(400);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    name: `${testPrefix} Currency Correction`,
                    currency: "ETB",
                    status: "PENDING_APPROVAL",
                    merchantId: null
                });

                const correctionAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_CORRECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(correctionAudits).toBe(0);
            }
        );

        it(
            "rejects an empty primary phone during merchant onboarding correction",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-empty-phone-staff",
                    "STAFF"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Required Phone Correction`,
                            currency: "ETB",
                            phone: "+251911000022",
                            ownerEmail:
                                `${testPrefix}-required-phone@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${staff.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            phone: "   "
                        })
                    }
                );

                expect(response.status).toBe(400);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    name: `${testPrefix} Required Phone Correction`,
                    phone: "+251911000022",
                    currency: "ETB",
                    status: "PENDING_APPROVAL",
                    merchantId: null
                });

                const correctionAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_CORRECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(correctionAudits).toBe(0);
            }
        );

        it(
            "rejects protected fields during merchant onboarding correction",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-protected-fields-staff",
                    "STAFF"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Protected Fields Correction`,
                            currency: "ETB",
                            phone: "+251911000023",
                            ownerEmail:
                                `${testPrefix}-protected-fields@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${staff.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            name: `${testPrefix} Unauthorized Change`,
                            status: "APPROVED",
                            reviewedById: staff.user.id,
                            merchantId: "unauthorized-merchant-id"
                        })
                    }
                );

                expect(response.status).toBe(400);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    name: `${testPrefix} Protected Fields Correction`,
                    status: "PENDING_APPROVAL",
                    reviewedById: null,
                    reviewedAt: null,
                    merchantId: null,
                    createdById: staff.user.id
                });

                const correctionAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_CORRECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(correctionAudits).toBe(0);
            }
        );

        it(
            "rejects an invalid owner email during merchant onboarding correction",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-invalid-email-staff",
                    "STAFF"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Owner Email Correction`,
                            currency: "ETB",
                            phone: "+251911000024",
                            ownerEmail:
                                `${testPrefix}-valid-owner@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            authorization: `Bearer ${staff.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            ownerEmail: "invalid-email",
                            name: `${testPrefix} Unauthorized Email Change`
                        })
                    }
                );

                expect(response.status).toBe(400);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    name: `${testPrefix} Owner Email Correction`,
                    ownerEmail:
                        `${testPrefix}-valid-owner@example.test`,
                    status: "PENDING_APPROVAL",
                    merchantId: null
                });

                const correctionAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_CORRECTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(correctionAudits).toBe(0);
            }
        );

        it(
            "allows ADMIN to discard a pending merchant onboarding application",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-discard-staff",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "onboarding-discard-admin",
                    "ADMIN"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Discard Application`,
                            currency: "ETB",
                            phone: "+251911000025",
                            ownerEmail:
                                `${testPrefix}-discard@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${admin.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            reason: "Duplicate onboarding application"
                        })
                    }
                );

                expect(response.status).toBe(200);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    status: "DISCARDED",
                    reviewedById: admin.user.id,
                    reviewReason: "Duplicate onboarding application",
                    merchantId: null
                });

                expect(stored.reviewedAt).not.toBeNull();

                const audits = await prisma.platformAuditLog.findMany({
                    where: {
                        action: "MERCHANT_ONBOARDING_DISCARDED",
                        entityType: "MERCHANT_ONBOARDING_APPLICATION",
                        entityId: application.id
                    }
                });

                expect(audits).toHaveLength(1);
                expect(audits[0]?.actorPlatformUserId).toBe(
                    admin.user.id
                );

                expect(
                    await prisma.merchant.count({
                        where: {
                            name: `${testPrefix} Discard Application`
                        }
                    })
                ).toBe(0);
            }
        );

        it(
            "denies STAFF permission to discard merchant onboarding",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-discard-denied-staff",
                    "STAFF"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Staff Discard Denied`,
                            currency: "ETB",
                            phone: "+251911000026",
                            ownerEmail:
                                `${testPrefix}-staff-discard@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${staff.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            reason: "Attempted STAFF discard"
                        })
                    }
                );

                expect(response.status).toBe(403);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    status: "PENDING_APPROVAL",
                    reviewedById: null,
                    reviewedAt: null,
                    reviewReason: null,
                    merchantId: null
                });

                const discardAudits =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_DISCARDED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(discardAudits).toBe(0);
            }
        );

        it(
            "prevents discarding finalized merchant onboarding applications",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-finalized-discard-staff",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "onboarding-finalized-discard-admin",
                    "ADMIN"
                );

                for (const status of [
                    "APPROVED",
                    "REJECTED",
                    "DISCARDED"
                ] as const) {
                    const application =
                        await prisma.merchantOnboardingApplication.create({
                            data: {
                                name: `${testPrefix} Finalized Discard ${status}`,
                                currency: "ETB",
                                phone: "+251911000027",
                                ownerEmail:
                                    `${testPrefix}-finalized-discard-${status.toLowerCase()}@example.test`,
                                createdById: staff.user.id,
                                status,
                                reviewedById: admin.user.id,
                                reviewedAt: new Date(),
                                reviewReason: "Previously finalized"
                            }
                        });

                    const response = await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`,
                        {
                            method: "POST",
                            headers: {
                                authorization: `Bearer ${admin.token}`,
                                "content-type": "application/json"
                            },
                            body: JSON.stringify({
                                reason: "Attempted second decision"
                            })
                        }
                    );

                    expect(response.status).toBe(409);

                    const stored =
                        await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                            where: { id: application.id }
                        });

                    expect(stored).toMatchObject({
                        status,
                        reviewedById: admin.user.id,
                        reviewReason: "Previously finalized",
                        merchantId: null
                    });

                    const discardAudits =
                        await prisma.platformAuditLog.count({
                            where: {
                                action: "MERCHANT_ONBOARDING_DISCARDED",
                                entityType: "MERCHANT_ONBOARDING_APPLICATION",
                                entityId: application.id
                            }
                        });

                    expect(discardAudits).toBe(0);
                }
            }
        );

        it(
            "prevents duplicate merchant onboarding discard",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-duplicate-discard-staff",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "onboarding-duplicate-discard-admin",
                    "ADMIN"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Duplicate Discard`,
                            currency: "ETB",
                            phone: "+251911000028",
                            ownerEmail:
                                `${testPrefix}-duplicate-discard@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const url =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`;

                const headers = {
                    authorization: `Bearer ${admin.token}`,
                    "content-type": "application/json"
                };

                const firstResponse = await fetch(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        reason: "Duplicate application"
                    })
                });

                expect(firstResponse.status).toBe(200);

                const secondResponse = await fetch(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        reason: "Second discard attempt"
                    })
                });

                expect(secondResponse.status).toBe(409);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    status: "DISCARDED",
                    reviewedById: admin.user.id,
                    reviewReason: "Duplicate application",
                    merchantId: null
                });

                const audits = await prisma.platformAuditLog.findMany({
                    where: {
                        action: "MERCHANT_ONBOARDING_DISCARDED",
                        entityType: "MERCHANT_ONBOARDING_APPLICATION",
                        entityId: application.id
                    }
                });

                expect(audits).toHaveLength(1);
                expect(audits[0]?.actorPlatformUserId).toBe(
                    admin.user.id
                );
            }
        );

        it(
            "allows only one concurrent merchant onboarding discard",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-concurrent-discard-staff",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "onboarding-concurrent-discard-admin",
                    "ADMIN"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Concurrent Discard`,
                            currency: "ETB",
                            phone: "+251911000029",
                            ownerEmail:
                                `${testPrefix}-concurrent-discard@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const url =
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`;

                const headers = {
                    authorization: `Bearer ${admin.token}`,
                    "content-type": "application/json"
                };

                const [first, second] = await Promise.all([
                    fetch(url, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            reason: "Concurrent discard A"
                        })
                    }),
                    fetch(url, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            reason: "Concurrent discard B"
                        })
                    })
                ]);

                expect(
                    [first.status, second.status].sort()
                ).toEqual([200, 409]);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored.status).toBe("DISCARDED");
                expect(stored.reviewedById).toBe(admin.user.id);

                expect([
                    "Concurrent discard A",
                    "Concurrent discard B"
                ]).toContain(stored.reviewReason);

                const audits = await prisma.platformAuditLog.findMany({
                    where: {
                        action: "MERCHANT_ONBOARDING_DISCARDED",
                        entityType: "MERCHANT_ONBOARDING_APPLICATION",
                        entityId: application.id
                    }
                });

                expect(audits).toHaveLength(1);
                expect(audits[0]?.actorPlatformUserId).toBe(
                    admin.user.id
                );

                expect(
                    await prisma.merchant.count({
                        where: {
                            name: `${testPrefix} Concurrent Discard`
                        }
                    })
                ).toBe(0);
            }
        );

        it(
            "rejects merchant onboarding discard without a reason",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-discard-no-reason-staff",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "onboarding-discard-no-reason-admin",
                    "ADMIN"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Discard Without Reason`,
                            currency: "ETB",
                            phone: "+251911000030",
                            ownerEmail:
                                `${testPrefix}-discard-no-reason@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${admin.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({})
                    }
                );

                expect(response.status).toBe(400);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    status: "PENDING_APPROVAL",
                    reviewedById: null,
                    reviewedAt: null,
                    reviewReason: null,
                    merchantId: null
                });

                const auditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_DISCARDED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(auditCount).toBe(0);
            }
        );

        it(
            "rejects merchant onboarding discard with a whitespace-only reason",
            async () => {
                const staff = await createPlatformFixture(
                    "onboarding-discard-blank-staff",
                    "STAFF"
                );

                const admin = await createPlatformFixture(
                    "onboarding-discard-blank-admin",
                    "ADMIN"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Discard Blank Reason`,
                            currency: "ETB",
                            phone: "+251911000031",
                            ownerEmail:
                                `${testPrefix}-discard-blank@example.test`,
                            createdById: staff.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${admin.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            reason: "   "
                        })
                    }
                );

                expect(response.status).toBe(400);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    status: "PENDING_APPROVAL",
                    reviewedById: null,
                    reviewedAt: null,
                    reviewReason: null,
                    merchantId: null
                });

                const auditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_DISCARDED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(auditCount).toBe(0);
            }
        );

        it(
            "prevents self-discard of merchant onboarding applications",
            async () => {
                const admin = await createPlatformFixture(
                    "onboarding-self-discard-admin",
                    "ADMIN"
                );

                const application =
                    await prisma.merchantOnboardingApplication.create({
                        data: {
                            name: `${testPrefix} Self Discard`,
                            currency: "ETB",
                            phone: "+251911000032",
                            ownerEmail:
                                `${testPrefix}-self-discard@example.test`,
                            createdById: admin.user.id
                        }
                    });

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${application.id}/discard`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${admin.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            reason: "Attempted self-discard"
                        })
                    }
                );

                expect(response.status).toBe(403);

                const stored =
                    await prisma.merchantOnboardingApplication.findUniqueOrThrow({
                        where: { id: application.id }
                    });

                expect(stored).toMatchObject({
                    status: "PENDING_APPROVAL",
                    reviewedById: null,
                    reviewedAt: null,
                    reviewReason: null,
                    merchantId: null
                });

                const auditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_DISCARDED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: application.id
                        }
                    });

                expect(auditCount).toBe(0);
            }
        );

        it(
            "returns 404 when discarding a nonexistent merchant onboarding application",
            async () => {
                const admin = await createPlatformFixture(
                    "onboarding-discard-missing-admin",
                    "ADMIN"
                );

                const missingId = "nonexistent-onboarding-application";

                const response = await fetch(
                    `${apiBaseUrl}/platform/merchant-onboarding/${missingId}/discard`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${admin.token}`,
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            reason: "Application not found"
                        })
                    }
                );

                expect(response.status).toBe(404);

                const auditCount =
                    await prisma.platformAuditLog.count({
                        where: {
                            action: "MERCHANT_ONBOARDING_DISCARDED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: missingId
                        }
                    });

                expect(auditCount).toBe(0);
            }
        );

        it(
            "denies ADMIN access to merchant OWNER password recovery",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "owner-password-admin-denied",
                        "ADMIN"
                    );

                const merchant =
                    await createMerchant(
                        "owner-password-admin-denied"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/owner/password`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${token}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    newPassword:
                                        "UnauthorizedPassword456!"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(403);

                expect(
                    await response.json()
                ).toEqual({
                    error:
                        "You do not have permission to perform this platform action"
                });
            }
        );

        it(
            "allows a platform user to reset the sole merchant OWNER password and invalidates existing sessions",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "owner-password-recovery"
                    );

                const merchant =
                    await createMerchant(
                        "owner-password-recovery"
                    );

                const currentPassword =
                    "CurrentOwnerPassword123!";

                const newPassword =
                    "RecoveredOwnerPassword456!";

                const passwordHash =
                    await hashPassword(
                        currentPassword
                    );

                const owner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-owner-password-recovery@example.test`,
                            passwordHash,
                            displayName:
                                "Recovery Owner",
                            role:
                                "OWNER",
                            tokenVersion:
                                0
                        }
                    });

                const oldToken =
                    createAuthToken({
                        id:
                            owner.id,
                        merchantId:
                            merchant.id,
                        role:
                            owner.role,
                        tokenVersion:
                            owner.tokenVersion
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/owner/password`,
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
                                    newPassword
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(200);

                const body =
                    await response.json() as {
                        message?: string;
                        owner?: {
                            id?: string;
                            merchantId?: string;
                            email?: string;
                            role?: string;
                            passwordHash?: string;
                            tokenVersion?: number;
                        };
                        passwordHash?: string;
                        tokenVersion?: number;
                    };

                expect(
                    body.message
                ).toBe(
                    "Merchant owner password reset successfully"
                );

                expect(
                    body.owner?.id
                ).toBe(
                    owner.id
                );

                expect(
                    body.owner?.merchantId
                ).toBe(
                    merchant.id
                );

                expect(
                    body.owner?.email
                ).toBe(
                    owner.email
                );

                expect(
                    body.owner?.role
                ).toBe(
                    "OWNER"
                );

                expect(
                    body
                ).not.toHaveProperty(
                    "passwordHash"
                );

                expect(
                    body
                ).not.toHaveProperty(
                    "tokenVersion"
                );

                expect(
                    body.owner
                ).not.toHaveProperty(
                    "passwordHash"
                );

                expect(
                    body.owner
                ).not.toHaveProperty(
                    "tokenVersion"
                );

                const updatedOwner =
                    await prisma.merchantUser.findUniqueOrThrow({
                        where: {
                            id:
                                owner.id
                        }
                    });

                expect(
                    updatedOwner.passwordHash
                ).not.toBe(
                    passwordHash
                );

                expect(
                    updatedOwner.passwordHash
                ).not.toBe(
                    newPassword
                );

                expect(
                    await verifyPassword(
                        newPassword,
                        updatedOwner.passwordHash
                    )
                ).toBe(true);

                expect(
                    updatedOwner.tokenVersion
                ).toBe(
                    owner.tokenVersion +
                    1
                );

                expect(
                    await authenticateUser(
                        owner.email,
                        currentPassword
                    )
                ).toBeNull();

                const recoveredOwner =
                    await authenticateUser(
                        owner.email,
                        newPassword
                    );

                expect(
                    recoveredOwner
                ).not.toBeNull();

                expect(
                    recoveredOwner?.id
                ).toBe(
                    owner.id
                );

                expect(
                    recoveredOwner?.merchantId
                ).toBe(
                    merchant.id
                );

                expect(
                    recoveredOwner?.role
                ).toBe(
                    "OWNER"
                );

                const oldTokenResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/me`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${oldToken}`
                            }
                        }
                    );

                expect(
                    oldTokenResponse.status
                ).toBe(401);

                const audit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_OWNER_PASSWORD_RESET",
                            entityType:
                                "MERCHANT_USER",
                            entityId:
                                owner.id
                        }
                    });

                expect(
                    audit
                ).not.toBeNull();

                expect(
                    JSON.stringify(
                        audit?.metadata ?? null
                    )
                ).not.toContain(
                    newPassword
                );

                expect(
                    JSON.stringify(
                        audit?.metadata ?? null
                    )
                ).not.toContain(
                    passwordHash
                );
            }
        );

        it(
            "refuses merchant owner password recovery when multiple OWNER accounts exist",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "owner-password-multiple"
                    );

                const merchant =
                    await createMerchant(
                        "owner-password-multiple"
                    );

                const firstPassword =
                    "FirstOwnerPassword123!";

                const secondPassword =
                    "SecondOwnerPassword123!";

                const firstOwner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-owner-password-multiple-first@example.test`,
                            passwordHash:
                                await hashPassword(
                                    firstPassword
                                ),
                            displayName:
                                "First Owner",
                            role:
                                "OWNER",
                            tokenVersion:
                                0
                        }
                    });

                const secondOwner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-owner-password-multiple-second@example.test`,
                            passwordHash:
                                await hashPassword(
                                    secondPassword
                                ),
                            displayName:
                                "Second Owner",
                            role:
                                "OWNER",
                            tokenVersion:
                                0
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/owner/password`,
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
                                    newPassword:
                                        "RecoveredPassword456!"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(409);

                const body =
                    await response.json() as {
                        error?: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant must have exactly one owner"
                );

                const unchangedOwners =
                    await prisma.merchantUser.findMany({
                        where: {
                            id: {
                                in: [
                                    firstOwner.id,
                                    secondOwner.id
                                ]
                            }
                        },
                        orderBy: {
                            email:
                                "asc"
                        }
                    });

                expect(
                    unchangedOwners
                ).toHaveLength(2);

                const unchangedFirstOwner =
                    unchangedOwners.find(
                        (user) =>
                            user.id ===
                            firstOwner.id
                    );

                const unchangedSecondOwner =
                    unchangedOwners.find(
                        (user) =>
                            user.id ===
                            secondOwner.id
                    );

                expect(
                    unchangedFirstOwner?.passwordHash
                ).toBe(
                    firstOwner.passwordHash
                );

                expect(
                    unchangedFirstOwner?.tokenVersion
                ).toBe(
                    firstOwner.tokenVersion
                );

                expect(
                    unchangedSecondOwner?.passwordHash
                ).toBe(
                    secondOwner.passwordHash
                );

                expect(
                    unchangedSecondOwner?.tokenVersion
                ).toBe(
                    secondOwner.tokenVersion
                );

                const audits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_OWNER_PASSWORD_RESET"
                        }
                    });

                expect(
                    audits
                ).toHaveLength(0);
            }
        );

        it(
            "refuses merchant owner password recovery when no OWNER account exists",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "owner-password-missing"
                    );

                const merchant =
                    await createMerchant(
                        "owner-password-missing"
                    );

                const staffPassword =
                    "StaffPassword123!";

                const staff =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-owner-password-missing-staff@example.test`,
                            passwordHash:
                                await hashPassword(
                                    staffPassword
                                ),
                            displayName:
                                "Recovery Staff",
                            role:
                                "STAFF",
                            tokenVersion:
                                0
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/owner/password`,
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
                                    newPassword:
                                        "RecoveredPassword456!"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(409);

                const body =
                    await response.json() as {
                        error?: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant must have exactly one owner"
                );

                const unchangedStaff =
                    await prisma.merchantUser.findUniqueOrThrow({
                        where: {
                            id:
                                staff.id
                        }
                    });

                expect(
                    unchangedStaff.passwordHash
                ).toBe(
                    staff.passwordHash
                );

                expect(
                    unchangedStaff.tokenVersion
                ).toBe(
                    staff.tokenVersion
                );

                expect(
                    await verifyPassword(
                        staffPassword,
                        unchangedStaff.passwordHash
                    )
                ).toBe(true);

                const audits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_OWNER_PASSWORD_RESET"
                        }
                    });

                expect(
                    audits
                ).toHaveLength(0);
            }
        );

        it(
            "rejects a short merchant owner recovery password without changing credentials",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "owner-password-short"
                    );

                const merchant =
                    await createMerchant(
                        "owner-password-short"
                    );

                const currentPassword =
                    "CurrentOwnerPassword123!";

                const owner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-owner-password-short@example.test`,
                            passwordHash:
                                await hashPassword(
                                    currentPassword
                                ),
                            displayName:
                                "Recovery Owner",
                            role:
                                "OWNER",
                            tokenVersion:
                                0
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/owner/password`,
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
                                    newPassword:
                                        "short"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(400);

                const body =
                    await response.json() as {
                        error?: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "New password must be at least 8 characters"
                );

                const unchangedOwner =
                    await prisma.merchantUser.findUniqueOrThrow({
                        where: {
                            id:
                                owner.id
                        }
                    });

                expect(
                    unchangedOwner.passwordHash
                ).toBe(
                    owner.passwordHash
                );

                expect(
                    unchangedOwner.tokenVersion
                ).toBe(
                    owner.tokenVersion
                );

                expect(
                    await authenticateUser(
                        owner.email,
                        currentPassword
                    )
                ).not.toBeNull();

                const audits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_OWNER_PASSWORD_RESET"
                        }
                    });

                expect(
                    audits
                ).toHaveLength(0);
            }
        );

        it(
            "rejects a merchant OWNER token from the platform owner password recovery endpoint",
            async () => {
                const merchant =
                    await createMerchant(
                        "owner-password-boundary"
                    );

                const currentPassword =
                    "CurrentOwnerPassword123!";

                const owner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-owner-password-boundary@example.test`,
                            passwordHash:
                                await hashPassword(
                                    currentPassword
                                ),
                            displayName:
                                "Boundary Owner",
                            role:
                                "OWNER",
                            tokenVersion:
                                0
                        }
                    });

                const merchantToken =
                    createAuthToken({
                        id:
                            owner.id,
                        merchantId:
                            merchant.id,
                        role:
                            owner.role,
                        tokenVersion:
                            owner.tokenVersion
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/owner/password`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                authorization:
                                    `Bearer ${merchantToken}`,
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    newPassword:
                                        "UnauthorizedPassword456!"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(403);

                const unchangedOwner =
                    await prisma.merchantUser.findUniqueOrThrow({
                        where: {
                            id:
                                owner.id
                        }
                    });

                expect(
                    unchangedOwner.passwordHash
                ).toBe(
                    owner.passwordHash
                );

                expect(
                    unchangedOwner.tokenVersion
                ).toBe(
                    owner.tokenVersion
                );

                expect(
                    await authenticateUser(
                        owner.email,
                        currentPassword
                    )
                ).not.toBeNull();

                const audits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_OWNER_PASSWORD_RESET"
                        }
                    });

                expect(
                    audits
                ).toHaveLength(0);
            }
        );

        it(
            "rejects unauthenticated merchant owner password recovery",
            async () => {
                const merchant =
                    await createMerchant(
                        "owner-password-unauthenticated"
                    );

                const currentPassword =
                    "CurrentOwnerPassword123!";

                const owner =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-owner-password-unauthenticated@example.test`,
                            passwordHash:
                                await hashPassword(
                                    currentPassword
                                ),
                            displayName:
                                "Recovery Owner",
                            role:
                                "OWNER",
                            tokenVersion:
                                0
                        }
                    });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchant.id}/owner/password`,
                        {
                            method:
                                "PATCH",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body:
                                JSON.stringify({
                                    newPassword:
                                        "UnauthorizedPassword456!"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(401);

                const unchangedOwner =
                    await prisma.merchantUser.findUniqueOrThrow({
                        where: {
                            id:
                                owner.id
                        }
                    });

                expect(
                    unchangedOwner.passwordHash
                ).toBe(
                    owner.passwordHash
                );

                expect(
                    unchangedOwner.tokenVersion
                ).toBe(
                    owner.tokenVersion
                );

                expect(
                    await authenticateUser(
                        owner.email,
                        currentPassword
                    )
                ).not.toBeNull();

                const audits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_OWNER_PASSWORD_RESET"
                        }
                    });

                expect(
                    audits
                ).toHaveLength(0);
            }
        );

        it(
            "returns 404 when recovering the owner password for a nonexistent merchant",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "owner-password-missing-merchant"
                    );

                const merchantId =
                    "nonexistent-merchant";

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants/${merchantId}/owner/password`,
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
                                    newPassword:
                                        "RecoveredPassword456!"
                                })
                        }
                    );

                expect(
                    response.status
                ).toBe(404);

                const body =
                    await response.json() as {
                        error?: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant not found"
                );

                const audits =
                    await prisma.platformAuditLog.findMany({
                        where: {
                            actorPlatformUserId:
                                fixture.user.id,
                            merchantId,
                            action:
                                "MERCHANT_OWNER_PASSWORD_RESET"
                        }
                    });

                expect(
                    audits
                ).toHaveLength(0);
            }
        );

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
            "immediately blocks and restores an existing merchant session when the account is suspended and reinstated",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-account-session-enforcement"
                    );

                const merchant =
                    await createMerchant(
                        "merchant-account-session-enforcement"
                    );

                const user =
                    await prisma.merchantUser.create({
                        data: {
                            merchantId:
                                merchant.id,
                            email:
                                `${testPrefix}-merchant-account-session-enforcement@example.test`,
                            passwordHash:
                                await hashPassword(
                                    "MerchantPassword123!"
                                ),
                            displayName:
                                "Merchant Account Session Owner",
                            role:
                                "OWNER",
                            tokenVersion:
                                0
                        }
                    });

                const merchantToken =
                    createAuthToken({
                        id:
                            user.id,
                        merchantId:
                            merchant.id,
                        role:
                            user.role,
                        tokenVersion:
                            user.tokenVersion
                    });

                const activeResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/me`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${merchantToken}`
                            }
                        }
                    );

                expect(
                    activeResponse.status
                ).toBe(
                    200
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
                                        "Session enforcement test"
                                })
                        }
                    );

                expect(
                    suspendResponse.status
                ).toBe(
                    200
                );

                const suspendedResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/me`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${merchantToken}`
                            }
                        }
                    );

                expect(
                    suspendedResponse.status
                ).toBe(
                    403
                );

                const suspendedBody =
                    await suspendedResponse.json() as {
                        error: string;
                    };

                expect(
                    suspendedBody.error
                ).toBe(
                    "Merchant account is suspended"
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
                                        "Session enforcement test completed"
                                })
                        }
                    );

                expect(
                    reinstateResponse.status
                ).toBe(
                    200
                );

                const restoredResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/me`,
                        {
                            headers: {
                                authorization:
                                    `Bearer ${merchantToken}`
                            }
                        }
                    );

                expect(
                    restoredResponse.status
                ).toBe(
                    200
                );

                const restoredBody =
                    await restoredResponse.json() as {
                        user: {
                            id: string;
                            merchantId: string;
                        };
                    };

                expect(
                    restoredBody.user
                ).toMatchObject({
                    id:
                        user.id,
                    merchantId:
                        merchant.id
                });

                const unchangedUser =
                    await prisma.merchantUser.findUniqueOrThrow({
                        where: {
                            id:
                                user.id
                        }
                    });

                expect(
                    unchangedUser.tokenVersion
                ).toBe(
                    user.tokenVersion
                );
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
            "denies STAFF access to the platform audit log",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "audit-staff-denied",
                        "STAFF"
                    );

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
                ).toBe(403);

                expect(
                    await response.json()
                ).toEqual({
                    error:
                        "You do not have permission to perform this platform action"
                });
            }
        );

        it(
            "allows ADMIN access to the platform audit log",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "audit-admin-allowed",
                        "ADMIN"
                    );

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

        it(
            "allows STAFF access to the platform billing workload summary",
            async () => {
                const {
                    token
                } =
                    await createPlatformFixture(
                        "billing-work-summary-staff",
                        "STAFF"
                    );

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/work/summary`,
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
            }
        );

        it(
            "returns current billing workload and today's resolved settlement counts",
            async () => {
                const {
                    user,
                    token
                } =
                    await createPlatformFixture(
                        "billing-work-summary"
                    );

                const merchant =
                    await createMerchant(
                        "billing-work-summary"
                    );

                const [
                    baselineDraftInvoices,
                    baselineAwaitingPayment,
                    baselinePaymentReview
                ] =
                    await Promise.all([
                        prisma.merchantInvoice.count({
                            where: {
                                status:
                                    MerchantInvoiceStatus.DRAFT
                            }
                        }),
                        prisma.merchantInvoice.count({
                            where: {
                                status:
                                    MerchantInvoiceStatus.OPEN
                            }
                        }),
                        prisma.merchantSettlement.count({
                            where: {
                                status:
                                    MerchantSettlementStatus
                                        .REVIEW_REQUIRED
                            }
                        })
                    ]);

                const now =
                    new Date();

                const todayStart =
                    new Date(
                        Date.UTC(
                            now.getUTCFullYear(),
                            now.getUTCMonth(),
                            now.getUTCDate()
                        )
                    );

                const tomorrowStart =
                    new Date(
                        Date.UTC(
                            now.getUTCFullYear(),
                            now.getUTCMonth(),
                            now.getUTCDate() + 1
                        )
                    );

                const [
                    baselineVerifiedToday,
                    baselineRejectedToday
                ] =
                    await Promise.all([
                        prisma.platformAuditLog.count({
                            where: {
                                action:
                                    "MERCHANT_SETTLEMENT_VERIFIED",
                                createdAt: {
                                    gte:
                                        todayStart,
                                    lt:
                                        tomorrowStart
                                }
                            }
                        }),
                        prisma.platformAuditLog.count({
                            where: {
                                action:
                                    "MERCHANT_SETTLEMENT_REJECTED",
                                createdAt: {
                                    gte:
                                        todayStart,
                                    lt:
                                        tomorrowStart
                                }
                            }
                        })
                    ]);

                const periodStart =
                    new Date(
                        "2026-09-01T00:00:00.000Z"
                    );

                const periodEnd =
                    new Date(
                        "2026-10-01T00:00:00.000Z"
                    );

                await prisma.merchantInvoice.create({
                    data: {
                        merchantId:
                            merchant.id,
                        invoiceNumber:
                            `${testPrefix}-work-draft`,
                        periodStart,
                        periodEnd,
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
                            MerchantInvoiceStatus.DRAFT
                    }
                });

                const openInvoice =
                    await prisma.merchantInvoice.create({
                        data: {
                            merchantId:
                                merchant.id,
                            invoiceNumber:
                                `${testPrefix}-work-open`,
                            periodStart:
                                new Date(
                                    "2026-10-01T00:00:00.000Z"
                                ),
                            periodEnd:
                                new Date(
                                    "2026-11-01T00:00:00.000Z"
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
                                new Date()
                        }
                    });

                await prisma.merchantSettlement.create({
                    data: {
                        merchantId:
                            merchant.id,
                        invoiceId:
                            openInvoice.id,
                        provider:
                            MerchantSettlementProvider.TELEBIRR,
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
                            `${testPrefix}-work-review`
                    }
                });

                await prisma.platformAuditLog.createMany({
                    data: [
                        {
                            actorPlatformUserId:
                                user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_SETTLEMENT_VERIFIED",
                            entityType:
                                "MERCHANT_SETTLEMENT",
                            entityId:
                                `${testPrefix}-work-verified`
                        },
                        {
                            actorPlatformUserId:
                                user.id,
                            merchantId:
                                merchant.id,
                            action:
                                "MERCHANT_SETTLEMENT_REJECTED",
                            entityType:
                                "MERCHANT_SETTLEMENT",
                            entityId:
                                `${testPrefix}-work-rejected`
                        }
                    ]
                });

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/billing/work/summary`,
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

                expect(
                    await response.json()
                ).toEqual({
                    pending: {
                        draftInvoices:
                            baselineDraftInvoices + 1,
                        awaitingPayment:
                            baselineAwaitingPayment + 1,
                        paymentReview:
                            baselinePaymentReview + 1,
                        total:
                            baselineDraftInvoices +
                            baselineAwaitingPayment +
                            baselinePaymentReview +
                            3
                    },
                    resolvedToday: {
                        verified:
                            baselineVerifiedToday + 1,
                        rejected:
                            baselineRejectedToday + 1,
                        total:
                            baselineVerifiedToday +
                            baselineRejectedToday +
                            2
                    }
                });
            }
        );

        it(
            "prevents direct merchant provisioning outside approved onboarding",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "direct-provisioning-block",
                        "ADMIN"
                    );

                const merchantName =
                    `${testPrefix} Direct Provisioning Block`;

                const ownerEmail =
                    `${testPrefix}-direct-provisioning@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchants`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name: merchantName,
                                currency: "ETB",
                                phone: "+251911000004",
                                ownerEmail,
                                ownerPassword:
                                    "LegacyPassword123!"
                            })
                        }
                    );

                expect(response.status).toBe(404);

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name: merchantName
                        }
                    });

                expect(merchant).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email: ownerEmail
                        }
                    });

                expect(owner).toBeNull();
            }
        );

        it(
            "allows a platform user to create a merchant with its initial owner atomically",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-onboarding"
                    );

                const reviewer =
                    await createPlatformFixture(
                        "merchant-onboarding-independent-reviewer",
                        "ADMIN"
                    );

                const ownerEmail =
                    `${testPrefix}-merchant-owner@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    `${testPrefix} Merchant`,
                                currency: "etb",
                                phone: "+251911000001",
                                address: "Addis Ababa",
                                ownerEmail:
                                    ownerEmail.toUpperCase(),
                                ownerDisplayName:
                                    "Merchant Owner"
                            })
                        }
                    );

                expect(response.status).toBe(201);

                const applicationBody =
                    await response.json() as {
                        id: string;
                        status: string;
                    };

                expect(applicationBody.id).toBeTruthy();

                expect(applicationBody.status)
                    .toBe("PENDING_APPROVAL");

                const approvalResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${applicationBody.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${reviewer.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                expect(approvalResponse.status).toBe(200);

                const approvalBody =
                    await approvalResponse.json() as {
                        applicationId: string;
                        merchantId: string;
                        status: string;
                    };

                expect(approvalBody).toMatchObject({
                    applicationId: applicationBody.id,
                    status: "APPROVED"
                });

                expect(approvalBody.merchantId).toBeTruthy();

                const invitation =
                    await prisma.merchantInvitationDelivery.findFirst({
                        where: {
                            activation: {
                                merchantId: approvalBody.merchantId
                            }
                        },
                        include: {
                            activation: true
                        }
                    });

                expect(invitation).not.toBeNull();

                expect(invitation?.status).toBe("PENDING");

                expect(invitation?.encryptedToken)
                    .not.toBeNull();

                const activationToken =
                    decryptMerchantInvitation(
                        invitation!.encryptedToken!
                    );

                const ownerPassword =
                    "merchant-owner-password";

                const activationResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/activate-owner`,
                        {
                            method: "POST",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                token: activationToken,
                                password: ownerPassword
                            })
                        }
                    );

                expect(activationResponse.status).toBe(200);

                const activatedOwner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email: ownerEmail
                        }
                    });

                expect(activatedOwner).not.toBeNull();

                expect(activatedOwner).toMatchObject({
                    merchantId: approvalBody.merchantId,
                    email: ownerEmail,
                    displayName: "Merchant Owner",
                    role: "OWNER"
                });

                expect(activatedOwner!.passwordHash)
                    .not.toBe(ownerPassword);

                const createdMerchant =
                    await prisma.merchant.findUniqueOrThrow({
                        where: {
                            id: approvalBody.merchantId
                        }
                    });

                const body = {
                    merchant: createdMerchant,
                    owner: activatedOwner!
                };

                expect(body.merchant).toMatchObject({
                    name:
                        `${testPrefix} Merchant`,
                    currency: "ETB",
                    accountStatus: "ACTIVE"
                });

                expect(body.owner).toMatchObject({
                    merchantId:
                        body.merchant.id,
                    email:
                        ownerEmail,
                    displayName:
                        "Merchant Owner",
                    role: "OWNER"
                });

                const persistedMerchant =
                    await prisma.merchant.findUnique({
                        where: {
                            id: body.merchant.id
                        },
                        include: {
                            users: true,
                            subscription: true
                        }
                    });

                expect(persistedMerchant).not.toBeNull();

                expect(
                    persistedMerchant?.users
                ).toHaveLength(1);

                expect(
                    persistedMerchant?.users[0]
                        ?.role
                ).toBe("OWNER");

                expect(
                    persistedMerchant?.users[0]
                        ?.passwordHash
                ).not.toBe(
                    "merchant-owner-password"
                );

                expect(
                    persistedMerchant?.subscription
                ).toBeNull();

                expect(
                    JSON.stringify(applicationBody)
                ).not.toContain(
                    "passwordHash"
                );

                expect(
                    JSON.stringify(approvalBody)
                ).not.toContain(
                    "passwordHash"
                );

                expect(
                    JSON.stringify(
                        await activationResponse.clone().json()
                    )
                ).not.toContain(
                    "passwordHash"
                );

                const onboardingAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId:
                                reviewer.user.id,
                            merchantId:
                                body.merchant.id,
                            action:
                                "MERCHANT_ONBOARDING_APPROVED",
                            entityType:
                                "MERCHANT_ONBOARDING_APPLICATION",
                            entityId:
                                applicationBody.id
                        }
                    });

                expect(
                    onboardingAudit
                ).not.toBeNull();
            }
        );

        it(
            "rejects a duplicate owner email without leaving a merchant behind",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-onboarding-duplicate"
                    );

                const reviewer =
                    await createPlatformFixture(
                        "merchant-onboarding-duplicate-reviewer",
                        "ADMIN"
                    );

                const existingMerchant =
                    await createMerchant(
                        "merchant-onboarding-duplicate-existing"
                    );

                const ownerEmail =
                    `${testPrefix}-duplicate-owner@example.com`;

                await prisma.merchantUser.create({
                    data: {
                        merchantId:
                            existingMerchant.id,
                        email:
                            ownerEmail,
                        passwordHash:
                            "existing-password-hash",
                        role:
                            "OWNER"
                    }
                });

                const merchantName =
                    `${testPrefix} Duplicate Email Merchant`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "ETB",
                                phone:
                                    "+251911000002",
                                ownerEmail:
                                    ownerEmail.toUpperCase(),
                                ownerDisplayName:
                                    "Duplicate Owner"
                            })
                        }
                    );

                expect(response.status).toBe(201);

                const applicationBody =
                    await response.json() as {
                        id: string;
                        status: string;
                    };

                expect(applicationBody.id).toBeTruthy();

                expect(applicationBody.status)
                    .toBe("PENDING_APPROVAL");

                const approvalResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${applicationBody.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${reviewer.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                expect(approvalResponse.status).toBe(200);

                const approvalBody =
                    await approvalResponse.json() as {
                        applicationId: string;
                        merchantId: string;
                        status: string;
                    };

                expect(approvalBody).toMatchObject({
                    applicationId: applicationBody.id,
                    status: "APPROVED"
                });

                expect(approvalBody.merchantId).toBeTruthy();

                const invitation =
                    await prisma.merchantInvitationDelivery.findFirst({
                        where: {
                            activation: {
                                merchantId: approvalBody.merchantId
                            }
                        },
                        include: {
                            activation: true
                        }
                    });

                expect(invitation).not.toBeNull();

                expect(invitation?.status).toBe("PENDING");

                expect(invitation?.encryptedToken)
                    .not.toBeNull();

                const activationToken =
                    decryptMerchantInvitation(
                        invitation!.encryptedToken!
                    );

                const activationResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/activate-owner`,
                        {
                            method: "POST",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                token: activationToken,
                                password:
                                    "merchant-owner-password"
                            })
                        }
                    );

                expect(activationResponse.status).toBe(400);

                const activationBody =
                    await activationResponse.json() as {
                        error: string;
                    };

                expect(activationBody.error).toBe(
                    "Invalid or unavailable activation invitation"
                );

                const activationAfterFailure =
                    await prisma.merchantOwnerActivation.findUniqueOrThrow({
                        where: {
                            id: invitation!.activationId
                        }
                    });

                expect(activationAfterFailure.consumedAt)
                    .toBeNull();

                const approvedMerchant =
                    await prisma.merchant.findUniqueOrThrow({
                        where: {
                            id: approvalBody.merchantId
                        }
                    });

                expect(approvedMerchant.name)
                    .toBe(merchantName);

                const newMerchantOwnerCount =
                    await prisma.merchantUser.count({
                        where: {
                            merchantId: approvalBody.merchantId,
                            role: "OWNER"
                        }
                    });

                expect(newMerchantOwnerCount).toBe(0);

                const ownersWithEmail =
                    await prisma.merchantUser.count({
                        where: {
                            email:
                                ownerEmail
                        }
                    });

                expect(
                    ownersWithEmail
                ).toBe(1);

                const onboardingAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            actorPlatformUserId: reviewer.user.id,
                            action: "MERCHANT_ONBOARDING_APPROVED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            entityId: applicationBody.id
                        }
                    });

                expect(onboardingAudit).not.toBeNull();
            }
        );

        it(
            "rejects merchant credentials when creating a merchant",
            async () => {
                const merchantToken =
                    createAuthToken({
                        id:
                            "merchant-user-test",
                        merchantId:
                            "merchant-test",
                        role:
                            "OWNER",
                        tokenVersion:
                            0
                    });

                const merchantName =
                    `${testPrefix} Unauthorized Merchant`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${merchantToken}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "ETB",
                                phone:
                                    "+251911000003",
                                ownerEmail:
                                    `${testPrefix}-unauthorized-owner@example.com`
                            })
                        }
                    );

                expect(
                    response.status
                ).toBe(403);

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name:
                                merchantName
                        }
                    });

                expect(
                    merchant
                ).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                `${testPrefix}-unauthorized-owner@example.com`
                        }
                    });

                expect(
                    owner
                ).toBeNull();

                const onboardingAudit =
                    await prisma.platformAuditLog.findFirst({
                        where: {
                            action: "MERCHANT_ONBOARDING_SUBMITTED",
                            entityType: "MERCHANT_ONBOARDING_APPLICATION",
                            metadata: {
                                path: [
                                    "ownerEmail"
                                ],
                                equals:
                                    `${testPrefix}-unauthorized-owner@example.com`
                            }
                        }
                    });

                expect(
                    onboardingAudit
                ).toBeNull();
            }
        );

        it(
            "rejects unauthenticated merchant creation",
            async () => {
                const merchantName =
                    `${testPrefix} Unauthenticated Merchant`;

                const ownerEmail =
                    `${testPrefix}-unauthenticated-owner@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "ETB",
                                phone:
                                    "+251911000004",
                                ownerEmail
                            })
                        }
                    );

                expect(
                    response.status
                ).toBe(401);

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name:
                                merchantName
                        }
                    });

                expect(
                    merchant
                ).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                ownerEmail
                        }
                    });

                expect(
                    owner
                ).toBeNull();
            }
        );

        it(
            "rejects an invalid initial owner email without creating a merchant",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-onboarding-invalid-email"
                    );

                const merchantName =
                    `${testPrefix} Invalid Email Merchant`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "ETB",
                                phone:
                                    "+251911000005",
                                ownerEmail:
                                    "owner@invalid"
                            })
                        }
                    );

                expect(
                    response.status
                ).toBe(400);

                const body =
                    await response.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "A valid owner email is required"
                );

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name:
                                merchantName
                        }
                    });

                expect(
                    merchant
                ).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                "owner@invalid"
                        }
                    });

                expect(
                    owner
                ).toBeNull();
            }
        );

        it(
            "rejects a short owner activation password without creating an owner account",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-onboarding-short-password"
                    );

                const reviewer =
                    await createPlatformFixture(
                        "merchant-onboarding-short-password-reviewer",
                        "ADMIN"
                    );

                const merchantName =
                    `${testPrefix} Short Password Merchant`;

                const ownerEmail =
                    `${testPrefix}-short-password-owner@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "ETB",
                                phone:
                                    "+251911000006",
                                ownerEmail
                            })
                        }
                    );

                expect(response.status).toBe(201);

                const applicationBody =
                    await response.json() as {
                        id: string;
                        status: string;
                    };

                expect(applicationBody.id).toBeTruthy();

                expect(applicationBody.status)
                    .toBe("PENDING_APPROVAL");

                const approvalResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${applicationBody.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${reviewer.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                expect(approvalResponse.status).toBe(200);

                const approvalBody =
                    await approvalResponse.json() as {
                        applicationId: string;
                        merchantId: string;
                        status: string;
                    };

                expect(approvalBody).toMatchObject({
                    applicationId: applicationBody.id,
                    status: "APPROVED"
                });

                expect(approvalBody.merchantId).toBeTruthy();

                const invitation =
                    await prisma.merchantInvitationDelivery.findFirst({
                        where: {
                            activation: {
                                merchantId: approvalBody.merchantId
                            }
                        },
                        include: {
                            activation: true
                        }
                    });

                expect(invitation).not.toBeNull();

                expect(invitation?.status).toBe("PENDING");

                expect(invitation?.encryptedToken)
                    .not.toBeNull();

                const activationToken =
                    decryptMerchantInvitation(
                        invitation!.encryptedToken!
                    );

                const activationResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/activate-owner`,
                        {
                            method: "POST",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                token: activationToken,
                                password: "short"
                            })
                        }
                    );

                expect(activationResponse.status).toBe(400);

                const activationBody =
                    await activationResponse.json() as {
                        error: string;
                    };

                expect(activationBody.error).toBe(
                    "Valid activation token and password are required"
                );

                const activationAfterFailure =
                    await prisma.merchantOwnerActivation.findUniqueOrThrow({
                        where: {
                            id: invitation!.activationId
                        }
                    });

                expect(activationAfterFailure.consumedAt)
                    .toBeNull();

                const approvedMerchant =
                    await prisma.merchant.findUniqueOrThrow({
                        where: {
                            id: approvalBody.merchantId
                        }
                    });

                expect(approvedMerchant.name)
                    .toBe(merchantName);

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                ownerEmail
                        }
                    });

                expect(
                    owner
                ).toBeNull();
            }
        );

        it(
            "rejects an invalid merchant currency without creating a merchant",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-onboarding-invalid-currency"
                    );

                const merchantName =
                    `${testPrefix} Invalid Currency Merchant`;

                const ownerEmail =
                    `${testPrefix}-invalid-currency-owner@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "INVALID",
                                phone:
                                    "+251911000007",
                                ownerEmail
                            })
                        }
                    );

                expect(
                    response.status
                ).toBe(400);

                const body =
                    await response.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    "Merchant currency must be ETB"
                );

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name:
                                merchantName
                        }
                    });

                expect(
                    merchant
                ).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                ownerEmail
                        }
                    });

                expect(
                    owner
                ).toBeNull();
            }
        );

        it.each([
            {
                field:
                    "phone",
                value:
                    "1".repeat(51),
                expectedError:
                    "phone is required and must be at most 50 characters"
            },
            {
                field:
                    "alternatePhone",
                value:
                    "1".repeat(51),
                expectedError:
                    "alternatePhone must be at most 50 characters"
            },
            {
                field:
                    "address",
                value:
                    "A".repeat(1001),
                expectedError:
                    "address must be at most 1000 characters"
            }
        ])(
            "rejects an oversized merchant $field during onboarding",
            async ({
                field,
                value,
                expectedError
            }) => {
                const fixture =
                    await createPlatformFixture(
                        `merchant-onboarding-${field}-limit`
                    );

                const merchantName =
                    `${testPrefix} ${field} Limit Merchant`;

                const ownerEmail =
                    `${testPrefix}-${field}-limit-owner@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "ETB",
                                phone:
                                    "+251911000008",
                                ownerEmail,
                                [field]:
                                    value
                            })
                        }
                    );

                expect(
                    response.status
                ).toBe(400);

                const body =
                    await response.json() as {
                        error: string;
                    };

                expect(
                    body.error
                ).toBe(
                    expectedError
                );

                const merchant =
                    await prisma.merchant.findFirst({
                        where: {
                            name:
                                merchantName
                        }
                    });

                expect(
                    merchant
                ).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                ownerEmail
                        }
                    });

                expect(
                    owner
                ).toBeNull();
            }
        );

        it(
            "ignores privileged onboarding fields and enforces safe merchant and owner defaults",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-onboarding-safe-defaults"
                    );

                const reviewer =
                    await createPlatformFixture(
                        "merchant-onboarding-safe-defaults-reviewer",
                        "ADMIN"
                    );

                const merchantName =
                    `${testPrefix} Safe Defaults Merchant`;

                const ownerEmail =
                    `${testPrefix}-safe-defaults-owner@example.com`;

                const response =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name:
                                    merchantName,
                                currency:
                                    "ETB",
                                phone:
                                    "+251911000009",
                                ownerEmail,

                                // These must never control
                                // onboarding security state.
                                role:
                                    "STAFF",
                                ownerRole:
                                    "ADMIN",
                                accountStatus:
                                    "SUSPENDED",
                                accountSuspensionReason:
                                    "caller-controlled",
                                accountSuspendedAt:
                                    new Date().toISOString()
                            })
                        }
                    );

                expect(
                    response.status
                ).toBe(201);

                const body =
                    await response.json() as {
                        id: string;
                        status: string;
                    };

                expect(
                    body.id
                ).toEqual(expect.any(String));

                expect(
                    body.status
                ).toBe("PENDING_APPROVAL");

                const approvalResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${body.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${reviewer.token}`,
                                "content-type":
                                    "application/json"
                            }
                        }
                    );

                expect(
                    approvalResponse.status
                ).toBe(200);

                const approvalBody =
                    await approvalResponse.json() as {
                        applicationId: string;
                        merchantId: string;
                        status: string;
                    };

                expect(
                    approvalBody.applicationId
                ).toBe(body.id);

                expect(
                    approvalBody.status
                ).toBe("APPROVED");

                const merchant =
                    await prisma.merchant.findUniqueOrThrow({
                        where: {
                            id:
                                approvalBody.merchantId
                        }
                    });

                expect(
                    merchant.accountStatus
                ).toBe("ACTIVE");

                expect(
                    merchant.accountSuspensionReason
                ).toBeNull();

                expect(
                    merchant.accountSuspendedAt
                ).toBeNull();

                const owner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                ownerEmail
                        }
                    });

                expect(
                    owner
                ).toBeNull();

                const invitation =
                    await prisma.merchantInvitationDelivery.findFirst({
                        where: {
                            activation: {
                                merchantId:
                                    approvalBody.merchantId
                            },
                            status: "PENDING"
                        },
                        include: {
                            activation: true
                        }
                    });

                expect(invitation).not.toBeNull();

                expect(invitation?.encryptedToken)
                    .not.toBeNull();

                const activationToken =
                    decryptMerchantInvitation(
                        invitation!.encryptedToken!
                    );

                const activationResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/activate-owner`,
                        {
                            method: "POST",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                token: activationToken,
                                password:
                                    "merchant-owner-password"
                            })
                        }
                    );

                expect(
                    activationResponse.status
                ).toBe(200);

                const activatedOwner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email:
                                ownerEmail
                        }
                    });

                expect(activatedOwner).not.toBeNull();

                expect(activatedOwner).toMatchObject({
                    merchantId:
                        approvalBody.merchantId,
                    email:
                        ownerEmail,
                    role:
                        "OWNER"
                });
            }
        );

        it(
            "creates an initial merchant owner that can authenticate through the merchant login flow",
            async () => {
                const fixture =
                    await createPlatformFixture(
                        "merchant-onboarding-owner-login"
                    );

                const reviewer =
                    await createPlatformFixture(
                        "merchant-onboarding-owner-login-reviewer",
                        "ADMIN"
                    );

                const merchantName =
                    `${testPrefix} Owner Login Merchant`;

                const ownerEmail =
                    `${testPrefix}-owner-login@example.com`;

                const ownerPassword =
                    "merchant-owner-password";

                const createResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${fixture.token}`,
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                name: merchantName,
                                currency: "ETB",
                                phone: "+251911000010",
                                ownerEmail:
                                    ownerEmail.toUpperCase(),
                                ownerDisplayName:
                                    "Initial Owner"
                            })
                        }
                    );

                expect(
                    createResponse.status
                ).toBe(201);

                const createBody =
                    await createResponse.json() as {
                        id: string;
                        status: string;
                    };

                expect(createBody.status).toBe(
                    "PENDING_APPROVAL"
                );

                expect(createBody.id).toEqual(
                    expect.any(String)
                );

                const approvalResponse =
                    await fetch(
                        `${apiBaseUrl}/platform/merchant-onboarding/${createBody.id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                authorization:
                                    `Bearer ${reviewer.token}`,
                                "content-type":
                                    "application/json"
                            }
                        }
                    );

                expect(approvalResponse.status).toBe(200);

                const approvalBody =
                    await approvalResponse.json() as {
                        applicationId: string;
                        merchantId: string;
                        status: string;
                    };

                expect(approvalBody).toMatchObject({
                    applicationId: createBody.id,
                    status: "APPROVED"
                });

                expect(approvalBody.merchantId).toEqual(
                    expect.any(String)
                );

                const invitation =
                    await prisma.merchantInvitationDelivery.findFirst({
                        where: {
                            activation: {
                                merchantId:
                                    approvalBody.merchantId
                            },
                            status: "PENDING"
                        },
                        include: {
                            activation: true
                        }
                    });

                expect(invitation).not.toBeNull();

                expect(invitation?.encryptedToken)
                    .not.toBeNull();

                const activationToken =
                    decryptMerchantInvitation(
                        invitation!.encryptedToken!
                    );

                const activationResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/activate-owner`,
                        {
                            method: "POST",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                token: activationToken,
                                password: ownerPassword
                            })
                        }
                    );

                expect(activationResponse.status).toBe(200);

                const activatedOwner =
                    await prisma.merchantUser.findUnique({
                        where: {
                            email: ownerEmail
                        }
                    });

                expect(activatedOwner).not.toBeNull();

                expect(activatedOwner).toMatchObject({
                    merchantId: approvalBody.merchantId,
                    email: ownerEmail,
                    displayName: "Initial Owner",
                    role: "OWNER"
                });

                const loginResponse =
                    await fetch(
                        `${apiBaseUrl}/auth/login`,
                        {
                            method: "POST",
                            headers: {
                                "content-type":
                                    "application/json"
                            },
                            body: JSON.stringify({
                                email:
                                    ownerEmail,
                                password:
                                    ownerPassword
                            })
                        }
                    );

                expect(
                    loginResponse.status
                ).toBe(200);

                const loginBody =
                    await loginResponse.json() as {
                        token: string;
                        user: {
                            id: string;
                            merchantId: string;
                            email: string;
                            displayName: string | null;
                            role: string;
                        };
                    };

                expect(
                    loginBody.token
                ).toEqual(
                    expect.any(String)
                );

                expect(
                    loginBody.token.length
                ).toBeGreaterThan(0);

                expect(
                    loginBody.user
                ).toEqual({
                    id:
                        activatedOwner!.id,
                    merchantId:
                        approvalBody.merchantId,
                    email:
                        ownerEmail,
                    displayName:
                        "Initial Owner",
                    role:
                        "OWNER"
                });
            }
        );

        describe(
            "merchant invitation delivery listing",
            () => {
                it(
                    "lists only REVIEW_REQUIRED deliveries by default without exposing secrets",
                    async () => {
                        const platform =
                            await createPlatformFixture(
                                "invitation-review-list",
                                "ADMIN"
                            );

                        const merchant =
                            await createMerchant(
                                "invitation-review-list"
                            );

                        const reviewActivation =
                            await prisma.merchantOwnerActivation.create({
                                data: {
                                    merchantId: merchant.id,
                                    ownerEmail:
                                        `${testPrefix}-review@example.test`,
                                    tokenHash:
                                        "invitation-review-token-hash",
                                    expiresAt:
                                        new Date(
                                            Date.now() + 3600000
                                        )
                                }
                            });

                        const pendingActivation =
                            await prisma.merchantOwnerActivation.create({
                                data: {
                                    merchantId: merchant.id,
                                    ownerEmail:
                                        `${testPrefix}-pending@example.test`,
                                    tokenHash:
                                        "invitation-pending-token-hash",
                                    expiresAt:
                                        new Date(
                                            Date.now() + 3600000
                                        )
                                }
                            });

                        const reviewDelivery =
                            await prisma.merchantInvitationDelivery.create({
                                data: {
                                    activationId: reviewActivation.id,
                                    recipientEmail:
                                        reviewActivation.ownerEmail,
                                    status: "REVIEW_REQUIRED",
                                    encryptedToken:
                                        "secret-encrypted-token"
                                }
                            });

                        await prisma.merchantInvitationDelivery.create({
                            data: {
                                activationId: pendingActivation.id,
                                recipientEmail:
                                    pendingActivation.ownerEmail,
                                status: "PENDING",
                                encryptedToken:
                                    "another-secret-token"
                            }
                        });

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${platform.token}`
                                    }
                                }
                            );

                        expect(response.status).toBe(200);

                        const body =
                            await response.json() as {
                                deliveries: Array<{
                                    id: string;
                                    status: string;
                                    recipientEmail: string;
                                    activation: {
                                        merchantId: string;
                                    };
                                }>;
                            };

                        expect(body.deliveries).toEqual(
                            expect.arrayContaining([
                                expect.objectContaining({
                                    id: reviewDelivery.id,
                                    status: "REVIEW_REQUIRED",
                                    recipientEmail:
                                        reviewActivation.ownerEmail,
                                    activation:
                                        expect.objectContaining({
                                            merchantId: merchant.id
                                        })
                                })
                            ])
                        );

                        expect(
                            body.deliveries.every(
                                (delivery) =>
                                    delivery.status ===
                                    "REVIEW_REQUIRED"
                            )
                        ).toBe(true);

                        const responseText =
                            JSON.stringify(body);

                        expect(responseText).not.toContain(
                            "secret-encrypted-token"
                        );

                        expect(responseText).not.toContain(
                            "invitation-review-token-hash"
                        );

                        expect(responseText).not.toContain(
                            "another-secret-token"
                        );

                        expect(responseText).not.toContain(
                            '"encryptedToken"'
                        );

                        expect(responseText).not.toContain(
                            '"tokenHash"'
                        );
                    }
                );

                it.each([
                    "OWNER",
                    "ADMIN",
                    "STAFF"
                ] as const)(
                    "allows platform %s to list invitation deliveries",
                    async (role) => {
                        const platform =
                            await createPlatformFixture(
                                `invitation-access-${role.toLowerCase()}`,
                                role
                            );

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${platform.token}`
                                    }
                                }
                            );

                        expect(response.status).toBe(200);

                        const body =
                            await response.json() as {
                                deliveries: unknown[];
                            };

                        expect(
                            Array.isArray(body.deliveries)
                        ).toBe(true);
                    }
                );

                it(
                    "rejects unauthenticated invitation delivery listing",
                    async () => {
                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries`
                            );

                        expect(response.status).toBe(401);
                    }
                );

                it(
                    "rejects merchant OWNER invitation delivery listing",
                    async () => {
                        const merchant =
                            await createMerchant(
                                "invitation-access-merchant"
                            );

                        const owner =
                            await prisma.merchantUser.create({
                                data: {
                                    merchantId: merchant.id,
                                    email:
                                        `${testPrefix}-invitation-access-owner@example.test`,
                                    passwordHash:
                                        await hashPassword(
                                            "BoundaryOwnerPassword123!"
                                        ),
                                    displayName:
                                        "Merchant Boundary Owner",
                                    role: "OWNER",
                                    tokenVersion: 0
                                }
                            });

                        const merchantToken =
                            createAuthToken({
                                id: owner.id,
                                merchantId: merchant.id,
                                role: owner.role,
                                tokenVersion: owner.tokenVersion
                            });

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${merchantToken}`
                                    }
                                }
                            );

                        expect(response.status).toBe(403);
                    }
                );

                it(
                    "filters invitation deliveries by an explicitly requested status",
                    async () => {
                        const platform =
                            await createPlatformFixture(
                                "invitation-filter-valid",
                                "ADMIN"
                            );

                        const merchant =
                            await createMerchant(
                                "invitation-filter-valid"
                            );

                        const activation =
                            await prisma.merchantOwnerActivation.create({
                                data: {
                                    merchantId: merchant.id,
                                    ownerEmail:
                                        `${testPrefix}-filter-valid@example.test`,
                                    tokenHash:
                                        "invitation-filter-valid-hash",
                                    expiresAt:
                                        new Date(Date.now() + 3600000)
                                }
                            });

                        const delivery =
                            await prisma.merchantInvitationDelivery.create({
                                data: {
                                    activationId: activation.id,
                                    recipientEmail:
                                        activation.ownerEmail,
                                    status: "SENT",
                                    sentAt: new Date(),
                                    providerMessageId:
                                        "resend-test-message"
                                }
                            });

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries?status=SENT`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${platform.token}`
                                    }
                                }
                            );

                        expect(response.status).toBe(200);

                        const body =
                            await response.json() as {
                                deliveries: Array<{
                                    id: string;
                                    status: string;
                                    providerMessageId: string | null;
                                }>;
                            };

                        expect(body.deliveries).toEqual(
                            expect.arrayContaining([
                                expect.objectContaining({
                                    id: delivery.id,
                                    status: "SENT",
                                    providerMessageId:
                                        "resend-test-message"
                                })
                            ])
                        );

                        expect(
                            body.deliveries.every(
                                (item) => item.status === "SENT"
                            )
                        ).toBe(true);
                    }
                );

                it.each([
                    "UNKNOWN",
                    "",
                    "sent",
                    "REVIEW_REQUIRED,FAILED"
                ])(
                    "rejects invalid invitation delivery status %j",
                    async (status) => {
                        const platform =
                            await createPlatformFixture(
                                `invitation-filter-invalid-${status.length}-${status.charCodeAt(0) || 0}`,
                                "ADMIN"
                            );

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries?status=${encodeURIComponent(status)}`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${platform.token}`
                                    }
                                }
                            );

                        expect(response.status).toBe(400);

                        expect(await response.json()).toEqual({
                            error: "Invalid invitation delivery status"
                        });
                    }
                );

                it(
                    "orders invitation deliveries by updatedAt and then id",
                    async () => {
                        const platform =
                            await createPlatformFixture(
                                "invitation-ordering",
                                "ADMIN"
                            );

                        const merchant =
                            await createMerchant(
                                "invitation-ordering"
                            );

                        const records = [
                            {
                                suffix: "middle",
                                updatedAt: new Date(
                                    "2026-01-02T00:00:00.000Z"
                                )
                            },
                            {
                                suffix: "oldest",
                                updatedAt: new Date(
                                    "2026-01-01T00:00:00.000Z"
                                )
                            },
                            {
                                suffix: "newest",
                                updatedAt: new Date(
                                    "2026-01-03T00:00:00.000Z"
                                )
                            },
                            {
                                suffix: "newest-tie",
                                updatedAt: new Date(
                                    "2026-01-03T00:00:00.000Z"
                                )
                            }
                        ];

                        const createdIds: Record<string, string> = {};

                        for (const record of records) {
                            const activation =
                                await prisma.merchantOwnerActivation.create({
                                    data: {
                                        merchantId: merchant.id,
                                        ownerEmail:
                                            `${testPrefix}-ordering-${record.suffix}@example.test`,
                                        tokenHash:
                                            `invitation-ordering-${record.suffix}-hash`,
                                        expiresAt:
                                            new Date(
                                                Date.now() + 3600000
                                            )
                                    }
                                });

                            const delivery =
                                await prisma.merchantInvitationDelivery.create({
                                    data: {
                                        activationId: activation.id,
                                        recipientEmail:
                                            activation.ownerEmail,
                                        status: "REVIEW_REQUIRED",
                                        updatedAt:
                                            record.updatedAt
                                    }
                                });

                            createdIds[record.suffix] = delivery.id;
                        }

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${platform.token}`
                                    }
                                }
                            );

                        expect(response.status).toBe(200);

                        const body =
                            await response.json() as {
                                deliveries: Array<{
                                    id: string;
                                    updatedAt: string;
                                }>;
                            };

                        const returnedIds =
                            body.deliveries
                                .filter((delivery) =>
                                    Object.values(createdIds).includes(
                                        delivery.id
                                    )
                                )
                                .map((delivery) => delivery.id);

                        const tiedIds = [
                            createdIds.newest,
                            createdIds["newest-tie"]
                        ].sort();

                        expect(returnedIds).toEqual([
                            createdIds.oldest,
                            createdIds.middle,
                            ...tiedIds
                        ]);

                        const orderingKeys =
                            body.deliveries.map((delivery) => ({
                                updatedAt: delivery.updatedAt,
                                id: delivery.id
                            }));

                        expect(orderingKeys).toEqual(
                            [...orderingKeys].sort((a, b) =>
                                a.updatedAt.localeCompare(b.updatedAt) ||
                                a.id.localeCompare(b.id)
                            )
                        );
                    }
                );

                it(
                    "limits invitation delivery listings to 50 records",
                    async () => {
                        const platform =
                            await createPlatformFixture(
                                "invitation-limit",
                                "ADMIN"
                            );

                        const merchant =
                            await createMerchant(
                                "invitation-limit"
                            );

                        const activationData =
                            Array.from(
                                { length: 51 },
                                (_, index) => ({
                                    merchantId: merchant.id,
                                    ownerEmail:
                                        `${testPrefix}-limit-${index}@example.test`,
                                    tokenHash:
                                        `invitation-limit-hash-${index}`,
                                    expiresAt:
                                        new Date(
                                            Date.now() + 3600000
                                        )
                                })
                            );

                        const activations =
                            await Promise.all(
                                activationData.map((data) =>
                                    prisma.merchantOwnerActivation.create({
                                        data
                                    })
                                )
                            );

                        await prisma.merchantInvitationDelivery.createMany({
                            data: activations.map((activation) => ({
                                activationId: activation.id,
                                recipientEmail:
                                    activation.ownerEmail,
                                status: "REVIEW_REQUIRED"
                            }))
                        });

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${platform.token}`
                                    }
                                }
                            );

                        expect(response.status).toBe(200);

                        const body =
                            await response.json() as {
                                deliveries: Array<{
                                    id: string;
                                    status: string;
                                }>;
                            };

                        expect(body.deliveries).toHaveLength(50);

                        expect(
                            body.deliveries.every(
                                (delivery) =>
                                    delivery.status ===
                                    "REVIEW_REQUIRED"
                            )
                        ).toBe(true);
                    }
                );

                it(
                    "does not modify invitation delivery records when listing them",
                    async () => {
                        const platform =
                            await createPlatformFixture(
                                "invitation-read-only",
                                "ADMIN"
                            );

                        const merchant =
                            await createMerchant(
                                "invitation-read-only"
                            );

                        const activation =
                            await prisma.merchantOwnerActivation.create({
                                data: {
                                    merchantId: merchant.id,
                                    ownerEmail:
                                        `${testPrefix}-read-only@example.test`,
                                    tokenHash:
                                        "invitation-read-only-token-hash",
                                    expiresAt:
                                        new Date(
                                            Date.now() + 3600000
                                        )
                                }
                            });

                        const delivery =
                            await prisma.merchantInvitationDelivery.create({
                                data: {
                                    activationId: activation.id,
                                    recipientEmail:
                                        activation.ownerEmail,
                                    status: "REVIEW_REQUIRED",
                                    attemptCount: 2,
                                    nextAttemptAt:
                                        new Date(
                                            "2026-10-01T10:00:00.000Z"
                                        ),
                                    processingUntil: null,
                                    providerMessageId: null,
                                    lastError:
                                        "Ambiguous provider outcome"
                                }
                            });

                        const before =
                            await prisma.merchantInvitationDelivery.findUniqueOrThrow({
                                where: {
                                    id: delivery.id
                                }
                            });

                        const response =
                            await fetch(
                                `${apiBaseUrl}/platform/merchant-invitations/deliveries`,
                                {
                                    headers: {
                                        authorization:
                                            `Bearer ${platform.token}`
                                    }
                                }
                            );

                        expect(response.status).toBe(200);

                        const body =
                            await response.json() as {
                                deliveries: Array<{
                                    id: string;
                                }>;
                            };

                        expect(
                            body.deliveries.some(
                                (item) => item.id === delivery.id
                            )
                        ).toBe(true);

                        const after =
                            await prisma.merchantInvitationDelivery.findUniqueOrThrow({
                                where: {
                                    id: delivery.id
                                }
                            });

                        expect(after).toEqual(before);
                    }
                );
            }
        );
    }
);
