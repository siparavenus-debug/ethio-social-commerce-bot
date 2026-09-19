import {
    createHmac,
    randomInt,
    timingSafeEqual
  } from "node:crypto";

  import { env } from "../config/env.js";

  const DELIVERY_CODE_MIN = 100000;
  const DELIVERY_CODE_MAX_EXCLUSIVE = 1000000;

  export const DELIVERY_CONFIRMATION_TTL_MS =
    30 * 60 * 1000;

  export const DELIVERY_CONFIRMATION_MAX_ATTEMPTS = 5;

  export type DeliveryConfirmation = {
    code: string;
    codeHash: string;
    expiresAt: Date;
  };

  function hashDeliveryConfirmationCode(
    orderId: string,
    code: string
  ): Buffer {
    return createHmac(
      "sha256",
      env.deliveryConfirmationSecret
    )
      .update(`${orderId}:${code}`)
      .digest();
  }

  export function createDeliveryConfirmation(
    orderId: string,
    now = new Date()
  ): DeliveryConfirmation {
    if (!orderId.trim()) {
      throw new Error("Order ID is required.");
    }

    const code = randomInt(
      DELIVERY_CODE_MIN,
      DELIVERY_CODE_MAX_EXCLUSIVE
    ).toString();

    const codeHash =
      hashDeliveryConfirmationCode(
        orderId,
        code
      ).toString("hex");

    const expiresAt = new Date(
      now.getTime() +
        DELIVERY_CONFIRMATION_TTL_MS
    );

    return {
      code,
      codeHash,
      expiresAt
    };
  }

  export function verifyDeliveryConfirmationCode(
    orderId: string,
    suppliedCode: string,
    storedHash: string
  ): boolean {
    if (
      !orderId.trim() ||
      !/^\d{6}$/.test(suppliedCode) ||
      !/^[a-f0-9]{64}$/i.test(storedHash)
    ) {
      return false;
    }

    try {
      const expected =
        hashDeliveryConfirmationCode(
          orderId,
          suppliedCode
        );

      const stored = Buffer.from(
        storedHash,
        "hex"
      );

      if (expected.length !== stored.length) {
        return false;
      }

      return timingSafeEqual(
        expected,
        stored
      );
    } catch {
      return false;
    }
  }
