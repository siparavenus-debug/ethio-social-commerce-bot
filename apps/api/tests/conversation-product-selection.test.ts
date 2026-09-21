import {
    afterEach,
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
    runAIConversationMock,
    getOrderStatusMock
} = vi.hoisted(() => ({
    runAIConversationMock: vi.fn(),
    getOrderStatusMock: vi.fn()
}));

vi.mock(
    "../src/ai/ai-orchestrator.js",
    () => ({
        runAIConversation:
            runAIConversationMock
    })
);

vi.mock(
    "../src/tools/orders.js",
    async (importOriginal) => {
        const actual =
            await importOriginal<
                typeof import(
                "../src/tools/orders.js"
                )
            >();

        return {
            ...actual,
            getOrderStatus:
                getOrderStatusMock
        };
    }
);

import {
    handleConversation
} from "../src/conversation/conversation-manager.js";

const chatId =
    "conversation-product-selection-test";

afterEach(() => {
    clearConversationState(chatId);
    runAIConversationMock.mockReset();
    getOrderStatusMock.mockReset();
});

describe(
    "conversation product selection",
    () => {
        it(
            "stores multiple authoritative search results as ordered unselected candidates",
            async () => {
                runAIConversationMock.mockResolvedValue({
                    response: {
                        intent:
                            "SEARCH_PRODUCT",
                        message:
                            "I found White Habesha Kemis and Blue Habesha Kemis.",
                        toolCalls: []
                    },
                    toolResults: [
                        {
                            tool:
                                "searchProducts",
                            query:
                                "Habesha Kemis",
                            result: [
                                {
                                    id:
                                        "product-white",
                                    name:
                                        "White Habesha Kemis",
                                    description:
                                        "White embroidered dress",
                                    price:
                                        2500,
                                    currency:
                                        "ETB",
                                    stock:
                                        4,
                                    imageUrl:
                                        "https://example.test/white-kemis.jpg",
                                    category:
                                        null
                                },
                                {
                                    id:
                                        "product-blue",
                                    name:
                                        "Blue Habesha Kemis",
                                    description:
                                        "Blue embroidered dress",
                                    price:
                                        2800,
                                    currency:
                                        "ETB",
                                    stock:
                                        3,
                                    imageUrl:
                                        "https://example.test/blue-kemis.jpg",
                                    category:
                                        null
                                }
                            ]
                        }
                    ]
                });

                await handleConversation(
                    {
                        merchantId:
                            "merchant-test",
                        customerId:
                            "customer-test",
                        chatId,
                        customerName:
                            "Test Customer",
                        merchantName:
                            "Test Merchant"
                    },
                    "Show me Habesha Kemis"
                );

                const state =
                    getConversationState(chatId);

                expect(
                    state.candidateProducts
                ).toEqual([
                    {
                        id:
                            "product-white",
                        name:
                            "White Habesha Kemis"
                    },
                    {
                        id:
                            "product-blue",
                        name:
                            "Blue Habesha Kemis"
                    }
                ]);

                expect(
                    state.productId
                ).toBeUndefined();

                expect(
                    state.productName
                ).toBeUndefined();

                expect(
                    state.awaitingQuantity
                ).not.toBe(true);
            }
        );

        it(
            "selects an authoritative candidate product and consumes the candidate list",
            async () => {
                runAIConversationMock.mockResolvedValue({
                    response: {
                        intent:
                            "GET_PRODUCT",
                        message:
                            "You selected Blue Habesha Kemis.",
                        toolCalls: []
                    },
                    toolResults: [
                        {
                            tool:
                                "getProduct",
                            result: {
                                id:
                                    "product-blue",
                                name:
                                    "Blue Habesha Kemis",
                                description:
                                    "Blue embroidered dress",
                                price:
                                    2800,
                                currency:
                                    "ETB",
                                stock:
                                    3,
                                imageUrl:
                                    "https://example.test/blue-kemis.jpg",
                                category:
                                    null
                            }
                        }
                    ]
                });

                await handleConversation(
                    {
                        merchantId:
                            "merchant-test",
                        customerId:
                            "customer-test",
                        chatId,
                        customerName:
                            "Test Customer",
                        merchantName:
                            "Test Merchant"
                    },
                    "Show me Habesha Kemis"
                );

                const candidateState =
                    getConversationState(chatId);

                candidateState.candidateProducts = [
                    {
                        id:
                            "product-white",
                        name:
                            "White Habesha Kemis"
                    },
                    {
                        id:
                            "product-blue",
                        name:
                            "Blue Habesha Kemis"
                    }
                ];

                await handleConversation(
                    {
                        merchantId:
                            "merchant-test",
                        customerId:
                            "customer-test",
                        chatId,
                        customerName:
                            "Test Customer",
                        merchantName:
                            "Test Merchant"
                    },
                    "the second one"
                );

                const state =
                    getConversationState(chatId);

                expect(state.productId).toBe(
                    "product-blue"
                );

                expect(state.productName).toBe(
                    "Blue Habesha Kemis"
                );

                expect(
                    state.candidateProducts
                ).toBeUndefined();
            }
        );

        it(
            "keeps candidate choices when a selected candidate is no longer available",
            async () => {
              setConversationState(
                chatId,
                {
                  candidateProducts: [
                    {
                      id:
                        "product-white",
                      name:
                        "White Habesha Kemis"
                    },
                    {
                      id:
                        "product-blue",
                      name:
                        "Blue Habesha Kemis"
                    }
                  ]
                }
              );

              runAIConversationMock.mockResolvedValue({
                response: {
                  intent:
                    "GET_PRODUCT",
                  message:
                    "That product is no longer available.",
                  toolCalls: []
                },
                toolResults: [
                  {
                    tool:
                      "getProduct",
                    result:
                      null
                  }
                ]
              });

              await handleConversation(
                {
                  merchantId:
                    "merchant-test",
                  customerId:
                    "customer-test",
                  chatId,
                  customerName:
                    "Test Customer",
                  merchantName:
                    "Test Merchant"
                },
                "the second one"
              );

              const state =
                getConversationState(chatId);

              expect(
                state.productId
              ).toBeUndefined();

              expect(
                state.productName
              ).toBeUndefined();

              expect(
                state.candidateProducts
              ).toEqual([
                {
                  id:
                    "product-white",
                  name:
                    "White Habesha Kemis"
                },
                {
                  id:
                    "product-blue",
                  name:
                    "Blue Habesha Kemis"
                }
              ]);
            }
          );

        it(
            "clears stale candidates when a new product search returns no results",
            async () => {
                runAIConversationMock.mockResolvedValue({
                    response: {
                        intent:
                            "SEARCH_PRODUCT",
                        message:
                            "I couldn't find matching products.",
                        toolCalls: []
                    },
                    toolResults: [
                        {
                            tool:
                                "searchProducts",
                            query:
                                "green jacket",
                            result: []
                        }
                    ]
                });

                setConversationState(
                    chatId,
                    {
                        candidateProducts: [
                            {
                                id:
                                    "product-white",
                                name:
                                    "White Habesha Kemis"
                            },
                            {
                                id:
                                    "product-blue",
                                name:
                                    "Blue Habesha Kemis"
                            }
                        ]
                    }
                );

                await handleConversation(
                    {
                        merchantId:
                            "merchant-test",
                        customerId:
                            "customer-test",
                        chatId,
                        customerName:
                            "Test Customer",
                        merchantName:
                            "Test Merchant"
                    },
                    "show me green jackets"
                );

                const state =
                    getConversationState(chatId);

                expect(
                    state.candidateProducts
                ).toBeUndefined();
            }
        );

        it(
            "clears stale candidates when releasing an order already in payment review",
            async () => {
              setConversationState(
                chatId,
                {
                  awaitingPayment: true,
                  pendingOrderId:
                    "order-under-review",
                  candidateProducts: [
                    {
                      id:
                        "product-white",
                      name:
                        "White Habesha Kemis"
                    },
                    {
                      id:
                        "product-blue",
                      name:
                        "Blue Habesha Kemis"
                    }
                  ]
                }
              );

              getOrderStatusMock.mockResolvedValue({
                id:
                  "order-under-review",
                status:
                  "PAYMENT_REVIEW"
              });

              runAIConversationMock.mockResolvedValue({
                response: {
                  intent:
                    "SEARCH_PRODUCT",
                  message:
                    "I couldn't find matching products.",
                  toolCalls: []
                },
                toolResults: []
              });

              await handleConversation(
                {
                  merchantId:
                    "merchant-test",
                  customerId:
                    "customer-test",
                  chatId,
                  customerName:
                    "Test Customer",
                  merchantName:
                    "Test Merchant"
                },
                "show me green jackets"
              );

              const state =
                getConversationState(chatId);

              expect(
                state.awaitingPayment
              ).toBe(false);

              expect(
                state.pendingOrderId
              ).toBeUndefined();

              expect(
                state.candidateProducts
              ).toBeUndefined();
            }
          );
    }
);
