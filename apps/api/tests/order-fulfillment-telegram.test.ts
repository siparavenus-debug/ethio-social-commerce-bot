import type {
    Server
  } from "node:http";

  import express from "express";

  import {
    MerchantUserRole,
    OrderStatus,
    prisma
  } from "@ethio-commerce/database";

  import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  const {
    sendTelegramMessageMock
  } = vi.hoisted(() => ({
    sendTelegramMessageMock:
      vi.fn()
  }));

  vi.mock(
    "../src/services/telegram.js",
    () => ({
      sendTelegramMessage:
        sendTelegramMessageMock
    })
  );

  import ordersRouter
    from "../src/routes/orders.js";

  import {
    createAuthToken
  } from "../src/services/auth.js";

  import {
    createDeliveryConfirmation,
    verifyDeliveryConfirmationCode
  } from "../src/services/delivery-security.js";

  import {
    encryptTelegramCredential
  } from "../src/services/telegram-credential-encryption.js";

  const testPrefix =
    "fulfillment-telegram";

  const testBotToken =
    "fulfillment-telegram-test-bot-token";

  async function createTelegramIntegration(
    merchantId: string
  ): Promise<void> {
    await prisma.merchantTelegramIntegration.create({
      data: {
        merchantId,
        webhookKey:
          `${testPrefix}-${merchantId}`,
        botTokenEncrypted:
          encryptTelegramCredential(
            testBotToken
          ),
        webhookSecretEncrypted:
          encryptTelegramCredential(
            "fulfillment-telegram-test-webhook-secret"
          )
      }
    });
  }

  let server:
    Server | null = null;

  let apiBaseUrl =
    "";

  async function cleanup():
  Promise<void> {
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

    await prisma.auditLog.deleteMany({
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

    await prisma.customer.deleteMany({
      where: {
        merchantId: {
          in: merchantIds
        }
      }
    });

    await prisma.merchantUser.deleteMany({
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

  describe(
    "order fulfillment Telegram delivery confirmation",
    () => {
      beforeAll(
        async () => {
          await cleanup();

          const app =
            express();

          app.use(
            express.json()
          );

          app.use(
            "/merchants",
            ordersRouter
          );

          await new Promise<void>(
            (resolve) => {
              server =
                app.listen(
                  0,
                  "127.0.0.1",
                  () => {
                    const address =
                      server!.address();

                    if (
                      !address ||
                      typeof address ===
                        "string"
                    ) {
                      throw new Error(
                        "Failed to start test server"
                      );
                    }

                    apiBaseUrl =
                      `http://127.0.0.1:${address.port}`;

                    resolve();
                  }
                );
            }
          );
        }
      );

      beforeEach(
        async () => {
          sendTelegramMessageMock
            .mockReset();

          sendTelegramMessageMock
            .mockResolvedValue(
              "telegram-message-id"
            );

          await cleanup();
        }
      );

      afterAll(
        async () => {
          await cleanup();

          if (server) {
            await new Promise<void>(
              (
                resolve,
                reject
              ) => {
                server!.close(
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
        "sends the plaintext delivery code only to the customer after fulfillment starts",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-merchant`,
                currency:
                  "ETB"
              }
            });

          await createTelegramIntegration(
            merchant.id
          );

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Fulfillment Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "Delivery Customer",
                telegramChatId:
                  "fulfillment-chat-123",
                telegramUserId:
                  "fulfillment-user-123"
              }
            });

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-001",
                status:
                  OrderStatus.PAID,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Delivery Recipient",
                deliveryPhone:
                  "0911000000",
                deliveryAddress:
                  "Addis Ababa Delivery Address"
              }
            });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/status`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    status:
                      "FULFILLING"
                  })
              }
            );

          expect(response.status)
            .toBe(200);

          const body =
            await response.json();

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(1);

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledWith(
            testBotToken,
            customer.telegramChatId,
            expect.stringContaining(
              order.orderNumber
            )
          );

          const telegramText =
            sendTelegramMessageMock
              .mock.calls[0]?.[2];

          expect(
            typeof telegramText
          ).toBe("string");

          const codeMatch =
            String(
              telegramText
            ).match(
              /delivery confirmation code is:\s*(\d{6})/i
            );

          expect(codeMatch)
            .not.toBeNull();

          const plaintextCode =
            codeMatch![1];

          const storedOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id: order.id
                }
              });

          expect(
            storedOrder.status
          ).toBe(
            OrderStatus.FULFILLING
          );

          expect(
            storedOrder
              .deliveryConfirmationSentAt
          ).not.toBeNull();

          expect(
            storedOrder
              .deliveryConfirmationCodeHash
          ).toMatch(
            /^[a-f0-9]{64}$/i
          );

          expect(
            storedOrder
              .deliveryConfirmationCodeHash
          ).not.toBe(
            plaintextCode
          );

          expect(
            verifyDeliveryConfirmationCode(
              order.id,
              plaintextCode,
              storedOrder
                .deliveryConfirmationCodeHash!
            )
          ).toBe(true);

          const responseText =
            JSON.stringify(body);

          expect(
            responseText
          ).not.toContain(
            plaintextCode
          );

          expect(
            responseText
          ).not.toContain(
            storedOrder
              .deliveryConfirmationCodeHash!
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeHash"
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeExpiresAt"
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationAttempts"
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationSentAt"
          );

          const audit =
            await prisma.auditLog
              .findFirstOrThrow({
                where: {
                  merchantId:
                    merchant.id,
                  entityId:
                    order.id,
                  action:
                    "ORDER_FULFILLING"
                }
              });

          const auditText =
            JSON.stringify(audit);

          expect(
            audit.actorUserId
          ).toBe(user.id);

          expect(
            auditText
          ).not.toContain(
            plaintextCode
          );

          expect(
            auditText
          ).not.toContain(
            storedOrder
              .deliveryConfirmationCodeHash!
          );

          expect(
            auditText
          ).not.toContain(
            "Delivery Recipient"
          );

          expect(
            auditText
          ).not.toContain(
            "0911000000"
          );

          expect(
            auditText
          ).not.toContain(
            "Addis Ababa Delivery Address"
          );
        }
      );

      it(
        "recovers when the initial delivery confirmation Telegram message fails",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-recovery-merchant`,
                currency:
                  "ETB"
              }
            });

          await createTelegramIntegration(
            merchant.id
          );

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}-recovery@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Recovery Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "Recovery Customer",
                telegramChatId:
                  "fulfillment-recovery-chat",
                telegramUserId:
                  "fulfillment-recovery-user"
              }
            });

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-RECOVERY-001",
                status:
                  OrderStatus.PAID,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Recovery Recipient",
                deliveryPhone:
                  "0911222333",
                deliveryAddress:
                  "Recovery Delivery Address"
              }
            });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          sendTelegramMessageMock
            .mockRejectedValueOnce(
              new Error(
                "Simulated Telegram failure"
              )
            );

          const startResponse =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/status`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    status:
                      "FULFILLING"
                  })
              }
            );

          expect(
            startResponse.status
          ).toBe(200);

          const startBody =
            await startResponse.json();

          expect(
            startBody.message
          ).toBe(
            "Order marked as fulfilling"
          );

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(1);

          const unsentOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id: order.id
                }
              });

          expect(
            unsentOrder.status
          ).toBe(
            OrderStatus.FULFILLING
          );

          expect(
            unsentOrder
              .deliveryConfirmationCodeHash
          ).toMatch(
            /^[a-f0-9]{64}$/i
          );

          expect(
            unsentOrder
              .deliveryConfirmationSentAt
          ).toBeNull();

          expect(
            startBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeHash"
          );

          expect(
            startBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeExpiresAt"
          );

          expect(
            startBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationAttempts"
          );

          expect(
            startBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationSentAt"
          );

          sendTelegramMessageMock
            .mockResolvedValueOnce(
              "telegram-recovery-message-id"
            );

          const resendResponse =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`,
              {
                method: "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`
                }
              }
            );

          expect(
            resendResponse.status
          ).toBe(200);

          const resendBody =
            await resendResponse.json();

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(2);

          const recoveryTelegramText =
            sendTelegramMessageMock
              .mock.calls[1]?.[2];

          expect(
            typeof recoveryTelegramText
          ).toBe("string");

          const recoveryCodeMatch =
            String(
              recoveryTelegramText
            ).match(
              /delivery confirmation code is:\s*(\d{6})/i
            );

          expect(
            recoveryCodeMatch
          ).not.toBeNull();

          const recoveryCode =
            recoveryCodeMatch![1];

          const recoveredOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id: order.id
                }
              });

          expect(
            recoveredOrder.status
          ).toBe(
            OrderStatus.FULFILLING
          );

          expect(
            recoveredOrder
              .deliveryConfirmationSentAt
          ).not.toBeNull();

          expect(
            recoveredOrder
              .deliveryConfirmationCodeHash
          ).not.toBe(
            unsentOrder
              .deliveryConfirmationCodeHash
          );

          expect(
            verifyDeliveryConfirmationCode(
              order.id,
              recoveryCode,
              recoveredOrder
                .deliveryConfirmationCodeHash!
            )
          ).toBe(true);

          expect(
            resendBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeHash"
          );

          expect(
            resendBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeExpiresAt"
          );

          expect(
            resendBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationAttempts"
          );

          expect(
            resendBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationSentAt"
          );
        }
      );

      it(
        "allows another recovery when the replacement Telegram message also fails",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-retry-recovery-merchant`,
                currency:
                  "ETB"
              }
            });

          await createTelegramIntegration(
            merchant.id
          );

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}-retry-recovery@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Retry Recovery Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "Retry Recovery Customer",
                telegramChatId:
                  "retry-recovery-chat",
                telegramUserId:
                  "retry-recovery-user"
              }
            });

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-RECOVERY-002",
                status:
                  OrderStatus.PAID,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Retry Recovery Recipient",
                deliveryPhone:
                  "0911333444",
                deliveryAddress:
                  "Retry Recovery Address"
              }
            });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          /*
           * Initial delivery notification fails.
           */
          sendTelegramMessageMock
            .mockRejectedValueOnce(
              new Error(
                "Simulated initial Telegram failure"
              )
            );

          const startResponse =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/status`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    status:
                      "FULFILLING"
                  })
              }
            );

          expect(
            startResponse.status
          ).toBe(200);

          const afterInitialFailure =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    order.id
                }
              });

          expect(
            afterInitialFailure
              .deliveryConfirmationSentAt
          ).toBeNull();

          /*
           * First recovery rotates the code, but its
           * replacement Telegram notification also fails.
           */
          sendTelegramMessageMock
            .mockRejectedValueOnce(
              new Error(
                "Simulated recovery Telegram failure"
              )
            );

          const firstRecoveryResponse =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`
                }
              }
            );

          expect(
            firstRecoveryResponse.status
          ).toBe(200);

          const afterRecoveryFailure =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    order.id
                }
              });

          expect(
            afterRecoveryFailure
              .deliveryConfirmationSentAt
          ).toBeNull();

          expect(
            afterRecoveryFailure
              .deliveryConfirmationCodeHash
          ).not.toBe(
            afterInitialFailure
              .deliveryConfirmationCodeHash
          );

          /*
           * Because the replacement was never successfully
           * sent, another recovery must still be allowed.
           */
          sendTelegramMessageMock
            .mockResolvedValueOnce(
              "telegram-final-recovery-message-id"
            );

          const secondRecoveryResponse =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`
                }
              }
            );

          expect(
            secondRecoveryResponse.status
          ).toBe(200);

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(3);

          const finalTelegramText =
            String(
              sendTelegramMessageMock
                .mock.calls[2]?.[2]
            );

          const finalCodeMatch =
            finalTelegramText.match(
              /delivery confirmation code is:\s*(\d{6})/i
            );

          expect(
            finalCodeMatch
          ).not.toBeNull();

          const finalPlaintextCode =
            finalCodeMatch![1];

          const recoveredOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    order.id
                }
              });

          expect(
            recoveredOrder
              .deliveryConfirmationSentAt
          ).not.toBeNull();

          expect(
            recoveredOrder
              .deliveryConfirmationCodeHash
          ).not.toBe(
            afterRecoveryFailure
              .deliveryConfirmationCodeHash
          );

          expect(
            verifyDeliveryConfirmationCode(
              order.id,
              finalPlaintextCode,
              recoveredOrder
                .deliveryConfirmationCodeHash!
            )
          ).toBe(true);

          const secondRecoveryBody =
            await secondRecoveryResponse
              .json();

          expect(
            secondRecoveryBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeHash"
          );

          expect(
            secondRecoveryBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeExpiresAt"
          );

          expect(
            secondRecoveryBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationAttempts"
          );

          expect(
            secondRecoveryBody.order
          ).not.toHaveProperty(
            "deliveryConfirmationSentAt"
          );
        }
      );

      it(
        "notifies the customer after successful delivery confirmation",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-confirmed-merchant`,
                currency:
                  "ETB"
              }
            });

          await createTelegramIntegration(
            merchant.id
          );

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}-confirmed@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Delivery Confirmation Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "Confirmed Delivery Customer",
                telegramChatId:
                  "confirmed-delivery-chat-123",
                telegramUserId:
                  "confirmed-delivery-user-123"
              }
            });

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-002",
                status:
                  OrderStatus.FULFILLING,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Confirmed Recipient",
                deliveryPhone:
                  "0911000000",
                deliveryAddress:
                  "Confirmed Delivery Address"
              }
            });

          const confirmation =
            createDeliveryConfirmation(
              order.id
            );

          await prisma.order.update({
            where: {
              id: order.id
            },
            data: {
              deliveryConfirmationCodeHash:
                confirmation.codeHash,
              deliveryConfirmationCodeExpiresAt:
                confirmation.expiresAt,
              deliveryConfirmationAttempts:
                0
            }
          });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                },
                body:
                  JSON.stringify({
                    code:
                      confirmation.code
                  })
              }
            );

          expect(
            response.status
          ).toBe(200);

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(1);

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledWith(
            testBotToken,
            customer.telegramChatId,
            expect.stringContaining(
              order.orderNumber
            )
          );

          const telegramText =
            String(
              sendTelegramMessageMock
                .mock.calls[0]?.[2]
            );

          expect(
            telegramText
          ).toMatch(
            /delivered|delivery.*confirmed|received/i
          );

          expect(
            telegramText
          ).not.toContain(
            confirmation.code
          );

          expect(
            telegramText
          ).not.toContain(
            confirmation.codeHash
          );

          const storedOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id: order.id
                }
              });

          expect(
            storedOrder.status
          ).toBe(
            OrderStatus.FULFILLED
          );

          expect(
            storedOrder
              .deliveryConfirmedAt
          ).not.toBeNull();

          expect(
            storedOrder
              .deliveryConfirmationCodeHash
          ).toBeNull();

          expect(
            storedOrder
              .deliveryConfirmationCodeExpiresAt
          ).toBeNull();

          expect(
            storedOrder
              .deliveryConfirmationSentAt
          ).toBeNull();
        }
      );

      it(
        "rotates the delivery confirmation code and sends the new plaintext only to the customer",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-resend-merchant`,
                currency:
                  "ETB"
              }
            });

          await createTelegramIntegration(
            merchant.id
          );

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}-resend@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Delivery Resend Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "Resend Customer",
                telegramChatId:
                  "resend-delivery-chat-123",
                telegramUserId:
                  "resend-delivery-user-123"
              }
            });

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-003",
                status:
                  OrderStatus.FULFILLING,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Resend Recipient",
                deliveryPhone:
                  "0911000000",
                deliveryAddress:
                  "Resend Delivery Address"
              }
            });

          const oldConfirmation =
            createDeliveryConfirmation(
              order.id
            );

          await prisma.order.update({
            where: {
              id: order.id
            },
            data: {
              deliveryConfirmationCodeHash:
                oldConfirmation.codeHash,
              deliveryConfirmationCodeExpiresAt:
              new Date(
                Date.now() - 60_000
              ),
              deliveryConfirmationAttempts:
                3
            }
          });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                }
              }
            );

          expect(
            response.status
          ).toBe(200);

          const body =
            await response.json();

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(1);

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledWith(
            testBotToken,
            customer.telegramChatId,
            expect.stringContaining(
              order.orderNumber
            )
          );

          const telegramText =
            String(
              sendTelegramMessageMock
                .mock.calls[0]?.[2]
            );

          const codeMatch =
            telegramText.match(
              /delivery confirmation code is:\s*(\d{6})/i
            );

          expect(
            codeMatch
          ).not.toBeNull();

          const newPlaintextCode =
            codeMatch![1];

          const storedOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    order.id
                }
              });

          expect(
            storedOrder.status
          ).toBe(
            OrderStatus.FULFILLING
          );

          expect(
            storedOrder
              .deliveryConfirmationAttempts
          ).toBe(0);

          expect(
            storedOrder
              .deliveryConfirmationCodeHash
          ).not.toBe(
            oldConfirmation.codeHash
          );

          expect(
            storedOrder
              .deliveryConfirmationCodeExpiresAt
          ).not.toBeNull();

          expect(
            storedOrder
              .deliveryConfirmationSentAt
          ).not.toBeNull();

          expect(
            verifyDeliveryConfirmationCode(
              order.id,
              newPlaintextCode,
              storedOrder
                .deliveryConfirmationCodeHash!
            )
          ).toBe(true);

          expect(
            verifyDeliveryConfirmationCode(
              order.id,
              oldConfirmation.code,
              storedOrder
                .deliveryConfirmationCodeHash!
            )
          ).toBe(false);

          const responseText =
            JSON.stringify(body);

          expect(
            responseText
          ).not.toContain(
            newPlaintextCode
          );

          expect(
            responseText
          ).not.toContain(
            storedOrder
              .deliveryConfirmationCodeHash!
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeHash"
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationCodeExpiresAt"
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationAttempts"
          );

          expect(
            body.order
          ).not.toHaveProperty(
            "deliveryConfirmationSentAt"
          );

          const audit =
            await prisma.auditLog
              .findFirstOrThrow({
                where: {
                  merchantId:
                    merchant.id,
                  entityId:
                    order.id,
                  action:
                    "DELIVERY_CONFIRMATION_ROTATED"
                }
              });

          expect(
            audit.actorUserId
          ).toBe(
            user.id
          );

          const auditText =
            JSON.stringify(audit);

          expect(
            auditText
          ).not.toContain(
            newPlaintextCode
          );

          expect(
            auditText
          ).not.toContain(
            storedOrder
              .deliveryConfirmationCodeHash!
          );

          expect(
            auditText
          ).not.toContain(
            "Resend Recipient"
          );

          expect(
            auditText
          ).not.toContain(
            "0911000000"
          );

          expect(
            auditText
          ).not.toContain(
            "Resend Delivery Address"
          );

          const secondResendResponse =
          await fetch(
            `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`,
            {
              method:
                "POST",
              headers: {
                authorization:
                  `Bearer ${token}`
              }
            }
          );

        expect(
          secondResendResponse.status
        ).toBe(409);

        expect(
          sendTelegramMessageMock
        ).toHaveBeenCalledTimes(1);

        const afterRejectedResend =
          await prisma.order
            .findUniqueOrThrow({
              where: {
                id:
                  order.id
              }
            });

        expect(
          afterRejectedResend
            .deliveryConfirmationCodeHash
        ).toBe(
          storedOrder
            .deliveryConfirmationCodeHash
        );

        expect(
          afterRejectedResend
            .deliveryConfirmationSentAt
            ?.getTime()
        ).toBe(
          storedOrder
            .deliveryConfirmationSentAt
            ?.getTime()
        );
        }
      );

      it(
        "does not rotate the delivery code when the customer has no Telegram destination",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-no-telegram-merchant`,
                currency:
                  "ETB"
              }
            });

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}-no-telegram@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "No Telegram Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "No Telegram Customer"
              }
            });

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-004",
                status:
                  OrderStatus.FULFILLING,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "No Telegram Recipient",
                deliveryPhone:
                  "0911000000",
                deliveryAddress:
                  "No Telegram Address"
              }
            });

          const confirmation =
            createDeliveryConfirmation(
              order.id
            );

          await prisma.order.update({
            where: {
              id:
                order.id
            },
            data: {
              deliveryConfirmationCodeHash:
                confirmation.codeHash,
              deliveryConfirmationCodeExpiresAt:
                confirmation.expiresAt,
              deliveryConfirmationAttempts:
                2
            }
          });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                }
              }
            );

          expect(
            response.status
          ).toBe(400);

          expect(
            await response.json()
          ).toEqual({
            error:
              "Customer does not have a Telegram chat for delivery confirmation"
          });

          expect(
            sendTelegramMessageMock
          ).not.toHaveBeenCalled();

          const unchangedOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    order.id
                }
              });

          expect(
            unchangedOrder.status
          ).toBe(
            OrderStatus.FULFILLING
          );

          expect(
            unchangedOrder
              .deliveryConfirmationCodeHash
          ).toBe(
            confirmation.codeHash
          );

          expect(
            unchangedOrder
              .deliveryConfirmationCodeExpiresAt
              ?.getTime()
          ).toBe(
            confirmation.expiresAt
              .getTime()
          );

          expect(
            unchangedOrder
              .deliveryConfirmationAttempts
          ).toBe(2);

          expect(
            await prisma.auditLog.count({
              where: {
                merchantId:
                  merchant.id,
                entityId:
                  order.id,
                action:
                  "DELIVERY_CONFIRMATION_ROTATED"
              }
            })
          ).toBe(0);
        }
      );

      it(
        "does not rotate the delivery code after the order is fulfilled",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-fulfilled-resend-merchant`,
                currency:
                  "ETB"
              }
            });

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}-fulfilled-resend@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Fulfilled Resend Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "Fulfilled Customer",
                telegramChatId:
                  "fulfilled-resend-chat",
                telegramUserId:
                  "fulfilled-resend-user"
              }
            });

          const confirmation =
            createDeliveryConfirmation(
              "temporary-order-id"
            );

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-005",
                status:
                  OrderStatus.FULFILLED,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Fulfilled Recipient",
                deliveryPhone:
                  "0911000000",
                deliveryAddress:
                  "Fulfilled Address",
                deliveryConfirmationCodeHash:
                  confirmation.codeHash,
                deliveryConfirmationCodeExpiresAt:
                  confirmation.expiresAt,
                deliveryConfirmationAttempts:
                  2,
                deliveryConfirmedAt:
                  new Date()
              }
            });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                }
              }
            );

          expect(
            response.status
          ).toBe(400);

          expect(
            await response.json()
          ).toEqual({
            error:
              "Order must be FULFILLING before delivery confirmation can be resent"
          });

          expect(
            sendTelegramMessageMock
          ).not.toHaveBeenCalled();

          const unchangedOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    order.id
                }
              });

          expect(
            unchangedOrder.status
          ).toBe(
            OrderStatus.FULFILLED
          );

          expect(
            unchangedOrder
              .deliveryConfirmationCodeHash
          ).toBe(
            confirmation.codeHash
          );

          expect(
            unchangedOrder
              .deliveryConfirmationCodeExpiresAt
              ?.getTime()
          ).toBe(
            confirmation.expiresAt
              .getTime()
          );

          expect(
            unchangedOrder
              .deliveryConfirmationAttempts
          ).toBe(2);

          expect(
            unchangedOrder
              .deliveryConfirmedAt
          ).not.toBeNull();

          expect(
            await prisma.auditLog.count({
              where: {
                merchantId:
                  merchant.id,
                entityId:
                  order.id,
                action:
                  "DELIVERY_CONFIRMATION_ROTATED"
              }
            })
          ).toBe(0);
        }
      );

      it(
        "does not allow one merchant to rotate another merchant's delivery confirmation code",
        async () => {
          const merchantA =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-resend-idor-a`,
                currency:
                  "ETB"
              }
            });

          const merchantB =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-resend-idor-b`,
                currency:
                  "ETB"
              }
            });

          const userA =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchantA.id,
                email:
                  `${testPrefix}-resend-idor-a@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Merchant A Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customerB =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchantB.id,
                name:
                  "Merchant B Customer",
                telegramChatId:
                  "resend-idor-chat-b",
                telegramUserId:
                  "resend-idor-user-b"
              }
            });

          const orderB =
            await prisma.order.create({
              data: {
                merchantId:
                  merchantB.id,
                customerId:
                  customerB.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-006",
                status:
                  OrderStatus.FULFILLING,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Merchant B Recipient",
                deliveryPhone:
                  "0911000000",
                deliveryAddress:
                  "Merchant B Address"
              }
            });

          const confirmation =
            createDeliveryConfirmation(
              orderB.id
            );

          await prisma.order.update({
            where: {
              id:
                orderB.id
            },
            data: {
              deliveryConfirmationCodeHash:
                confirmation.codeHash,
              deliveryConfirmationCodeExpiresAt:
                confirmation.expiresAt,
              deliveryConfirmationAttempts:
                2
            }
          });

          const tokenA =
            createAuthToken({
              id:
                userA.id,
              merchantId:
                merchantA.id,
              role:
                userA.role,
              tokenVersion:
                userA.tokenVersion
            });

          const response =
            await fetch(
              `${apiBaseUrl}/merchants/${merchantB.id}/orders/${orderB.id}/delivery-confirmation/resend`,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${tokenA}`,
                  "content-type":
                    "application/json"
                }
              }
            );

          expect(
            [403, 404]
          ).toContain(
            response.status
          );

          expect(
            sendTelegramMessageMock
          ).not.toHaveBeenCalled();

          const unchangedOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    orderB.id
                }
              });

          expect(
            unchangedOrder.status
          ).toBe(
            OrderStatus.FULFILLING
          );

          expect(
            unchangedOrder
              .deliveryConfirmationCodeHash
          ).toBe(
            confirmation.codeHash
          );

          expect(
            unchangedOrder
              .deliveryConfirmationCodeExpiresAt
              ?.getTime()
          ).toBe(
            confirmation.expiresAt
              .getTime()
          );

          expect(
            unchangedOrder
              .deliveryConfirmationAttempts
          ).toBe(2);

          expect(
            await prisma.auditLog.count({
              where: {
                merchantId:
                  merchantB.id,
                entityId:
                  orderB.id,
                action:
                  "DELIVERY_CONFIRMATION_ROTATED"
              }
            })
          ).toBe(0);
        }
      );

      it(
        "allows only one concurrent delivery confirmation rotation",
        async () => {
          const merchant =
            await prisma.merchant.create({
              data: {
                name:
                  `${testPrefix}-resend-race`,
                currency:
                  "ETB"
              }
            });

          await createTelegramIntegration(
            merchant.id
          );

          const user =
            await prisma.merchantUser.create({
              data: {
                merchantId:
                  merchant.id,
                email:
                  `${testPrefix}-resend-race@example.test`,
                passwordHash:
                  "test-password-hash",
                displayName:
                  "Resend Race Staff",
                role:
                  MerchantUserRole.STAFF,
                tokenVersion:
                  0
              }
            });

          const customer =
            await prisma.customer.create({
              data: {
                merchantId:
                  merchant.id,
                name:
                  "Resend Race Customer",
                telegramChatId:
                  "resend-race-chat",
                telegramUserId:
                  "resend-race-user"
              }
            });

          const order =
            await prisma.order.create({
              data: {
                merchantId:
                  merchant.id,
                customerId:
                  customer.id,
                orderNumber:
                  "FULFILLMENT-TELEGRAM-007",
                status:
                  OrderStatus.FULFILLING,
                currency:
                  "ETB",
                subtotal:
                  "100.00",
                total:
                  "100.00",
                deliveryName:
                  "Resend Race Recipient",
                deliveryPhone:
                  "0911000000",
                deliveryAddress:
                  "Resend Race Address"
              }
            });

          const oldConfirmation =
            createDeliveryConfirmation(
              order.id
            );

          await prisma.order.update({
            where: {
              id:
                order.id
            },
            data: {
              deliveryConfirmationCodeHash:
                oldConfirmation.codeHash,
              deliveryConfirmationCodeExpiresAt:
                new Date(
                  Date.now() + 30 * 60_000
                ),
              deliveryConfirmationAttempts:
                0,
              deliveryConfirmationSentAt:
                null
            }
          });

          const token =
            createAuthToken({
              id:
                user.id,
              merchantId:
                merchant.id,
              role:
                user.role,
              tokenVersion:
                user.tokenVersion
            });

          const url =
            `${apiBaseUrl}/merchants/${merchant.id}/orders/${order.id}/delivery-confirmation/resend`;

          const request = () =>
            fetch(
              url,
              {
                method:
                  "POST",
                headers: {
                  authorization:
                    `Bearer ${token}`,
                  "content-type":
                    "application/json"
                }
              }
            );

          const [
            responseA,
            responseB
          ] =
            await Promise.all([
              request(),
              request()
            ]);

          const statuses = [
            responseA.status,
            responseB.status
          ].sort(
            (a, b) =>
              a - b
          );

          expect(
            statuses
          ).toEqual([
            200,
            409
          ]);

          expect(
            sendTelegramMessageMock
          ).toHaveBeenCalledTimes(1);

          const telegramText =
            String(
              sendTelegramMessageMock
                .mock.calls[0]?.[2]
            );

          const codeMatch =
            telegramText.match(
              /delivery confirmation code is:\s*(\d{6})/i
            );

          expect(
            codeMatch
          ).not.toBeNull();

          const winningCode =
            codeMatch![1];

          const storedOrder =
            await prisma.order
              .findUniqueOrThrow({
                where: {
                  id:
                    order.id
                }
              });

          expect(
            storedOrder.status
          ).toBe(
            OrderStatus.FULFILLING
          );

          expect(
            storedOrder
              .deliveryConfirmationAttempts
          ).toBe(0);

          expect(
            storedOrder
              .deliveryConfirmationCodeHash
          ).not.toBeNull();

          expect(
            storedOrder
              .deliveryConfirmationCodeExpiresAt
          ).not.toBeNull();

          expect(
            storedOrder
              .deliveryConfirmationSentAt
          ).not.toBeNull();

          expect(
            verifyDeliveryConfirmationCode(
              order.id,
              winningCode,
              storedOrder
                .deliveryConfirmationCodeHash!
            )
          ).toBe(true);

          expect(
            await prisma.auditLog.count({
              where: {
                merchantId:
                  merchant.id,
                entityId:
                  order.id,
                action:
                  "DELIVERY_CONFIRMATION_ROTATED"
              }
            })
          ).toBe(1);
        }
      );
    }
  );
