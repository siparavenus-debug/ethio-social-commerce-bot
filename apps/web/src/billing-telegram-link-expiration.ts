
export function scheduleBillingTelegramLinkExpiration(
    expiresAt: string,
    onExpire: () => void,
    nowMs: number = Date.now()
  ): () => void {
    const expiresAtMs = Date.parse(expiresAt);
    const remainingMs = expiresAtMs - nowMs;

    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(remainingMs) ||
      remainingMs <= 0
    ) {
      onExpire();
      return () => {};
    }

    const timeoutId = setTimeout(() => {
      onExpire();
    }, remainingMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }
