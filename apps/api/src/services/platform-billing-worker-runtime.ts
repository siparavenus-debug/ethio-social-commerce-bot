export const PLATFORM_BILLING_WORKER_MAX_RUNTIME_MS =
  240_000;

export function getPlatformBillingWorkerDeadline(
  startedAtMs: number
): number {
  return (
    startedAtMs +
    PLATFORM_BILLING_WORKER_MAX_RUNTIME_MS
  );
}

export function canStartPlatformBillingWorkerOperation(
  deadlineAtMs: number,
  nowMs: number,
  requiredTimeMs = 0
): boolean {
  if (
    !Number.isFinite(deadlineAtMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(requiredTimeMs) ||
    requiredTimeMs < 0
  ) {
    return false;
  }

  return nowMs + requiredTimeMs < deadlineAtMs;
}