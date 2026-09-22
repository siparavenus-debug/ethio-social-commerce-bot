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
            "የወንድ shoe አለ?";

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
                  "black የወንድ shoe አለ?",
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
                        "ጥቁር የወንድ ጫማ",
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
                  "ጥቁር የወንድ ጫማ አለ?",
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
              "ጥቁር የወንድ ጫማ"
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
                "የወንድ shoe አለ?",
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
                "የወንድ shoe አለ? price sint new?",
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
                  "ያኛው one",
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
