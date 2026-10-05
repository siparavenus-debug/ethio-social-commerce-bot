import { Router } from "express";
import { prisma } from "@ethio-commerce/database";
import { sendTelegramMessage } from "../services/telegram.js";

import {
  getActiveMerchantTelegramBotToken
} from "../services/merchant-telegram-integration.js";

import { sanitizeOrderForResponse } from "../services/order-response.js";
import {
  createDeliveryConfirmation,
  DELIVERY_CONFIRMATION_MAX_ATTEMPTS,
  verifyDeliveryConfirmationCode
} from "../services/delivery-security.js";

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

/**
 * List merchant orders.
 *
 * GET /merchants/:merchantId/orders
 */
router.get("/:merchantId/orders", requireMerchantAccess, async (req, res) => {
  try {
    const merchantId = String(req.params.merchantId);

    const orders = await prisma.order.findMany({
      where: {
        merchantId
      },
      include: {
        customer: true,
        items: true,
        ...(req.auth!.role === "STAFF"
          ? {}
          : { payments: true })
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    res.json(
      orders.map((order) =>
        sanitizeOrderForResponse(order)
      )
    );
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
router.get("/:merchantId/orders/:orderId", requireMerchantAccess, async (req, res) => {
  try {
    const merchantId = String(req.params.merchantId);
    const orderId = String(req.params.orderId);

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        merchantId
      },
      include: {
        customer: true,
        items: true,
        ...(req.auth!.role === "STAFF"
          ? {}
          : { payments: true })
      }
    });

    if (!order) {
      res.status(404).json({
        error: "Order not found"
      });
      return;
    }

    res.json(
      sanitizeOrderForResponse(order)
    );
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
router.post(
  "/:merchantId/orders",
  requireMerchantAccess,
  requireMerchantEntitlement(
    "CREATE_COMMERCE"
  ),
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
      const {
        customerId,
        orderNumber,
        currency,
        items,
        deliveryName,
        deliveryPhone,
        deliveryAddress
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

      if (
        typeof deliveryName !== "string" ||
        deliveryName.trim().length === 0
      ) {
        res.status(400).json({
          error: "deliveryName is required"
        });
        return;
      }

      if (
        typeof deliveryPhone !== "string" ||
        deliveryPhone.trim().length === 0
      ) {
        res.status(400).json({
          error: "deliveryPhone is required"
        });
        return;
      }

      if (deliveryPhone.trim().length > 50) {
        res.status(400).json({
          error:
            "deliveryPhone must be at most 50 characters"
        });
        return;
      }

      if (
        typeof deliveryAddress !== "string" ||
        deliveryAddress.trim().length === 0
      ) {
        res.status(400).json({
          error: "deliveryAddress is required"
        });
        return;
      }

      if (deliveryAddress.trim().length > 1000) {
        res.status(400).json({
          error:
            "deliveryAddress must be at most 1000 characters"
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
            deliveryName: deliveryName.trim(),
            deliveryPhone: deliveryPhone.trim(),
            deliveryAddress: deliveryAddress.trim(),
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
              actorUserId: req.auth!.id,
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

      res.status(201).json(
        sanitizeOrderForResponse(order)
      );
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
 *   "status": "FULFILLING"
 * }
 */
router.post(
  "/:merchantId/orders/:orderId/status",
  requireMerchantAccess, requireRole("OWNER", "ADMIN", "STAFF"),
  async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
      const orderId = String(req.params.orderId);

      const { status } = req.body;

      if (status !== "FULFILLING") {
        res.status(400).json({
          error:
            "status must be FULFILLING"
        });
        return;
      }

      let deliveryConfirmationCode:
        string | null = null;

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
          if (order.status !== "PAID") {
            throw new Error(
              `Order must be PAID before fulfillment. Current status: ${order.status}`
            );
          }

          const deliveryConfirmation = (() => {
            if (
              !order.deliveryName?.trim() ||
              !order.deliveryPhone?.trim() ||
              !order.deliveryAddress?.trim()
            ) {
              throw new Error(
                "Order must have complete delivery details before fulfillment."
              );
            }

            return createDeliveryConfirmation(
              order.id
            );
          })();

          deliveryConfirmationCode =
            deliveryConfirmation.code;

          const updatedOrder =
            await tx.order.update({
              where: {
                id: order.id
              },
              data: {
                status,
                deliveryConfirmationCodeHash:
                  deliveryConfirmation.codeHash,
                deliveryConfirmationCodeExpiresAt:
                  deliveryConfirmation.expiresAt,
                deliveryConfirmationAttempts: 0,
                deliveryConfirmationSentAt: null,
                deliveryConfirmedAt: null
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
              actorUserId: req.auth!.id,
              action: "ORDER_FULFILLING",
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
          if (!deliveryConfirmationCode) {
            throw new Error(
              "Delivery confirmation code was not generated."
            );
          }

          const botToken =
            await getActiveMerchantTelegramBotToken(
              merchantId
            );

          await sendTelegramMessage(
            botToken,
            result.customer.telegramChatId,
            `Order ${result.orderNumber} is now being prepared.\n\n` +
            `Your delivery confirmation code is: ${deliveryConfirmationCode}\n\n` +
            "Give this code to the merchant or delivery person only after you receive your order."
          );

          await prisma.order.updateMany({
            where: {
              id: result.id,
              merchantId,
              status: "FULFILLING",
              deliveryConfirmationCodeHash:
                result.deliveryConfirmationCodeHash,
              deliveryConfirmationSentAt: null
            },
            data: {
              deliveryConfirmationSentAt:
                new Date()
            }
          });
        } catch (telegramError) {
          console.error(
            "Failed to send order status Telegram message:",
            telegramError
          );
        }
      }

      res.json({
        message:
          "Order marked as fulfilling",
        order: sanitizeOrderForResponse(result)
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

/**
 * Confirm customer delivery using the customer-held code.
 *
 * POST /merchants/:merchantId/orders/:orderId/delivery-confirmation
 *
 * Body:
 * {
 *   "code": "123456"
 * }
 */
router.post(
  "/:merchantId/orders/:orderId/delivery-confirmation",
  requireMerchantAccess,
  requireRole("OWNER", "ADMIN", "STAFF"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const orderId =
        String(req.params.orderId);

      const { code } =
        req.body;

      if (
        typeof code !== "string" ||
        !/^\d{6}$/.test(code)
      ) {
        res.status(400).json({
          error:
            "code must be a 6-digit number"
        });
        return;
      }

      const result =
        await prisma.$transaction(
          async (tx) => {
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
              return {
                kind:
                  "NOT_FOUND" as const
              };
            }

            if (
              order.status !==
              "FULFILLING"
            ) {
              return {
                kind:
                  "INVALID_STATUS" as const
              };
            }

            if (
              !order
                .deliveryConfirmationCodeHash ||
              !order
                .deliveryConfirmationCodeExpiresAt
            ) {
              return {
                kind:
                  "MISSING_CONFIRMATION" as const
              };
            }

            if (
              order
                .deliveryConfirmationAttempts >=
              DELIVERY_CONFIRMATION_MAX_ATTEMPTS
            ) {
              return {
                kind:
                  "ATTEMPT_LIMIT" as const
              };
            }

            if (
              order
                .deliveryConfirmationCodeExpiresAt
                .getTime() <=
              Date.now()
            ) {
              return {
                kind:
                  "EXPIRED" as const
              };
            }

            const validCode =
              verifyDeliveryConfirmationCode(
                order.id,
                code,
                order
                  .deliveryConfirmationCodeHash
              );

            if (!validCode) {
              const attemptResult =
                await tx.order.updateMany({
                  where: {
                    id: order.id,
                    merchantId,
                    status:
                      "FULFILLING",
                    deliveryConfirmationCodeHash:
                      order
                        .deliveryConfirmationCodeHash,
                    deliveryConfirmationCodeExpiresAt:
                      order
                        .deliveryConfirmationCodeExpiresAt,
                    deliveryConfirmationAttempts: {
                      lt:
                        DELIVERY_CONFIRMATION_MAX_ATTEMPTS
                    }
                  },
                  data: {
                    deliveryConfirmationAttempts: {
                      increment: 1
                    }
                  }
                });

              if (
                attemptResult.count !== 1
              ) {
                return {
                  kind:
                    "ALREADY_CLAIMED" as const
                };
              }

              return {
                kind:
                  "INVALID_CODE" as const
              };
            }

            const confirmedAt =
              new Date();

            const claimResult =
              await tx.order.updateMany({
                where: {
                  id: order.id,
                  merchantId,
                  status:
                    "FULFILLING",
                  deliveryConfirmationCodeHash:
                    order
                      .deliveryConfirmationCodeHash,
                  deliveryConfirmationCodeExpiresAt:
                    order
                      .deliveryConfirmationCodeExpiresAt
                },
                data: {
                  status:
                    "FULFILLED",
                  deliveryConfirmedAt:
                    confirmedAt,
                  deliveryConfirmationCodeHash:
                    null,
                  deliveryConfirmationCodeExpiresAt:
                    null,
                  deliveryConfirmationSentAt:
                    null
                }
              });

            if (
              claimResult.count !== 1
            ) {
              return {
                kind:
                  "ALREADY_CLAIMED" as const
              };
            }

            const fulfilledOrder =
              await tx.order.findUniqueOrThrow({
                where: {
                  id: order.id
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
                actorUserId:
                  req.auth!.id,
                action:
                  "ORDER_FULFILLED",
                entityType:
                  "ORDER",
                entityId:
                  order.id,
                metadata: {
                  orderNumber:
                    order.orderNumber,
                  previousStatus:
                    order.status,
                  newStatus:
                    "FULFILLED"
                }
              }
            });

            return {
              kind:
                "CONFIRMED" as const,
              order:
                fulfilledOrder
            };
          }
        );

      if (
        result.kind ===
        "NOT_FOUND"
      ) {
        res.status(404).json({
          error: "Order not found"
        });
        return;
      }

      if (
        result.kind ===
        "INVALID_STATUS"
      ) {
        res.status(400).json({
          error:
            "Order must be FULFILLING before delivery confirmation"
        });
        return;
      }

      if (
        result.kind ===
        "MISSING_CONFIRMATION"
      ) {
        res.status(400).json({
          error:
            "Delivery confirmation is not available for this order"
        });
        return;
      }

      if (
        result.kind ===
        "ATTEMPT_LIMIT"
      ) {
        res.status(400).json({
          error:
            "Delivery confirmation attempt limit reached"
        });
        return;
      }

      if (
        result.kind ===
        "EXPIRED"
      ) {
        res.status(400).json({
          error:
            "Delivery confirmation code has expired"
        });
        return;
      }

      if (
        result.kind ===
        "INVALID_CODE"
      ) {
        res.status(400).json({
          error:
            "Invalid delivery confirmation code"
        });
        return;
      }

      if (
        result.kind ===
        "ALREADY_CLAIMED"
      ) {
        res.status(409).json({
          error:
            "Delivery confirmation was already processed"
        });
        return;
      }

      if (
        result.order.customer
          ?.telegramChatId
      ) {
        try {
          const botToken =
            await getActiveMerchantTelegramBotToken(
              merchantId
            );

          await sendTelegramMessage(
            botToken,
            result.order.customer
              .telegramChatId,
            `Order ${result.order.orderNumber} has been delivered and confirmed.\n\n` +
            "Thank you for your order."
          );
        } catch (telegramError) {
          console.error(
            "Failed to send delivery confirmation Telegram message:",
            telegramError
          );
        }
      }

      res.json({
        message:
          "Delivery confirmed and order fulfilled",
        order:
          sanitizeOrderForResponse(
            result.order
          )
      });
    } catch (error) {
      console.error(
        "Failed to confirm order delivery:",
        error
      );

      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to confirm order delivery"
      });
    }
  }
);

/**
 * Rotate and resend the delivery confirmation code.
 *
 * POST /merchants/:merchantId/orders/:orderId/delivery-confirmation/resend
 *
 * The previous confirmation code is invalidated.
 * The new plaintext code is sent only to the customer.
 */
router.post(
  "/:merchantId/orders/:orderId/delivery-confirmation/resend",
  requireMerchantAccess,
  requireRole("OWNER", "ADMIN", "STAFF"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const orderId =
        String(req.params.orderId);

      let deliveryConfirmationCode:
        string | null = null;

      const result =
        await prisma.$transaction(
          async (tx) => {
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
              return {
                kind:
                  "NOT_FOUND" as const
              };
            }

            if (
              order.status !==
              "FULFILLING"
            ) {
              return {
                kind:
                  "INVALID_STATUS" as const
              };
            }

            if (
              !order.deliveryName?.trim() ||
              !order.deliveryPhone?.trim() ||
              !order.deliveryAddress?.trim()
            ) {
              return {
                kind:
                  "MISSING_DELIVERY" as const
              };
            }

            if (
              !order.customer
                ?.telegramChatId
            ) {
              return {
                kind:
                  "NO_TELEGRAM" as const
              };
            }

            const now =
              new Date();

            const confirmationMissing =
              !order
                .deliveryConfirmationCodeHash ||
              !order
                .deliveryConfirmationCodeExpiresAt;

            const confirmationExpired =
              order
                .deliveryConfirmationCodeExpiresAt !==
              null &&
              order
                .deliveryConfirmationCodeExpiresAt
                .getTime() <=
              now.getTime();

            const attemptsExhausted =
              order
                .deliveryConfirmationAttempts >=
              DELIVERY_CONFIRMATION_MAX_ATTEMPTS;
            const confirmationNotSent =
              order.deliveryConfirmationSentAt === null;

            if (
              !confirmationMissing &&
              !confirmationExpired &&
              !attemptsExhausted &&
              !confirmationNotSent
            ) {
              return {
                kind:
                  "CONFIRMATION_ACTIVE" as const
              };
            }

            const deliveryConfirmation =
              createDeliveryConfirmation(
                order.id
              );

            const claimResult =
              await tx.order.updateMany({
                where: {
                  id:
                    order.id,
                  merchantId,
                  status:
                    "FULFILLING",
                  deliveryConfirmationCodeHash:
                    order
                      .deliveryConfirmationCodeHash,
                  deliveryConfirmationCodeExpiresAt:
                    order
                      .deliveryConfirmationCodeExpiresAt,
                  deliveryConfirmationAttempts:
                    order.deliveryConfirmationAttempts,
                  deliveryConfirmationSentAt:
                    order.deliveryConfirmationSentAt
                },
                data: {
                  deliveryConfirmationCodeHash:
                    deliveryConfirmation.codeHash,
                  deliveryConfirmationCodeExpiresAt:
                    deliveryConfirmation.expiresAt,
                  deliveryConfirmationAttempts:
                    0,
                  deliveryConfirmationSentAt:
                    null
                }
              });

            if (
              claimResult.count !== 1
            ) {
              return {
                kind:
                  "ALREADY_ROTATED" as const
              };
            }

            deliveryConfirmationCode =
              deliveryConfirmation.code;

            const updatedOrder =
              await tx.order
                .findUniqueOrThrow({
                  where: {
                    id:
                      order.id
                  },
                  include: {
                    customer:
                      true,
                    items:
                      true,
                    payments:
                      true
                  }
                });

            await tx.auditLog.create({
              data: {
                merchantId,
                actorUserId:
                  req.auth!.id,
                action:
                  "DELIVERY_CONFIRMATION_ROTATED",
                entityType:
                  "ORDER",
                entityId:
                  order.id,
                metadata: {
                  orderNumber:
                    order.orderNumber
                }
              }
            });

            return {
              kind:
                "ROTATED" as const,
              order:
                updatedOrder
            };
          }
        );

      if (
        result.kind ===
        "NOT_FOUND"
      ) {
        res.status(404).json({
          error:
            "Order not found"
        });
        return;
      }

      if (
        result.kind ===
        "INVALID_STATUS"
      ) {
        res.status(400).json({
          error:
            "Order must be FULFILLING before delivery confirmation can be resent"
        });
        return;
      }

      if (
        result.kind ===
        "MISSING_DELIVERY"
      ) {
        res.status(400).json({
          error:
            "Order must have complete delivery details before delivery confirmation can be resent"
        });
        return;
      }

      if (
        result.kind ===
        "NO_TELEGRAM"
      ) {
        res.status(400).json({
          error:
            "Customer does not have a Telegram chat for delivery confirmation"
        });
        return;
      }

      if (
        result.kind ===
        "CONFIRMATION_ACTIVE"
      ) {
        res.status(409).json({
          error:
            "Delivery confirmation code is still active"
        });
        return;
      }

      if (
        result.kind ===
        "ALREADY_ROTATED"
      ) {
        res.status(409).json({
          error:
            "Delivery confirmation was already changed"
        });
        return;
      }

      if (
        !deliveryConfirmationCode
      ) {
        throw new Error(
          "Delivery confirmation code was not generated."
        );
      }

      try {
        const botToken =
          await getActiveMerchantTelegramBotToken(
            merchantId
          );

        await sendTelegramMessage(
          botToken,
          result.order.customer!
            .telegramChatId!,
          `Order ${result.order.orderNumber} delivery confirmation code is: ${deliveryConfirmationCode}\n\n` +
          "This replaces your previous delivery confirmation code. Give this code to the merchant or delivery person only after you receive your order."
        );

        await prisma.order.updateMany({
          where: {
            id: result.order.id,
            merchantId,
            status: "FULFILLING",
            deliveryConfirmationCodeHash:
              result.order.deliveryConfirmationCodeHash,
            deliveryConfirmationSentAt: null
          },
          data: {
            deliveryConfirmationSentAt:
              new Date()
          }
        });
      } catch (telegramError) {
        console.error(
          "Failed to resend delivery confirmation Telegram message:",
          telegramError
        );
      }

      res.json({
        message:
          "Delivery confirmation code rotated and resent",
        order:
          sanitizeOrderForResponse(
            result.order
          )
      });
    } catch (error) {
      console.error(
        "Failed to rotate delivery confirmation code:",
        error
      );

      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to rotate delivery confirmation code"
      });
    }
  }
);

export default router;
