import type { Prisma } from "@ethio-commerce/database";

import {
  validatePlatformBillingPreSend
} from "./platform-billing-notification-pre-send.js";

import {
  resolvePlatformBillingNotification
} from "./platform-billing-notification-resolver.js";

import {
  renderBillingNotification
} from "./platform-billing-notification-renderer.js";

type BillingPreparationDisposition =
  | "SUPPRESS"
  | "DEFER"
  | "REVIEW_REQUIRED";

export type BillingMessagePreparationResult =
  | {
      prepared: true;
      sendAuthorized: false;
      text: string;
    }
  | {
      prepared: false;
      sendAuthorized: false;
      disposition: BillingPreparationDisposition;
      reason: string;
    };

function reject(
  disposition: BillingPreparationDisposition,
  reason: string
): BillingMessagePreparationResult {
  return {
    prepared: false,
    sendAuthorized: false,
    disposition,
    reason
  };
}

export async function preparePlatformBillingNotificationMessage(
  tx: Prisma.TransactionClient,
  deliveryId: string
): Promise<BillingMessagePreparationResult> {
  if (
    typeof deliveryId !== "string" ||
    !deliveryId.trim()
  ) {
    return reject("REVIEW_REQUIRED", "INVALID_DELIVERY_ID");
  }

  const eligibility =
    await validatePlatformBillingPreSend(tx, deliveryId);

  if (!eligibility.eligible) {
    return reject(
      eligibility.disposition,
      eligibility.reason
    );
  }

  const delivery =
    await tx.platformBillingNotificationDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        merchantId: true,
        notification: {
          select: {
            merchantId: true,
            event: {
              select: {
                merchantId: true,
                sourceId: true,
                type: true
              }
            }
          }
        }
      }
    });

  if (!delivery) {
    return reject(
      "REVIEW_REQUIRED",
      "DELIVERY_NOT_FOUND"
    );
  }

  const notification = delivery.notification;
  const event = notification?.event;

  if (!notification || !event) {
    return reject(
      "REVIEW_REQUIRED",
      "EVENT_NOT_FOUND"
    );
  }

  if (
    delivery.merchantId !== notification.merchantId ||
    notification.merchantId !== event.merchantId
  ) {
    return reject(
      "REVIEW_REQUIRED",
      "MERCHANT_MISMATCH"
    );
  }

  const resolution =
    await resolvePlatformBillingNotification(tx, {
      merchantId: event.merchantId,
      sourceId: event.sourceId,
      type: event.type
    });

  if (!resolution.ok) {
    return reject(
      "REVIEW_REQUIRED",
      resolution.reason
    );
  }

  const rendered =
    renderBillingNotification(resolution.input);

  if (!rendered.ok) {
    return reject(
      "REVIEW_REQUIRED",
      "INVALID_TEMPLATE_DATA"
    );
  }

  return {
    prepared: true,
    sendAuthorized: false,
    text: rendered.text
  };
}