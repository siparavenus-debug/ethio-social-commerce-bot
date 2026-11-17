import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "@ethio-commerce/database";

import {
  validatePlatformBillingPreSend
} from "../src/services/platform-billing-notification-pre-send.js";

import {
  resolvePlatformBillingNotification
} from "../src/services/platform-billing-notification-resolver.js";

import {
  renderBillingNotification
} from "../src/services/platform-billing-notification-renderer.js";

import {
  preparePlatformBillingNotificationMessage
} from "../src/services/platform-billing-notification-message-preparation.js";

vi.mock(
  "../src/services/platform-billing-notification-pre-send.js",
  () => ({
    validatePlatformBillingPreSend: vi.fn()
  })
);

vi.mock(
  "../src/services/platform-billing-notification-resolver.js",
  () => ({
    resolvePlatformBillingNotification: vi.fn()
  })
);

vi.mock(
  "../src/services/platform-billing-notification-renderer.js",
  () => ({
    renderBillingNotification: vi.fn()
  })
);

const preSendMock = vi.mocked(
  validatePlatformBillingPreSend
);

const resolverMock = vi.mocked(
  resolvePlatformBillingNotification
);

const rendererMock = vi.mocked(
  renderBillingNotification
);

const event = {
  merchantId: "merchant-a",
  sourceId: "invoice-a",
  type: "INVOICE_ISSUED" as const
};

const templateInput = {
  type: "INVOICE_ISSUED" as const,
  invoiceNumber: "INV-001",
  amount: "100.00",
  currency: "ETB",
  dueDate: null
};

function makeTx(
  delivery: unknown = {
    merchantId: "merchant-a",
    notification: {
      merchantId: "merchant-a",
      event
    }
  }
) {
  const findUnique = vi.fn().mockResolvedValue(delivery);

  const tx = {
    platformBillingNotificationDelivery: {
      findUnique
    }
  } as unknown as Prisma.TransactionClient;

  return { tx, findUnique };
}

beforeEach(() => {
  vi.resetAllMocks();

  preSendMock.mockResolvedValue({
    eligible: true,
    sendAuthorized: false
  });

  resolverMock.mockResolvedValue({
    ok: true,
    input: templateInput
  });

  rendererMock.mockReturnValue({
    ok: true,
    text: "Invoice INV-001"
  });
});

describe("B7.4-C3 message preparation", () => {
  it("prepares valid text without authorizing sending", async () => {
    const { tx, findUnique } = makeTx();

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        "delivery-a"
      );

    expect(result).toEqual({
      prepared: true,
      sendAuthorized: false,
      text: "Invoice INV-001"
    });

    expect(preSendMock).toHaveBeenCalledWith(
      tx,
      "delivery-a"
    );

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "delivery-a" }
      })
    );

    expect(resolverMock).toHaveBeenCalledWith(
      tx,
      event
    );

    expect(rendererMock).toHaveBeenCalledWith(
      templateInput
    );
  });

  it.each([
    ["SUPPRESS", "DESTINATION_MISSING"],
    ["DEFER", "TEMPORARILY_INELIGIBLE"],
    ["REVIEW_REQUIRED", "MERCHANT_MISMATCH"],
    [
      "REVIEW_REQUIRED",
      "SUBSCRIPTION_OCCURRENCE_UNCONFIRMED"
    ],
    ["SUPPRESS", "NO_NOTIFICATION_MAPPING"],
    [
      "REVIEW_REQUIRED",
      "INVOICE_PAYMENT_ATTRIBUTION_UNCONFIRMED"
    ]
  ] as const)(
    "preserves %s pre-send denial: %s",
    async (disposition, reason) => {
      preSendMock.mockResolvedValue({
        eligible: false,
        disposition,
        reason
      });

      const { tx, findUnique } = makeTx();

      const result =
        await preparePlatformBillingNotificationMessage(
          tx,
          "delivery-a"
        );

      expect(result).toEqual({
        prepared: false,
        sendAuthorized: false,
        disposition,
        reason
      });

      expect(findUnique).not.toHaveBeenCalled();
      expect(resolverMock).not.toHaveBeenCalled();
      expect(rendererMock).not.toHaveBeenCalled();
    }
  );

  it("rejects an invalid delivery ID before database access", async () => {
    const { tx, findUnique } = makeTx();

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        " "
      );

    expect(result).toEqual({
      prepared: false,
      sendAuthorized: false,
      disposition: "REVIEW_REQUIRED",
      reason: "INVALID_DELIVERY_ID"
    });

    expect(preSendMock).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("fails closed when delivery is missing", async () => {
    const { tx } = makeTx(null);

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        "delivery-a"
      );

    expect(result).toMatchObject({
      prepared: false,
      sendAuthorized: false,
      disposition: "REVIEW_REQUIRED",
      reason: "DELIVERY_NOT_FOUND"
    });

    expect(resolverMock).not.toHaveBeenCalled();
  });

  it("fails closed when event is missing", async () => {
    const { tx } = makeTx({
      merchantId: "merchant-a",
      notification: {
        merchantId: "merchant-a",
        event: null
      }
    });

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        "delivery-a"
      );

    expect(result).toMatchObject({
      prepared: false,
      sendAuthorized: false,
      reason: "EVENT_NOT_FOUND"
    });

    expect(resolverMock).not.toHaveBeenCalled();
  });

  it("rejects cross-merchant event relationships", async () => {
    const { tx } = makeTx({
      merchantId: "merchant-a",
      notification: {
        merchantId: "merchant-a",
        event: {
          ...event,
          merchantId: "merchant-b"
        }
      }
    });

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        "delivery-a"
      );

    expect(result).toMatchObject({
      prepared: false,
      sendAuthorized: false,
      reason: "MERCHANT_MISMATCH"
    });

    expect(resolverMock).not.toHaveBeenCalled();
  });

  it("fails closed when C2 cannot resolve source data", async () => {
    resolverMock.mockResolvedValue({
      ok: false,
      reason: "SOURCE_NOT_FOUND"
    });

    const { tx } = makeTx();

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        "delivery-a"
      );

    expect(result).toEqual({
      prepared: false,
      sendAuthorized: false,
      disposition: "REVIEW_REQUIRED",
      reason: "SOURCE_NOT_FOUND"
    });

    expect(rendererMock).not.toHaveBeenCalled();
  });

  it("fails closed when C1 rejects template data", async () => {
    rendererMock.mockReturnValue({
      ok: false,
      reason: "INVALID_TEMPLATE_DATA"
    });

    const { tx } = makeTx();

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        "delivery-a"
      );

    expect(result).toEqual({
      prepared: false,
      sendAuthorized: false,
      disposition: "REVIEW_REQUIRED",
      reason: "INVALID_TEMPLATE_DATA"
    });
  });

  it("performs no delivery or notification writes", async () => {
    const { tx, findUnique } = makeTx();

    const result =
      await preparePlatformBillingNotificationMessage(
        tx,
        "delivery-a"
      );

    expect(result.sendAuthorized).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(1);

    expect(
      Object.keys(tx)
    ).toEqual([
      "platformBillingNotificationDelivery"
    ]);
  });
});