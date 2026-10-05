import express from "express";

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  MerchantAccountStatus,
  prisma
} from "@ethio-commerce/database";

const {
  testMerchantId,
  testWebhookKey,
  testWebhookSecret,
  testBotToken,
  handleConversationMock,
  sendTelegramMessageMock
} = vi.hoisted(() => ({
    testMerchantId:
      "telegram-account-enforcement-test-merchant",
    testWebhookKey:
      "telegram-account-enforcement-test-webhook-key",
    testWebhookSecret:
      "telegram-account-enforcement-test-secret",
    testBotToken:
      "telegram-account-enforcement-test-token",
    handleConversationMock:
      vi.fn(),
    sendTelegramMessageMock:
      vi.fn()
  }));

vi.mock(
  "../src/conversation/conversation-manager.js",
  () => ({
    handleConversation:
      handleConversationMock
  })
);

vi.mock(
  "../src/services/telegram.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import(
          "../src/services/telegram.js"
        )
      >();

    return {
      ...actual,
      sendTelegramMessage:
        sendTelegramMessageMock
    };
  }
);

import telegramRouter
  from "../src/routes/telegram.js";

import {
  encryptTelegramCredential
} from "../src/services/telegram-credential-encryption.js";

async function cleanup(): Promise<void> {
  await prisma.webhookEvent.deleteMany({
    where: {
      merchantId: testMerchantId
    }
  });

  await prisma.merchantTelegramIntegration.deleteMany({
    where: {
      merchantId:
        testMerchantId
    }
  });

  await prisma.merchant.deleteMany({
    where: {
      id: testMerchantId
    }
  });
}

async function createTelegramIntegration(): Promise<void> {
  await prisma.merchantTelegramIntegration.create({
    data: {
      merchantId:
        testMerchantId,
      webhookKey:
        testWebhookKey,
      botTokenEncrypted:
        encryptTelegramCredential(
          testBotToken
        ),
      webhookSecretEncrypted:
        encryptTelegramCredential(
          testWebhookSecret
        )
    }
  });
}

beforeEach(async () => {
  handleConversationMock.mockReset();
  sendTelegramMessageMock.mockReset();

  await cleanup();
});

afterAll(async () => {
  await cleanup();

  await prisma.$disconnect();
});

describe(
  "Telegram merchant account enforcement",
  () => {
    it(
      "rejects an unknown merchant Telegram webhook key without processing the update",
      async () => {
        const app = express();

        app.use(express.json());

        app.use(
          "/webhooks/telegram",
          telegramRouter
        );

        const server =
          app.listen(
            0,
            "127.0.0.1"
          );

        await new Promise<void>(
          (resolve) => {
            server.once(
              "listening",
              resolve
            );
          }
        );

        try {
          const address =
            server.address();

          if (
            !address ||
            typeof address === "string"
          ) {
            throw new Error(
              "Test server did not expose a TCP port"
            );
          }

          const response =
            await fetch(
              `http://127.0.0.1:${address.port}/webhooks/telegram/unknown-webhook-key`,
              {
                method: "POST",
                headers: {
                  "content-type":
                    "application/json",
                  "x-telegram-bot-api-secret-token":
                    testWebhookSecret
                },
                body: JSON.stringify({
                  update_id: 910000,
                  message: {
                    message_id: 920000,
                    text:
                      "Show me your products",
                    chat: {
                      id: 930000
                    },
                    from: {
                      id: 940000,
                      first_name:
                        "Unknown",
                      last_name:
                        "Customer"
                    }
                  }
                })
              }
            );

          expect(
            response.status
          ).toBe(404);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Telegram integration was not found"
          });

          expect(
            await prisma.webhookEvent.count({
              where: {
                eventId:
                  "910000",
                provider:
                  "TELEGRAM"
              }
            })
          ).toBe(0);

          expect(
            handleConversationMock
          ).not.toHaveBeenCalled();
        } finally {
          await new Promise<void>(
            (
              resolve,
              reject
            ) => {
              server.close(
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

    it(
      "rejects an inactive merchant Telegram integration without processing the update",
      async () => {
        await prisma.merchant.create({
          data: {
            id:
              testMerchantId,
            name:
              "telegram-account-enforcement-test"
          }
        });

        await createTelegramIntegration();

        await prisma.merchantTelegramIntegration.update({
          where: {
            merchantId:
              testMerchantId
          },
          data: {
            status:
              "INACTIVE"
          }
        });

        const app = express();

        app.use(express.json());

        app.use(
          "/webhooks/telegram",
          telegramRouter
        );

        const server =
          app.listen(
            0,
            "127.0.0.1"
          );

        await new Promise<void>(
          (resolve) => {
            server.once(
              "listening",
              resolve
            );
          }
        );

        try {
          const address =
            server.address();

          if (
            !address ||
            typeof address === "string"
          ) {
            throw new Error(
              "Test server did not expose a TCP port"
            );
          }

          const response =
            await fetch(
              `http://127.0.0.1:${address.port}/webhooks/telegram/${testWebhookKey}`,
              {
                method:
                  "POST",
                headers: {
                  "content-type":
                    "application/json",
                  "x-telegram-bot-api-secret-token":
                    testWebhookSecret
                },
                body:
                  JSON.stringify({
                    update_id:
                      910003,
                    message: {
                      message_id:
                        920003,
                      text:
                        "Show me your products",
                      chat: {
                        id:
                          930003
                      },
                      from: {
                        id:
                          940003,
                        first_name:
                          "Inactive",
                        last_name:
                          "Customer"
                      }
                    }
                  })
              }
            );

          expect(
            response.status
          ).toBe(404);

          await expect(
            response.json()
          ).resolves.toEqual({
            error:
              "Telegram integration was not found"
          });

          expect(
            await prisma.webhookEvent.count({
              where: {
                merchantId:
                  testMerchantId,
                provider:
                  "TELEGRAM",
                eventId:
                  "910003"
              }
            })
          ).toBe(0);

          expect(
            await prisma.customer.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            handleConversationMock
          ).not.toHaveBeenCalled();
        } finally {
          await new Promise<void>(
            (
              resolve,
              reject
            ) => {
              server.close(
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

    it(
      "rejects an invalid Telegram webhook secret without processing the update",
      async () => {
        await prisma.merchant.create({
          data: {
            id:
              testMerchantId,
            name:
              "telegram-account-enforcement-test"
          }
        });

        await createTelegramIntegration();

        const app = express();

        app.use(express.json());

        app.use(
          "/webhooks/telegram",
          telegramRouter
        );

        const server =
          app.listen(
            0,
            "127.0.0.1"
          );

        await new Promise<void>(
          (resolve) => {
            server.once(
              "listening",
              resolve
            );
          }
        );

        try {
          const address =
            server.address();

          if (
            !address ||
            typeof address === "string"
          ) {
            throw new Error(
              "Test server did not expose a TCP port"
            );
          }

          const response =
            await fetch(
              `http://127.0.0.1:${address.port}/webhooks/telegram/${testWebhookKey}`,
              {
                method:
                  "POST",
                headers: {
                  "content-type":
                    "application/json",
                  "x-telegram-bot-api-secret-token":
                    "incorrect-webhook-secret"
                },
                body:
                  JSON.stringify({
                    update_id:
                      910004,
                    message: {
                      message_id:
                        920004,
                      text:
                        "Show me your products",
                      chat: {
                        id:
                          930004
                      },
                      from: {
                        id:
                          940004,
                        first_name:
                          "Invalid",
                        last_name:
                          "Secret"
                      }
                    }
                  })
              }
            );

          expect(
            response.status
          ).toBe(401);

          expect(
            await prisma.webhookEvent.count({
              where: {
                merchantId:
                  testMerchantId,
                provider:
                  "TELEGRAM",
                eventId:
                  "910004"
              }
            })
          ).toBe(0);

          expect(
            await prisma.customer.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            await prisma.conversation.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            handleConversationMock
          ).not.toHaveBeenCalled();
        } finally {
          await new Promise<void>(
            (
              resolve,
              reject
            ) => {
              server.close(
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

    it(
      "routes an active Telegram integration to the correct merchant",
      async () => {
        await prisma.merchant.create({
          data: {
            id:
              testMerchantId,
            name:
              "telegram-account-enforcement-test"
          }
        });

        await createTelegramIntegration();

        handleConversationMock.mockResolvedValue({
          reply:
            "Merchant-specific reply"
        });

        sendTelegramMessageMock.mockResolvedValue(
          "telegram-outbound-message-1"
        );

        const app = express();

        app.use(express.json());

        app.use(
          "/webhooks/telegram",
          telegramRouter
        );

        const server =
          app.listen(
            0,
            "127.0.0.1"
          );

        await new Promise<void>(
          (resolve) => {
            server.once(
              "listening",
              resolve
            );
          }
        );

        try {
          const address =
            server.address();

          if (
            !address ||
            typeof address === "string"
          ) {
            throw new Error(
              "Test server did not expose a TCP port"
            );
          }

          const response =
            await fetch(
              `http://127.0.0.1:${address.port}/webhooks/telegram/${testWebhookKey}`,
              {
                method:
                  "POST",
                headers: {
                  "content-type":
                    "application/json",
                  "x-telegram-bot-api-secret-token":
                    testWebhookSecret
                },
                body:
                  JSON.stringify({
                    update_id:
                      910005,
                    message: {
                      message_id:
                        920005,
                      text:
                        "Show me your products",
                      chat: {
                        id:
                          930005
                      },
                      from: {
                        id:
                          940005,
                        first_name:
                          "Active",
                        last_name:
                          "Customer"
                      }
                    }
                  })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const customer =
            await prisma.customer.findUniqueOrThrow({
              where: {
                merchantId_telegramChatId: {
                  merchantId:
                    testMerchantId,
                  telegramChatId:
                    "930005"
                }
              }
            });

          const conversation =
            await prisma.conversation.findUniqueOrThrow({
              where: {
                merchantId_channel_externalId: {
                  merchantId:
                    testMerchantId,
                  channel:
                    "TELEGRAM",
                  externalId:
                    "930005"
                }
              }
            });

          expect(
            conversation.customerId
          ).toBe(customer.id);

          expect(
            handleConversationMock
          ).toHaveBeenCalledTimes(1);

          expect(
            handleConversationMock
          ).toHaveBeenCalledWith(
            {
              merchantId:
                testMerchantId,
              customerId:
                customer.id,
              chatId:
                "930005",
              customerName:
                "Active Customer",
              merchantName:
                "telegram-account-enforcement-test"
            },
            "Show me your products"
          );

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(1);

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledWith(
            testBotToken,
            "930005",
            "Merchant-specific reply"
          );

          const event =
            await prisma.webhookEvent.findUniqueOrThrow({
              where: {
                merchantId_provider_eventId: {
                  merchantId:
                    testMerchantId,
                  provider:
                    "TELEGRAM",
                  eventId:
                    "910005"
                }
              }
            });

          expect(
            event.processedAt
          ).not.toBeNull();

          const inboundMessage =
            await prisma.message.findUniqueOrThrow({
              where: {
                conversationId_externalId: {
                  conversationId:
                    conversation.id,
                  externalId:
                    "920005"
                }
              }
            });

          expect(
            inboundMessage.direction
          ).toBe("INBOUND");

          expect(
            inboundMessage.content
          ).toBe(
            "Show me your products"
          );

          const outboundMessage =
            await prisma.message.findUniqueOrThrow({
              where: {
                conversationId_externalId: {
                  conversationId:
                    conversation.id,
                  externalId:
                    "telegram-outbound-message-1"
                }
              }
            });

          expect(
            outboundMessage.direction
          ).toBe("OUTBOUND");

          expect(
            outboundMessage.content
          ).toBe(
            "Merchant-specific reply"
          );
        } finally {
          await new Promise<void>(
            (
              resolve,
              reject
            ) => {
              server.close(
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

    it(
      "durably consumes an update without starting commerce when the merchant account is suspended",
      async () => {
        await prisma.merchant.create({
          data: {
            id: testMerchantId,
            name:
              "telegram-account-enforcement-test",
            accountStatus:
              MerchantAccountStatus.SUSPENDED,
            accountSuspensionReason:
              "Suspicious account activity",
            accountSuspendedAt:
              new Date()
          }
        });

        await createTelegramIntegration();

        const app = express();

        app.use(express.json());

        app.use(
          "/webhooks/telegram",
          telegramRouter
        );

        const server =
          app.listen(
            0,
            "127.0.0.1"
          );

        await new Promise<void>(
          (resolve) => {
            server.once(
              "listening",
              resolve
            );
          }
        );

        try {
          const address =
            server.address();

          if (
            !address ||
            typeof address === "string"
          ) {
            throw new Error(
              "Test server did not expose a TCP port"
            );
          }

          const response =
            await fetch(
              `http://127.0.0.1:${address.port}/webhooks/telegram/${testWebhookKey}`,
              {
                method: "POST",
                headers: {
                  "content-type":
                    "application/json",
                  "x-telegram-bot-api-secret-token":
                    testWebhookSecret
                },
                body: JSON.stringify({
                  update_id: 910001,
                  message: {
                    message_id: 920001,
                    text:
                      "Show me your products",
                    chat: {
                      id: 930001
                    },
                    from: {
                      id: 940001,
                      first_name:
                        "Suspended",
                      last_name:
                        "Customer"
                    }
                  }
                })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const event =
            await prisma.webhookEvent
              .findUnique({
                where: {
                  merchantId_provider_eventId: {
                    merchantId:
                      testMerchantId,
                    provider:
                      "TELEGRAM",
                    eventId:
                      "910001"
                  }
                }
              });

          expect(event).not.toBeNull();

          expect(
            event?.merchantId
          ).toBe(testMerchantId);

          expect(
            event?.processedAt
          ).not.toBeNull();

          expect(
            await prisma.customer.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            await prisma.conversation.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            await prisma.message.count({
              where: {
                conversation: {
                  merchantId:
                    testMerchantId
                }
              }
            })
          ).toBe(0);

          expect(
            handleConversationMock
          ).not.toHaveBeenCalled();

          const duplicateResponse =
            await fetch(
              `http://127.0.0.1:${address.port}/webhooks/telegram/${testWebhookKey}`,
              {
                method: "POST",
                headers: {
                  "content-type":
                    "application/json",
                  "x-telegram-bot-api-secret-token":
                    testWebhookSecret
                },
                body: JSON.stringify({
                  update_id: 910001,
                  message: {
                    message_id: 920001,
                    text:
                      "Show me your products",
                    chat: {
                      id: 930001
                    },
                    from: {
                      id: 940001,
                      first_name:
                        "Suspended",
                      last_name:
                        "Customer"
                    }
                  }
                })
              }
            );

          expect(
            duplicateResponse.status
          ).toBe(200);

          expect(
            await duplicateResponse.json()
          ).toEqual({
            ok: true,
            duplicate: true
          });

          expect(
            await prisma.webhookEvent.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(1);

          expect(
            await prisma.customer.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            await prisma.conversation.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            handleConversationMock
          ).not.toHaveBeenCalled();
        } finally {
          await new Promise<void>(
            (
              resolve,
              reject
            ) => {
              server.close(
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

    it(
      "marks a previously unprocessed update as processed when the merchant account is suspended",
      async () => {
        await prisma.merchant.create({
          data: {
            id: testMerchantId,
            name:
              "telegram-account-enforcement-test",
            accountStatus:
              MerchantAccountStatus.SUSPENDED,
            accountSuspensionReason:
              "Suspicious account activity",
            accountSuspendedAt:
              new Date()
          }
        });

        await createTelegramIntegration();

        await prisma.webhookEvent.create({
          data: {
            merchantId:
              testMerchantId,
            provider:
              "TELEGRAM",
            eventId:
              "910002",
            payload: {
              update_id: 910002
            }
          }
        });

        const app = express();

        app.use(express.json());

        app.use(
          "/webhooks/telegram",
          telegramRouter
        );

        const server =
          app.listen(
            0,
            "127.0.0.1"
          );

        await new Promise<void>(
          (resolve) => {
            server.once(
              "listening",
              resolve
            );
          }
        );

        try {
          const address =
            server.address();

          if (
            !address ||
            typeof address === "string"
          ) {
            throw new Error(
              "Test server did not expose a TCP port"
            );
          }

          const response =
            await fetch(
              `http://127.0.0.1:${address.port}/webhooks/telegram/${testWebhookKey}`,
              {
                method: "POST",
                headers: {
                  "content-type":
                    "application/json",
                  "x-telegram-bot-api-secret-token":
                    testWebhookSecret
                },
                body: JSON.stringify({
                  update_id: 910002,
                  message: {
                    message_id: 920002,
                    text:
                      "Show me your products",
                    chat: {
                      id: 930002
                    },
                    from: {
                      id: 940002,
                      first_name:
                        "Suspended",
                      last_name:
                        "Customer"
                    }
                  }
                })
              }
            );

          expect(
            response.status
          ).toBe(200);

          const event =
            await prisma.webhookEvent
              .findUniqueOrThrow({
                where: {
                  merchantId_provider_eventId: {
                    merchantId:
                      testMerchantId,
                    provider:
                      "TELEGRAM",
                    eventId:
                      "910002"
                  }
                }
              });

          expect(
            event.processedAt
          ).not.toBeNull();

          expect(
            await prisma.webhookEvent.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(1);

          expect(
            await prisma.customer.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            await prisma.conversation.count({
              where: {
                merchantId:
                  testMerchantId
              }
            })
          ).toBe(0);

          expect(
            handleConversationMock
          ).not.toHaveBeenCalled();
        } finally {
          await new Promise<void>(
            (
              resolve,
              reject
            ) => {
              server.close(
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
  }
);