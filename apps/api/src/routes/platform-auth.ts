import { Router } from "express";

import {
  rateLimit
} from "express-rate-limit";

import {
  authenticatePlatformUser,
  createPlatformAuthToken
} from "../services/platform-auth.js";

import {
  requirePlatformAuth
} from "../middleware/platform-auth.js";

const router = Router();

const platformLoginRateLimiter =
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
 * POST /platform/auth/login
 *
 * Platform authentication is intentionally separate
 * from merchant authentication.
 *
 * There is no public platform registration route.
 */
router.post(
  "/login",
  platformLoginRateLimiter,
  async (req, res) => {
    try {
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim()
          : "";

      const password =
        typeof req.body?.password === "string"
          ? req.body.password
          : "";

      if (!email || !password) {
        res.status(400).json({
          error:
            "Email and password are required"
        });

        return;
      }

      const user =
        await authenticatePlatformUser(
          email,
          password
        );

      if (!user) {
        res.status(401).json({
          error:
            "Invalid email or password"
        });

        return;
      }

      const token =
        createPlatformAuthToken(user);

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName:
            user.displayName
        }
      });
    } catch (error) {
      console.error(
        "Platform login failed:",
        error
      );

      res.status(500).json({
        error:
          "Platform authentication service failed"
      });
    }
  }
);

/*
 * GET /platform/auth/me
 */
router.get(
  "/me",
  requirePlatformAuth,
  (req, res) => {
    if (!req.platformAuth) {
      res.status(401).json({
        error:
          "Platform authentication required"
      });

      return;
    }

    res.json({
      user: req.platformAuth
    });
  }
);

export default router;