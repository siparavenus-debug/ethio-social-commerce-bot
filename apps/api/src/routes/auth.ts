import { Router } from "express";

import {
  rateLimit
} from "express-rate-limit";

import {
  authenticateUser,
  createAuthToken
} from "../services/auth.js";

import {
  requireAuth
} from "../middleware/auth.js";

const router = Router();

const loginRateLimiter =
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
 * POST /auth/login
 */
router.post(
  "/login",
  loginRateLimiter,
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
        await authenticateUser(
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
        createAuthToken(user);

      res.json({
        token,
        user: {
          id: user.id,
          merchantId:
            user.merchantId,
          email: user.email,
          displayName:
            user.displayName,
          role: user.role
        }
      });
    } catch (error) {
      console.error(
        "Merchant login failed:",
        error
      );

      res.status(500).json({
        error:
          "Authentication service failed"
      });
    }
  }
);

/*
 * GET /auth/me
 */
router.get(
  "/me",
  requireAuth,
  (req, res) => {
    if (!req.auth) {
      res.status(401).json({
        error:
          "Authentication required"
      });

      return;
    }

    res.json({
      user: req.auth
    });
  }
);

export default router;