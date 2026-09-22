import {
  MerchantSubscriptionStatus,
  PaymentProvider,
  ProductStatus,
  SubscriptionBillingInterval,
  prisma
} from "@ethio-commerce/database";

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  clearConversationState,
  getConversationState,
  setConversationState
} from "../src/conversation/conversation-state.js";

const {
    runAIConversationMock
  } = vi.hoisted(() => ({
    runAIConversationMock: vi.fn()
  }));

  vi.mock(
    "../src/ai/ai-orchestrator.js",
    () => ({
      runAIConversation:
        runAIConversationMock
    })
  );

import {
  handleConversation
} from "../src/conversation/conversation-manager.js";

const testPrefix =
  "telegram-delivery-collection";

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
    await prisma.auditLog.deleteMany({
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

    await prisma.order.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.paymentMethod.deleteMany({
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

async function createFixture() {
  const suffix = Date.now().toString();

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
          `Telegram Delivery Plan ${suffix}`,
        monthlyPrice: "500.00",
        annualPrice: "5000.00",
        currency: "ETB",
        commissionRate: "0.035000",
        isActive: true
      }
    });

  await prisma.merchantSubscription.create({
    data: {
      merchantId: merchant.id,
      planId: plan.id,
      status:
        MerchantSubscriptionStatus.ACTIVE,
      billingInterval:
        SubscriptionBillingInterval.MONTHLY,
      priceSnapshot: "500.00",
      commissionRateSnapshot:
        "0.035000",
      currency: "ETB",
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

  const customer =
    await prisma.customer.create({
      data: {
        merchantId: merchant.id,
        name:
          `Delivery Customer ${suffix}`,
        telegramChatId:
          `delivery-chat-${suffix}`,
        telegramUserId:
          `delivery-user-${suffix}`
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name:
          `Delivery Product ${suffix}`,
        price: "100.00",
        currency: "ETB",
        stock: 5,
        status: ProductStatus.ACTIVE
      }
    });

  await prisma.paymentMethod.create({
    data: {
      merchantId: merchant.id,
      provider:
        PaymentProvider.TELEBIRR,
      accountName:
        "Delivery Test Merchant",
      accountNumber:
        "0911000000"
    }
  });

  return {
    merchant,
    customer,
    product,
    chatId:
      customer.telegramChatId!
  };
}

describe(
  "Telegram delivery collection",
  () => {
    beforeEach(async () => {
      runAIConversationMock.mockReset();
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    it(
      "collects delivery details deterministically before creating the order",
      async () => {
        const fixture =
          await createFixture();

        setConversationState(
          fixture.chatId,
          {
            productId:
              fixture.product.id,
            productName:
              fixture.product.name,
            quantity: 2,
            awaitingConfirmation: true
          }
        );

        const context = {
          merchantId:
            fixture.merchant.id,
          customerId:
            fixture.customer.id,
          chatId:
            fixture.chatId,
          customerName:
            fixture.customer.name,
          merchantName:
            fixture.merchant.name
        };

        const confirmation =
          await handleConversation(
            context,
            "YES"
          );

        expect(
          confirmation.reply
        ).toContain(
          "recipient's full name"
        );

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toMatchObject({
          awaitingConfirmation: false,
          awaitingDeliveryName: true
        });

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        const name =
          "  Test Recipient  ";

        const nameResult =
          await handleConversation(
            context,
            name
          );

        expect(
          nameResult.reply
        ).toContain(
          "delivery phone number"
        );

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toMatchObject({
          awaitingDeliveryName: false,
          awaitingDeliveryPhone: true,
          deliveryName:
            "Test Recipient"
        });

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        const phone =
          "  0911223344  ";

        const phoneResult =
          await handleConversation(
            context,
            phone
          );

        expect(
          phoneResult.reply
        ).toContain(
          "delivery address or location"
        );

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toMatchObject({
          awaitingDeliveryPhone: false,
          awaitingDeliveryAddress: true,
          deliveryPhone:
            "0911223344"
        });

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        const address =
          "  Bole, Addis Ababa  ";

        const addressResult =
          await handleConversation(
            context,
            address
          );

        expect(
          addressResult.reply
        ).toContain(
          "Order confirmed!"
        );

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        const orders =
          await prisma.order.findMany({
            where: {
              merchantId:
                fixture.merchant.id
            }
          });

        expect(orders).toHaveLength(1);

        const order = orders[0];

        expect(
          order.deliveryName
        ).toBe("Test Recipient");

        expect(
          order.deliveryPhone
        ).toBe("0911223344");

        expect(
          order.deliveryAddress
        ).toBe(
          "Bole, Addis Ababa"
        );

        expect(order.status).toBe(
          "PENDING_PAYMENT"
        );

        expect(
          order.deliveryConfirmationCodeHash
        ).toBeNull();

        expect(
          order.deliveryConfirmationCodeExpiresAt
        ).toBeNull();

        expect(
          order.deliveryConfirmationAttempts
        ).toBe(0);

        expect(
          order.deliveryConfirmedAt
        ).toBeNull();

        /*
         * Temporary delivery PII must no
         * longer remain in conversation
         * state after order creation.
         */
        expect(
          getConversationState(
            fixture.chatId
          )
        ).toEqual({
          awaitingPayment: true,
          pendingOrderId: order.id
        });

        /*
         * Telegram order creation only
         * checks stock. Payment verification
         * remains responsible for committing
         * inventory.
         */
        const product =
          await prisma.product.findUniqueOrThrow({
            where: {
              id: fixture.product.id
            }
          });

        expect(product.stock).toBe(5);

        clearConversationState(
          fixture.chatId
        );
      }
    );

    it(
      "preserves multilingual delivery details deterministically",
      async () => {
        const fixture =
          await createFixture();

        setConversationState(
          fixture.chatId,
          {
            productId:
              fixture.product.id,
            productName:
              fixture.product.name,
            quantity: 1,
            awaitingDeliveryName: true
          }
        );

        const context = {
          merchantId:
            fixture.merchant.id,
          customerId:
            fixture.customer.id,
          chatId:
            fixture.chatId,
          customerName:
            fixture.customer.name,
          merchantName:
            fixture.merchant.name
        };

        const deliveryName =
          "  ሀና ተስፋዬ  ";

        const nameResult =
          await handleConversation(
            context,
            deliveryName
          );

        expect(
          nameResult.reply
        ).toContain(
          "delivery phone number"
        );

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toMatchObject({
          deliveryName:
            "ሀና ተስፋዬ",
          awaitingDeliveryPhone: true
        });

        const deliveryPhone =
          "  +251 911 223 344  ";

        const phoneResult =
          await handleConversation(
            context,
            deliveryPhone
          );

        expect(
          phoneResult.reply
        ).toContain(
          "delivery address or location"
        );

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toMatchObject({
          deliveryPhone:
            "+251 911 223 344",
          awaitingDeliveryAddress: true
        });

        const deliveryAddress =
          "  ቦሌ, Addis Ababa - መድሀኒዓለም አጠገብ  ";

        const addressResult =
          await handleConversation(
            context,
            deliveryAddress
          );

        expect(
          addressResult.reply
        ).toContain(
          "Order confirmed!"
        );

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        const order =
          await prisma.order.findFirstOrThrow({
            where: {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          });

        expect(
          order.deliveryName
        ).toBe("ሀና ተስፋዬ");

        expect(
          order.deliveryPhone
        ).toBe("+251 911 223 344");

        expect(
          order.deliveryAddress
        ).toBe(
          "ቦሌ, Addis Ababa - መድሀኒዓለም አጠገብ"
        );

        expect(order.status).toBe(
          "PENDING_PAYMENT"
        );

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toEqual({
          awaitingPayment: true,
          pendingOrderId: order.id
        });

        clearConversationState(
          fixture.chatId
        );
      }
    );

    it(
      "keeps invalid conversational text inside the pending payment flow",
      async () => {
        const fixture =
          await createFixture();

        const order =
          await prisma.order.create({
            data: {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id,
              orderNumber:
                `${testPrefix}-payment-boundary`,
              subtotal: 100,
              total: 100,
              currency: "ETB",
              status:
                "PENDING_PAYMENT",
              deliveryName:
                "Test Recipient",
              deliveryPhone:
                "0911223344",
              deliveryAddress:
                "Bole, Addis Ababa"
            }
          });

        setConversationState(
          fixture.chatId,
          {
            awaitingPayment: true,
            pendingOrderId:
              order.id
          }
        );

        const result =
          await handleConversation(
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id,
              chatId:
                fixture.chatId,
              customerName:
                fixture.customer.name,
              merchantName:
                fixture.merchant.name
            },
            "I want another product"
          );

        expect(
          result.reply
        ).toContain(
          "valid payment transaction reference"
        );

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toEqual({
          awaitingPayment: true,
          pendingOrderId:
            order.id
        });

        const unchangedOrder =
          await prisma.order.findUniqueOrThrow({
            where: {
              id: order.id
            }
          });

        expect(
          unchangedOrder.status
        ).toBe(
          "PENDING_PAYMENT"
        );

        const payments =
          await prisma.payment.findMany({
            where: {
              orderId:
                order.id
            }
          });

        expect(payments).toHaveLength(0);

        clearConversationState(
          fixture.chatId
        );
      }
    );
  }
);
