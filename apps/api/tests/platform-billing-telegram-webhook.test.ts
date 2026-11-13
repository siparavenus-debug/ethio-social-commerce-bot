
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

const mocks = vi.hoisted(() => ({
  findBot: vi.fn(),
  queryRaw: vi.fn(),
  updateEvent: vi.fn(),
  decrypt: vi.fn(),
  validate: vi.fn(),
  redeem: vi.fn(),
  sendMessage: vi.fn()
}));

const testSecret =
  "b35-webhook-test-secret-2026-isolated";

vi.mock("../src/config/env.js", () => ({
  env: {
    platformBillingTelegramWebhookSecret:
      "b35-webhook-test-secret-2026-isolated"
  }
}));

vi.mock("@ethio-commerce/database", () => ({
  prisma: {
    platformBillingTelegramBot: {
      findUnique: mocks.findBot
    },
    platformBillingTelegramWebhookEvent: {
      updateMany: mocks.updateEvent
    },
    $queryRaw: mocks.queryRaw
  }
}));

vi.mock(
  "../src/services/telegram-credential-encryption.js",
  () => ({
    decryptTelegramCredential: mocks.decrypt
  })
);

vi.mock(
  "../src/services/merchant-billing-telegram-redemption-input.js",
  () => ({
    validateBillingTelegramRedemptionInput:
      mocks.validate
  })
);

vi.mock(
  "../src/services/merchant-billing-telegram-redemption.js",
  () => ({
    redeemBillingTelegramLink: mocks.redeem
  })
);

vi.mock("../src/services/telegram.js", () => ({
  sendTelegramMessage: mocks.sendMessage
}));

import webhookRouter from
  "../src/routes/platform-billing-telegram.js";

describe("B3.5 platform billing Telegram webhook", () => {
  let server: Server;
  let baseUrl: string;

  const webhookKey = "b35-test-webhook-key";

  const bot = {
    id: "b35-test-platform-bot",
    status: "ACTIVE",
    webhookSecretEncrypted: "encrypted-secret",
    botTokenEncrypted: "encrypted-token"
  };

  beforeAll(async () => {
    const app = express();

    app.use(express.json());

    app.use(
      "/platform-billing-telegram",
      webhookRouter
    );

    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(
        0,
        "127.0.0.1",
        () => resolve(listeningServer)
      );
    });

    const address =
      server.address() as AddressInfo;

    baseUrl =
      `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  beforeEach(() => {
    vi.resetAllMocks();

    mocks.findBot.mockResolvedValue(bot);

    mocks.decrypt.mockReturnValue(testSecret);

    mocks.validate.mockReturnValue({
      ok: false,
      reason: "INVALID_INPUT"
    });
  });

  async function postUpdate(
    body: unknown,
    secret?: string
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    if (secret !== undefined) {
      headers["x-telegram-bot-api-secret-token"] =
        secret;
    }

    return fetch(
      `${baseUrl}/platform-billing-telegram/${webhookKey}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      }
    );
  }

  const validEnvelope = {
    update_id: 123456,
    message: {
      text: "/start example",
      chat: {
        id: 12345,
        type: "private"
      },
      from: {
        id: 67890
      }
    }
  };

  it("rejects requests without the webhook secret", async () => {
    const response = await postUpdate(
      validEnvelope
    );

    expect(response.status).toBe(401);

    expect(mocks.findBot)
      .not.toHaveBeenCalled();

    expect(mocks.queryRaw)
      .not.toHaveBeenCalled();

    expect(mocks.updateEvent)
      .not.toHaveBeenCalled();
  });

  it("rejects incorrect webhook secrets", async () => {
    const response = await postUpdate(
      validEnvelope,
      "incorrect-webhook-secret"
    );

    expect(response.status).toBe(401);

    expect(mocks.findBot)
      .not.toHaveBeenCalled();

    expect(mocks.queryRaw)
      .not.toHaveBeenCalled();

    expect(mocks.updateEvent)
      .not.toHaveBeenCalled();
  });

  it("rejects unknown webhook keys", async () => {
    mocks.findBot.mockResolvedValue(null);

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(404);

    expect(mocks.queryRaw)
      .not.toHaveBeenCalled();
  });

  it("rejects inactive platform bots", async () => {
    mocks.findBot.mockResolvedValue({
      ...bot,
      status: "INACTIVE"
    });

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(404);

    expect(mocks.queryRaw)
      .not.toHaveBeenCalled();
  });

  it("rejects mismatched stored webhook secrets", async () => {
    mocks.decrypt.mockReturnValue(
      "different-stored-secret"
    );

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(503);

    expect(mocks.queryRaw)
      .not.toHaveBeenCalled();
  });

  it("rejects malformed Telegram updates", async () => {
    const response = await postUpdate(
      {
        update_id: "invalid",
        message: {}
      },
      testSecret
    );

    expect(response.status).toBe(400);

    expect(mocks.validate)
      .not.toHaveBeenCalled();

    expect(mocks.queryRaw)
      .not.toHaveBeenCalled();
  });

  it("acknowledges invalid redemption input without claiming an event", async () => {
    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(200);

    expect(mocks.validate)
      .toHaveBeenCalledOnce();

    expect(mocks.queryRaw)
      .not.toHaveBeenCalled();

    expect(mocks.redeem)
      .not.toHaveBeenCalled();

    expect(mocks.sendMessage)
      .not.toHaveBeenCalled();
  });


  it("acknowledges duplicate updates without redeeming or sending", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    mocks.queryRaw.mockResolvedValue([]);

    mocks.updateEvent.mockResolvedValue({
      count: 0
    });

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(200);

    expect(mocks.queryRaw)
      .toHaveBeenCalledOnce();

    expect(mocks.updateEvent)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            platformBotId: bot.id,
            telegramUpdateId: "123456",
            status: "PROCESSING"
          }),
          data: expect.objectContaining({
            status: "REVIEW_REQUIRED",
            terminalReason:
              "PROCESSING_OUTCOME_UNCERTAIN"
          })
        })
      );

    expect(mocks.redeem)
      .not.toHaveBeenCalled();

    expect(mocks.sendMessage)
      .not.toHaveBeenCalled();
  });

  it("processes concurrent duplicate webhook requests at most once", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    let claimCount = 0;

    mocks.queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      const statement = sql.join(" ");

      if (statement.includes('INSERT INTO "PlatformBillingTelegramWebhookEvent"')) {
        claimCount += 1;

        return claimCount === 1
          ? [{ id: "test-webhook-event" }]
          : [];
      }

      if (
        statement.includes('UPDATE "PlatformBillingTelegramWebhookEvent"') &&
        statement.includes('"sanitizedPayload"')
      ) {
        return [{ id: "test-webhook-event" }];
      }

      throw new Error("Unexpected webhook SQL operation");
    });

    mocks.updateEvent.mockResolvedValue({
      count: 0
    });

    mocks.redeem.mockResolvedValue({
      ok: true
    });

    mocks.decrypt.mockImplementation((value: string) =>
      value === "encrypted-token"
        ? "test-bot-token"
        : testSecret
    );

    mocks.sendMessage.mockResolvedValue(
      "test-message-123"
    );

    const responses = await Promise.all([
      postUpdate(validEnvelope, testSecret),
      postUpdate(validEnvelope, testSecret)
    ]);

    expect(responses.map(response => response.status))
      .toEqual([200, 200]);

    expect(mocks.redeem)
      .toHaveBeenCalledOnce();

    expect(mocks.sendMessage)
      .toHaveBeenCalledOnce();

    expect(mocks.updateEvent)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            platformBotId: bot.id,
            telegramUpdateId: "123456",
            status: "PROCESSING"
          }),
          data: expect.objectContaining({
            status: "REVIEW_REQUIRED",
            terminalReason:
              "PROCESSING_OUTCOME_UNCERTAIN"
          })
        })
      );
  });
  it("records rejected redemption without sending confirmation", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    mocks.queryRaw.mockResolvedValue([
      { id: "test-webhook-event" }
    ]);

    mocks.redeem.mockResolvedValue({
      ok: false,
      reason: "TOKEN_INVALID"
    });

    mocks.updateEvent.mockResolvedValue({
      count: 1
    });

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(200);

    expect(mocks.redeem)
      .toHaveBeenCalledOnce();

    expect(mocks.updateEvent)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "test-webhook-event",
            status: "PROCESSING"
          }),
          data: expect.objectContaining({
            status: "REJECTED",
            terminalReason: "TOKEN_INVALID"
          })
        })
      );

    expect(mocks.sendMessage)
      .not.toHaveBeenCalled();
  });

  it("returns 503 when rejected redemption cannot be completed", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    mocks.queryRaw.mockResolvedValue([
      { id: "test-webhook-event" }
    ]);

    mocks.redeem.mockResolvedValue({
      ok: false,
      reason: "TOKEN_INVALID"
    });

    mocks.updateEvent.mockResolvedValue({
      count: 0
    });

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(503);

    expect(mocks.sendMessage)
      .not.toHaveBeenCalled();
  });


  it("reserves confirmation and records successful Telegram delivery", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    mocks.queryRaw
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ])
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ])
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ]);

    mocks.redeem.mockResolvedValue({
      ok: true
    });

    mocks.decrypt
      .mockReturnValueOnce(testSecret)
      .mockReturnValueOnce("test-bot-token");

    mocks.sendMessage.mockResolvedValue(
      "test-message-123"
    );

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(200);

    expect(mocks.redeem)
      .toHaveBeenCalledOnce();

    expect(mocks.queryRaw)
      .toHaveBeenCalledTimes(3);

    const webhookSqlStatements =
      mocks.queryRaw.mock.calls.map(
        (call) => call[0].join(" ")
      );

    for (const statement of webhookSqlStatements) {
      expect(statement)
        .not.toMatch(/\b(?:FROM|JOIN|INTO|UPDATE)\s+"?(?:Customer|Order|Payment)"?\b/i);
    }

    const successOutcomeCall =
      mocks.queryRaw.mock.calls[2];

    const successOutcomeSql =
      successOutcomeCall[0].join(" ");

    expect(successOutcomeSql)
      .toContain("confirmationMessageId");

    expect(successOutcomeCall)
      .toContain("SENT");

    expect(successOutcomeCall)
      .toContain("test-message-123");

    expect(mocks.sendMessage)
      .toHaveBeenCalledWith(
        "test-bot-token",
        "12345",
        "Your billing Telegram connection is now active."
      );

    const reserveOrder =
      mocks.queryRaw.mock.invocationCallOrder[1];

    const sendOrder =
      mocks.sendMessage.mock.invocationCallOrder[0];

    const recordOrder =
      mocks.queryRaw.mock.invocationCallOrder[2];

    expect(reserveOrder).toBeLessThan(sendOrder);
    expect(sendOrder).toBeLessThan(recordOrder);
  });

  it("does not send confirmation when reservation fails", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    mocks.queryRaw
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ])
      .mockResolvedValueOnce([]);

    mocks.redeem.mockResolvedValue({
      ok: true
    });

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(503);

    expect(mocks.queryRaw)
      .toHaveBeenCalledTimes(2);

    expect(mocks.sendMessage)
      .not.toHaveBeenCalled();
  });


  it("records REVIEW_REQUIRED when Telegram delivery fails", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    mocks.queryRaw
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ])
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ])
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ]);

    mocks.redeem.mockResolvedValue({
      ok: true
    });

    mocks.decrypt
      .mockReturnValueOnce(testSecret)
      .mockReturnValueOnce("test-bot-token");

    mocks.sendMessage.mockRejectedValue(
      new Error("Telegram delivery unavailable")
    );

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(503);

    expect(mocks.queryRaw)
      .toHaveBeenCalledTimes(3);

    const outcomeQuery =
      mocks.queryRaw.mock.calls[2][0];

    const outcomeSql =
      outcomeQuery.join(" ");

    expect(outcomeSql)
      .toContain("confirmationStatus");

    expect(mocks.queryRaw.mock.calls[2])
      .toContain("REVIEW_REQUIRED");

    expect(mocks.sendMessage)
      .toHaveBeenCalledOnce();
  });

  it("does not resend when confirmation recording fails", async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        tokenHash: "test-token-hash",
        chatId: "12345",
        telegramUserId: "67890"
      }
    });

    mocks.queryRaw
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ])
      .mockResolvedValueOnce([
        { id: "test-webhook-event" }
      ])
      .mockResolvedValueOnce([]);

    mocks.redeem.mockResolvedValue({
      ok: true
    });

    mocks.decrypt
      .mockReturnValueOnce(testSecret)
      .mockReturnValueOnce("test-bot-token");

    mocks.sendMessage.mockResolvedValue(
      "test-message-123"
    );

    const response = await postUpdate(
      validEnvelope,
      testSecret
    );

    expect(response.status).toBe(503);

    expect(mocks.queryRaw)
      .toHaveBeenCalledTimes(3);

    expect(mocks.sendMessage)
      .toHaveBeenCalledOnce();
  });

});
