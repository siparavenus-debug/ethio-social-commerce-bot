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
            "stores validated product search context separately from ordered candidates",
            async () => {
                runAIConversationMock.mockResolvedValue({
                    response: {
                        intent:
                            "SEARCH_PRODUCT",
                        message:
                            "I found matching shoes within your budget.",
                        toolCalls: []
                    },
                    toolResults: [
                        {
                            tool:
                                "searchProducts",
                            query:
                                "Men Shoes",
                            result: [
                                {
                                    id:
                                        "product-budget",
                                    name:
                                        "Budget Men Shoes",
                                    description:
                                        "Everyday shoes",
                                    price:
                                        1800,
                                    currency:
                                        "ETB",
                                    stock:
                                        4,
                                    imageUrl:
                                        null,
                                    category:
                                        null
                                },
                                {
                                    id:
                                        "product-second",
                                    name:
                                        "Classic Men Shoes",
                                    description:
                                        "Classic shoes",
                                    price:
                                        1950,
                                    currency:
                                        "ETB",
                                    stock:
                                        3,
                                    imageUrl:
                                        null,
                                    category:
                                        null
                                }
                            ]
                        }
                    ],
                    searchContexts: [
                        {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000,
                            currency:
                                "ETB"
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
                    "Show me men's shoes under 2000 ETB"
                );

                const state =
                    getConversationState(chatId);

                expect(
                    state.lastProductSearch
                ).toEqual({
                    query:
                        "Men Shoes",
                    maxPrice:
                        2000,
                    currency:
                        "ETB"
                });

                expect(
                    state.candidateProducts
                ).toEqual([
                    {
                        id:
                            "product-budget",
                        name:
                            "Budget Men Shoes"
                    },
                    {
                        id:
                            "product-second",
                        name:
                            "Classic Men Shoes"
                    }
                ]);

                expect(
                    state.productId
                ).toBeUndefined();

                expect(
                    state.productName
                ).toBeUndefined();
            }
        );

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

                expect(
                    state.seenProductIds
                ).toEqual([
                    "product-white",
                    "product-blue"
                ]);
            }
        );

        it(
            "selects a single authoritative search result without storing candidates",
            async () => {
                runAIConversationMock.mockResolvedValue({
                    response: {
                        intent:
                            "SEARCH_PRODUCT",
                        message:
                            "I found Budget Men Shoes.",
                        toolCalls: []
                    },
                    toolResults: [
                        {
                            tool:
                                "searchProducts",
                            query:
                                "Men Shoes",
                            result: [
                                {
                                    id:
                                        "product-budget",
                                    name:
                                        "Budget Men Shoes",
                                    description:
                                        "Everyday shoes",
                                    price:
                                        1800,
                                    currency:
                                        "ETB",
                                    stock:
                                        4,
                                    imageUrl:
                                        null,
                                    category:
                                        null
                                }
                            ]
                        }
                    ],
                    searchContexts: [
                        {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000,
                            currency:
                                "ETB"
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
                    "Show me men's shoes under 2000 ETB"
                );

                const state =
                    getConversationState(chatId);

                expect(
                    state.productId
                ).toBe(
                    "product-budget"
                );

                expect(
                    state.productName
                ).toBe(
                    "Budget Men Shoes"
                );

                expect(
                    state.candidateProducts
                ).toBeUndefined();

                expect(
                    state.seenProductIds
                ).toEqual([
                    "product-budget"
                ]);

                expect(
                    state.awaitingQuantity
                ).toBe(true);

                expect(
                    state.lastProductSearch
                ).toEqual({
                    query:
                        "Men Shoes",
                    maxPrice:
                        2000,
                    currency:
                        "ETB"
                });
            }
        );

        it(
            "accumulates products already shown across a continued product search",
            async () => {
                setConversationState(
                    chatId,
                    {
                        candidateProducts: [
                            {
                                id:
                                    "product-budget",
                                name:
                                    "Budget Men Shoes"
                            },
                            {
                                id:
                                    "product-second",
                                name:
                                    "Classic Men Shoes"
                            }
                        ],
                        lastProductSearch: {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000,
                            currency:
                                "ETB"
                        }
                    }
                );

                runAIConversationMock.mockResolvedValue({
                    response: {
                        intent:
                            "SEARCH_PRODUCT",
                        message:
                            "I found another option.",
                        toolCalls: []
                    },
                    toolResults: [
                        {
                            tool:
                                "searchProducts",
                            query:
                                "Men Shoes",
                            isProductSearchContinuation:
                                true,
                            result: [
                                {
                                    id:
                                        "product-third",
                                    name:
                                        "Everyday Men Shoes",
                                    description:
                                        "Everyday shoes",
                                    price:
                                        1900,
                                    currency:
                                        "ETB",
                                    stock:
                                        2,
                                    imageUrl:
                                        null,
                                    category:
                                        null
                                }
                            ]
                        }
                    ],
                    searchContexts: [
                        {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000,
                            currency:
                                "ETB"
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
                    "another option"
                );

                const state =
                    getConversationState(chatId);

                expect(
                    state.seenProductIds
                ).toEqual([
                    "product-budget",
                    "product-second",
                    "product-third"
                ]);
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
                        ],
                        seenProductIds: [
                            "product-white",
                            "product-blue"
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

            expect(
                state.seenProductIds
            ).toBeUndefined();
            }
        );

        it(
            "preserves seen products when a continued product search returns no results",
            async () => {
                runAIConversationMock.mockResolvedValue({
                    response: {
                        intent:
                            "SEARCH_PRODUCT",
                        message:
                            "I couldn't find another matching option.",
                        toolCalls: []
                    },
                    toolResults: [
                        {
                            tool:
                                "searchProducts",
                            query:
                                "Men Shoes",
                            isProductSearchContinuation:
                                true,
                            result: []
                        }
                    ],
                    searchContexts: [
                        {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000,
                            currency:
                                "ETB"
                        }
                    ]
                });

                setConversationState(
                    chatId,
                    {
                        productId:
                            "product-third",
                        productName:
                            "Everyday Men Shoes",
                        seenProductIds: [
                            "product-budget",
                            "product-second",
                            "product-third"
                        ],
                        lastProductSearch: {
                            query:
                                "Men Shoes",
                            maxPrice:
                                2000,
                            currency:
                                "ETB"
                        }
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
                    "another option"
                );

                const state =
                    getConversationState(chatId);

                expect(
                    state.candidateProducts
                ).toBeUndefined();

                expect(
                    state.seenProductIds
                ).toEqual([
                    "product-budget",
                    "product-second",
                    "product-third"
                ]);

                expect(
                    state.lastProductSearch
                ).toEqual({
                    query:
                        "Men Shoes",
                    maxPrice:
                        2000,
                    currency:
                        "ETB"
                });
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
