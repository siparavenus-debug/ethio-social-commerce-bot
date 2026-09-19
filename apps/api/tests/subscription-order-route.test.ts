import {
  MerchantSubscriptionStatus,
  MerchantUserRole,
  OrderStatus,
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
  createAuthToken
} from "../src/services/auth.js";

import {
  createDeliveryConfirmation,
  DELIVERY_CONFIRMATION_MAX_ATTEMPTS
} from "../src/services/delivery-security.js";

const API_BASE_URL =
  "http://localhost:3000";

const testPrefix =
  "d16-order-route";

async function cleanup(): Promise<void> {
  const merchants =
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

  const merchantIds =
    merchants.map(
      (merchant) =>
        merchant.id
    );

  if (merchantIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.order.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.product.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantSubscription.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchantUser.deleteMany({
      where: {
        merchantId: {
          in:
            merchantIds
        }
      }
    });

    await prisma.merchant.deleteMany({
      where: {
        id: {
          in:
            merchantIds
        }
      }
    });
  }

  await prisma.subscriptionPlan.deleteMany({
    where: {
      code: {
        startsWith:
          testPrefix
      }
    }
  });
}

async function createFixture(
  suffix: string,
  status: MerchantSubscriptionStatus,
  role:
    MerchantUserRole =
    MerchantUserRole.OWNER
) {
  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`,
        currency:
          "ETB"
      }
    });

  const user =
    await prisma.merchantUser.create({
      data: {
        merchantId:
          merchant.id,
        email:
          `${testPrefix}-${suffix}@example.test`,
        passwordHash:
          "test-password-hash",
        displayName:
          `Day 16 ${role}`,
        role,
        tokenVersion:
          0
      }
    });

  const plan =
    await prisma.subscriptionPlan.create({
      data: {
        code:
          `${testPrefix}-${suffix}`,
        name:
          `Day 16 ${suffix}`,
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

  await prisma.merchantSubscription.create({
    data: {
      merchantId:
        merchant.id,
      planId:
        plan.id,
      status,
      billingInterval:
        SubscriptionBillingInterval.MONTHLY,
      priceSnapshot:
        "500.00",
      commissionRateSnapshot:
        "0.035000",
      currency:
        "ETB",
      currentPeriodStart:
        new Date(
          "2026-09-01T00:00:00.000Z"
        ),
      currentPeriodEnd:
        new Date(
          "2026-10-01T00:00:00.000Z"
        )
    }
  });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Product ${suffix}`,
        price:
          "100.00",
        currency:
          "ETB",
        stock:
          5,
        status:
          ProductStatus.ACTIVE
      }
    });

  const token =
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

  return {
    merchant,
    user,
    product,
    token
  };
}

async function postOrder(
  merchantId: string,
  token: string,
  productId: string,
  orderNumber: string,
  quantity = 2
) {
  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/orders`,
    {
      method:
        "POST",
      headers: {
        authorization:
          `Bearer ${token}`,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify({
          orderNumber,
          deliveryName:
            "Day 16 Delivery Recipient",
          deliveryPhone:
            "0911000000",
          deliveryAddress:
            "Day 16 Delivery Address",
          currency:
            "ETB",
          items: [
            {
              productId,
              quantity
            }
          ]
        })
    }
  );
}

async function postOrderStatus(
  merchantId: string,
  orderId: string,
  token: string,
  status:
    "FULFILLING" |
    "FULFILLED"
) {
  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/orders/${orderId}/status`,
    {
      method:
        "POST",
      headers: {
        authorization:
          `Bearer ${token}`,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify({
          status
        })
    }
  );
}

async function postDeliveryConfirmation(
  merchantId: string,
  orderId: string,
  token: string,
  code: string
) {
  return fetch(
    `${API_BASE_URL}/merchants/${merchantId}/orders/${orderId}/delivery-confirmation`,
    {
      method:
        "POST",
      headers: {
        authorization:
          `Bearer ${token}`,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify({
          code
        })
    }
  );
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe(
  "subscription enforcement on merchant order routes",
  () => {
    it(
      "allows an ACTIVE merchant to create new commerce",
      async () => {
        const fixture =
          await createFixture(
            "active",
            MerchantSubscriptionStatus.ACTIVE
          );

        const response =
          await postOrder(
            fixture.merchant.id,
            fixture.token,
            fixture.product.id,
            "D16-ACTIVE-ORDER"
          );

        expect(
          response.status
        ).toBe(201);

        const body =
          await response.json() as {
            id: string;
            orderNumber: string;
          };

        expect(
          body.orderNumber
        ).toBe(
          "D16-ACTIVE-ORDER"
        );

        const order =
          await prisma.order.findUnique({
            where: {
              id:
                body.id
            }
          });

        expect(
          order
        ).not.toBeNull();

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          product.stock
        ).toBe(3);
      }
    );

    it(
      "rejects order creation when delivery details are missing without mutating inventory",
      async () => {
        const fixture =
          await createFixture(
            "missing-delivery",
            MerchantSubscriptionStatus.ACTIVE
          );

        const response = await fetch(
          `${API_BASE_URL}/merchants/${fixture.merchant.id}/orders`,
          {
            method: "POST",
            headers: {
              authorization:
                `Bearer ${fixture.token}`,
              "content-type":
                "application/json"
            },
            body: JSON.stringify({
              orderNumber:
                "D16-MISSING-DELIVERY",
              currency: "ETB",
              items: [
                {
                  productId:
                    fixture.product.id,
                  quantity: 2
                }
              ]
            })
          }
        );

        expect(response.status).toBe(400);

        expect(
          await response.json()
        ).toEqual({
          error: "deliveryName is required"
        });

        const order =
          await prisma.order.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-MISSING-DELIVERY"
            }
          });

        expect(order).toBeNull();

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(product.stock).toBe(5);
      }
    );

    it(
      "blocks a SUSPENDED merchant from creating new commerce without mutating inventory",
      async () => {
        const fixture =
          await createFixture(
            "suspended-owner",
            MerchantSubscriptionStatus.SUSPENDED
          );

        const response =
          await postOrder(
            fixture.merchant.id,
            fixture.token,
            fixture.product.id,
            "D16-SUSPENDED-ORDER"
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          await response.json()
        ).toEqual({
          error:
            "Merchant subscription does not allow this action"
        });

        expect(
          await prisma.order.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          product.stock
        ).toBe(5);

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);
      }
    );

    it(
      "does not allow STAFF to bypass suspension",
      async () => {
        const fixture =
          await createFixture(
            "suspended-staff",
            MerchantSubscriptionStatus.SUSPENDED,
            MerchantUserRole.STAFF
          );

        const response =
          await postOrder(
            fixture.merchant.id,
            fixture.token,
            fixture.product.id,
            "D16-STAFF-BYPASS"
          );

        expect(
          response.status
        ).toBe(403);

        expect(
          await response.json()
        ).toEqual({
          error:
            "Merchant subscription does not allow this action"
        });

        expect(
          await prisma.order.count({
            where: {
              merchantId:
                fixture.merchant.id
            }
          })
        ).toBe(0);

        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id:
                fixture.product.id
            }
          });

        expect(
          product.stock
        ).toBe(5);
      }
    );

    it(
      "does not allow direct FULFILLED status without delivery confirmation",
      async () => {
        const fixture =
          await createFixture(
            "direct-fulfilled",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DIRECT-FULFILLED",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Direct Fulfilled Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Direct Fulfilled Address",
              deliveryConfirmationCodeHash:
                "a".repeat(64),
              deliveryConfirmationCodeExpiresAt:
                new Date(
                  Date.now() + 30 * 60 * 1000
                ),
              deliveryConfirmationAttempts:
                0
            }
          });

        const response =
          await postOrderStatus(
            fixture.merchant.id,
            order.id,
            fixture.token,
            "FULFILLED"
          );

        expect(
          response.status
        ).toBe(400);

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder.deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "rejects fulfillment when a PAID order has no delivery snapshot",
      async () => {
        const fixture =
          await createFixture(
            "missing-delivery",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-MISSING-DELIVERY",
              status:
                OrderStatus.PAID,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00"
            }
          });

        const response =
          await postOrderStatus(
            fixture.merchant.id,
            order.id,
            fixture.token,
            "FULFILLING"
          );

        expect(
          response.status
        ).toBe(400);

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.PAID
        );

        expect(
          unchangedOrder.deliveryConfirmationCodeHash
        ).toBeNull();

        expect(
          unchangedOrder.deliveryConfirmationCodeExpiresAt
        ).toBeNull();

        expect(
          unchangedOrder.deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          unchangedOrder.deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLING"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "allows a SUSPENDED merchant to process an existing PAID order",
      async () => {
        const fixture =
          await createFixture(
            "suspended-fulfillment",
            MerchantSubscriptionStatus.SUSPENDED,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-EXISTING-PAID",
              status:
                OrderStatus.PAID,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Day 16 Delivery Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Day 16 Delivery Address",
              deliveryConfirmationCodeHash:
                "a".repeat(64),
              deliveryConfirmationCodeExpiresAt:
                new Date(
                  "2026-09-16T12:00:00.000Z"
                ),
              deliveryConfirmationAttempts:
                2
            }
          });

        const response =
          await postOrderStatus(
            fixture.merchant.id,
            order.id,
            fixture.token,
            "FULFILLING"
          );

        expect(
          response.status
        ).toBe(200);

        const body =
          await response.json();

        expect(
          body.order.deliveryName
        ).toBe(
          "Day 16 Delivery Recipient"
        );

        expect(
          body.order.deliveryPhone
        ).toBe(
          "0911000000"
        );

        expect(
          body.order.deliveryAddress
        ).toBe(
          "Day 16 Delivery Address"
        );

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationCodeHash"
        );

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationCodeExpiresAt"
        );

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationAttempts"
        );

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationSentAt"
        );

        const updatedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id:
                order.id
            }
          });

        expect(
          updatedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          updatedOrder.deliveryConfirmationCodeHash
        ).toMatch(/^[a-f0-9]{64}$/);

        expect(
          updatedOrder.deliveryConfirmationCodeHash
        ).not.toBe(
          "a".repeat(64)
        );

        expect(
          updatedOrder.deliveryConfirmationCodeExpiresAt
        ).not.toBeNull();

        expect(
          updatedOrder.deliveryConfirmationCodeExpiresAt!.getTime()
        ).toBeGreaterThan(
          Date.now()
        );

        expect(
          updatedOrder.deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          updatedOrder.deliveryConfirmedAt
        ).toBeNull();

        const detailResponse =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/orders/${order.id}`,
            {
              headers: {
                authorization:
                  `Bearer ${fixture.token}`
              }
            }
          );

        expect(
          detailResponse.status
        ).toBe(200);

        const detailBody =
          await detailResponse.json();

        expect(
          detailBody.deliveryName
        ).toBe(
          "Day 16 Delivery Recipient"
        );

        expect(
          detailBody.deliveryPhone
        ).toBe(
          "0911000000"
        );

        expect(
          detailBody.deliveryAddress
        ).toBe(
          "Day 16 Delivery Address"
        );

        expect(
          detailBody
        ).not.toHaveProperty(
          "deliveryConfirmationCodeHash"
        );

        expect(
          detailBody
        ).not.toHaveProperty(
          "deliveryConfirmationCodeExpiresAt"
        );

        expect(
          detailBody
        ).not.toHaveProperty(
          "deliveryConfirmationAttempts"
        );

        expect(
          detailBody
        ).not.toHaveProperty(
          "deliveryConfirmationSentAt"
        );

        const listResponse =
          await fetch(
            `${API_BASE_URL}/merchants/${fixture.merchant.id}/orders`,
            {
              headers: {
                authorization:
                  `Bearer ${fixture.token}`
              }
            }
          );

        expect(
          listResponse.status
        ).toBe(200);

        const listBody =
          await listResponse.json();

        const listedOrder =
          listBody.find(
            (listed: { id: string }) =>
              listed.id === order.id
          );

        expect(
          listedOrder
        ).toBeDefined();

        expect(
          listedOrder.deliveryName
        ).toBe(
          "Day 16 Delivery Recipient"
        );

        expect(
          listedOrder.deliveryPhone
        ).toBe(
          "0911000000"
        );

        expect(
          listedOrder.deliveryAddress
        ).toBe(
          "Day 16 Delivery Address"
        );

        expect(
          listedOrder
        ).not.toHaveProperty(
          "deliveryConfirmationCodeHash"
        );

        expect(
          listedOrder
        ).not.toHaveProperty(
          "deliveryConfirmationCodeExpiresAt"
        );

        expect(
          listedOrder
        ).not.toHaveProperty(
          "deliveryConfirmationAttempts"
        );

        expect(
          listedOrder
        ).not.toHaveProperty(
          "deliveryConfirmationSentAt"
        );

        const audit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLING"
            }
          });

        expect(
          audit
        ).not.toBeNull();

        expect(
          audit?.actorUserId
        ).toBe(
          fixture.user.id
        );

        expect(
          JSON.stringify(audit?.metadata)
        ).not.toContain(
          "deliveryConfirmation"
        );

        expect(
          JSON.stringify(audit?.metadata)
        ).not.toContain(
          "Day 16 Delivery Recipient"
        );

        expect(
          JSON.stringify(audit?.metadata)
        ).not.toContain(
          "0911000000"
        );

        expect(
          JSON.stringify(audit?.metadata)
        ).not.toContain(
          "Day 16 Delivery Address"
        );
      }
    );

    it(
      "confirms delivery with the valid customer-held code",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-success",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-SUCCESS",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Confirmation Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Confirmation Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              0
          }
        });

        const response =
          await postDeliveryConfirmation(
            fixture.merchant.id,
            order.id,
            fixture.token,
            deliveryConfirmation.code
          );

        expect(
          response.status
        ).toBe(200);

        const body =
          await response.json();

        expect(
          body.order.status
        ).toBe(
          OrderStatus.FULFILLED
        );

        expect(
          body.order.deliveryConfirmedAt
        ).not.toBeNull();

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationCodeHash"
        );

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationCodeExpiresAt"
        );

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationAttempts"
        );

        expect(
          body.order
        ).not.toHaveProperty(
          "deliveryConfirmationSentAt"
        );

        const fulfilledOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          fulfilledOrder.status
        ).toBe(
          OrderStatus.FULFILLED
        );

        expect(
          fulfilledOrder.deliveryConfirmedAt
        ).not.toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationCodeHash
        ).toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationCodeExpiresAt
        ).toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationSentAt
        ).toBeNull();

        const audit =
          await prisma.auditLog.findFirst({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          });

        expect(
          audit
        ).not.toBeNull();

        expect(
          audit?.actorUserId
        ).toBe(
          fixture.user.id
        );

        const auditText =
          JSON.stringify(audit);

        expect(
          auditText
        ).not.toContain(
          deliveryConfirmation.code
        );

        expect(
          auditText
        ).not.toContain(
          deliveryConfirmation.codeHash
        );

        expect(
          auditText
        ).not.toContain(
          "Confirmation Recipient"
        );

        expect(
          auditText
        ).not.toContain(
          "0911000000"
        );

        expect(
          auditText
        ).not.toContain(
          "Confirmation Address"
        );
      }
    );

    it(
      "allows only one concurrent valid delivery confirmation to claim fulfillment",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-concurrent",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-CONCURRENT",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Concurrent Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Concurrent Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              0
          }
        });

        const responses =
          await Promise.all([
            postDeliveryConfirmation(
              fixture.merchant.id,
              order.id,
              fixture.token,
              deliveryConfirmation.code
            ),
            postDeliveryConfirmation(
              fixture.merchant.id,
              order.id,
              fixture.token,
              deliveryConfirmation.code
            )
          ]);

        const statuses =
          responses
            .map(
              (response) =>
                response.status
            )
            .sort(
              (a, b) =>
                a - b
            );

        expect(
          statuses[0]
        ).toBe(200);

        expect(
          [400, 409]
        ).toContain(
          statuses[1]
        );

        const fulfilledOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          fulfilledOrder.status
        ).toBe(
          OrderStatus.FULFILLED
        );

        expect(
          fulfilledOrder
            .deliveryConfirmedAt
        ).not.toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationCodeHash
        ).toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationCodeExpiresAt
        ).toBeNull();

        expect(
          fulfilledOrder
            .deliveryConfirmationSentAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(1);
      }
    );


    it(
      "increments attempts for an invalid delivery confirmation code",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-invalid",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-INVALID",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Invalid Code Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Invalid Code Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              0
          }
        });

        const wrongCode =
          deliveryConfirmation.code ===
          "000000"
            ? "000001"
            : "000000";

        const response =
          await postDeliveryConfirmation(
            fixture.merchant.id,
            order.id,
            fixture.token,
            wrongCode
          );

        expect(
          response.status
        ).toBe(400);

        const body =
          await response.json();

        expect(
          body.error
        ).toBe(
          "Invalid delivery confirmation code"
        );

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(1);

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBe(
          deliveryConfirmation.codeHash
        );

        expect(
          unchangedOrder
            .deliveryConfirmationCodeExpiresAt
        ).not.toBeNull();

        expect(
          unchangedOrder
            .deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "blocks delivery confirmation after the maximum number of attempts",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-limit",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-LIMIT",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Attempt Limit Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Attempt Limit Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              DELIVERY_CONFIRMATION_MAX_ATTEMPTS
          }
        });

        const response =
          await postDeliveryConfirmation(
            fixture.merchant.id,
            order.id,
            fixture.token,
            deliveryConfirmation.code
          );

        expect(
          response.status
        ).toBe(400);

        const body =
          await response.json();

        expect(
          body.error
        ).toBe(
          "Delivery confirmation attempt limit reached"
        );

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(
          DELIVERY_CONFIRMATION_MAX_ATTEMPTS
        );

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBe(
          deliveryConfirmation.codeHash
        );

        expect(
          unchangedOrder.deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "does not let concurrent invalid delivery codes exceed the attempt limit",
      async () => {
        const fixture =
          await createFixture(
            "delivery-race-invalid",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-CONCURRENT-INVALID",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Concurrent Invalid Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Concurrent Invalid Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              DELIVERY_CONFIRMATION_MAX_ATTEMPTS -
              1
          }
        });

        const responses =
          await Promise.all([
            postDeliveryConfirmation(
              fixture.merchant.id,
              order.id,
              fixture.token,
              "000000"
            ),
            postDeliveryConfirmation(
              fixture.merchant.id,
              order.id,
              fixture.token,
              "000000"
            )
          ]);

        for (const response of responses) {
          expect(
            [400, 409]
          ).toContain(
            response.status
          );
        }

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(
          DELIVERY_CONFIRMATION_MAX_ATTEMPTS
        );

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBe(
          deliveryConfirmation.codeHash
        );

        expect(
          unchangedOrder
            .deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );


    it(
      "rejects an expired delivery confirmation code",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-expired",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-EXPIRED",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Expired Code Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Expired Code Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        const expiredAt =
          new Date(
            Date.now() - 60_000
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              expiredAt,
            deliveryConfirmationAttempts:
              0
          }
        });

        const response =
          await postDeliveryConfirmation(
            fixture.merchant.id,
            order.id,
            fixture.token,
            deliveryConfirmation.code
          );

        expect(
          response.status
        ).toBe(400);

        const body =
          await response.json();

        expect(
          body.error
        ).toBe(
          "Delivery confirmation code has expired"
        );

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBe(
          deliveryConfirmation.codeHash
        );

        expect(
          unchangedOrder
            .deliveryConfirmationCodeExpiresAt
        ).not.toBeNull();

        expect(
          unchangedOrder
            .deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "rejects a malformed delivery confirmation code without consuming an attempt",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-malformed",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-MALFORMED",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Malformed Code Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Malformed Code Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              0
          }
        });

        const response =
          await postDeliveryConfirmation(
            fixture.merchant.id,
            order.id,
            fixture.token,
            "12345"
          );

        expect(
          response.status
        ).toBe(400);

        const body =
          await response.json();

        expect(
          body.error
        ).toBe(
          "code must be a 6-digit number"
        );

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBe(
          deliveryConfirmation.codeHash
        );

        expect(
          unchangedOrder
            .deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "rejects delivery confirmation when confirmation state is missing",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-missing",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-MISSING",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Missing State Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Missing State Address"
            }
          });

        const response =
          await postDeliveryConfirmation(
            fixture.merchant.id,
            order.id,
            fixture.token,
            "123456"
          );

        expect(
          response.status
        ).toBe(400);

        const body =
          await response.json();

        expect(
          body.error
        ).toBe(
          "Delivery confirmation is not available for this order"
        );

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBeNull();

        expect(
          unchangedOrder
            .deliveryConfirmationCodeExpiresAt
        ).toBeNull();

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          unchangedOrder
            .deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "rejects delivery confirmation when the order is not fulfilling",
      async () => {
        const fixture =
          await createFixture(
            "delivery-confirmation-status",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-STATUS",
              status:
                OrderStatus.PAID,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Invalid Status Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Invalid Status Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              0
          }
        });

        const response =
          await postDeliveryConfirmation(
            fixture.merchant.id,
            order.id,
            fixture.token,
            deliveryConfirmation.code
          );

        expect(
          response.status
        ).toBe(400);

        const body =
          await response.json();

        expect(
          body.error
        ).toBe(
          "Order must be FULFILLING before delivery confirmation"
        );

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.PAID
        );

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBe(
          deliveryConfirmation.codeHash
        );

        expect(
          unchangedOrder
            .deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              merchantId:
                fixture.merchant.id,
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );

    it(
      "does not allow one merchant to confirm another merchant's delivery",
      async () => {
        const merchantA =
          await createFixture(
            "delivery-confirmation-idor-a",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const merchantB =
          await createFixture(
            "delivery-confirmation-idor-b",
            MerchantSubscriptionStatus.ACTIVE,
            MerchantUserRole.STAFF
          );

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                merchantB.merchant.id,
              orderNumber:
                "D16-DELIVERY-CONFIRM-IDOR",
              status:
                OrderStatus.FULFILLING,
              currency:
                "ETB",
              subtotal:
                "100.00",
              total:
                "100.00",
              deliveryName:
                "Other Merchant Recipient",
              deliveryPhone:
                "0911000000",
              deliveryAddress:
                "Other Merchant Address"
            }
          });

        const deliveryConfirmation =
          createDeliveryConfirmation(
            order.id
          );

        await prisma.order.update({
          where: {
            id: order.id
          },
          data: {
            deliveryConfirmationCodeHash:
              deliveryConfirmation.codeHash,
            deliveryConfirmationCodeExpiresAt:
              deliveryConfirmation.expiresAt,
            deliveryConfirmationAttempts:
              0
          }
        });

        const response =
          await postDeliveryConfirmation(
            merchantA.merchant.id,
            order.id,
            merchantA.token,
            deliveryConfirmation.code
          );

        expect(
          response.status
        ).toBe(404);

        expect(
          await response.json()
        ).toEqual({
          error:
            "Order not found"
        });

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.merchantId
        ).toBe(
          merchantB.merchant.id
        );

        expect(
          unchangedOrder.status
        ).toBe(
          OrderStatus.FULFILLING
        );

        expect(
          unchangedOrder
            .deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          unchangedOrder
            .deliveryConfirmationCodeHash
        ).toBe(
          deliveryConfirmation.codeHash
        );

        expect(
          unchangedOrder
            .deliveryConfirmedAt
        ).toBeNull();

        expect(
          await prisma.auditLog.count({
            where: {
              entityId:
                order.id,
              action:
                "ORDER_FULFILLED"
            }
          })
        ).toBe(0);
      }
    );
  }
);
