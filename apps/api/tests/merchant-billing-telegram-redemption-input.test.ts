
import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";

import {
  validateBillingTelegramRedemptionInput
} from "../src/services/merchant-billing-telegram-redemption-input.js";

describe("billing Telegram redemption input", () => {
  const token = randomBytes(32).toString("base64url");

  const validInput = {
    text: `/start ${token}`,
    chatType: "private",
    chatId: 123456789,
    senderId: 123456789
  };

  it("accepts a valid private-chat redemption", () => {
    const result = validateBillingTelegramRedemptionInput(
      validInput
    );

    expect(result).toEqual({
      ok: true,
      value: {
        tokenHash: createHash("sha256")
          .update(token)
          .digest("hex"),
        chatId: "123456789",
        telegramUserId: "123456789"
      }
    });

    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each([
    { text: "/start" },
    { text: `/start ${token} extra` },
    { text: `/START ${token}` },
    { text: `/start invalid!` },
    { text: `/start ${token}=` },
    { text: `/start ${token.slice(0, -1)}` },
    { chatType: "group" },
    { chatType: "supergroup" },
    { chatType: "channel" },
    { chatType: undefined },
    { chatId: 0 },
    { chatId: -1 },
    { chatId: 1.5 },
    { chatId: Number.MAX_SAFE_INTEGER + 1 },
    { senderId: undefined },
    { senderId: 987654321 },
    { senderId: "00123456789" },
    { senderId: "1e3" }
  ])("rejects invalid redemption input %#", (override) => {
    expect(
      validateBillingTelegramRedemptionInput({
        ...validInput,
        ...override
      })
    ).toEqual({
      ok: false,
      reason: "INVALID_INPUT"
    });
  });

  it("accepts canonical decimal-string Telegram IDs", () => {
    const result = validateBillingTelegramRedemptionInput({
      ...validInput,
      chatId: "123456789",
      senderId: "123456789"
    });

    expect(result.ok).toBe(true);
  });

  it("produces a deterministic token hash", () => {
    const first = validateBillingTelegramRedemptionInput(
      validInput
    );
    const second = validateBillingTelegramRedemptionInput(
      validInput
    );

    expect(first).toEqual(second);
  });


  it.each([
    null,
    undefined,
    "",
    0,
    false,
    [],
    ["/start"],
    {}
  ])("rejects malformed runtime input %#", (input) => {
    expect(
      validateBillingTelegramRedemptionInput(input)
    ).toEqual({
      ok: false,
      reason: "INVALID_INPUT"
    });
  });

  it("rejects noncanonical base64url final characters", () => {
    const canonicalToken = "A".repeat(42) + "A";

    // B is not a valid final character for a
    // canonical 32-byte base64url token.
    const noncanonicalToken = canonicalToken.slice(0, -1) + "B";

    expect(
      validateBillingTelegramRedemptionInput({
        ...validInput,
        text: `/start ${canonicalToken}`
      }).ok
    ).toBe(true);

    expect(
      validateBillingTelegramRedemptionInput({
        ...validInput,
        text: `/start ${noncanonicalToken}`
      })
    ).toEqual({
      ok: false,
      reason: "INVALID_INPUT"
    });
  });

  it("accepts equivalent numeric and string Telegram IDs", () => {
    const result = validateBillingTelegramRedemptionInput({
      ...validInput,
      chatId: "123456789",
      senderId: 123456789
    });

    expect(result.ok).toBe(true);
  });

  it("rejects malformed Telegram ID strings", () => {
    for (const chatId of [
      "0",
      "-1",
      "+123",
      "00123",
      "1.5",
      "1e3",
      "9007199254740992",
      " 123 "
    ]) {
      expect(
        validateBillingTelegramRedemptionInput({
          ...validInput,
          chatId
        })
      ).toEqual({
        ok: false,
        reason: "INVALID_INPUT"
      });
    }
  });

});
