import { Router } from "express";
import { prisma } from "@ethio-commerce/database";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const merchants = await prisma.merchant.findMany({
      orderBy: {
        createdAt: "desc"
      }
    });

    res.json(merchants);
  } catch (error) {
    console.error("Failed to list merchants:", error);

    res.status(500).json({
      error: "Failed to list merchants"
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, currency } = req.body;

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({
        error: "name is required"
      });
      return;
    }

    const merchant = await prisma.merchant.create({
      data: {
        name: name.trim(),
        currency:
          typeof currency === "string" && currency.trim().length > 0
            ? currency.trim().toUpperCase()
            : "ETB"
      }
    });

    res.status(201).json(merchant);
  } catch (error) {
    console.error("Failed to create merchant:", error);

    res.status(500).json({
      error: "Failed to create merchant"
    });
  }
});

export default router;
