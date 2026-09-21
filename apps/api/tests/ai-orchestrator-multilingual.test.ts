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
    }
  );