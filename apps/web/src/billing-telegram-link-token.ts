
export type BillingTelegramLinkTokenResult = {
    token: string;
    expiresAt: string;
  };

  const MAX_TOKEN_LIFETIME_MS = 10 * 60 * 1000;

  export function validateBillingTelegramLinkTokenResponse(
    value: unknown,
    nowMs: number = Date.now()
  ): BillingTelegramLinkTokenResult {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("token" in value) ||
      !("expiresAt" in value) ||
      typeof value.token !== "string" ||
      typeof value.expiresAt !== "string"
    ) {
      throw new Error("Invalid billing Telegram link response");
    }

    const token = value.token;
    const expiresAt = value.expiresAt;

    // 32 random bytes encoded as unpadded base64url.
    if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token)) {
      throw new Error("Invalid billing Telegram link token");
    }

    const expiresAtMs = Date.parse(expiresAt);

    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= nowMs ||
      expiresAtMs - nowMs > MAX_TOKEN_LIFETIME_MS
    ) {
      throw new Error("Invalid billing Telegram link expiration");
    }

    return {
      token,
      expiresAt
    };
  }
