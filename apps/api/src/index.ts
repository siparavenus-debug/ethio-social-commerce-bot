import express from "express";
import { env } from "./config/env.js";
import merchantsRouter from "./routes/merchants.js";
import productsRouter from "./routes/products.js";
import customersRouter from "./routes/customers.js";
import ordersRouter from "./routes/orders.js";
import conversationsRouter from "./routes/conversations.js";
import telegramRouter from "./routes/telegram.js";
import paymentMethodsRouter from "./routes/payment-methods.js";
import paymentsRouter from "./routes/payments.js";
import paymentReviewRouter from "./routes/payment-review.js";

async function start() {
  const app = express();

app.use((req, res, next) => {
  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
  ];

  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

  app.use(express.json());

  const { prisma } = await import("@ethio-commerce/database");

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "api"
    });
  });

  app.get("/health/db", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;

      res.json({
        status: "ok",
        service: "api",
        database: "connected"
      });
    } catch (error) {
      console.error("Database health check failed:", error);

      res.status(503).json({
        status: "error",
        service: "api",
        database: "unavailable"
      });
    }
  });

  app.use("/merchants", merchantsRouter);
  app.use("/merchants", productsRouter);
  app.use("/merchants", customersRouter);
  app.use("/merchants", ordersRouter);
  app.use("/merchants", conversationsRouter);
  app.use("/webhooks/telegram", telegramRouter);
  app.use("/merchants", paymentMethodsRouter);
  app.use("/merchants", paymentsRouter);
  app.use("/merchants", paymentReviewRouter);

  console.log(
    "REGISTERED ROUTES:",
    app.router?.stack
      ?.filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: layer.route.methods
      }))
  );
 

  app.listen(env.apiPort, () => {
    console.log(
      `API running on http://localhost:${env.apiPort}`
    );
  });
}

start().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});

