import {
  Prisma,
  PlatformBillingEventType
} from "@ethio-commerce/database";

export type BillingEventForMaterialization = {
  id: string;
  merchantId: string;
  type: PlatformBillingEventType;
  createdAt: Date;
};

export type BillingMaterializationResult = {
  notificationId: string;
  deliveryId: string | null;
  status: "PENDING" | "SUPPRESSED";
  terminalReason: string | null;
};

const NOTIFIABLE_EVENTS =
  new Set<PlatformBillingEventType>([
    "INVOICE_ISSUED",
    "INVOICE_FIRST_OVERDUE",
    "INVOICE_SECOND_OVERDUE",
    "SETTLEMENT_SUBMITTED",
    "SETTLEMENT_REJECTED",
    "INVOICE_PAID",
    "SUBSCRIPTION_SUSPENDED",
    "SUBSCRIPTION_RECOVERED"
  ]);

export async function materializePlatformBillingNotification(
  tx: Prisma.TransactionClient,
  event: BillingEventForMaterialization
): Promise<BillingMaterializationResult> {
  if (
    !event.id?.trim() ||
    !event.merchantId?.trim() ||
    !(event.createdAt instanceof Date) ||
    !Number.isFinite(event.createdAt.getTime())
  ) {
    throw new Error(
      "Valid billing event identity and creation time are required"
    );
  }

  if (!NOTIFIABLE_EVENTS.has(event.type)) {
    const notification =
      await tx.platformBillingNotification.create({
        data: {
          merchantId: event.merchantId,
          eventId: event.id,
          status: "SUPPRESSED",
          terminalReason: "NO_NOTIFICATION_MAPPING"
        }
      });

    return {
      notificationId: notification.id,
      deliveryId: null,
      status: "SUPPRESSED",
      terminalReason: "NO_NOTIFICATION_MAPPING"
    };
  }

  // Coordinate with destination redemption, preferences,
  // unlink, and merchant suspension using the shared
  // Merchant-first locking convention.
  const merchants = await tx.$queryRaw<
    Array<{ id: string }>
  >`
    SELECT "id"
    FROM "Merchant"
    WHERE "id" = ${event.merchantId}
      AND "accountStatus" = 'ACTIVE'
    FOR UPDATE
  `;

  let terminalReason: string | null = null;

  if (merchants.length !== 1) {
    terminalReason = "MERCHANT_NOT_ACTIVE";
  }

  const destinations =
    terminalReason === null
      ? await tx.merchantBillingTelegramDestination.findMany({
          where: {
            merchantId: event.merchantId,
            status: "ACTIVE",
            revokedAt: null,
            notificationsEnabled: true,

            consentedAt: {
              lte: event.createdAt
            },
            platformBot: {
              status: "ACTIVE"
            }
          },
          select: {
            id: true,
            linkVersion: true
          },
          take: 2
        })
      : [];

  if (terminalReason === null && destinations.length !== 1) {
    terminalReason =
      destinations.length === 0
        ? "NO_ELIGIBLE_OPT_IN"
        : "AMBIGUOUS_DESTINATION";
  }

  if (terminalReason !== null) {
    const notification =
      await tx.platformBillingNotification.create({
        data: {
          merchantId: event.merchantId,
          eventId: event.id,
          status: "SUPPRESSED",
          terminalReason
        }
      });

    return {
      notificationId: notification.id,
      deliveryId: null,
      status: "SUPPRESSED",
      terminalReason
    };
  }

  const destination = destinations[0];

  if (!destination) {
    throw new Error(
      "Eligible billing destination disappeared"
    );
  }

  const notification =
    await tx.platformBillingNotification.create({
      data: {
        merchantId: event.merchantId,
        eventId: event.id,
        status: "PENDING"
      }
    });

  const delivery =
    await tx.platformBillingNotificationDelivery.create({
      data: {
        merchantId: event.merchantId,
        notificationId: notification.id,
        destinationId: destination.id,
        destinationLinkVersion:
          destination.linkVersion,
        status: "PENDING"
      }
    });

  return {
    notificationId: notification.id,
    deliveryId: delivery.id,
    status: "PENDING",
    terminalReason: null
  };
}