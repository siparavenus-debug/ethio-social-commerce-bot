import {
    afterEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";
  
  import {
    clearConversationState,
    getConversationState
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
  
  const chatId =
    "conversation-category-image-test";
  
  afterEach(() => {
    clearConversationState(chatId);
    runAIConversationMock.mockReset();
  });
  
  describe(
    "conversation category image presentation",
    () => {
      it(
        "uses the category image for multiple products returned by a matching category search",
        async () => {
          runAIConversationMock.mockResolvedValue({
            response: {
              intent:
                "SEARCH_PRODUCTS",
              message:
                "Here are the available traditional Ethiopian dresses.",
              toolCalls: []
            },
            toolResults: [
              {
                tool:
                  "searchProducts",
                query:
                  "Traditional Ethiopian Dress",
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
                    category: {
                      id:
                        "category-dress",
                      name:
                        "Traditional Ethiopian Dress",
                      imageUrl:
                        "https://example.test/category-dress.jpg",
                      imageAltText:
                        "Traditional Ethiopian dresses"
                    }
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
                    category: {
                      id:
                        "category-dress",
                      name:
                        "Traditional Ethiopian Dress",
                      imageUrl:
                        "https://example.test/category-dress.jpg",
                      imageAltText:
                        "Traditional Ethiopian dresses"
                    }
                  }
                ]
              }
            ]
          });
  
          const result =
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
              "Show me traditional Ethiopian dresses"
            );
  
          expect(result.imageUrl).toBe(
            "https://example.test/category-dress.jpg"
          );
  
          expect(
            getConversationState(chatId)
          ).not.toMatchObject({
            productId:
              expect.any(String)
          });
        }
      );

      it(
        "does not use the category image when multiple products match a product-name query",
        async () => {
          runAIConversationMock.mockResolvedValue({
            response: {
              intent:
                "SEARCH_PRODUCTS",
              message:
                "Here are the available Habesha Kemis products.",
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
                    category: {
                      id:
                        "category-dress",
                      name:
                        "Traditional Ethiopian Dress",
                      imageUrl:
                        "https://example.test/category-dress.jpg",
                      imageAltText:
                        "Traditional Ethiopian dresses"
                    }
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
                    category: {
                      id:
                        "category-dress",
                      name:
                        "Traditional Ethiopian Dress",
                      imageUrl:
                        "https://example.test/category-dress.jpg",
                      imageAltText:
                        "Traditional Ethiopian dresses"
                    }
                  }
                ]
              }
            ]
          });
      
          const result =
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
      
          expect(result.imageUrl).toBeUndefined();
      
          expect(
            getConversationState(chatId)
          ).not.toMatchObject({
            productId:
              expect.any(String)
          });
        }
      );

      it(
        "does not use a category image when multiple results do not share the same category",
        async () => {
          runAIConversationMock.mockResolvedValue({
            response: {
              intent:
                "SEARCH_PRODUCTS",
              message:
                "Here are the available dress products.",
              toolCalls: []
            },
            toolResults: [
              {
                tool:
                  "searchProducts",
                query:
                  "Dress",
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
                    category: {
                      id:
                        "category-traditional-dress",
                      name:
                        "Traditional Dress",
                      imageUrl:
                        "https://example.test/traditional-dress.jpg",
                      imageAltText:
                        "Traditional dresses"
                    }
                  },
                  {
                    id:
                      "product-modern",
                    name:
                      "Modern Dress",
                    description:
                      "Modern dress",
                    price:
                      3000,
                    currency:
                      "ETB",
                    stock:
                      5,
                    imageUrl:
                      "https://example.test/modern-dress.jpg",
                    category: {
                      id:
                        "category-modern-dress",
                      name:
                        "Modern Dress",
                      imageUrl:
                        "https://example.test/modern-category.jpg",
                      imageAltText:
                        "Modern dresses"
                    }
                  }
                ]
              }
            ]
          });
      
          const result =
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
              "Show me dresses"
            );
      
          expect(result.imageUrl).toBeUndefined();
      
          expect(
            getConversationState(chatId)
          ).not.toMatchObject({
            productId:
              expect.any(String)
          });
        }
      );

      it(
        "does not fall back to a product image when a matching category has no image",
        async () => {
          runAIConversationMock.mockResolvedValue({
            response: {
              intent:
                "SEARCH_PRODUCTS",
              message:
                "Here are the available traditional Ethiopian dresses.",
              toolCalls: []
            },
            toolResults: [
              {
                tool:
                  "searchProducts",
                query:
                  "Traditional Ethiopian Dress",
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
                    category: {
                      id:
                        "category-dress",
                      name:
                        "Traditional Ethiopian Dress",
                      imageUrl:
                        null,
                      imageAltText:
                        null
                    }
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
                    category: {
                      id:
                        "category-dress",
                      name:
                        "Traditional Ethiopian Dress",
                      imageUrl:
                        null,
                      imageAltText:
                        null
                    }
                  }
                ]
              }
            ]
          });
      
          const result =
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
              "Show me traditional Ethiopian dresses"
            );
      
          expect(result.imageUrl).toBeUndefined();
      
          expect(
            getConversationState(chatId)
          ).not.toMatchObject({
            productId:
              expect.any(String)
          });
        }
      );

      it(
        "uses the product image for a single product result",
        async () => {
          runAIConversationMock.mockResolvedValue({
            response: {
              intent:
                "SEARCH_PRODUCTS",
              message:
                "I found White Habesha Kemis.",
              toolCalls: []
            },
            toolResults: [
              {
                tool:
                  "searchProducts",
                query:
                  "White Habesha Kemis",
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
                    category: {
                      id:
                        "category-dress",
                      name:
                        "Traditional Ethiopian Dress",
                      imageUrl:
                        "https://example.test/category-dress.jpg",
                      imageAltText:
                        "Traditional Ethiopian dresses"
                    }
                  }
                ]
              }
            ]
          });
      
          const result =
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
              "Show me White Habesha Kemis"
            );
      
          expect(result.imageUrl).toBe(
            "https://example.test/white-kemis.jpg"
          );
      
          expect(
            getConversationState(chatId)
          ).toMatchObject({
            productId:
              "product-white",
            productName:
              "White Habesha Kemis",
            awaitingQuantity:
              true
          });
        }
      );
    }
  );