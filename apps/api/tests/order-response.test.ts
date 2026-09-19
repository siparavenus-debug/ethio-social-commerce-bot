import {
  describe,
  expect,
  it
} from "vitest";

import {
  sanitizeOrderForBillingResponse,
  sanitizeOrderForResponse
} from "../src/services/order-response.js";

const order = {
  id: "order-1",
  orderNumber: "ORD-001",
  status: "FULFILLING",

  deliveryName: "Test Recipient",
  deliveryPhone: "0911000000",
  deliveryAddress: "Test Address",

  deliveryConfirmationCodeHash:
    "a".repeat(64),
  deliveryConfirmationCodeExpiresAt:
    new Date("2026-09-16T12:00:00.000Z"),
  deliveryConfirmationAttempts: 2,
  deliveryConfirmationSentAt:
    new Date("2026-09-16T11:00:00.000Z"),
  deliveryConfirmedAt:
    new Date("2026-09-16T11:30:00.000Z")
};

describe("order response sanitization", () => {
  it(
    "removes delivery confirmation security internals from normal order responses",
    () => {
      const result =
        sanitizeOrderForResponse(order);

      expect(result).not.toHaveProperty(
        "deliveryConfirmationSentAt"
      );

      expect(result).not.toHaveProperty(
        "deliveryConfirmationCodeHash"
      );

      expect(result).not.toHaveProperty(
        "deliveryConfirmationCodeExpiresAt"
      );

      expect(result).not.toHaveProperty(
        "deliveryConfirmationAttempts"
      );

      expect(result).toMatchObject({
        id: "order-1",
        orderNumber: "ORD-001",
        deliveryName: "Test Recipient",
        deliveryPhone: "0911000000",
        deliveryAddress: "Test Address"
      });
    }
  );

  it(
    "also removes delivery contact PII from billing responses",
    () => {
      const result =
        sanitizeOrderForBillingResponse(
          order
        );

      expect(result).not.toHaveProperty(
        "deliveryConfirmationSentAt"
      );

      expect(result).not.toHaveProperty(
        "deliveryName"
      );

      expect(result).not.toHaveProperty(
        "deliveryPhone"
      );

      expect(result).not.toHaveProperty(
        "deliveryAddress"
      );

      expect(result).not.toHaveProperty(
        "deliveryConfirmationCodeHash"
      );

      expect(result).not.toHaveProperty(
        "deliveryConfirmationCodeExpiresAt"
      );

      expect(result).not.toHaveProperty(
        "deliveryConfirmationAttempts"
      );

      expect(result).toMatchObject({
        id: "order-1",
        orderNumber: "ORD-001",
        status: "FULFILLING",
        deliveryConfirmedAt:
          new Date(
            "2026-09-16T11:30:00.000Z"
          )
      });
    }
  );
});