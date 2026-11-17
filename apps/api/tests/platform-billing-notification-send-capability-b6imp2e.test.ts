
import { describe, expect, it } from "vitest";

import {
  createBillingCapabilityRegistry,
  preparePlatformBillingSendCapability,
  type BillingSendCapabilityBinding
} from "../src/services/platform-billing-notification-send-capability.js";

function binding(
  attemptId = "attempt-1"
): BillingSendCapabilityBinding {
  return {
    deliveryId: "delivery-1",
    claimId: "claim-1",
    attemptId,
    destinationId: "destination-1",
    platformBotId: "bot-1",
    botIdentityId: "identity-1"
  };
}

describe("B6-IMP2-E capability registry", () => {
  it("issues and consumes a capability exactly once", () => {
    const registry = createBillingCapabilityRegistry();
    const expected = binding();

    const capability = registry.issue(expected);

    expect(capability).not.toBeNull();
    expect(registry.consume(capability!, expected)).toBe(true);
    expect(registry.consume(capability!, expected)).toBe(false);
  });

  it("rejects duplicate issuance for the same attempt", () => {
    const registry = createBillingCapabilityRegistry();

    expect(registry.issue(binding())).not.toBeNull();
    expect(registry.issue(binding())).toBeNull();
  });

  it("rejects a forged capability", () => {
    const registry = createBillingCapabilityRegistry();

    const forged = {
      id: Symbol("billing-send-capability")
    };

    expect(registry.consume(forged, binding())).toBe(false);
  });

  it("rejects a mismatched binding without consuming", () => {
    const registry = createBillingCapabilityRegistry();
    const expected = binding();

    const capability = registry.issue(expected)!;

    expect(
      registry.consume(capability, {
        ...expected,
        destinationId: "different-destination"
      })
    ).toBe(false);

    expect(registry.consume(capability, expected)).toBe(true);
  });

  it("rejects invalid issuance input", () => {
    const registry = createBillingCapabilityRegistry();

    expect(
      registry.issue({
        ...binding(),
        claimId: ""
      })
    ).toBeNull();
  });

  it("allows only one concurrent consumption", async () => {
    const registry = createBillingCapabilityRegistry();
    const expected = binding();
    const capability = registry.issue(expected)!;

    const results = await Promise.all(
      Array.from({ length: 20 }, async () => {
        await Promise.resolve();

        return registry.consume(capability, expected);
      })
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => !result)).toHaveLength(19);
  });

  it("does not issue production sending authorization", () => {
    expect(
      preparePlatformBillingSendCapability(binding())
    ).toEqual({
      prepared: false,
      sendAuthorized: false,
      reason: "TRUSTED_SENDER_NOT_CONNECTED"
    });
  });

  it("documents registry-instance isolation", () => {
    const first = createBillingCapabilityRegistry();
    const second = createBillingCapabilityRegistry();

    expect(first.issue(binding())).not.toBeNull();
    expect(second.issue(binding())).not.toBeNull();
  });
});
