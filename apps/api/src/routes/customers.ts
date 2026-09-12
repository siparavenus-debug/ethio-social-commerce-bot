import { Router } from "express";
import { prisma } from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../middleware/auth.js";

import {
requireMerchantEntitlement
} from "../middleware/subscription-entitlement.js";

const router = Router();

router.use(requireAuth);

router.get("/:merchantId/customers", requireMerchantAccess, async (req, res) => {
  try {
    const merchantId = String(req.params.merchantId);

    const customers = await prisma.customer.findMany({
      where: {
        merchantId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    res.json(customers);
  } catch (error) {
    console.error("Failed to list customers:", error);

    res.status(500).json({
      error: "Failed to list customers"
    });
  }
});

router.get("/:merchantId/customers/:customerId", requireMerchantAccess, async (req, res) => {
  try {
    const merchantId = String(req.params.merchantId);
    const customerId = String(req.params.customerId);

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        merchantId
      }
    });

    if (!customer) {
      res.status(404).json({
        error: "Customer not found"
      });
      return;
    }

    res.json(customer);
  } catch (error) {
    console.error("Failed to get customer:", error);

    res.status(500).json({
      error: "Failed to get customer"
    });
  }
});

router.post(
  "/:merchantId/customers",
  requireMerchantAccess,
  requireMerchantEntitlement(
    "MUTATE_CUSTOMER"
  ),
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
      const {
        name,
        phone,
        telegramChatId,
        telegramUserId
      } = req.body;

      const merchant = await prisma.merchant.findUnique({
        where: {
          id: merchantId
        }
      });

      if (!merchant) {
        res.status(404).json({
          error: "Merchant not found"
        });
        return;
      }

      if (
        name !== undefined &&
        name !== null &&
        typeof name !== "string"
      ) {
        res.status(400).json({
          error: "name must be a string"
        });
        return;
      }

      const customer = await prisma.customer.create({
        data: {
          merchantId,
          name:
            typeof name === "string" && name.trim().length > 0
              ? name.trim()
              : null,
          phone:
            typeof phone === "string" && phone.trim().length > 0
              ? phone.trim()
              : null,
          telegramChatId:
            typeof telegramChatId === "string" &&
              telegramChatId.trim().length > 0
              ? telegramChatId.trim()
              : null,
          telegramUserId:
            typeof telegramUserId === "string" &&
              telegramUserId.trim().length > 0
              ? telegramUserId.trim()
              : null
        }
      });

      res.status(201).json(customer);
    } catch (error) {
      console.error("Failed to create customer:", error);

      res.status(500).json({
        error: "Failed to create customer"
      });
    }
  });

router.patch(
  "/:merchantId/customers/:customerId",
  requireMerchantAccess,
  requireMerchantEntitlement(
    "MUTATE_CUSTOMER"
  ),
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
      const customerId = String(req.params.customerId);
      const {
        name,
        phone,
        telegramChatId,
        telegramUserId
      } = req.body;

      const existingCustomer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          merchantId
        }
      });

      if (!existingCustomer) {
        res.status(404).json({
          error: "Customer not found"
        });
        return;
      }

      if (
        name !== undefined &&
        name !== null &&
        typeof name !== "string"
      ) {
        res.status(400).json({
          error: "name must be a string"
        });
        return;
      }

      const customer = await prisma.customer.update({
        where: {
          id: customerId
        },
        data: {
          ...(name !== undefined && {
            name:
              typeof name === "string" && name.trim().length > 0
                ? name.trim()
                : null
          }),
          ...(phone !== undefined && {
            phone:
              typeof phone === "string" && phone.trim().length > 0
                ? phone.trim()
                : null
          }),
          ...(telegramChatId !== undefined && {
            telegramChatId:
              typeof telegramChatId === "string" &&
                telegramChatId.trim().length > 0
                ? telegramChatId.trim()
                : null
          }),
          ...(telegramUserId !== undefined && {
            telegramUserId:
              typeof telegramUserId === "string" &&
                telegramUserId.trim().length > 0
                ? telegramUserId.trim()
                : null
          })
        }
      });

      res.json(customer);
    } catch (error) {
      console.error("Failed to update customer:", error);

      res.status(500).json({
        error: "Failed to update customer"
      });
    }
  });

router.delete(
  "/:merchantId/customers/:customerId",
  requireMerchantAccess,
  requireMerchantEntitlement(
    "MUTATE_CUSTOMER"
  ),
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
      const customerId = String(req.params.customerId);

      const existingCustomer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          merchantId
        }
      });

      if (!existingCustomer) {
        res.status(404).json({
          error: "Customer not found"
        });
        return;
      }

      await prisma.customer.delete({
        where: {
          id: customerId
        }
      });

      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete customer:", error);

      res.status(500).json({
        error: "Failed to delete customer"
      });
    }
  });

export default router;
