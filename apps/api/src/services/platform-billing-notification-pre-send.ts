import {
  Prisma,
  PlatformBillingEventType
} from "@ethio-commerce/database";

export type BillingPreSendDecision =
  | {
      eligible: true;
      sendAuthorized: false;
      destinationId: string;
      platformBotId: string;
      botIdentityId: string;
    }
  | {
      eligible: false;
      disposition: "SUPPRESS" | "DEFER" | "REVIEW_REQUIRED";
      reason: string;
    };

const deny = (
  disposition: "SUPPRESS" | "DEFER" | "REVIEW_REQUIRED",
  reason: string
): BillingPreSendDecision => ({
  eligible: false,
  disposition,
  reason
});

async function validatePlatformBillingEligibility(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  allowedStatuses: readonly string[]
): Promise<BillingPreSendDecision> {
  if (!deliveryId?.trim()) {
    return deny("REVIEW_REQUIRED", "INVALID_DELIVERY_ID");
  }

  const delivery =
    await tx.platformBillingNotificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          include: {
            event: true
          }
        },
        destination: {
          include: {
            linkedBy: true,
            platformBot: true
          }
        }
      }
    });

  if (!delivery) {
    return deny("REVIEW_REQUIRED", "DELIVERY_NOT_FOUND");
  }

  const quarantine =
    await tx.platformBillingDeliveryQuarantine.findUnique({
      where: {
        deliveryId: delivery.id
      },
      select: {
        deliveryId: true
      }
    });

  if (quarantine) {
    return deny(
      "REVIEW_REQUIRED",
      "LEGACY_LINK_VERSION_UNVERIFIED"
    );
  }

  const notification = delivery.notification;
  const event = notification.event;
  const destination = delivery.destination;

  if (
    delivery.merchantId !== notification.merchantId ||
    notification.merchantId !== event.merchantId
  ) {
    return deny("REVIEW_REQUIRED", "MERCHANT_MISMATCH");
  }

  if (
    notification.status !== "PENDING" ||
    !allowedStatuses.includes(delivery.status)
  ) {
    return deny("REVIEW_REQUIRED", "DELIVERY_NOT_SENDABLE");
  }

  if (!destination) {
    return deny("SUPPRESS", "DESTINATION_MISSING");
  }

  const eligible = (): BillingPreSendDecision => ({
    eligible: true,
    sendAuthorized: false,
    destinationId: destination.id,
    platformBotId: destination.platformBotId,
    botIdentityId: destination.platformBot.botIdentityId
  });

  if (
    destination.merchantId !== event.merchantId ||
    destination.id !== delivery.destinationId ||
    destination.linkVersion !==
      delivery.destinationLinkVersion
  ) {
    return deny(
      "SUPPRESS",
      "DESTINATION_LINK_VERSION_CHANGED"
    );
  }

  const merchant = await tx.merchant.findUnique({
    where: { id: event.merchantId },
    select: { accountStatus: true }
  });

  if (merchant?.accountStatus !== "ACTIVE") {
    return deny("SUPPRESS", "MERCHANT_NOT_ACTIVE");
  }

  if (
    destination.status !== "ACTIVE" ||
    destination.revokedAt !== null ||
    !destination.notificationsEnabled ||
    destination.consentedAt > event.createdAt
  ) {
    return deny(
      "SUPPRESS",
      "DESTINATION_NO_LONGER_ELIGIBLE"
    );
  }

  if (
    destination.linkedBy.merchantId !== event.merchantId ||
    destination.linkedBy.role !== "OWNER"
  ) {
    return deny(
      "SUPPRESS",
      "OWNER_NO_LONGER_AUTHORIZED"
    );
  }

  const validTelegramId = (value: string): boolean =>
    /^[1-9][0-9]*$/.test(value);

  if (
    !validTelegramId(destination.chatId) ||
    !validTelegramId(destination.telegramUserId) ||
    destination.chatId !== destination.telegramUserId
  ) {
    return deny(
      "REVIEW_REQUIRED",
      "TELEGRAM_IDENTITY_INVALID"
    );
  }

  if (destination.platformBot.status !== "ACTIVE") {
    return deny("DEFER", "PLATFORM_BOT_NOT_ACTIVE");
  }

  const reservations =
    await tx.telegramBotOwnershipReservation.findMany({
      where: {
        botIdentityId:
          destination.platformBot.botIdentityId,
        platformBillingBotId:
          destination.platformBotId,
        ownerType: "PLATFORM_BILLING",
        status: "RESERVED",
        releasedAt: null,
        merchantId: null,
        merchantIntegrationId: null
      },
      select: { id: true },
      take: 2
    });

  if (reservations.length !== 1) {
    return deny(
      "REVIEW_REQUIRED",
      "BOT_OWNERSHIP_NOT_CONFIRMED"
    );
  }

  const type: PlatformBillingEventType = event.type;

  switch (type) {
    case "INVOICE_ISSUED":
    case "INVOICE_PAID": {
      const invoice = await tx.merchantInvoice.findFirst({
        where: {
          id: event.sourceId,
          merchantId: event.merchantId
        },
        select: { status: true }
      });

      if (!invoice) {
        return deny("REVIEW_REQUIRED", "INVOICE_NOT_FOUND");
      }

      const valid =
        type === "INVOICE_ISSUED"
          ? invoice.status === "OPEN" ||
            invoice.status === "OVERDUE"
          : invoice.status === "PAID";

      if (!valid) {
        return deny("SUPPRESS", "INVOICE_STATE_CHANGED");
      }

      if (type === "INVOICE_PAID") {
        const verifiedSettlements =
          await tx.merchantSettlement.findMany({
            where: {
              merchantId: event.merchantId,
              invoiceId: event.sourceId,
              status: "VERIFIED"
            },
            select: { id: true },
            take: 2
          });

        if (verifiedSettlements.length !== 1) {
          return deny(
            "REVIEW_REQUIRED",
            "VERIFIED_SETTLEMENT_UNCONFIRMED"
          );
        }

        // A unique VERIFIED settlement does not establish
        // authoritative invoice-payment attribution.
        // Fail closed until that linkage can be proven.
        return deny(
          "REVIEW_REQUIRED",
          "INVOICE_PAYMENT_ATTRIBUTION_UNCONFIRMED"
        );
      }

      return eligible();
    }

    case "INVOICE_FIRST_OVERDUE":
    case "INVOICE_SECOND_OVERDUE": {
      const reminder =
        await tx.merchantInvoiceReminder.findFirst({
          where: {
            id: event.sourceId,
            merchantId: event.merchantId
          },
          select: {
            invoiceId: true,
            type: true,
            invoice: {
              select: { status: true }
            }
          }
        });

      if (!reminder) {
        return deny("REVIEW_REQUIRED", "REMINDER_NOT_FOUND");
      }

      const expected =
        type === "INVOICE_FIRST_OVERDUE"
          ? "FIRST_OVERDUE"
          : "SECOND_OVERDUE";

      if (reminder.type !== expected) {
        return deny("REVIEW_REQUIRED", "REMINDER_TYPE_MISMATCH");
      }

      if (reminder.invoice.status !== "OVERDUE") {
        return deny("SUPPRESS", "INVOICE_NO_LONGER_OVERDUE");
      }

      const pendingSettlement =
        await tx.merchantSettlement.findFirst({
          where: {
            merchantId: event.merchantId,
            invoiceId: reminder.invoiceId,
            status: "REVIEW_REQUIRED"
          },
          select: { id: true }
        });

      if (pendingSettlement) {
        return deny("DEFER", "SETTLEMENT_REVIEW_PENDING");
      }

      if (type === "INVOICE_FIRST_OVERDUE") {
        const secondReminder =
          await tx.merchantInvoiceReminder.findFirst({
            where: {
              merchantId: event.merchantId,
              invoiceId: reminder.invoiceId,
              type: "SECOND_OVERDUE"
            },
            select: { id: true }
          });

        if (secondReminder) {
          return deny(
            "SUPPRESS",
            "SUPERSEDED_BY_SECOND_OVERDUE"
          );
        }
      }

      return eligible();
    }

    case "SETTLEMENT_SUBMITTED":
    case "SETTLEMENT_REJECTED": {
      const settlement =
        await tx.merchantSettlement.findFirst({
          where: {
            id: event.sourceId,
            merchantId: event.merchantId
          },
          select: { status: true }
        });

      if (!settlement) {
        return deny("REVIEW_REQUIRED", "SETTLEMENT_NOT_FOUND");
      }

      const expected =
        type === "SETTLEMENT_SUBMITTED"
          ? "REVIEW_REQUIRED"
          : "REJECTED";

          return settlement.status === expected
          ? eligible()
          : deny("SUPPRESS", "SETTLEMENT_STATUS_CHANGED");
    }

    case "SUBSCRIPTION_SUSPENDED":
    case "SUBSCRIPTION_RECOVERED":
      return deny(
        "REVIEW_REQUIRED",
        "SUBSCRIPTION_OCCURRENCE_UNCONFIRMED"
      );

    case "SETTLEMENT_VERIFIED":
      return deny("SUPPRESS", "NO_NOTIFICATION_MAPPING");

    default:
      return deny("REVIEW_REQUIRED", "UNKNOWN_EVENT_TYPE");
  }
}




export async function validatePlatformBillingPreSend(
  tx: Prisma.TransactionClient,
  deliveryId: string
): Promise<BillingPreSendDecision> {
  return validatePlatformBillingEligibility(
    tx,
    deliveryId,
    ["PENDING", "PROCESSING", "FAILED"]
  );
}

export async function validatePlatformBillingRequestStart(
  tx: Prisma.TransactionClient,
  deliveryId: string
): Promise<BillingPreSendDecision> {
  return validatePlatformBillingEligibility(
    tx,
    deliveryId,
    ["SENDING"]
  );
}
