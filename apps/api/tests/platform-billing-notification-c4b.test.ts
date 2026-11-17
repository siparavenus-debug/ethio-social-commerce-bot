import {
  describe,
  expect,
  it
} from "vitest";

import {
  coordinatePlatformBillingPreSendFailureC4B
} from "../src/services/platform-billing-notification-c4b.js";

describe("C4-B.6 dormant reconciliation boundary", () => {
  it("returns NO_QUALIFYING_FAILURE", () => {
    const result =
      coordinatePlatformBillingPreSendFailureC4B();

    expect(result).toEqual({
      outcome: "NO_QUALIFYING_FAILURE",
      sendAuthorized: false
    });
  });

  it("never authorizes sending", () => {
    const result =
      coordinatePlatformBillingPreSendFailureC4B();

    expect(result.sendAuthorized).toBe(false);
  });

  it("does not expose reconciliation status", () => {
    const result =
      coordinatePlatformBillingPreSendFailureC4B();

    expect(result).not.toHaveProperty(
      "deliveryStatus"
    );

    expect(result).not.toHaveProperty(
      "reconciled"
    );
  });
});
