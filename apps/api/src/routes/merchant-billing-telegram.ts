
import { Router } from "express";

import {
  BillingDestinationStatus,
  prisma
} from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../middleware/auth.js";

import {
    BillingTelegramLinkNotEligibleError,
    createBillingTelegramLinkToken
  } from "../services/merchant-billing-telegram-link-token.js";

import {
    unlinkBillingTelegramDestination
  } from "../services/merchant-billing-telegram-unlink.js";

import {
    updateBillingTelegramPreferences
  } from "../services/merchant-billing-telegram-preferences.js";

function maskBillingTelegramAccount(
  telegramUserId: string
): string {
  if (!/^\d{6,}$/.test(telegramUserId)) {
    return "••••";
  }

  return `••••${telegramUserId.slice(-4)}`;
}

const router = Router();

router.use(requireAuth);

router.get(
  "/:merchantId/billing-telegram",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    const merchantId = req.auth!.merchantId;

    res.setHeader("Cache-Control", "no-store");

    try {
      const destination =
        await prisma.merchantBillingTelegramDestination.findFirst({
          where: {
            merchantId,
            status: BillingDestinationStatus.ACTIVE,
            revokedAt: null
          },
          select: {
            id: true,
            platformBotId: true,
            chatId: true,
            telegramUserId: true,
            status: true,
            linkVersion: true,
            notificationsEnabled: true,
            consentedAt: true,
            createdAt: true,
            updatedAt: true
          }
        });

      res.status(200).json({
        linked: destination !== null,
        destination: destination
          ? {
              id: destination.id,
              platformBotId: destination.platformBotId,
              maskedTelegramAccount:
                maskBillingTelegramAccount(
                  destination.telegramUserId
                ),
              status: destination.status,
              linkVersion: destination.linkVersion,
              notificationsEnabled:
                destination.notificationsEnabled,
              consentedAt: destination.consentedAt,
              createdAt: destination.createdAt,
              updatedAt: destination.updatedAt
            }
          : null
      });
    } catch {
      res.status(500).json({
        error: "Failed to load billing Telegram settings"
      });
    }
  }
);


router.post(
    "/:merchantId/billing-telegram/link-token",
    requireMerchantAccess,
    requireRole("OWNER"),
    async (req, res) => {
      // Never allow token responses to be cached.
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");

      const merchantId = req.auth!.merchantId;
      const ownerUserId = req.auth!.id;
      const ownerTokenVersion = req.auth!.tokenVersion;

      try {
        const result =
          await createBillingTelegramLinkToken(
            merchantId,
            ownerUserId,
            ownerTokenVersion
          );

        res.status(201).json({
          token: result.token,
          expiresAt: result.expiresAt.toISOString()
        });
    } catch (error) {
        if (
          error instanceof
          BillingTelegramLinkNotEligibleError
        ) {
          res.status(403).json({
            error:
              "Billing Telegram link token could not be issued"
          });
          return;
        }

        res.status(500).json({
          error:
            "Billing Telegram link token could not be issued"
        });
      }
    }
  );


  router.post(
    "/:merchantId/billing-telegram/unlink",
    requireMerchantAccess,
    requireRole("OWNER"),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");

      try {
        const result = await unlinkBillingTelegramDestination(
          req.auth!.merchantId,
          req.auth!.id,
          req.auth!.tokenVersion
        );

        if (!result.ok) {
          if (result.reason === "UNSAFE_IN_FLIGHT") {
            res.status(409).json({
              error:
                "Billing Telegram unlink cannot complete while deliveries require safety review"
            });
            return;
          }

          res.status(403).json({
            error: "Billing Telegram unlink not permitted"
          });
          return;
        }

        res.status(200).json({
          linked: false,
          unlinked: result.unlinked
        });
      } catch {
        res.status(500).json({
          error: "Failed to unlink billing Telegram"
        });
      }
    }
  );


  router.patch(
    "/:merchantId/billing-telegram/preferences",
    requireMerchantAccess,
    requireRole("OWNER"),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");

      const body = req.body;

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof body.notificationsEnabled !== "boolean"
      ) {
        res.status(400).json({
          error: "Invalid billing Telegram preferences"
        });
        return;
      }

      try {
        const result = await updateBillingTelegramPreferences(
          req.auth!.merchantId,
          req.auth!.id,
          req.auth!.tokenVersion,
          body.notificationsEnabled
        );

        if (!result.ok) {
          if (result.reason === "UNSAFE_IN_FLIGHT") {
            res.status(409).json({
              error:
                "Billing Telegram preferences cannot change while deliveries require safety review"
            });
            return;
          }

          res.status(403).json({
            error: "Billing Telegram preference update not permitted"
          });
          return;
        }

        res.status(200).json({
          notificationsEnabled: result.notificationsEnabled,
          suppressedDeliveries: result.suppressedDeliveries
        });
      } catch {
        res.status(500).json({
          error: "Failed to update billing Telegram preferences"
        });
      }
    }
  );

export default router;
