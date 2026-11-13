import {
  TelegramApiError
} from "./telegram.js";

export type BillingTelegramOutcome =
  | {
      kind: "ACCEPTED";
      telegramMessageId: string;
    }
  | {
      kind: "PERMANENT_FAILURE";
      reason: "BOT_BLOCKED" | "BAD_REQUEST";
    }
  | {
      kind: "TRANSIENT_FAILURE";
      reason: "RATE_LIMITED";
      retryAfterSeconds: number | null;
    }
  | {
      kind: "AMBIGUOUS";
      reason:
        | "TIMEOUT"
        | "NETWORK"
        | "SERVER_ERROR"
        | "INVALID_RESPONSE"
        | "API_ERROR"
        | "UNKNOWN_ERROR"
        | "INVALID_MESSAGE_ID";
    };

export function classifyBillingTelegramSuccess(
  messageId: unknown
): BillingTelegramOutcome {
  if (
    typeof messageId !== "string" ||
    !/^[1-9][0-9]*$/.test(messageId)
  ) {
    return {
      kind: "AMBIGUOUS",
      reason: "INVALID_MESSAGE_ID"
    };
  }

  return {
    kind: "ACCEPTED",
    telegramMessageId: messageId
  };
}

export function classifyBillingTelegramError(
  error: unknown
): BillingTelegramOutcome {
  if (!(error instanceof TelegramApiError)) {
    return {
      kind: "AMBIGUOUS",
      reason: "UNKNOWN_ERROR"
    };
  }

  switch (error.kind) {
    case "BOT_BLOCKED":
      return {
        kind: "PERMANENT_FAILURE",
        reason: "BOT_BLOCKED"
      };

    case "BAD_REQUEST":
      return {
        kind: "PERMANENT_FAILURE",
        reason: "BAD_REQUEST"
      };

    case "RATE_LIMITED":
      return {
        kind: "TRANSIENT_FAILURE",
        reason: "RATE_LIMITED",
        retryAfterSeconds:
          error.retryAfterSeconds !== null &&
          Number.isSafeInteger(error.retryAfterSeconds) &&
          error.retryAfterSeconds >= 0
            ? error.retryAfterSeconds
            : null
      };

    case "TIMEOUT":
    case "NETWORK":
    case "SERVER_ERROR":
    case "INVALID_RESPONSE":
    case "API_ERROR":
      return {
        kind: "AMBIGUOUS",
        reason: error.kind
      };

    default:
      return {
        kind: "AMBIGUOUS",
        reason: "UNKNOWN_ERROR"
      };
  }
}
