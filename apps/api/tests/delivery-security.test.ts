import { describe, expect, it } from "vitest";

import {
  createDeliveryConfirmation,
  DELIVERY_CONFIRMATION_MAX_ATTEMPTS,
  DELIVERY_CONFIRMATION_TTL_MS,
  verifyDeliveryConfirmationCode
} from "../src/services/delivery-security.js";

describe("delivery confirmation security", () => {
  it("creates a six-digit delivery confirmation code", () => {
    const confirmation =
      createDeliveryConfirmation("order-123");

    expect(confirmation.code).toMatch(/^\d{6}$/);
    expect(confirmation.codeHash).toMatch(
      /^[a-f0-9]{64}$/
    );
  });

  it("does not store the plaintext code in the hash", () => {
    const confirmation =
      createDeliveryConfirmation("order-123");

    expect(
      confirmation.codeHash
    ).not.toContain(confirmation.code);
  });

  it("verifies the correct code for the correct order", () => {
    const confirmation =
      createDeliveryConfirmation("order-123");

    expect(
      verifyDeliveryConfirmationCode(
        "order-123",
        confirmation.code,
        confirmation.codeHash
      )
    ).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const confirmation =
      createDeliveryConfirmation("order-123");

    const incorrectCode =
      confirmation.code === "000000"
        ? "999999"
        : "000000";

    expect(
      verifyDeliveryConfirmationCode(
        "order-123",
        incorrectCode,
        confirmation.codeHash
      )
    ).toBe(false);
  });

  it("binds the code hash to the order", () => {
    const confirmation =
      createDeliveryConfirmation("order-123");

    expect(
      verifyDeliveryConfirmationCode(
        "order-456",
        confirmation.code,
        confirmation.codeHash
      )
    ).toBe(false);
  });

  it("rejects malformed codes and hashes safely", () => {
    expect(
      verifyDeliveryConfirmationCode(
        "order-123",
        "12345",
        "not-a-valid-hash"
      )
    ).toBe(false);

    expect(
      verifyDeliveryConfirmationCode(
        "order-123",
        "abcdef",
        "a".repeat(64)
      )
    ).toBe(false);
  });

  it("sets the configured confirmation expiry", () => {
    const now =
      new Date("2026-09-16T09:00:00.000Z");

    const confirmation =
      createDeliveryConfirmation(
        "order-123",
        now
      );

    expect(
      confirmation.expiresAt.getTime()
    ).toBe(
      now.getTime() +
        DELIVERY_CONFIRMATION_TTL_MS
    );
  });

  it("defines a finite delivery confirmation attempt limit", () => {
    expect(
      DELIVERY_CONFIRMATION_MAX_ATTEMPTS
    ).toBe(5);
  });

  it("rejects an empty order ID", () => {
    expect(() =>
      createDeliveryConfirmation("   ")
    ).toThrow("Order ID is required.");
  });
});