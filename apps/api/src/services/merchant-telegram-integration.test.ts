import {
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    MerchantTelegramIntegrationStatus,
    prisma
  } from "@ethio-commerce/database";

  import {
    encryptTelegramCredential
  } from "./telegram-credential-encryption.js";

  import {
    getActiveMerchantTelegramBotToken,
    getActiveMerchantTelegramWebhookIntegration
  } from "./merchant-telegram-integration.js";

  vi.mock(
    "@ethio-commerce/database",
    async () => {
      const actual =
        await vi.importActual<
          typeof import("@ethio-commerce/database")
        >(
          "@ethio-commerce/database"
        );

      return {
        ...actual,
        prisma: {
          merchantTelegramIntegration: {
            findFirst: vi.fn()
          }
        }
      };
    }
  );

  const findFirst =
    vi.mocked(
      prisma.merchantTelegramIntegration.findFirst
    );

  describe(
    "merchant Telegram integration resolver",
    () => {
      beforeEach(() => {
        vi.clearAllMocks();
      });

      it(
        "resolves the active merchant bot token",
        async () => {
          const botToken =
            "123456789:merchant-bot-token";

          findFirst.mockResolvedValueOnce({
            botTokenEncrypted:
              encryptTelegramCredential(
                botToken
              )
          } as never);

          await expect(
            getActiveMerchantTelegramBotToken(
              "merchant-1"
            )
          ).resolves.toBe(botToken);

          expect(findFirst)
            .toHaveBeenCalledWith({
              where: {
                merchantId: "merchant-1",
                status:
                  MerchantTelegramIntegrationStatus.ACTIVE
              },
              select: {
                botTokenEncrypted: true
              }
            });
        }
      );

      it(
        "rejects when the merchant has no active Telegram integration",
        async () => {
          findFirst.mockResolvedValueOnce(
            null
          );

          await expect(
            getActiveMerchantTelegramBotToken(
              "merchant-1"
            )
          ).rejects.toThrow(
            "Active merchant Telegram integration not found"
          );

          expect(findFirst)
            .toHaveBeenCalledWith({
              where: {
                merchantId: "merchant-1",
                status:
                  MerchantTelegramIntegrationStatus.ACTIVE
              },
              select: {
                botTokenEncrypted: true
              }
            });
        }
      );

      it(
        "resolves an active webhook integration and decrypts its credentials",
        async () => {
          const botToken =
            "123456789:merchant-bot-token";

          const webhookSecret =
            "merchant-webhook-secret";

          findFirst.mockResolvedValueOnce({
            merchantId: "merchant-1",
            botTokenEncrypted:
              encryptTelegramCredential(
                botToken
              ),
            webhookSecretEncrypted:
              encryptTelegramCredential(
                webhookSecret
              )
          } as never);

          await expect(
            getActiveMerchantTelegramWebhookIntegration(
              "webhook-key-1"
            )
          ).resolves.toEqual({
            merchantId: "merchant-1",
            botToken,
            webhookSecret
          });

          expect(findFirst)
            .toHaveBeenCalledWith({
              where: {
                webhookKey:
                  "webhook-key-1",
                status:
                  MerchantTelegramIntegrationStatus.ACTIVE
              },
              select: {
                merchantId: true,
                botTokenEncrypted: true,
                webhookSecretEncrypted: true
              }
            });
        }
      );

      it(
        "returns null when the webhook key has no active integration",
        async () => {
          findFirst.mockResolvedValueOnce(
            null
          );

          await expect(
            getActiveMerchantTelegramWebhookIntegration(
              "webhook-key-1"
            )
          ).resolves.toBeNull();

          expect(findFirst)
            .toHaveBeenCalledWith({
              where: {
                webhookKey:
                  "webhook-key-1",
                status:
                  MerchantTelegramIntegrationStatus.ACTIVE
              },
              select: {
                merchantId: true,
                botTokenEncrypted: true,
                webhookSecretEncrypted: true
              }
            });
        }
      );
    }
  );
