
import { createHash } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const TELEGRAM_ID_PATTERN = /^[1-9][0-9]*$/;

export type BillingTelegramRedemptionInput = {
  text: unknown;
  chatType: unknown;
  chatId: unknown;
  senderId: unknown;
};

export type ValidatedBillingTelegramRedemption = {
  tokenHash: string;
  chatId: string;
  telegramUserId: string;
};

export type BillingTelegramRedemptionInputResult =
  | {
      ok: true;
      value: ValidatedBillingTelegramRedemption;
    }
  | {
      ok: false;
      reason: "INVALID_INPUT";
    };

function normalizeTelegramId(value: unknown): string | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  if (
    typeof value === "string" &&
    TELEGRAM_ID_PATTERN.test(value)
  ) {
    const parsed = Number(value);

    if (
      Number.isSafeInteger(parsed) &&
      parsed > 0
    ) {
      return value;
    }
  }

  return null;
}

export function validateBillingTelegramRedemptionInput(
    input: unknown
  ): BillingTelegramRedemptionInputResult {
    const invalid = {
      ok: false as const,
      reason: "INVALID_INPUT" as const
    };

    // Reject malformed runtime values without throwing.
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      return invalid;
    }

    const candidate =
      input as Partial<BillingTelegramRedemptionInput>;

    if (
      typeof candidate.text !== "string" ||
      candidate.chatType !== "private"
    ) {
      return invalid;
    }

    const match = /^\/start ([A-Za-z0-9_-]{43})$/.exec(
      candidate.text
    );

    if (!match) {
      return invalid;
    }

    const token = match[1];

    if (!TOKEN_PATTERN.test(token)) {
      return invalid;
    }

    const chatId = normalizeTelegramId(candidate.chatId);
    const senderId = normalizeTelegramId(candidate.senderId);

    if (
      chatId === null ||
      senderId === null ||
      chatId !== senderId
    ) {
      return invalid;
    }

    const tokenHash = createHash("sha256")
      .update(token)
      .digest("hex");

    return {
      ok: true,
      value: {
        tokenHash,
        chatId,
        telegramUserId: senderId
      }
    };
  }
