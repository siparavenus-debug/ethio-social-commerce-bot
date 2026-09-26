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
    testWebhookSecret,
    handleConversationMock
  } = vi.hoisted(() => ({
    testMerchantId:
      "telegram-account-enforcement-test-merchant",
    testWebhookSecret:
      "telegram-account-enforcement-test-secret",
    handleConversationMock:
      vi.fn()
  }));

vi.mock(
  "../src/config/env.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import(
          "../src/config/env.js"
        )
      >();

    return {
      ...actual,
      env: {
        ...actual.env,
        telegramBotToken:
          "telegram-account-enforcement-test-token",
        telegramWebhookSecret:
          testWebhookSecret,
        telegramMerchantId:
          testMerchantId
      }
    };
  }
);

vi.mock(
  "../src/conversation/conversation-manager.js",
  () => ({
    handleConversation:
      handleConversationMock
  })
);

import telegramRouter
  from "../src/routes/telegram.js";

async function cleanup(): Promise<void> {
  await prisma.webhookEvent.deleteMany({
    where: {
      merchantId: testMerchantId
    }
  });

  await prisma.merchant.deleteMany({
    where: {
      id: testMerchantId
    }
  });
}

beforeEach(async () => {
  handleConversationMock.mockReset();

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
              `http://127.0.0.1:${address.port}/webhooks/telegram`,
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
                  provider_eventId: {
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
              `http://127.0.0.1:${address.port}/webhooks/telegram`,
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
              `http://127.0.0.1:${address.port}/webhooks/telegram`,
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
                  provider_eventId: {
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