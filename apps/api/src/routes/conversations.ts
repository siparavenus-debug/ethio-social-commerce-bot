import { Router } from "express";
import { prisma } from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess
} from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/:merchantId/conversations", requireMerchantAccess,async (req, res) => {
  try {
    const merchantId = String(req.params.merchantId);

    const conversations = await prisma.conversation.findMany({
      where: {
        merchantId
      },
      include: {
        customer: true,
        messages: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    res.json(conversations);
  } catch (error) {
    console.error("Failed to list conversations:", error);

    res.status(500).json({
      error: "Failed to list conversations"
    });
  }
});

router.post("/:merchantId/conversations", requireMerchantAccess,async (req, res) => {
  try {
    const merchantId = String(req.params.merchantId);
    const {
      customerId,
      channel,
      externalId
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

    if (channel !== "TELEGRAM") {
      res.status(400).json({
        error: "Invalid conversation channel"
      });
      return;
    }

    if (
      typeof externalId !== "string" ||
      externalId.trim().length === 0
    ) {
      res.status(400).json({
        error: "externalId is required"
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

    const conversation = await prisma.conversation.create({
      data: {
        merchantId,
        customerId: customerId ?? null,
        channel,
        externalId: externalId.trim()
      },
      include: {
        customer: true,
        messages: true
      }
    });

    res.status(201).json(conversation);
  } catch (error) {
    console.error("Failed to create conversation:", error);

    if (
      error instanceof Error &&
      error.message.includes("Unique constraint")
    ) {
      res.status(409).json({
        error: "Conversation already exists"
      });
      return;
    }

    res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to create conversation"
    });
  }
});

router.get(
  "/:merchantId/conversations/:conversationId",
  requireMerchantAccess,async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
  const conversationId = String(req.params.conversationId);

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          merchantId
        },
        include: {
          customer: true,
          messages: {
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      });

      if (!conversation) {
        res.status(404).json({
          error: "Conversation not found"
        });
        return;
      }

      res.json(conversation);
    } catch (error) {
      console.error("Failed to get conversation:", error);

      res.status(500).json({
        error: "Failed to get conversation"
      });
    }
  }
);

router.get(
  "/:merchantId/conversations/:conversationId/messages",
  requireMerchantAccess,async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
  const conversationId = String(req.params.conversationId);

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          merchantId
        }
      });

      if (!conversation) {
        res.status(404).json({
          error: "Conversation not found"
        });
        return;
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId
        },
        orderBy: {
          createdAt: "asc"
        }
      });

      res.json(messages);
    } catch (error) {
      console.error("Failed to list messages:", error);

      res.status(500).json({
        error: "Failed to list messages"
      });
    }
  }
);

router.post(
  "/:merchantId/conversations/:conversationId/messages",
  requireMerchantAccess,async (req, res) => {
    try {
      const merchantId = String(req.params.merchantId);
  const conversationId = String(req.params.conversationId);

      const {
        direction,
        externalId,
        content
      } = req.body;

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          merchantId
        }
      });

      if (!conversation) {
        res.status(404).json({
          error: "Conversation not found"
        });
        return;
      }

      if (
        direction !== "INBOUND" &&
        direction !== "OUTBOUND"
      ) {
        res.status(400).json({
          error: "Invalid message direction"
        });
        return;
      }

      if (
        typeof content !== "string" ||
        content.trim().length === 0
      ) {
        res.status(400).json({
          error: "content is required"
        });
        return;
      }

      const message = await prisma.message.create({
        data: {
          conversationId,
          direction,
          externalId:
            typeof externalId === "string" &&
            externalId.trim().length > 0
              ? externalId.trim()
              : null,
          content: content.trim()
        }
      });

      res.status(201).json(message);
    } catch (error) {
      console.error("Failed to create message:", error);

      if (
        error instanceof Error &&
        error.message.includes("Unique constraint")
      ) {
        res.status(409).json({
          error: "Message with this external ID already exists"
        });
        return;
      }

      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create message"
      });
    }
  }
);

export default router;
