import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

describe("merchant delivery fulfillment UI contract", () => {
  it("uses the dedicated delivery confirmation endpoint", () => {
    expect(appSource).toContain(
      "/delivery-confirmation`"
    );
    expect(appSource).toContain(
      "code"
    );
    expect(appSource).toContain(
      "Confirm Delivery"
    );
  });

  it("uses the protected delivery code recovery endpoint", () => {
    expect(appSource).toContain(
      "/delivery-confirmation/resend`"
    );
    expect(appSource).toContain(
      "Send New Code"
    );
  });

  it("does not expose delivery confirmation security internals", () => {
    expect(appSource).not.toContain(
      "deliveryConfirmationCodeHash"
    );
    expect(appSource).not.toContain(
      "deliveryConfirmationCodeExpiresAt"
    );
    expect(appSource).not.toContain(
      "deliveryConfirmationAttempts"
    );
    expect(appSource).not.toContain(
      "deliveryConfirmationSentAt"
    );
  });

  it("does not offer the obsolete direct fulfilled action", () => {
    expect(appSource).not.toContain(
      "Mark Fulfilled"
    );
    expect(appSource).not.toContain(
      'status: "FULFILLED"'
    );
  });

  it("keeps the entered delivery code in temporary React state", () => {
    expect(appSource).toContain(
      'deliveryConfirmationCode'
    );
    expect(appSource).toContain(
      'setDeliveryConfirmationCode('
    );
    expect(appSource).not.toContain(
      'localStorage.setItem("deliveryConfirmationCode"'
    );
  });
});
