import {
  PlatformBillingDeliveryStatus,
  prisma
} from "@ethio-commerce/database";
import { Router } from "express";

import {
  requirePlatformRole
} from "../middleware/platform-auth.js";

const router = Router();

const DELIVERY_STATUSES =
  Object.values(PlatformBillingDeliveryStatus);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function queryString(value: unknown): string | null {
  return typeof value === "string"
    ? value
    : null;
}

type DeliveryCursor = {
  createdAt: Date;
  id: string;
};

function parseCursor(
  value: string,
  status: string | undefined,
  merchantId: string | undefined
): DeliveryCursor | null {
  try {
    if (
      value.length === 0 ||
      value.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      return null;
    }

    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as unknown;

    if (
      !decoded ||
      typeof decoded !== "object" ||
      Array.isArray(decoded)
    ) {
      return null;
    }

    const data = decoded as Record<string, unknown>;

    if (
      data.version !== 1 ||
      data.status !== (status ?? null) ||
      data.merchantId !== (merchantId ?? null) ||
      typeof data.createdAt !== "string" ||
      typeof data.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)
    ) {
      return null;
    }

    const createdAt = new Date(data.createdAt);

    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== data.createdAt
    ) {
      return null;
    }

    return {
      createdAt,
      id: data.id
    };
  } catch {
    return null;
  }
}
router.get(
  "/billing/telegram/deliveries",
  requirePlatformRole("OWNER", "ADMIN"),
  async (req, res) => {
    const rawStatus = req.query.status;
    const rawMerchantId = req.query.merchantId;
    const rawLimit = req.query.limit;
    const rawCursor = req.query.cursor;

    const status =
      rawStatus === undefined
        ? undefined
        : queryString(rawStatus);

    if (
      status === null ||
      (
        status !== undefined &&
        !DELIVERY_STATUSES.includes(
          status as PlatformBillingDeliveryStatus
        )
      )
    ) {
      res.status(400).json({
        error: "Invalid delivery status"
      });
      return;
    }

    const merchantId =
      rawMerchantId === undefined
        ? undefined
        : queryString(rawMerchantId);

    if (
      merchantId === null ||
      (
        merchantId !== undefined &&
        !/^[A-Za-z0-9_-]{1,128}$/.test(merchantId)
      )
    ) {
      res.status(400).json({
        error: "Invalid merchant ID"
      });
      return;
    }

    let limit = DEFAULT_LIMIT;

    if (rawLimit !== undefined) {
      const value = queryString(rawLimit);

      if (
        value === null ||
        !/^[1-9][0-9]*$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) > MAX_LIMIT
      ) {
        res.status(400).json({
          error: "Invalid delivery limit"
        });
        return;
      }

      limit = Number(value);
    }

    let cursor:
      | { createdAt: Date; id: string }
      | undefined;

    if (rawCursor !== undefined) {
      const value = queryString(rawCursor);

      if (value === null) {
        res.status(400).json({
          error: "Invalid delivery cursor"
        });
        return;
      }

      const parsed = parseCursor(value, status, merchantId);

      if (!parsed) {
        res.status(400).json({
          error: "Invalid delivery cursor"
        });
        return;
      }

      cursor = parsed;
    }

    try {
      const deliveries =
        await prisma.platformBillingNotificationDelivery.findMany({
          where: {
            ...(status ? {
              status: status as PlatformBillingDeliveryStatus
            } : {}),
            ...(merchantId ? { merchantId } : {}),
            ...(cursor ? {
              OR: [
                {
                  createdAt: {
                    lt: cursor.createdAt
                  }
                },
                {
                  createdAt: cursor.createdAt,
                  id: {
                    lt: cursor.id
                  }
                }
              ]
            } : {})
          },
          select: {
            id: true,
            merchantId: true,
            notificationId: true,
            status: true,
            attemptCount: true,
            nextAttemptAt: true,
            processingUntil: true,
            createdAt: true,
            updatedAt: true,
            notification: {
              select: {
                eventId: true,
                status: true
              }
            },
            quarantine: {
              select: {
                createdAt: true
              }
            },
            attempts: {
              select: {
                id: true,
                attemptNumber: true,
                outcome: true,
                requestStartedAt: true,
                responseReceivedAt: true,
                createdAt: true
              },
              orderBy: [
                { attemptNumber: "desc" },
                { id: "desc" }
              ],
              take: 3
            }
          },
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" }
          ],
          take: limit + 1
        });

      const hasMore = deliveries.length > limit;
      const page = deliveries.slice(0, limit);
      const last = page[page.length - 1];

      const nextCursor =
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                status: status ?? null,
                merchantId: merchantId ?? null,
                createdAt: last.createdAt.toISOString(),
                id: last.id
              }),
              "utf8"
            ).toString("base64url")
          : null;

      res.setHeader("Cache-Control", "no-store");

      res.json({
        deliveries: page.map((delivery) => ({
          id: delivery.id,
          merchantId: delivery.merchantId,
          notificationId: delivery.notificationId,
          eventId: delivery.notification.eventId,
          notificationStatus:
            delivery.notification.status,
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          nextAttemptAt: delivery.nextAttemptAt,
          processingUntil: delivery.processingUntil,
          createdAt: delivery.createdAt,
          updatedAt: delivery.updatedAt,
          quarantined: delivery.quarantine !== null,
          quarantineCreatedAt:
            delivery.quarantine?.createdAt ?? null,
          attempts: delivery.attempts
        })),
        nextCursor
      });
    } catch {
      res.status(500).json({
        error: "Failed to load billing Telegram deliveries"
      });
    }
  }
);

export default router;
