import { Router } from "express";
import { prisma } from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess
} from "../middleware/auth.js";

const router = Router();

router.use(
  requireAuth,
  requireMerchantAccess
);

router.get("/:merchantId/products", async (req, res) => {
  try {
    const { merchantId } = req.params;

    const products = await prisma.product.findMany({
      where: {
        merchantId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    res.json(products);
  } catch (error) {
    console.error("Failed to list products:", error);

    res.status(500).json({
      error: "Failed to list products"
    });
  }
});

router.post("/:merchantId/products", async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { name, description, price, currency, stock, status } = req.body;

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({
        error: "name is required"
      });
      return;
    }

    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      res.status(400).json({
        error: "price must be a non-negative number"
      });
      return;
    }

    const numericStock = stock === undefined ? 0 : Number(stock);

    if (!Number.isInteger(numericStock) || numericStock < 0) {
      res.status(400).json({
        error: "stock must be a non-negative integer"
      });
      return;
    }

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

    const product = await prisma.product.create({
      data: {
        merchantId,
        name: name.trim(),
        description:
          typeof description === "string" && description.trim().length > 0
            ? description.trim()
            : null,
        price: numericPrice,
        currency:
          typeof currency === "string" && currency.trim().length > 0
            ? currency.trim().toUpperCase()
            : merchant.currency,
        stock: numericStock,
        status: status ?? "DRAFT"
      }
    });

    res.status(201).json(product);
  } catch (error) {
    console.error("Failed to create product:", error);

    res.status(500).json({
      error: "Failed to create product"
    });
  }
});

router.patch("/:merchantId/products/:productId", async (req, res) => {
  try {
    const { merchantId, productId } = req.params;
    const { stock } = req.body;

    const numericStock = Number(stock);

    if (!Number.isInteger(numericStock) || numericStock < 0) {
      res.status(400).json({
        error: "stock must be a non-negative integer"
      });
      return;
    }

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        merchantId
      }
    });

    if (!product) {
      res.status(404).json({
        error: "Product not found"
      });
      return;
    }

    const updatedProduct = await prisma.product.update({
      where: {
        id: product.id
      },
      data: {
        stock: numericStock
      }
    });

    res.json(updatedProduct);
  } catch (error) {
    console.error("Failed to update product:", error);

    res.status(500).json({
      error: "Failed to update product"
    });
  }
});

/**
 * Restock a product.
 *
 * POST /merchants/:merchantId/products/:productId/restock
 *
 * Body:
 * {
 *   "quantity": 10,
 *   "note": "New shipment received"
 * }
 */
router.post(
  "/:merchantId/products/:productId/restock",
  async (req, res) => {
    try {
      const { merchantId, productId } = req.params;
      const { quantity, note } = req.body;

      const numericQuantity = Number(quantity);

      if (
        !Number.isInteger(numericQuantity) ||
        numericQuantity <= 0
      ) {
        res.status(400).json({
          error: "quantity must be a positive integer"
        });
        return;
      }

      if (
        note !== undefined &&
        note !== null &&
        typeof note !== "string"
      ) {
        res.status(400).json({
          error: "note must be a string"
        });
        return;
      }

      const trimmedNote =
        typeof note === "string" && note.trim().length > 0
          ? note.trim()
          : null;

      const result = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findFirst({
          where: {
            id: productId,
            merchantId
          }
        });

        if (!product) {
          return null;
        }

        const updatedProduct = await tx.product.update({
          where: {
            id: product.id
          },
          data: {
            stock: {
              increment: numericQuantity
            }
          }
        });

        await tx.auditLog.create({
          data: {
            merchantId,
            actorUserId: null,
            action: "PRODUCT_RESTOCKED",
            entityType: "PRODUCT",
            entityId: product.id,
            metadata: {
              productName: product.name,
              quantityAdded: numericQuantity,
              previousStock: product.stock,
              newStock: updatedProduct.stock,
              note: trimmedNote
            }
          }
        });

        return updatedProduct;
      });

      if (!result) {
        res.status(404).json({
          error: "Product not found"
        });
        return;
      }

      res.json({
        message: "Product restocked successfully",
        product: result,
        quantityAdded: numericQuantity
      });
    } catch (error) {
      console.error("Failed to restock product:", error);

      res.status(500).json({
        error: "Failed to restock product"
      });
    }
  }
);

export default router;