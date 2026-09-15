import express from "express";
import rateLimit from "express-rate-limit";

import { env } from "./config/env.js";

import authRouter from "./routes/auth.js";
import platformAuthRouter from "./routes/platform-auth.js";
import platformAdminRouter from "./routes/platform-admin.js";
import merchantsRouter from "./routes/merchants.js";
import merchantProfileRouter from "./routes/merchant-profile.js";
import productsRouter from "./routes/products.js";
import customersRouter from "./routes/customers.js";
import ordersRouter from "./routes/orders.js";
import conversationsRouter from "./routes/conversations.js";
import telegramRouter from "./routes/telegram.js";
import paymentMethodsRouter from "./routes/payment-methods.js";
import paymentsRouter from "./routes/payments.js";
import merchantSettlementsRouter from "./routes/merchant-settlements.js";
import merchantUsersRouter from "./routes/merchant-users.js";

async function start() {
  const app = express();

  /*
   * Trust the reverse proxy / Cloudflare Tunnel.
   *
   * This allows Express to correctly determine the
   * original client IP from X-Forwarded-For.
   *
   * Required for express-rate-limit when the API is
   * accessed through a proxy.
   */
  app.set("trust proxy", 1);

  /*
   * CORS
   *
   * The Authorization header is explicitly allowed
   * because the merchant dashboard uses Bearer tokens.
   */
  app.use((req, res, next) => {
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:5174"
    ];

    const origin =
      req.headers.origin;

    if (
      origin &&
      allowedOrigins.includes(origin)
    ) {
      res.header(
        "Access-Control-Allow-Origin",
        origin
      );

      res.header(
        "Vary",
        "Origin"
      );
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

  /*
   * General API rate limiting.
   *
   * Protects the API from excessive request bursts
   * while allowing normal merchant-dashboard usage.
   */
  const generalApiLimiter =
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error:
          "Too many requests. Please try again later."
      }
    });

  /*
   * Login rate limiting.
   *
   * Login receives a stricter limit because repeated
   * authentication attempts are a common abuse target.
   */
  const loginLimiter =
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error:
          "Too many login attempts. Please try again later."
      }
    });

  /*
   * Telegram webhook rate limiting.
   *
   * Telegram webhook traffic is handled separately
   * from authenticated merchant API traffic.
   */
  const telegramWebhookLimiter =
    rateLimit({
      windowMs: 60 * 1000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error:
          "Too many webhook requests."
      }
    });

  /*
   * Health check.
   *
   * Kept outside the general API rate limiter so it
   * remains available for monitoring.
   */
  app.get(
    "/health",
    (_req, res) => {
      res.json({
        status: "ok",
        service: "api"
      });
    }
  );

  /*
   * Database health check.
   */
  app.get(
    "/health/db",
    async (_req, res) => {
      try {
        const { prisma } =
          await import(
            "@ethio-commerce/database"
          );

        await prisma.$queryRaw`SELECT 1`;

        res.json({
          status: "ok",
          service: "api",
          database: "connected"
        });
      } catch (error) {
        console.error(
          "Database health check failed:",
          error
        );

        res.status(503).json({
          status: "error",
          service: "api",
          database: "unavailable"
        });
      }
    }
  );

  /*
   * Telegram webhook.
   *
   * IMPORTANT:
   *
   * This is mounted BEFORE the general JSON parser.
   * Therefore Telegram gets its own JSON body limit.
   *
   * The webhook itself does not use merchant
   * authentication because Telegram calls it directly.
   */
  app.use(
    "/webhooks/telegram",
    express.json({
      limit: "100kb"
    }),
    telegramWebhookLimiter,
    telegramRouter
  );

  /*
   * General JSON body-size protection.
   *
   * Normal API endpoints should not need large JSON
   * request bodies.
   */
  app.use(
    express.json({
      limit: "100kb"
    })
  );

  /*
   * General API rate limiting.
   *
   * Applied to normal API routes after health checks
   * and the separately handled Telegram webhook.
   */
  app.use(
    generalApiLimiter
  );

  /*
   * Authentication routes.
   *
   * Login has an additional stricter limiter.
   */
  app.use(
    "/auth/login",
    loginLimiter
  );

  app.use(
    "/auth",
    authRouter
  );

  /*
 * Platform authentication routes.
 *
 * Platform identity is intentionally separate from
 * merchant identity. There is no public platform
 * registration endpoint.
 */
  app.use(
    "/platform/auth",
    platformAuthRouter
  );

  app.use(
    "/platform",
    platformAdminRouter
  );

  /*
   * Protected merchant routes.
   *
   * Authentication is enforced inside the
   * merchant routers themselves.
   */
  app.use(
    "/merchants",
    merchantsRouter
  );

  app.use(
    "/merchants",
    merchantProfileRouter
  );

  app.use(
    "/merchants",
    productsRouter
  );

  app.use(
    "/merchants",
    merchantUsersRouter
  );

  app.use(
    "/merchants",
    customersRouter
  );

  app.use(
    "/merchants",
    ordersRouter
  );

  app.use(
    "/merchants",
    conversationsRouter
  );

  app.use(
    "/merchants",
    paymentMethodsRouter
  );

  app.use(
    "/merchants",
    paymentsRouter

  );

  app.use(
    "/merchants",
    merchantSettlementsRouter
  );

  console.log(
    `API running on http://localhost:${env.apiPort}`
  );

  app.listen(
    env.apiPort,
    () => {
      console.log(
        `API listening on port ${env.apiPort}`
      );
    }
  );
}

start().catch(
  (error) => {
    console.error(
      "Failed to start API:",
      error
    );

    process.exit(1);
  }
);
