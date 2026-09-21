import {
  ProductStatus,
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
  "conversation-multilingual";

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

  if (merchantIds.length === 0) {
    return;
  }

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

  await prisma.merchant.deleteMany({
    where: {
      id: {
        in: merchantIds
      }
    }
  });
}

async function createFixture() {
  const suffix =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  const merchant =
    await prisma.merchant.create({
      data: {
        name:
          `${testPrefix}-${suffix}`,
        currency: "ETB"
      }
    });

  const customer =
    await prisma.customer.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Multilingual Customer ${suffix}`,
        telegramChatId:
          `multilingual-chat-${suffix}`,
        telegramUserId:
          `multilingual-user-${suffix}`
      }
    });

  const product =
    await prisma.product.create({
      data: {
        merchantId:
          merchant.id,
        name:
          `Multilingual Product ${suffix}`,
        price: "100.00",
        currency: "ETB",
        stock: 5,
        status:
          ProductStatus.ACTIVE
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

beforeEach(async () => {
  runAIConversationMock.mockReset();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe(
  "multilingual conversation baseline",
  () => {
    it(
      "keeps valid numeric quantity handling deterministic",
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
            awaitingQuantity: true
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
            "2"
          );

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        expect(result.reply).toContain(
          "Would you like to place this order?"
        );

        expect(
          getConversationState(
            fixture.chatId
          )
        ).toMatchObject({
          productId:
            fixture.product.id,
          quantity: 2,
          awaitingConfirmation: true
        });
      }
    );

    it.each([
        ["two", 2],
        ["ሁለት", 2],
        ["hulet", 2],
        ["2 pcs", 2]
      ])(
        "interprets quantity expression %s as %i deterministically",
        async (input, expectedQuantity) => {
          const fixture =
            await createFixture();
      
          setConversationState(
            fixture.chatId,
            {
              productId:
                fixture.product.id,
              productName:
                fixture.product.name,
              awaitingQuantity: true
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
              input
            );
      
          expect(
            runAIConversationMock
          ).not.toHaveBeenCalled();
      
          expect(result.reply).toContain(
            "Would you like to place this order?"
          );
      
          expect(
            getConversationState(
              fixture.chatId
            )
          ).toMatchObject({
            productId:
              fixture.product.id,
            quantity:
              expectedQuantity,
            awaitingConfirmation: true
          });
        }
      );

      it.each([
        "0",
        "-2",
        "2 or 3",
        "I have 2 but want 3",
        "2 shoes",
        "two or three"
      ])(
        "does not guess a quantity from ambiguous or unsupported input %s",
        async (input) => {
          const fixture =
            await createFixture();
      
          setConversationState(
            fixture.chatId,
            {
              productId:
                fixture.product.id,
              productName:
                fixture.product.name,
              awaitingQuantity: true
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
              input
            );
      
          expect(
            runAIConversationMock
          ).not.toHaveBeenCalled();
      
          expect(result.reply).toContain(
            "Please enter the quantity as a number."
          );
      
          const state =
            getConversationState(
              fixture.chatId
            );
      
          expect(state).toMatchObject({
            productId:
              fixture.product.id,
            awaitingQuantity: true
          });
      
          expect(
            state.quantity
          ).toBeUndefined();
      
          expect(
            state.awaitingConfirmation
          ).toBeUndefined();
        }
      );

    it(
      "keeps recognized English confirmation deterministic",
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
            "YES"
          );

        expect(
          runAIConversationMock
        ).not.toHaveBeenCalled();

        expect(result.reply).toContain(
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
      }
    );

    it.each([
        "አዎ",
        "awo"
      ])(
        "accepts explicit multilingual confirmation %s deterministically",
        async (input) => {
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
              input
            );
      
          expect(
            runAIConversationMock
          ).not.toHaveBeenCalled();
      
          expect(result.reply).toContain(
            "recipient's full name"
          );
      
          expect(
            getConversationState(
              fixture.chatId
            )
          ).toMatchObject({
            productId:
              fixture.product.id,
            quantity: 2,
            awaitingConfirmation: false,
            awaitingDeliveryName: true
          });
        }
      );
      
      it.each([
        "አይ",
        "ay"
      ])(
        "accepts explicit multilingual cancellation %s deterministically",
        async (input) => {
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
              input
            );
      
          expect(
            runAIConversationMock
          ).not.toHaveBeenCalled();
      
          expect(result.reply).toContain(
            "cancelled"
          );
      
          const state =
            getConversationState(
              fixture.chatId
            );
      
            expect(
                state.awaitingConfirmation
              ).toBeUndefined();
              
              expect(
                state.awaitingDeliveryName
              ).toBeUndefined();
              
              expect(
                state.productId
              ).toBeUndefined();
              
              expect(
                state.quantity
              ).toBeUndefined();
        }
      );

      it.each([
        "yes or no",
        "yes maybe",
        "no maybe",
        "አዎ አይ",
        "awo ay",
        "awo maybe",
        "ay maybe"
      ])(
        "does not guess confirmation intent from ambiguous input %s",
        async (input) => {
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
              input
            );
      
          expect(
            runAIConversationMock
          ).not.toHaveBeenCalled();
      
          expect(result.reply).toContain(
            "Please reply YES"
          );
      
          const state =
            getConversationState(
              fixture.chatId
            );
      
          expect(state).toMatchObject({
            productId:
              fixture.product.id,
            productName:
              fixture.product.name,
            quantity: 2,
            awaitingConfirmation: true
          });
      
          expect(
            state.awaitingDeliveryName
          ).toBeUndefined();
        }
      );
  }
);