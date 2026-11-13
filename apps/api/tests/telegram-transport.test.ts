import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  sendTelegramMessage,
  setTelegramWebhook,
  TelegramApiError
} from "../src/services/telegram.js";

const TOKEN = "test-bot-token";

function mockResponse(
  status: number,
  payload: unknown
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Telegram transport hardening", () => {
  it("returns a successful message ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        ok: true,
        result: { message_id: 123 }
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendTelegramMessage(TOKEN, "12345", "Hello")
    ).resolves.toBe("123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new Error("Network unavailable")
      )
    );

    await expect(
      sendTelegramMessage(TOKEN, "12345", "Hello")
    ).rejects.toMatchObject({
      kind: "NETWORK"
    });
  });

  it("classifies request timeouts", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;

          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }

          if (signal.aborted) {
            reject(signal.reason);
            return;
          }

          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true }
          );
        })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendTelegramMessage(TOKEN, "12345", "Hello")
    ).rejects.toMatchObject({
      kind: "TIMEOUT"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("classifies HTTP 429 and retry_after", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(429, {
          ok: false,
          parameters: { retry_after: 12 }
        })
      )
    );

    await expect(
      sendTelegramMessage(TOKEN, "12345", "Hello")
    ).rejects.toMatchObject({
      kind: "RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 12
    });
  });

  it.each([
    [400, "BAD_REQUEST"],
    [403, "BOT_BLOCKED"],
    [500, "SERVER_ERROR"],
    [503, "SERVER_ERROR"]
  ] as const)(
    "classifies HTTP %i as %s",
    async (status, kind) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          mockResponse(status, { ok: false })
        )
      );

      await expect(
        sendTelegramMessage(
          TOKEN,
          "12345",
          "Hello"
        )
      ).rejects.toMatchObject({
        kind,
        status
      });
    }
  );

  it("rejects malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(
          new SyntaxError("Invalid JSON")
        )
      })
    );

    await expect(
      sendTelegramMessage(TOKEN, "12345", "Hello")
    ).rejects.toMatchObject({
      kind: "INVALID_RESPONSE"
    });
  });

  it("rejects missing API result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, { ok: true })
      )
    );

    await expect(
      sendTelegramMessage(TOKEN, "12345", "Hello")
    ).rejects.toMatchObject({
      kind: "INVALID_RESPONSE"
    });
  });

  it("preserves false-result validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          ok: true,
          result: false
        })
      )
    );

    await expect(
      setTelegramWebhook(
        TOKEN,
        "https://example.com/webhook",
        "test-secret"
      )
    ).rejects.toThrow(
      "Telegram setWebhook returned an invalid response"
    );
  });

  it("does not automatically retry failed sends", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(503, { ok: false })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendTelegramMessage(TOKEN, "12345", "Hello")
    ).rejects.toBeInstanceOf(TelegramApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});