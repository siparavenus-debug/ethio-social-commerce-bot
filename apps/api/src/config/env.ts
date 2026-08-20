import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(
    process.cwd(),
    ".env"
  )
});

const port = Number(
  process.env.API_PORT ?? "3000"
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("API_PORT must be a valid TCP port.");
}

const authSecret =
  process.env.AUTH_SECRET?.trim();

if (!authSecret || authSecret.length < 32) {
  throw new Error(
    "AUTH_SECRET must be configured and contain at least 32 characters."
  );
}

const authTokenTtlSeconds =
  Number(
    process.env.AUTH_TOKEN_TTL_SECONDS ??
      "86400"
  );

if (
  !Number.isInteger(authTokenTtlSeconds) ||
  authTokenTtlSeconds < 300 ||
  authTokenTtlSeconds > 604800
) {
  throw new Error(
    "AUTH_TOKEN_TTL_SECONDS must be an integer between 300 and 604800."
  );
}

export const env = {
  nodeEnv:
    process.env.NODE_ENV ??
    "development",

  apiPort: port,

  anthropicApiKey:
    process.env.ANTHROPIC_API_KEY,

  geminiApiKey:
    process.env.GEMINI_API_KEY,

  telegramBotToken:
    process.env.TELEGRAM_BOT_TOKEN,

  telegramWebhookSecret:
    process.env.TELEGRAM_WEBHOOK_SECRET,

  telegramMerchantId:
    process.env.TELEGRAM_MERCHANT_ID,

  authSecret,

  authTokenTtlSeconds
} as const;