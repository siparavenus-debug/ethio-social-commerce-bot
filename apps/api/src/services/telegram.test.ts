import {
    afterEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    deleteTelegramWebhook,
    downloadTelegramFile,
    getTelegramBotIdentity,
    getTelegramWebhookInfo,
    setTelegramWebhook
  } from "./telegram.js";

  function mockTelegramResponse(
    result: unknown
  ) {
    return vi.spyOn(
      globalThis,
      "fetch"
    ).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result
        }),
        {
          status: 200,
          headers: {
            "content-type":
              "application/json"
          }
        }
      )
    );
  }

  describe(
    "Telegram service",
    () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it(
        "validates a bot token and returns safe bot identity",
        async () => {
          const fetchMock =
            mockTelegramResponse({
              id: 123456789,
              is_bot: true,
              first_name: "Shop Bot",
              username: "shop_bot"
            });

          await expect(
            getTelegramBotIdentity(
              "test-bot-token"
            )
          ).resolves.toEqual({
            id: 123456789,
            username: "shop_bot",
            firstName: "Shop Bot"
          });

          expect(fetchMock).toHaveBeenCalledWith(
            "https://api.telegram.org/bottest-bot-token/getMe",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json"
              },
              body: "{}"
            }
          );
        }
      );

      it(
        "registers a Telegram webhook with its secret token",
        async () => {
          const fetchMock =
            mockTelegramResponse(true);

          await expect(
            setTelegramWebhook(
              "test-bot-token",
              "https://api.example.com/webhooks/telegram/webhook-key",
              "webhook-secret"
            )
          ).resolves.toBeUndefined();

          expect(fetchMock).toHaveBeenCalledWith(
            "https://api.telegram.org/bottest-bot-token/setWebhook",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json"
              },
              body: JSON.stringify({
                url: "https://api.example.com/webhooks/telegram/webhook-key",
                secret_token:
                  "webhook-secret"
              })
            }
          );
        }
      );

      it(
        "deletes a Telegram webhook",
        async () => {
          const fetchMock =
            mockTelegramResponse(true);

          await expect(
            deleteTelegramWebhook(
              "test-bot-token"
            )
          ).resolves.toBeUndefined();

          expect(fetchMock).toHaveBeenCalledWith(
            "https://api.telegram.org/bottest-bot-token/deleteWebhook",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json"
              },
              body: "{}"
            }
          );
        }
      );

      it(
        "returns Telegram webhook status information",
        async () => {
          mockTelegramResponse({
            url: "https://api.example.com/webhooks/telegram/webhook-key",
            pending_update_count: 3,
            last_error_date: 123456,
            last_error_message:
              "Example error"
          });

          await expect(
            getTelegramWebhookInfo(
              "test-bot-token"
            )
          ).resolves.toEqual({
            url: "https://api.example.com/webhooks/telegram/webhook-key",
            pendingUpdateCount: 3,
            lastErrorDate: 123456,
            lastErrorMessage:
              "Example error"
          });
        }
      );

      it(
        "rejects an invalid getMe response",
        async () => {
          mockTelegramResponse({
            id: 123456789,
            is_bot: false,
            first_name: "Not A Bot"
          });

          await expect(
            getTelegramBotIdentity(
              "test-bot-token"
            )
          ).rejects.toThrow(
            "Telegram getMe returned an invalid bot response"
          );
        }
      );

      it(
        "surfaces Telegram API failures without exposing the bot token",
        async () => {
          vi.spyOn(
            globalThis,
            "fetch"
          ).mockResolvedValue(
            new Response(
              JSON.stringify({
                ok: false,
                description:
                  "Unauthorized"
              }),
              {
                status: 401,
                statusText:
                  "Unauthorized",
                headers: {
                  "content-type":
                    "application/json"
                }
              }
            )
          );

          let caughtError: unknown;

          try {
            await getTelegramBotIdentity(
              "super-secret-bot-token"
            );
          } catch (error) {
            caughtError = error;
          }

          expect(caughtError).toBeInstanceOf(
            Error
          );

          expect(
            (caughtError as Error).message
          ).toContain(
            "Telegram API getMe failed: Unauthorized"
          );

          expect(
            (caughtError as Error).message
          ).not.toContain(
            "super-secret-bot-token"
          );
        }
      );

      it(
        "sanitizes Telegram network failures without exposing the bot token",
        async () => {
          vi.spyOn(
            globalThis,
            "fetch"
          ).mockRejectedValueOnce(
            new Error(
              "fetch failed for https://api.telegram.org/botsuper-secret-bot-token/getMe"
            )
          );

          let caughtError: unknown;

          try {
            await getTelegramBotIdentity(
              "super-secret-bot-token"
            );
          } catch (error) {
            caughtError = error;
          }

          expect(caughtError).toBeInstanceOf(
            Error
          );

          expect(
            (caughtError as Error).message
          ).toBe(
            "Telegram API getMe request failed"
          );

          expect(
            (caughtError as Error).message
          ).not.toContain(
            "super-secret-bot-token"
          );
        }
      );

      it(
        "sanitizes Telegram file download network failures without exposing the bot token",
        async () => {
          vi.spyOn(
            globalThis,
            "fetch"
          ).mockRejectedValueOnce(
            new Error(
              "fetch failed for https://api.telegram.org/file/botsuper-secret-bot-token/receipts/test.jpg"
            )
          );

          let caughtError: unknown;

          try {
            await downloadTelegramFile(
              "super-secret-bot-token",
              "receipts/test.jpg"
            );
          } catch (error) {
            caughtError = error;
          }

          expect(caughtError).toBeInstanceOf(
            Error
          );

          expect(
            (caughtError as Error).message
          ).toBe(
            "Telegram file download request failed"
          );

          expect(
            (caughtError as Error).message
          ).not.toContain(
            "super-secret-bot-token"
          );
        }
      );
    }
  );
