import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(
    process.cwd(),
    ".env"
  ),
  override: true
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

const r2AccountId = process.env.R2_ACCOUNT_ID?.trim();
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
const r2BucketName = process.env.R2_BUCKET_NAME?.trim();
const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();

const r2Configured = Boolean(
  r2AccountId &&
  r2AccessKeyId &&
  r2SecretAccessKey &&
  r2BucketName &&
  r2PublicBaseUrl
);

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

  authTokenTtlSeconds,

  r2AccountId,
  r2AccessKeyId,
  r2SecretAccessKey,
  r2BucketName,
  r2PublicBaseUrl,
  r2Configured
} as const;