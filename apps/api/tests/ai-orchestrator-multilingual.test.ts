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

  const {
    generateAIResponseMock
  } = vi.hoisted(() => ({
    generateAIResponseMock: vi.fn()
  }));

  vi.mock(
    "../src/ai/ai-provider.js",
    () => ({
      generateAIResponse:
        generateAIResponseMock
    })
  );

  import {
    runAIConversation
  } from "../src/ai/ai-orchestrator.js";

  const testPrefix =
    "ai-orchestrator-multilingual";

  async function cleanup() {
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

    if (merchantIds.length === 0) {
      return;
    }

    await prisma.productImage.deleteMany({
      where: {
        product: {
          merchantId: {
            in: merchantIds
          }
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

    await prisma.productCategory.deleteMany({
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
            `${testPrefix}-merchant-${suffix}`,
          currency: "ETB"
        }
      });

    const otherMerchant =
      await prisma.merchant.create({
        data: {
          name:
            `${testPrefix}-other-${suffix}`,
          currency: "ETB"
        }
      });

    const customer =
      await prisma.customer.create({
        data: {
          merchantId:
            merchant.id,
          name:
            `AI Customer ${suffix}`,
          telegramChatId:
            `ai-chat-${suffix}`,
          telegramUserId:
            `ai-user-${suffix}`
        }
      });

    const category =
      await prisma.productCategory.create({
        data: {
          merchantId:
            merchant.id,
          name:
            "Men Shoes"
        }
      });

    const otherCategory =
      await prisma.productCategory.create({
        data: {
          merchantId:
            otherMerchant.id,
          name:
            "Men Shoes"
        }
      });

    const product =
      await prisma.product.create({
        data: {
          merchantId:
            merchant.id,
          categoryId:
            category.id,
          name:
            "Black Men Shoes",
          description:
            "Black everyday shoes",
          price:
            "1800.00",
          currency:
            "ETB",
          stock: 4,
          status:
            ProductStatus.ACTIVE
        }
      });

    const otherProduct =
      await prisma.product.create({
        data: {
          merchantId:
            otherMerchant.id,
          categoryId:
            otherCategory.id,
          name:
            "Other Merchant Men Shoes",
          description:
            "Must never leak across merchants",
          price:
            "999.00",
          currency:
            "ETB",
          stock: 8,
          status:
            ProductStatus.ACTIVE
        }
      });

    return {
      merchant,
      otherMerchant,
      customer,
      product,
      otherProduct
    };
  }

  beforeEach(async () => {
    generateAIResponseMock.mockReset();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  describe(
    "AI orchestrator multilingual grounding",
    () => {
      it(
        "executes a normalized catalog query from mixed-language input and grounds the final response in merchant-scoped results",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching the catalog.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Men Shoes"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Black Men Shoes is available for 1800 ETB."
            });

          const customerMessage =
            "á‹¨á‹ˆáŠ•á‹µ shoe áŠ áˆˆ?";

          const result =
            await runAIConversation(
              {
                text:
                  customerMessage,
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          expect(
            firstCall.messages[
              firstCall.messages.length - 1
            ].content
          ).toContain(
            customerMessage
          );

          expect(result.toolResults).toHaveLength(
            1
          );

          expect(
            result.toolResults[0]
          ).toMatchObject({
            tool:
              "searchProducts",
            query:
              "Men Shoes"
          });

          const products =
            result.toolResults[0]
              .result as Array<{
                id: string;
                name: string;
                price: number;
                currency: string;
                stock: number;
              }>;

          expect(products).toHaveLength(1);

          expect(products[0]).toMatchObject({
            id:
              fixture.product.id,
            name:
              "Black Men Shoes",
            price: 1800,
            currency:
              "ETB",
            stock: 4
          });

          expect(
            products.some(
              (product) =>
                product.id ===
                fixture.otherProduct.id
            )
          ).toBe(false);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          const secondCallContent =
            secondCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(
            secondCallContent
          ).toContain(
            fixture.product.id
          );

          expect(
            secondCallContent
          ).toContain(
            "Black Men Shoes"
          );

          expect(
            secondCallContent
          ).not.toContain(
            fixture.otherProduct.id
          );

          expect(
            secondCallContent
          ).not.toContain(
            "Other Merchant Men Shoes"
          );

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "Black Men Shoes is available for 1800 ETB.",
            toolCalls: []
          });
        }
      );

      it(
        "preserves all normalized product constraints when executing a multilingual catalog search",
        async () => {
          const fixture =
            await createFixture();

          await prisma.product.update({
            where: {
              id: fixture.product.id
            },
            data: {
              name:
                "Urban Classic",
              description:
                "Black leather everyday shoe"
            }
          });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching the catalog.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "black men shoes"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Urban Classic is available for 1800 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "black á‹¨á‹ˆáŠ•á‹µ shoe áŠ áˆˆ?",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            result.toolResults
          ).toHaveLength(1);

          expect(
            result.toolResults[0]
          ).toMatchObject({
            tool:
              "searchProducts",
            query:
              "black men shoes"
          });

          const products =
            result.toolResults[0]
              .result as Array<{
                id: string;
                name: string;
              }>;

          expect(products).toHaveLength(1);

          expect(products[0]).toMatchObject({
            id:
              fixture.product.id,
            name:
              "Urban Classic"
          });

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "Urban Classic is available for 1800 ETB.",
            toolCalls: []
          });
        }
      );

      it(
        "executes an explicit product budget as a structured price and currency constraint",
        async () => {
          const fixture =
            await createFixture();

          await prisma.product.update({
            where: {
              id: fixture.product.id
            },
            data: {
              name:
                "Budget Men Shoes",
              price:
                "1800.00",
              currency:
                "ETB"
            }
          });

          const expensiveProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  fixture.product.categoryId,
                name:
                  "Premium Men Shoes",
                description:
                  "Formal shoes",
                price:
                  "2400.00",
                currency:
                  "ETB",
                stock: 3,
                status:
                  ProductStatus.ACTIVE
              }
            });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching within your budget.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Men Shoes",
                      maxPrice:
                        2000,
                      currency:
                        "ETB"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Budget Men Shoes is available for 1800 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "That's too expensive. I can only spend 2000 ETB on men's shoes.",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            result.toolResults
          ).toHaveLength(1);

          expect(
            result.toolResults[0]
          ).toMatchObject({
            tool:
              "searchProducts",
            query:
              "Men Shoes"
          });

          expect(
            result.toolResults[0]
          ).not.toHaveProperty(
            "searchContext"
          );

          expect(
            result.searchContexts
          ).toEqual([
            {
              query:
                "Men Shoes",
              maxPrice:
                2000,
              currency:
                "ETB"
            }
          ]);

          const products =
            result.toolResults[0]
              .result as Array<{
                id: string;
                name: string;
                price: number;
                currency: string;
              }>;

          expect(products).toHaveLength(1);

          expect(products[0]).toMatchObject({
            id:
              fixture.product.id,
            name:
              "Budget Men Shoes",
            price:
              1800,
            currency:
              "ETB"
          });

          expect(
            products.some(
              (product) =>
                product.id ===
                expensiveProduct.id
            )
          ).toBe(false);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          const finalCallContent =
            secondCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(finalCallContent).toContain(
            "Commerce tool results:"
          );

          expect(finalCallContent).not.toContain(
            '"searchContext"'
          );

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "Budget Men Shoes is available for 1800 ETB.",
            toolCalls: []
          });
        }
      );

      it(
        "retrieves an authoritative English catalog product through a meaning-equivalent multilingual alternative query",
        async () => {
          const fixture =
            await createFixture();

          await prisma.product.update({
            where: {
              id:
                fixture.product.id
            },
            data: {
              name:
                "Urban Classic",
              description:
                "Black leather everyday shoe"
            }
          });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching the catalog.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "áŒ¥á‰áˆ­ á‹¨á‹ˆáŠ•á‹µ áŒ«áˆ›",
                      alternativeQueries: [
                        "black men shoes"
                      ]
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Urban Classic is available for 1800 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "áŒ¥á‰áˆ­ á‹¨á‹ˆáŠ•á‹µ áŒ«áˆ› áŠ áˆˆ?",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          expect(
            result.toolResults
          ).toHaveLength(1);

          expect(
            result.toolResults[0]
          ).toMatchObject({
            tool:
              "searchProducts",
            query:
              "áŒ¥á‰áˆ­ á‹¨á‹ˆáŠ•á‹µ áŒ«áˆ›"
          });

          const products =
            result.toolResults[0]
              .result as Array<{
                id: string;
                name: string;
              }>;

          expect(products).toHaveLength(1);

          expect(products[0]).toMatchObject({
            id:
              fixture.product.id,
            name:
              "Urban Classic"
          });

          expect(
            products.some(
              (product) =>
                product.id ===
                fixture.otherProduct.id
            )
          ).toBe(false);

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "Urban Classic is available for 1800 ETB.",
            toolCalls: []
          });
        }
      );

      it(
        "uses authoritative catalog results for the final response instead of the initial model message",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "The shoes cost 50 ETB and there are 99 available.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Men Shoes"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Black Men Shoes is available for 1800 ETB, with 4 in stock."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "mens shoe ale? price sint new?",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          const secondCallContent =
            secondCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(
            secondCallContent
          ).toContain(
            "The shoes cost 50 ETB and there are 99 available."
          );

          expect(
            secondCallContent
          ).toContain(
            "Black Men Shoes"
          );

          expect(
            secondCallContent
          ).toContain(
            "1800"
          );

          expect(
            secondCallContent
          ).toContain(
            '"stock":4'
          );

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "Black Men Shoes is available for 1800 ETB, with 4 in stock.",
            toolCalls: []
          });

          expect(
            result.response.message
          ).not.toContain(
            "50 ETB"
          );

          expect(
            result.response.message
          ).not.toContain(
            "99"
          );
        }
      );

      it(
        "gives the interpretation model an explicit Ethiopian multilingual language contract",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent: "GENERAL",
              message: "How can I help?",
              toolCalls: []
            })
          });

          await runAIConversation(
            {
              text:
                "á‹¨á‹ˆáŠ•á‹µ shoe áŠ áˆˆ?",
              state: {},
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          const systemPrompt =
            firstCall.system;

          expect(systemPrompt).toContain(
            "Amharic script"
          );

          expect(systemPrompt).toContain(
            "English"
          );

          expect(systemPrompt).toContain(
            "code-switching"
          );

          expect(systemPrompt).toContain(
            "Latin-script transliterated Amharic"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "do not invent a product"
          );

          expect(systemPrompt).toContain(
            "preserve all explicit customer constraints"
          );

          expect(systemPrompt).toContain(
            "ask a clarification question"
          );

          expect(systemPrompt).toContain(
            "When asking for clarification, put the clarification question in the JSON message field, use an empty toolCalls array, and return only the required JSON object."
          );

          expect(systemPrompt).toContain(
            "alternativeQueries"
          );

          expect(systemPrompt).toContain(
            "meaning-equivalent"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "must preserve every explicit customer constraint"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "or add a constraint that the customer did not provide"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "must not remove a constraint"
          );

          expect(systemPrompt).toContain(
            "maxPrice"
          );

          expect(systemPrompt).toContain(
            "currency"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "maximum budget"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "catalog search terms"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "do not include the price or currency in query"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "maxprice and currency apply to every alternative query"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "do not convert currencies"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "do not guess a currency"
          );

          expect(systemPrompt).toContain(
            "cheaperThanSelectedProduct"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "authoritative selected product price and currency"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "do not provide a numeric comparison price"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "reuse the validated query from lastproductsearch"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "price objection"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "invent a numeric budget"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "explicit spending limit"
          );

          expect(
            systemPrompt.toLowerCase()
          ).toContain(
            "show me something cheaper"
          );
        }
      );

      it(
        "gives the final-response model an explicit multilingual and tool-authority contract",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "The shoes cost 50 ETB.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Men Shoes"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Black Men Shoes is available for 1800 ETB."
            });

          await runAIConversation(
            {
              text:
                "á‹¨á‹ˆáŠ•á‹µ shoe áŠ áˆˆ? price sint new?",
              state: {},
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          const finalSystemPrompt =
            secondCall.system;

          expect(finalSystemPrompt).toContain(
            "tool results are authoritative"
          );

          expect(finalSystemPrompt).toContain(
            "conflicts"
          );

          expect(finalSystemPrompt).toContain(
            "Amharic"
          );

          expect(finalSystemPrompt).toContain(
            "English"
          );

          expect(finalSystemPrompt).toContain(
            "code-switching"
          );

          expect(finalSystemPrompt).toContain(
            "customer"
          );

          expect(finalSystemPrompt).toContain(
            "Compare products only using facts"
          );

          expect(finalSystemPrompt).toContain(
            "name, description, price, currency, stock, and category"
          );

          expect(finalSystemPrompt).toContain(
            "Do not invent product characteristics"
          );

          expect(finalSystemPrompt).toContain(
            "customer's stated preference"
          );

          expect(finalSystemPrompt).toContain(
            "Do not claim that one product is better quality"
          );

          expect(finalSystemPrompt).toContain(
            "If the available catalog facts do not support the requested comparison"
          );
        }
      );

      it(
        "allows ambiguous multilingual requests to ask for clarification without guessing a product",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GENERAL",
              message:
                "Which product do you mean?",
              toolCalls: []
            })
          });

          const result =
            await runAIConversation(
              {
                text:
                  "á‹«áŠ›á‹ one",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);

          expect(result.toolResults).toEqual(
            []
          );

          expect(result.response).toMatchObject({
            intent:
              "GENERAL",
            message:
              "Which product do you mean?",
            toolCalls: []
          });

          expect(
            await prisma.product.count({
              where: {
                merchantId:
                  fixture.merchant.id
              }
            })
          ).toBe(1);
        }
      );

      it(
        "provides ordered authoritative product candidates to the interpretation model",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GENERAL",
              message:
                "You mean the second product.",
              toolCalls: []
            })
          });

          await runAIConversation(
            {
              text:
                "the second one",
              state: {
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
              },
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          const firstCallContent =
            firstCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(firstCallContent).toContain(
            '"candidateProducts":[{"id":"product-white","name":"White Habesha Kemis"},{"id":"product-blue","name":"Blue Habesha Kemis"}]'
          );
        }
      );

      it(
        "provides the last validated product search to the interpretation model",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GENERAL",
              message:
                "I can show another option.",
              toolCalls: []
            })
          });

          await runAIConversation(
            {
              text:
                "another option under that budget",
              state: {
                lastProductSearch: {
                  query:
                    "Men Shoes",
                  maxPrice:
                    2000,
                  currency:
                    "ETB"
                }
              },
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          const firstCallContent =
            firstCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(firstCallContent).toContain(
            '"lastProductSearch":{"query":"Men Shoes","maxPrice":2000,"currency":"ETB"}'
          );
        }
      );

      it(
        "uses trusted previous results and validated search context for another-option searches",
        async () => {
          const fixture =
            await createFixture();

          const existingProduct =
            await prisma.product.findUniqueOrThrow({
              where: {
                id: fixture.product.id
              }
            });

          const alternativeProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  existingProduct.categoryId,
                name:
                  "Classic Men Shoes",
                description:
                  "Classic everyday shoes",
                price:
                  "1950.00",
                currency:
                  "ETB",
                stock: 3,
                status:
                  ProductStatus.ACTIVE
              }
            });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching for another option.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                      arguments: {
                        query:
                          "Wrong Search",
                        maxPrice:
                          9999,
                        currency:
                          "USD",
                        excludePreviousResults:
                          true,
                        excludeProductIds: [
                          alternativeProduct.id
                        ]
                      }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Classic Men Shoes is another option under 2000 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "another option under that budget",
                state: {
                  candidateProducts: [
                    {
                      id:
                        fixture.product.id,
                      name:
                        fixture.product.name
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
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

            const searchToolResult =
            result.toolResults[0];

          const searchResult =
            searchToolResult?.result as Array<{
              id: string;
            }>;

          expect(
            searchToolResult
              ?.isProductSearchContinuation
          ).toBe(true);

          expect(
            searchToolResult
              ?.isRelativePriceSearch
          ).toBeUndefined();

          expect(
            searchResult.map(
              (product) => product.id
            )
          ).toEqual([
            alternativeProduct.id
          ]);

          expect(
            result.searchContexts
          ).toEqual([
            {
              query:
                "Men Shoes",
              maxPrice:
                2000,
              currency:
                "ETB"
            }
          ]);

          const finalCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(finalCall).toBeDefined();

          const finalCallContent =
            finalCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

              expect(finalCallContent).toContain(
                alternativeProduct.id
              );

              const commerceToolResultsContent =
                finalCall.messages
                  .map(
                    (message: {
                      content: string;
                    }) => message.content
                  )
                  .find(
                    (content: string) =>
                      content.startsWith(
                        "Commerce tool results:"
                      )
                  );

              expect(
                commerceToolResultsContent
              ).toBeDefined();

              expect(
                commerceToolResultsContent
              ).not.toContain(
                fixture.product.id
              );

              expect(
                commerceToolResultsContent
              ).not.toContain(
                "excludePreviousResults"
              );

              expect(
                commerceToolResultsContent
              ).not.toContain(
                "excludeProductIds"
              );
        }
      );

      it(
        "excludes all products already seen across repeated another-option searches",
        async () => {
          const fixture =
            await createFixture();

          const existingProduct =
            await prisma.product.findUniqueOrThrow({
              where: {
                id: fixture.product.id
              }
            });

          const secondProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  existingProduct.categoryId,
                name:
                  "Classic Men Shoes",
                description:
                  "Classic everyday shoes",
                price:
                  "1900.00",
                currency:
                  "ETB",
                stock: 3,
                status:
                  ProductStatus.ACTIVE
              }
            });

          const thirdProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  existingProduct.categoryId,
                name:
                  "Everyday Men Shoes",
                description:
                  "Everyday shoes",
                price:
                  "1950.00",
                currency:
                  "ETB",
                stock: 2,
                status:
                  ProductStatus.ACTIVE
              }
            });

          const nextProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  existingProduct.categoryId,
                name:
                  "Comfort Men Shoes",
                description:
                  "Comfort shoes",
                price:
                  "1980.00",
                currency:
                  "ETB",
                stock: 2,
                status:
                  ProductStatus.ACTIVE
              }
            });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching for another option.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Wrong Search",
                      maxPrice:
                        9999,
                      currency:
                        "USD",
                      excludePreviousResults:
                        true
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Comfort Men Shoes is another option under 2000 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "another option",
                state: {
                  productId:
                    thirdProduct.id,
                  productName:
                    thirdProduct.name,
                  seenProductIds: [
                    fixture.product.id,
                    secondProduct.id,
                    thirdProduct.id
                  ],
                  lastProductSearch: {
                    query:
                      "Men Shoes",
                    maxPrice:
                      2000,
                    currency:
                      "ETB"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          const searchResult =
            result.toolResults[0]
              ?.result as Array<{
                id: string;
              }>;

          expect(
            searchResult.map(
              (product) => product.id
            )
          ).toEqual([
            nextProduct.id
          ]);
        }
      );

      it(
        "rejects another-option search without a previous validated product search",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "SEARCH_PRODUCT",
              message:
                "Searching for another option.",
              toolCalls: [
                {
                  tool:
                    "searchProducts",
                  arguments: {
                    query:
                      "Men Shoes",
                    excludePreviousResults:
                      true
                  }
                }
              ]
            })
          });

          await expect(
            runAIConversation(
              {
                text:
                  "show me another option",
                state: {
                  candidateProducts: [
                    {
                      id:
                        fixture.product.id,
                      name:
                        fixture.product.name
                    }
                  ]
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            )
          ).rejects.toThrow(
            "AI requested previous product search results without a previous validated product search."
          );
        }
      );

      it(
        "rejects a cheaper-product search without a previous validated product search",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "SEARCH_PRODUCT",
              message:
                "Searching for something cheaper.",
              toolCalls: [
                {
                  tool:
                    "searchProducts",
                  arguments: {
                    query:
                      "Men Shoes",
                    cheaperThanSelectedProduct:
                      true
                  }
                }
              ]
            })
          });

          await expect(
            runAIConversation(
              {
                text:
                  "show me something cheaper",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  productPrice: 1800,
                  productCurrency:
                    "ETB"
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            )
          ).rejects.toThrow(
            "AI requested a cheaper product without a previous validated product search."
          );
        }
      );

      it(
        "rejects a cheaper-product search without authoritative selected product price and currency",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "SEARCH_PRODUCT",
              message:
                "Searching for something cheaper.",
              toolCalls: [
                {
                  tool:
                    "searchProducts",
                  arguments: {
                    query:
                      "Men Shoes",
                    cheaperThanSelectedProduct:
                      true
                  }
                }
              ]
            })
          });

          await expect(
            runAIConversation(
              {
                text:
                  "show me something cheaper",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  lastProductSearch: {
                    query:
                      "Men Shoes",
                    maxPrice: 2000,
                    currency:
                      "ETB"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            )
          ).rejects.toThrow(
            "AI requested a cheaper product without an authoritative selected product price and currency."
          );
        }
      );

      it(
        "excludes the selected product when continuing a single-result product search",
        async () => {
          const fixture =
            await createFixture();

          const existingProduct =
            await prisma.product.findUniqueOrThrow({
              where: {
                id:
                  fixture.product.id
              }
            });

          const alternativeProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  existingProduct.categoryId,
                name:
                  "Classic Men Shoes",
                description:
                  "Classic everyday shoes",
                price:
                  1950,
                currency:
                  "ETB",
                stock:
                  3,
                status:
                  ProductStatus.ACTIVE
              }
            });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching for another option.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Wrong Search",
                      maxPrice:
                        9999,
                      currency:
                        "USD",
                      excludePreviousResults:
                        true
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Classic Men Shoes is another option under 2000 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "another option under that budget",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  lastProductSearch: {
                    query:
                      "Men Shoes",
                    maxPrice:
                      2000,
                    currency:
                      "ETB"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          const searchResult =
            result.toolResults.find(
              (toolResult) =>
                toolResult.tool ===
                "searchProducts"
            );

          expect(
            (
              searchResult?.result as Array<{
                id: string;
              }>
            ).map(
              (product) =>
                product.id
            )
          ).toEqual([
            alternativeProduct.id
          ]);

          expect(
            result.searchContexts
          ).toEqual([
            {
              query:
                "Men Shoes",
              maxPrice:
                2000,
              currency:
                "ETB"
            }
          ]);
        }
      );

      it(
        "does not apply previous product exclusions to a new product search",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching for men's shoes.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Men Shoes"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Here are the matching men's shoes."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "show me men shoes",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  candidateProducts: [
                    {
                      id:
                        fixture.product.id,
                      name:
                        fixture.product.name
                    }
                  ],
                  lastProductSearch: {
                    query:
                      "Old Search",
                    maxPrice:
                      1000,
                    currency:
                      "ETB"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          const searchResult =
            result.toolResults.find(
              (toolResult) =>
                toolResult.tool ===
                "searchProducts"
            );

          expect(
            (
              searchResult?.result as Array<{
                id: string;
              }>
            ).map(
              (product) =>
                product.id
            )
          ).toContain(
            fixture.product.id
          );

          expect(
            result.searchContexts
          ).toEqual([
            {
              query:
                "Men Shoes"
            }
          ]);
        }
      );

      it(
        "uses authoritative selected product price and currency for a cheaper-product search",
        async () => {
          const fixture =
            await createFixture();

          const existingProduct =
            await prisma.product.findUniqueOrThrow({
              where: {
                id:
                  fixture.product.id
              }
            });

          const cheaperProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  existingProduct.categoryId,
                name:
                  "Cheaper Men Shoes",
                description:
                  "Lower priced everyday shoes",
                price:
                  1700,
                currency:
                  "ETB",
                stock:
                  3,
                status:
                  ProductStatus.ACTIVE
              }
            });

          await prisma.product.create({
            data: {
              merchantId:
                fixture.merchant.id,
              categoryId:
                existingProduct.categoryId,
              name:
                "Cheaper USD Men Shoes",
              description:
                "Lower numeric price in another currency",
              price:
                100,
              currency:
                "USD",
              stock:
                3,
              status:
                ProductStatus.ACTIVE
            }
          });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching for something cheaper.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Wrong Search",
                      maxPrice:
                        9999,
                      currency:
                        "USD",
                      cheaperThanSelectedProduct:
                        true
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Cheaper Men Shoes is a lower-priced option."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "That's too expensive, show me something cheaper",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  productPrice:
                    1800,
                  productCurrency:
                    "ETB",
                  lastProductSearch: {
                    query:
                      "Men Shoes",
                    maxPrice:
                      2000,
                    currency:
                      "ETB"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          const searchToolResult =
            result.toolResults.find(
              (toolResult) =>
                toolResult.tool ===
                "searchProducts"
            );

            expect(
              searchToolResult
                ?.isRelativePriceSearch
            ).toBe(true);

            expect(
              searchToolResult
                ?.isProductSearchContinuation
            ).toBeUndefined();

          const searchResult =
            searchToolResult?.result as Array<{
              id: string;
              currency: string;
            }>;

          expect(
            searchResult.map(
              (product) => product.id
            )
          ).toEqual([
            cheaperProduct.id
          ]);

          expect(
            searchResult.every(
              (product) =>
                product.currency === "ETB"
            )
          ).toBe(true);

        const finalCall =
          generateAIResponseMock.mock
            .calls[1]?.[0];

        expect(finalCall).toBeDefined();

        const finalCallContent =
          finalCall.messages
            .map(
              (message: {
                content: string;
              }) => message.content
            )
            .join("\n");

        const commerceToolResultsContent =
          finalCallContent.split(
            "Commerce tool results:"
          )[1];

        expect(
          commerceToolResultsContent
        ).toBeDefined();

        expect(
          commerceToolResultsContent
        ).not.toContain(
          "cheaperThanSelectedProduct"
        );

        expect(
          commerceToolResultsContent
        ).not.toContain(
          "Wrong Search"
        );

        expect(
          commerceToolResultsContent
        ).not.toContain(
          "9999"
        );

        expect(
          commerceToolResultsContent
        ).not.toContain(
          '"USD"'
        );


        }
      );

      it(
        "does not broaden a cheaper-product search when no cheaper matching product exists",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Searching for something cheaper.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Wrong Search",
                      maxPrice:
                        9999,
                      currency:
                        "USD",
                      cheaperThanSelectedProduct:
                        true
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "I couldn't find a cheaper matching option."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "show me something cheaper",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  productPrice: 1,
                  productCurrency:
                    "ETB",
                  lastProductSearch: {
                    query:
                      "Men Shoes",
                    currency:
                      "ETB"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          expect(result.toolResults).toHaveLength(
            1
          );

          expect(
            result.toolResults[0]?.tool
          ).toBe(
            "searchProducts"
          );

          expect(
            result.toolResults[0]?.result
          ).toEqual([]);

          const finalCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(finalCall).toBeDefined();

          const commerceToolResultsContent =
            finalCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .find((content: string) =>
                content.startsWith(
                  "Commerce tool results:"
                )
              );

          expect(
            commerceToolResultsContent
          ).toBeDefined();

          expect(
            commerceToolResultsContent
          ).toContain(
            '"result":[]'
          );
        }
      );

      it(
        "does not invent a commerce action for a vague price objection",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GENERAL",
              message:
                "I understand. Would you like a cheaper option or do you have a budget in mind?",
              toolCalls: []
            })
          });

          const result =
            await runAIConversation(
              {
                text:
                  "That's too expensive.",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  productPrice:
                    1800,
                  productCurrency:
                    "ETB",
                  lastProductSearch: {
                    query:
                      "Men Shoes",
                    maxPrice:
                      2000,
                    currency:
                      "ETB"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);

          expect(
            result.toolResults
          ).toEqual([]);

          expect(
            result.searchContexts
          ).toEqual([]);

          expect(
            result.response
          ).toMatchObject({
            intent:
              "GENERAL",
            message:
              "I understand. Would you like a cheaper option or do you have a budget in mind?",
            toolCalls: []
          });
        }
      );


      it(
        "exposes authoritative selected product price and currency to interpretation context",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GENERAL",
              message:
                "I can help with that.",
              toolCalls: []
            })
          });

          await runAIConversation(
            {
              text:
                "show me something cheaper",
              state: {
                productId:
                  fixture.product.id,
                productName:
                  fixture.product.name,
                productPrice:
                  1800,
                productCurrency:
                  "ETB"
              },
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          const firstCallContent =
            firstCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(
            firstCallContent
          ).toContain(
            `"selectedProduct":{"id":"${fixture.product.id}","name":"${fixture.product.name}","price":1800,"currency":"ETB"}`
          );
        }
      );

      it(
        "rejects getProduct when productId is missing",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GET_PRODUCT",
              message:
                "Getting that product.",
              toolCalls: [
                {
                  tool:
                    "getProduct",
                  arguments: {}
                }
              ]
            })
          });

          await expect(
            runAIConversation(
              {
                text:
                  "the blue one",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            )
          ).rejects.toThrow(
            "AI returned invalid getProduct arguments."
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);
        }
      );

      it(
        "rejects a getProduct selection outside the current authoritative candidates",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GET_PRODUCT",
              message:
                "You mean another product.",
              toolCalls: [
                {
                  tool:
                    "getProduct",
                  arguments: {
                    productId:
                      fixture.product.id
                  }
                }
              ]
            })
          });

          await expect(
            runAIConversation(
              {
                text:
                  "the second one",
                state: {
                  candidateProducts: [
                    {
                      id:
                        "candidate-one",
                      name:
                        "First Candidate"
                    },
                    {
                      id:
                        "candidate-two",
                      name:
                        "Second Candidate"
                    }
                  ]
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            )
          ).rejects.toThrow(
            "AI getProduct selection must reference a current candidate product."
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);
        }
      );

      it(
        "allows getProduct for a product in the current authoritative candidates",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "GET_PRODUCT",
                message:
                  "You mean that product.",
                toolCalls: [
                  {
                    tool:
                      "getProduct",
                    arguments: {
                      productId:
                        fixture.product.id
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "You selected the product."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "the second one",
                state: {
                  candidateProducts: [
                    {
                      id:
                        "candidate-one",
                      name:
                        "First Candidate"
                    },
                    {
                      id:
                        fixture.product.id,
                      name:
                        fixture.product.name
                    }
                  ]
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          expect(result.toolResults).toHaveLength(
            1
          );

          expect(
            result.toolResults[0]?.tool
          ).toBe(
            "getProduct"
          );

          expect(
            (
              result.toolResults[0]?.result as {
                id: string;
              }
            ).id
          ).toBe(
            fixture.product.id
          );
        }
      );

      it(
        "re-fetches the authoritative selected product for a product-detail question without treating it as candidate selection",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "GET_PRODUCT",
                message:
                  "Let me check that product.",
                toolCalls: [
                  {
                    tool:
                      "getProduct",
                    arguments: {
                      selectedProductDetails:
                        true
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Here are the available product details."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "Tell me more about this one.",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  productPrice:
                    1800,
                  productCurrency:
                    "ETB",
                  candidateProducts: [
                    {
                      id:
                        "candidate-one",
                      name:
                        "First Candidate"
                    },
                    {
                      id:
                        "candidate-two",
                      name:
                        "Second Candidate"
                    }
                  ]
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          expect(
            result.toolResults
          ).toHaveLength(1);

          expect(
            result.toolResults[0]?.tool
          ).toBe(
            "getProduct"
          );

          expect(
            (
              result.toolResults[0]?.result as {
                id: string;
              }
            ).id
          ).toBe(
            fixture.product.id
          );
        }
      );

      it(
        "rejects a selected-product detail request without an authoritative selected product",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GET_PRODUCT",
              message:
                "Let me check that product.",
              toolCalls: [
                {
                  tool:
                    "getProduct",
                  arguments: {
                    selectedProductDetails:
                      true
                  }
                }
              ]
            })
          });

          await expect(
            runAIConversation(
              {
                text:
                  "Tell me more about this one.",
                state: {
                  candidateProducts: [
                    {
                      id:
                        fixture.product.id,
                      name:
                        fixture.product.name
                    }
                  ]
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            )
          ).rejects.toThrow(
            "AI requested selected product details without an authoritative selected product."
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(1);
        }
      );

      it(
        "gives the interpretation model a safe selected-product detail contract",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GENERAL",
              message:
                "I can help with that.",
              toolCalls: []
            })
          });

          await runAIConversation(
            {
              text:
                "What material is this one?",
              state: {
                productId:
                  fixture.product.id,
                productName:
                  fixture.product.name,
                productPrice:
                  1800,
                productCurrency:
                  "ETB"
              },
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          expect(firstCall.system).toContain(
            "When the customer asks for factual details about the already selected product, use getProduct with selectedProductDetails set to true."
          );

          expect(firstCall.system).toContain(
            "Do not provide productId for a selected-product detail request; the application supplies the authoritative selected product id."
          );

          expect(firstCall.system).toContain(
            "Use selectedProductDetails only for the already selected product, never to select from candidateProducts."
          );

          expect(firstCall.system).toContain(
            "If there is no selected product and the requested product is unclear, ask for clarification instead of using selectedProductDetails."
          );
        }
      );

      it(
        "gives the final response model a safe missing selected-product detail contract",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "GET_PRODUCT",
                message:
                  "Let me check that product.",
                toolCalls: [
                  {
                    tool:
                      "getProduct",
                    arguments: {
                      selectedProductDetails:
                        true
                    }
                  }
                ]
              })
            })
            .mockImplementationOnce(
              async (request) => {
                expect(
                  request.system
                ).toContain(
                  "For selected-product detail questions, answer only from factual details explicitly present in the supplied commerce tool result."
                );

                expect(
                  request.system
                ).toContain(
                  "Do not infer an unstated color, material, size, fit, brand, model, origin, or other product attribute from the product name, category, price, image, or general product knowledge."
                );

                expect(
                  request.system
                ).toContain(
                  "If the customer asks for a specific product detail that the supplied catalog facts do not state, clearly say that the catalog does not specify that detail."
                );

                return {
                  text:
                    "The catalog does not specify the material for this product."
                };
              }
            );

          const result =
            await runAIConversation(
              {
                text:
                  "What material is this one?",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  productPrice:
                    1800,
                  productCurrency:
                    "ETB"
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  "customer-test"
              }
            );

          expect(
            result.response.message
          ).toBe(
            "The catalog does not specify the material for this product."
          );

          expect(
            result.toolResults
          ).toHaveLength(1);

          expect(
            result.toolResults[0]
          ).toMatchObject({
            tool:
              "getProduct",
            isSelectedProductDetails:
              true
          });
        }
      );

      it(
        "gives the interpretation model a safe ordered-candidate reference contract",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock.mockResolvedValueOnce({
            text: JSON.stringify({
              intent:
                "GENERAL",
              message:
                "Which product do you mean?",
              toolCalls: []
            })
          });

          await runAIConversation(
            {
              text:
                "the second one",
              state: {
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
              },
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          expect(firstCall.system).toContain(
            "candidateProducts are ordered exactly as the products were presented from the authoritative search results."
          );

          expect(firstCall.system).toContain(
            "Ordinal references such as first, second, or third may resolve only to the product at that position in candidateProducts."
          );

          expect(firstCall.system).toContain(
            "When a customer clearly selects one candidate, use getProduct with that candidate's exact id."
          );

          expect(firstCall.system).toContain(
            'When using getProduct for a candidate selection, arguments.productId must be that candidate\'s exact non-empty id.'
          );

          expect(firstCall.system).toContain(
            "Never use a product id outside candidateProducts to resolve a reference to those candidates."
          );
        }
      );

      it(
        "provides authoritative same-merchant product facts for a grounded comparison",
        async () => {
          const fixture =
            await createFixture();

          const comparisonProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  fixture.product.categoryId,
                name:
                  "Premium Black Men Shoes",
                description:
                  "Black leather formal shoes",
                price:
                  "2400.00",
                currency:
                  "ETB",
                stock: 2,
                status:
                  ProductStatus.ACTIVE
              }
            });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "Comparing the matching shoes.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Men Shoes"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Black Men Shoes is cheaper at 1800 ETB, while Premium Black Men Shoes is 2400 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "Compare the men's shoes. Which is cheaper?",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          expect(result.toolResults).toHaveLength(
            1
          );

          const products =
            result.toolResults[0]
              .result as Array<{
                id: string;
                name: string;
                description: string | null;
                price: number;
                currency: string;
                stock: number;
                category: {
                  id: string;
                  name: string;
                } | null;
              }>;

          expect(products).toHaveLength(2);

          expect(products).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id:
                  fixture.product.id,
                name:
                  "Black Men Shoes",
                description:
                  "Black everyday shoes",
                price: 1800,
                currency:
                  "ETB",
                stock: 4,
                category:
                  expect.objectContaining({
                    name:
                      "Men Shoes"
                  })
              }),
              expect.objectContaining({
                id:
                  comparisonProduct.id,
                name:
                  "Premium Black Men Shoes",
                description:
                  "Black leather formal shoes",
                price: 2400,
                currency:
                  "ETB",
                stock: 2,
                category:
                  expect.objectContaining({
                    name:
                      "Men Shoes"
                  })
              })
            ])
          );

          expect(
            products.some(
              (product) =>
                product.id ===
                fixture.otherProduct.id
            )
          ).toBe(false);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          const finalCallContent =
            secondCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(finalCallContent).toContain(
            '"name":"Black Men Shoes"'
          );

          expect(finalCallContent).toContain(
            '"price":1800'
          );

          expect(finalCallContent).toContain(
            '"description":"Black everyday shoes"'
          );

          expect(finalCallContent).toContain(
            '"name":"Premium Black Men Shoes"'
          );

          expect(finalCallContent).toContain(
            '"price":2400'
          );

          expect(finalCallContent).toContain(
            '"description":"Black leather formal shoes"'
          );

          expect(finalCallContent).not.toContain(
            "Other Merchant Men Shoes"
          );

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "Black Men Shoes is cheaper at 1800 ETB, while Premium Black Men Shoes is 2400 ETB.",
            toolCalls: []
          });
        }
      );

      it(
        "provides authoritative facts for a recommendation tied to the customer's budget",
        async () => {
          const fixture =
            await createFixture();

          const comparisonProduct =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  fixture.product.categoryId,
                name:
                  "Premium Black Men Shoes",
                description:
                  "Black leather formal shoes",
                price:
                  "2400.00",
                currency:
                  "ETB",
                stock: 2,
                status:
                  ProductStatus.ACTIVE
              }
            });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "I found matching shoes.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Men Shoes"
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "For your 2000 ETB budget, Black Men Shoes fits at 1800 ETB. Premium Black Men Shoes costs 2400 ETB, which is above your stated budget."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "I have a 2000 ETB budget. Which men's shoes do you recommend?",
                state: {},
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          expect(result.toolResults).toHaveLength(
            1
          );

          const products =
            result.toolResults[0]
              .result as Array<{
                id: string;
                name: string;
                price: number;
                currency: string;
              }>;

          expect(products).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id:
                  fixture.product.id,
                name:
                  "Black Men Shoes",
                price: 1800,
                currency:
                  "ETB"
              }),
              expect.objectContaining({
                id:
                  comparisonProduct.id,
                name:
                  "Premium Black Men Shoes",
                price: 2400,
                currency:
                  "ETB"
              })
            ])
          );

          expect(
            products.some(
              (product) =>
                product.id ===
                fixture.otherProduct.id
            )
          ).toBe(false);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          const finalCallContent =
            secondCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(finalCallContent).toContain(
            "I have a 2000 ETB budget."
          );

          expect(finalCallContent).toContain(
            '"name":"Black Men Shoes"'
          );

          expect(finalCallContent).toContain(
            '"price":1800'
          );

          expect(finalCallContent).toContain(
            '"name":"Premium Black Men Shoes"'
          );

          expect(finalCallContent).toContain(
            '"price":2400'
          );

          expect(finalCallContent).not.toContain(
            "Other Merchant Men Shoes"
          );

          expect(secondCall.system).toContain(
            "tie the reason to the customer's stated preference or constraint"
          );

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "For your 2000 ETB budget, Black Men Shoes fits at 1800 ETB. Premium Black Men Shoes costs 2400 ETB, which is above your stated budget.",
            toolCalls: []
          });
        }
      );

      it(
        "executes an explicit additional-product search without turning it into continuation or relative-price search",
        async () => {
          const fixture =
            await createFixture();

          const beltCategory =
            await prisma.productCategory.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                name:
                  "Belts"
              }
            });

          const belt =
            await prisma.product.create({
              data: {
                merchantId:
                  fixture.merchant.id,
                categoryId:
                  beltCategory.id,
                name:
                  "Black Leather Belt",
                description:
                  "Black leather belt",
                price:
                  "650.00",
                currency:
                  "ETB",
                stock: 5,
                status:
                  ProductStatus.ACTIVE
              }
            });

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "I found belts.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        "Belt",
                      additionalProductSearch:
                        true
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "Yes. Black Leather Belt is available for 650 ETB."
            });

          const result =
            await runAIConversation(
              {
                text:
                  "I'll take the Black Men Shoes. Do you also have belts?",
                state: {
                  productId:
                    fixture.product.id,
                  productName:
                    fixture.product.name,
                  productPrice:
                    1800,
                  productCurrency:
                    "ETB",
                  lastProductSearch: {
                    query:
                      "Men Shoes"
                  }
                },
                merchantName:
                  fixture.merchant.name
              },
              {
                merchantId:
                  fixture.merchant.id,
                customerId:
                  fixture.customer.id
              }
            );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          const firstCall =
            generateAIResponseMock.mock
              .calls[0]?.[0];

          expect(firstCall).toBeDefined();

          expect(firstCall.system).toContain(
            "arguments.additionalProductSearch set to true"
          );

          expect(firstCall.system).toContain(
            "Use additionalProductSearch only for an explicit additional-product request."
          );

          expect(firstCall.system).toContain(
            "do not infer an accessory, complementary category, bundle, or"
          );

          expect(firstCall.system).toContain(
            "Ask for clarification instead of guessing a product"
          );

          expect(firstCall.system).toContain(
            "Do not proactively or spontaneously search for additional products"
          );

          expect(
            result.toolResults
          ).toHaveLength(1);

          expect(
            result.toolResults[0]
          ).toMatchObject({
            tool:
              "searchProducts",
            query:
              "Belt",
            isCrossSellSearch:
              true
          });

          expect(
            result.toolResults[0]
              .isProductSearchContinuation
          ).toBeUndefined();

          expect(
            result.toolResults[0]
              .isRelativePriceSearch
          ).toBeUndefined();

          const products =
            result.toolResults[0]
              .result as Array<{
                id: string;
                name: string;
                price: number;
                currency: string;
              }>;

          expect(products).toEqual([
            expect.objectContaining({
              id:
                belt.id,
              name:
                "Black Leather Belt",
              price: 650,
              currency:
                "ETB"
            })
          ]);

          expect(
            products.some(
              (product) =>
                product.id ===
                fixture.otherProduct.id
            )
          ).toBe(false);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          const finalCallContent =
            secondCall.messages
              .map(
                (message: {
                  content: string;
                }) => message.content
              )
              .join("\n");

          expect(finalCallContent).toContain(
            '"name":"Black Leather Belt"'
          );

          expect(finalCallContent).toContain(
            '"price":650'
          );

          expect(finalCallContent).not.toContain(
            "Other Merchant Men Shoes"
          );

          expect(secondCall.system).toContain(
            "present it as a secondary option and keep the customer's primary selected"
          );

          expect(secondCall.system).toContain(
            "Do not claim that an additional product matches, fits, works with, complements,"
          );

          expect(secondCall.system).toContain(
            "Do not invent a bundle, bundle price, discount, promotion, package, accessory"
          );

          expect(secondCall.system).toContain(
            "Do not pressure the customer to add the additional product"
          );

          expect(result.response).toMatchObject({
            intent:
              "SEARCH_PRODUCT",
            message:
              "Yes. Black Leather Belt is available for 650 ETB.",
            toolCalls: []
          });
        }
      );

      it(
        "requires the final-response model to preserve authoritative product result order",
        async () => {
          const fixture =
            await createFixture();

          generateAIResponseMock
            .mockResolvedValueOnce({
              text: JSON.stringify({
                intent:
                  "SEARCH_PRODUCT",
                message:
                  "I found matching products.",
                toolCalls: [
                  {
                    tool:
                      "searchProducts",
                    arguments: {
                      query:
                        fixture.product.name
                    }
                  }
                ]
              })
            })
            .mockResolvedValueOnce({
              text:
                "I found matching products."
            });

          await runAIConversation(
            {
              text:
                `Show me ${fixture.product.name}`,
              state: {},
              merchantName:
                fixture.merchant.name
            },
            {
              merchantId:
                fixture.merchant.id,
              customerId:
                fixture.customer.id
            }
          );

          expect(
            generateAIResponseMock
          ).toHaveBeenCalledTimes(2);

          const secondCall =
            generateAIResponseMock.mock
              .calls[1]?.[0];

          expect(secondCall).toBeDefined();

          expect(secondCall.system).toContain(
            "When presenting multiple products from a search result, preserve their authoritative result order."
          );

          expect(secondCall.system).toContain(
            "Do not reorder the products when numbering, listing, or describing them."
          );
        }
      );
    }
  );
