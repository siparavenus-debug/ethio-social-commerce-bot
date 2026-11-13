import { describe, expect, it } from "vitest";

import {
  TelegramApiError
} from "../src/services/telegram.js";

import {
  classifyBillingTelegramError,
  classifyBillingTelegramSuccess
} from "../src/services/platform-billing-notification-outcome.js";

describe("B6.4 Telegram outcome classification", () => {
  it("accepts a valid Telegram message ID", () => {
    expect(
      classifyBillingTelegramSuccess("12345")
    ).toEqual({
      kind: "ACCEPTED",
      telegramMessageId: "12345"
    });
  });

  it.each([
    null,
    undefined,
    "",
    "0",
    "-1",
    "abc",
    123,
    "12.5"
  ])("treats invalid message ID %s as ambiguous", (value) => {
    expect(
      classifyBillingTelegramSuccess(value)
    ).toEqual({
      kind: "AMBIGUOUS",
      reason: "INVALID_MESSAGE_ID"
    });
  });

  it.each([
    ["BOT_BLOCKED", 403],
    ["BAD_REQUEST", 400]
  ] as const)("classifies %s as permanent", (kind, status) => {
    expect(
      classifyBillingTelegramError(
        new TelegramApiError(kind, status)
      )
    ).toEqual({
      kind: "PERMANENT_FAILURE",
      reason: kind
    });
  });

  it("preserves a valid Telegram retry_after", () => {
    expect(
      classifyBillingTelegramError(
        new TelegramApiError("RATE_LIMITED", 429, 30)
      )
    ).toEqual({
      kind: "TRANSIENT_FAILURE",
      reason: "RATE_LIMITED",
      retryAfterSeconds: 30
    });
  });

  it.each([
    null,
    -1,
    1.5,
    Number.POSITIVE_INFINITY
  ])("rejects invalid retry_after %s", (value) => {
    expect(
      classifyBillingTelegramError(
        new TelegramApiError("RATE_LIMITED", 429, value)
      )
    ).toEqual({
      kind: "TRANSIENT_FAILURE",
      reason: "RATE_LIMITED",
      retryAfterSeconds: null
    });
  });

  it.each([
    "TIMEOUT",
    "NETWORK",
    "SERVER_ERROR",
    "INVALID_RESPONSE",
    "API_ERROR"
  ] as const)("classifies %s as ambiguous", (kind) => {
    expect(
      classifyBillingTelegramError(
        new TelegramApiError(kind)
      )
    ).toEqual({
      kind: "AMBIGUOUS",
      reason: kind
    });
  });

  it("classifies unknown exceptions conservatively", () => {
    expect(
      classifyBillingTelegramError(
        new Error("synthetic sensitive error")
      )
    ).toEqual({
      kind: "AMBIGUOUS",
      reason: "UNKNOWN_ERROR"
    });
  });
});
