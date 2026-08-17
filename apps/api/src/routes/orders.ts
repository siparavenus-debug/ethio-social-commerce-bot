import { Router } from "express";
import { prisma } from "@ethio-commerce/database";
import { sendTelegramMessage } from "../services/telegram.js";

const router = Router();

/**
 * List merchant orders.
 *
 * GET /merchants/:merchantId/orders
 */
router.get("/:merchantId/orders", async (req, res) => {
  try {
    const { merchantId } = req.params;

    const orders = await prisma.order.findMany({
      where: {
        merchantId
      },
      include: {
        customer: true,
        items: true,
        payments: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    res.json(orders);
  } catch (error) {
    console.error("Failed to list orders:", error);

    res.status(500).json({
      error: "Failed to list orders"
    });
  }
});

/**
 * Get one merchant order.
 *
 * GET /merchants/:merchantId/orders/:orderId
 */
router.get("/:merchantId/orders/:orderId", async (req, res) => {
  try {
    const { merchantId, orderId } = req.params;

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        merchantId
      },
      include: {
        customer: true,
        items: true,
        payments: true
      }
    });

    if (!order) {
      res.status(404).json({
        error: "Order not found"
      });
      return;
    }

    res.json(order);
  } catch (error) {
    console.error("Failed to get order:", error);

    res.status(500).json({
      error: "Failed to get order"
    });
  }
});

/**
 * Create an order.
 *
 * POST /merchants/:merchantId/orders
 *
 * Body:
 * {
 *   "customerId": "...",
 *   "orderNumber": "...",
 *   "currency": "ETB",
 *   "items": [
 *     {
 *       "productId": "...",
 *       "quantity": 1
 *     }
 *   ]
 * }
 *
 * Important:
 * Product stock is reserved/deducted inside the same
 * database transaction as order creation.
 */
router.post("/:merchantId/orders", async (req, res) => {
  try {
    const { merchantId } = req.params;

    const {
      customerId,
      orderNumber,
      currency,
      items
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
      typeof orderNumber !== "string" ||
      orderNumber.trim().length === 0
    ) {
      res.status(400).json({
        error: "orderNumber is required"
      });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        error: "items must be a non-empty array"
      });
      return;
    }

    if (customerId !== undefined && customerId !== null) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          merchantId
        }
      });

      if (!customer) {
        res.status(400).json({
          error: "Customer not found for this merchant"
        });
        return;
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      /*
       * Validate item structure before touching inventory.
       */
      const normalizedItems = items.map((item) => {
        if (
          !item ||
          typeof item.productId !== "string" ||
          item.productId.trim().length === 0
        ) {
          throw new Error(
            "Each item must contain a valid productId"
          );
        }

        const quantity = Number(item.quantity);

        if (
          !Number.isInteger(quantity) ||
          quantity <= 0
        ) {
          throw new Error(
            "Each item quantity must be a positive integer"
          );
        }

        return {
          productId: item.productId,
          quantity
        };
      });

      /*
       * Load all products belonging to this merchant.
       */
      const productIds = normalizedItems.map(
        (item) => item.productId
      );

      const products = await tx.product.findMany({
        where: {
          id: {
            in: productIds
          },
          merchantId
        }
      });

      /*
       * Make sure every requested product exists.
       */
      if (products.length !== productIds.length) {
        throw new Error(
          "One or more products were not found for this merchant"
        );
      }

      /*
       * Prevent duplicate product IDs from creating
       * confusing stock calculations.
       */
      const uniqueProductIds = new Set(productIds);

      if (
        uniqueProductIds.size !== productIds.length
      ) {
        throw new Error(
          "Each product may only appear once in an order"
        );
      }

      let subtotal = 0;

      const orderItems = normalizedItems.map(
        (item) => {
          const product = products.find(
            (product) =>
              product.id === item.productId
          );

          if (!product) {
            throw new Error(
              "Product lookup failed"
            );
          }

          if (product.status !== "ACTIVE") {
            throw new Error(
              `Product "${product.name}" is not active`
            );
          }

          if (product.stock < item.quantity) {
            throw new Error(
              `Insufficient stock for product "${product.name}". Available: ${product.stock}, requested: ${item.quantity}`
            );
          }

          const unitPrice = Number(product.price);

          const lineTotal =
            unitPrice * item.quantity;

          subtotal += lineTotal;

          return {
            product,
            quantity: item.quantity,
            unitPrice,
            lineTotal
          };
        }
      );

      /*
       * Create the order first.
       *
       * The stock changes below are part of this same
       * transaction. If anything fails, the order itself
       * will also be rolled back.
       */
      const createdOrder = await tx.order.create({
        data: {
          merchantId,
          customerId: customerId ?? null,
          orderNumber: orderNumber.trim(),
          currency:
            typeof currency === "string" &&
            currency.trim().length > 0
              ? currency.trim()
              : merchant.currency,
          subtotal,
          total: subtotal,
          items: {
            create: orderItems.map((item) => ({
              productId: item.product.id,
              productName: item.product.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal
            }))
          }
        }
      });

      /*
       * Atomically deduct stock.
       *
       * The WHERE clause includes:
       *   stock >= requested quantity
       *
       * This protects against stock becoming insufficient
       * between the earlier validation and this update.
       */
      for (const item of orderItems) {
        const updatedProduct =
          await tx.product.updateMany({
            where: {
              id: item.product.id,
              merchantId,
              stock: {
                gte: item.quantity
              }
            },
            data: {
              stock: {
                decrement: item.quantity
              }
            }
          });

        if (updatedProduct.count !== 1) {
          throw new Error(
            `Insufficient stock for product "${item.product.name}".`
          );
        }

        /*
         * Record the inventory movement for auditing.
         */
        await tx.auditLog.create({
          data: {
            merchantId,
            actorUserId: null,
            action: "PRODUCT_STOCK_DEDUCTED",
            entityType: "PRODUCT",
            entityId: item.product.id,
            metadata: {
              productName: item.product.name,
              quantityDeducted: item.quantity,
              previousStock: item.product.stock,
              newStock:
                item.product.stock -
                item.quantity,
              orderId: createdOrder.id,
              orderNumber:
                orderNumber.trim()
            }
          }
        });
      }

      /*
       * Return the complete order after inventory has
       * successfully been deducted.
       */
      return tx.order.findUniqueOrThrow({
        where: {
          id: createdOrder.id
        },
        include: {
          customer: true,
          items: true,
          payments: true
        }
      });
    });

    res.status(201).json(order);
  } catch (error) {
    console.error("Failed to create order:", error);

    res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to create order"
    });
  }
});

/**
 * Update order fulfillment status.
 *
 * POST /merchants/:merchantId/orders/:orderId/status
 *
 * Body:
 * {
 *   "status": "FULFILLING" | "FULFILLED"
 * }
 */
router.post(
  "/:merchantId/orders/:orderId/status",
  async (req, res) => {
    try {
      const {
        merchantId,
        orderId
      } = req.params;

      const { status } = req.body;

      if (
        status !== "FULFILLING" &&
        status !== "FULFILLED"
      ) {
        res.status(400).json({
          error:
            "status must be FULFILLING or FULFILLED"
        });
        return;
      }

      const result =
        await prisma.$transaction(async (tx) => {
          const order =
            await tx.order.findFirst({
              where: {
                id: orderId,
                merchantId
              },
              include: {
                customer: true
              }
            });

          if (!order) {
            return null;
          }

          /*
           * Enforce the fulfillment state machine.
           */
          if (
            status === "FULFILLING" &&
            order.status !== "PAID"
          ) {
            throw new Error(
              `Order must be PAID before fulfillment. Current status: ${order.status}`
            );
          }

          if (
            status === "FULFILLED" &&
            order.status !== "FULFILLING"
          ) {
            throw new Error(
              `Order must be FULFILLING before it can be fulfilled. Current status: ${order.status}`
            );
          }

          const updatedOrder =
            await tx.order.update({
              where: {
                id: order.id
              },
              data: {
                status
              },
              include: {
                customer: true,
                items: true,
                payments: true
              }
            });

          await tx.auditLog.create({
            data: {
              merchantId,
              actorUserId: null,
              action:
                status === "FULFILLING"
                  ? "ORDER_FULFILLING"
                  : "ORDER_FULFILLED",
              entityType: "ORDER",
              entityId: order.id,
              metadata: {
                orderNumber:
                  order.orderNumber,
                previousStatus:
                  order.status,
                newStatus: status
              }
            }
          });

          return updatedOrder;
        });

      if (!result) {
        res.status(404).json({
          error: "Order not found"
        });
        return;
      }

      /*
       * Telegram notification happens after the database
       * transaction succeeds. A Telegram failure must not
       * roll back the order status.
       */
      if (
        result.customer?.telegramChatId
      ) {
        try {
          if (status === "FULFILLING") {
            await sendTelegramMessage(
              result.customer.telegramChatId,
              `Order ${result.orderNumber} is now being prepared.`
            );
          } else {
            await sendTelegramMessage(
              result.customer.telegramChatId,
              `Order ${result.orderNumber} has been fulfilled. Thank you for shopping with us!`
            );
          }
        } catch (telegramError) {
          console.error(
            "Failed to send order status Telegram message:",
            telegramError
          );
        }
      }

      res.json({
        message:
          status === "FULFILLING"
            ? "Order marked as fulfilling"
            : "Order marked as fulfilled",
        order: result
      });
    } catch (error) {
      console.error(
        "Failed to update order status:",
        error
      );

      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to update order status"
      });
    }
  }
);

export default router;