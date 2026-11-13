import { describe, expect, it } from "vitest";

import {
  PLATFORM_BILLING_WORKER_MAX_RUNTIME_MS,
  getPlatformBillingWorkerDeadline,
  canStartPlatformBillingWorkerOperation
} from "../src/services/platform-billing-worker-runtime.js";

describe("B6.6 worker runtime budget", () => {
  it("uses the approved 240-second budget", () => {
    expect(
      PLATFORM_BILLING_WORKER_MAX_RUNTIME_MS
    ).toBe(240_000);

    expect(
      getPlatformBillingWorkerDeadline(1_000)
    ).toBe(241_000);
  });

  it("allows operations before the deadline", () => {
    expect(
      canStartPlatformBillingWorkerOperation(
        240_000,
        100_000
      )
    ).toBe(true);
  });

  it("rejects operations at or after the deadline", () => {
    expect(
      canStartPlatformBillingWorkerOperation(
        240_000,
        240_000
      )
    ).toBe(false);

    expect(
      canStartPlatformBillingWorkerOperation(
        240_000,
        240_001
      )
    ).toBe(false);
  });

  it("reserves sufficient time for an operation", () => {
    expect(
      canStartPlatformBillingWorkerOperation(
        240_000,
        200_000,
        30_000
      )
    ).toBe(true);

    expect(
      canStartPlatformBillingWorkerOperation(
        240_000,
        220_000,
        30_000
      )
    ).toBe(false);
  });

  it("rejects invalid timing inputs", () => {
    expect(
      canStartPlatformBillingWorkerOperation(
        Number.NaN,
        100
      )
    ).toBe(false);

    expect(
      canStartPlatformBillingWorkerOperation(
        240_000,
        Number.POSITIVE_INFINITY
      )
    ).toBe(false);

    expect(
      canStartPlatformBillingWorkerOperation(
        240_000,
        100,
        -1
      )
    ).toBe(false);
  });
});