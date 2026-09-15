import { Router } from "express";
import { prisma } from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../middleware/auth.js";

const router = Router();

const MAX_PHONE_LENGTH = 50;
const MAX_ADDRESS_LENGTH = 1000;

router.use(requireAuth);

router.get(
  "/:merchantId/profile",
  requireMerchantAccess,
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const merchant =
        await prisma.merchant.findUnique({
          where: {
            id: merchantId
          },
          select: {
            id: true,
            name: true,
            currency: true,
            phone: true,
            alternatePhone: true,
            address: true,
            createdAt: true,
            updatedAt: true
          }
        });

      if (!merchant) {
        res.status(404).json({
          error: "Merchant not found"
        });
        return;
      }

      res.json(merchant);
    } catch (error) {
      console.error(
        "Failed to get merchant profile:",
        error
      );

      res.status(500).json({
        error:
          "Failed to get merchant profile"
      });
    }
  }
);

router.patch(
  "/:merchantId/profile",
  requireMerchantAccess,
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const {
        phone,
        alternatePhone,
        address
      } = req.body ?? {};

      const suppliedFields = [
        ["phone", phone],
        ["alternatePhone", alternatePhone],
        ["address", address]
      ] as const;

      const hasSupportedField =
        suppliedFields.some(
          ([field]) =>
            Object.prototype.hasOwnProperty.call(
              req.body ?? {},
              field
            )
        );

      if (!hasSupportedField) {
        res.status(400).json({
          error:
            "At least one profile field must be provided"
        });
        return;
      }

      for (
        const [field, value] of suppliedFields
      ) {
        if (
          value !== undefined &&
          value !== null &&
          typeof value !== "string"
        ) {
          res.status(400).json({
            error:
              `${field} must be a string or null`
          });
          return;
        }
      }

      if (
        typeof phone === "string" &&
        phone.trim().length >
          MAX_PHONE_LENGTH
      ) {
        res.status(400).json({
          error:
            `phone must be at most ${MAX_PHONE_LENGTH} characters`
        });
        return;
      }

      if (
        typeof alternatePhone === "string" &&
        alternatePhone.trim().length >
          MAX_PHONE_LENGTH
      ) {
        res.status(400).json({
          error:
            `alternatePhone must be at most ${MAX_PHONE_LENGTH} characters`
        });
        return;
      }

      if (
        typeof address === "string" &&
        address.trim().length >
          MAX_ADDRESS_LENGTH
      ) {
        res.status(400).json({
          error:
            `address must be at most ${MAX_ADDRESS_LENGTH} characters`
        });
        return;
      }

      const existingMerchant =
        await prisma.merchant.findUnique({
          where: {
            id: merchantId
          },
          select: {
            id: true,
            phone: true,
            alternatePhone: true,
            address: true
          }
        });

      if (!existingMerchant) {
        res.status(404).json({
          error: "Merchant not found"
        });
        return;
      }

      const normalizeNullableString = (
        value: string | null
      ): string | null => {
        if (value === null) {
          return null;
        }

        const trimmed = value.trim();

        return trimmed.length > 0
          ? trimmed
          : null;
      };

      const data = {
        ...(phone !== undefined && {
          phone:
            normalizeNullableString(phone)
        }),
        ...(alternatePhone !== undefined && {
          alternatePhone:
            normalizeNullableString(
              alternatePhone
            )
        }),
        ...(address !== undefined && {
          address:
            normalizeNullableString(address)
        })
      };

      const changedFields: string[] = [];

      if (
        phone !== undefined &&
        data.phone !== existingMerchant.phone
      ) {
        changedFields.push("phone");
      }

      if (
        alternatePhone !== undefined &&
        data.alternatePhone !==
          existingMerchant.alternatePhone
      ) {
        changedFields.push(
          "alternatePhone"
        );
      }

      if (
        address !== undefined &&
        data.address !==
          existingMerchant.address
      ) {
        changedFields.push("address");
      }

      const merchant =
        await prisma.$transaction(
          async (tx) => {
            const updatedMerchant =
              await tx.merchant.update({
                where: {
                  id: merchantId
                },
                data,
                select: {
                  id: true,
                  name: true,
                  currency: true,
                  phone: true,
                  alternatePhone: true,
                  address: true,
                  createdAt: true,
                  updatedAt: true
                }
              });

            if (changedFields.length > 0) {
              await tx.auditLog.create({
                data: {
                  merchantId,
                  actorUserId:
                    req.auth!.id,
                  action:
                    "MERCHANT_PROFILE_UPDATED",
                  entityType:
                    "MERCHANT",
                  entityId:
                    merchantId,
                  metadata: {
                    changedFields
                  }
                }
              });
            }

            return updatedMerchant;
          }
        );

      res.json(merchant);
    } catch (error) {
      console.error(
        "Failed to update merchant profile:",
        error
      );

      res.status(500).json({
        error:
          "Failed to update merchant profile"
      });
    }
  }
);

export default router;