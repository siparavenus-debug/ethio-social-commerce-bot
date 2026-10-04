import { Router } from "express";

import {
  rateLimit
} from "express-rate-limit";

import {
  prisma
} from "@ethio-commerce/database";

import {
  authenticateUser,
  createAuthToken,
  hashPassword,
  verifyPassword
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
 * PATCH /auth/password
 *
 * An authenticated merchant user may change only their own
 * password. Successful rotation increments tokenVersion,
 * invalidating every previously issued merchant token.
 */
router.patch(
  "/password",
  requireAuth,
  async (req, res) => {
    try {
      const userId =
        req.auth?.id;

      if (!userId) {
        res.status(401).json({
          error:
            "Authentication required"
        });

        return;
      }

      const currentPassword =
        typeof req.body?.currentPassword ===
        "string"
          ? req.body.currentPassword
          : "";

      const newPassword =
        typeof req.body?.newPassword ===
        "string"
          ? req.body.newPassword
          : "";

      if (
        !currentPassword ||
        !newPassword
      ) {
        res.status(400).json({
          error:
            "Current password and new password are required"
        });

        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({
          error:
            "New password must be at least 8 characters"
        });

        return;
      }

      const user =
        await prisma.merchantUser.findUnique({
          where: {
            id:
              userId
          },
          select: {
            passwordHash:
              true
          }
        });

      if (!user) {
        res.status(401).json({
          error:
            "Authentication required"
        });

        return;
      }

      const currentPasswordMatches =
        await verifyPassword(
          currentPassword,
          user.passwordHash
        );

      if (!currentPasswordMatches) {
        res.status(400).json({
          error:
            "Current password is incorrect"
        });

        return;
      }

      const passwordHash =
        await hashPassword(
          newPassword
        );

      await prisma.$transaction(
        async (tx) => {
          const updatedUser =
            await tx.merchantUser.update({
              where: {
                id:
                  userId
              },
              data: {
                passwordHash,
                tokenVersion: {
                  increment:
                    1
                }
              },
              select: {
                id: true,
                merchantId: true
              }
            });

          await tx.auditLog.create({
            data: {
              merchantId:
                updatedUser.merchantId,
              actorUserId:
                updatedUser.id,
              action:
                "MERCHANT_PASSWORD_CHANGED",
              entityType:
                "MERCHANT_USER",
              entityId:
                updatedUser.id
            }
          });
        }
      );

      res.json({
        message:
          "Password changed successfully"
      });
    } catch (error) {
      console.error(
        "Merchant password change failed:",
        error
      );

      res.status(500).json({
        error:
          "Password change failed"
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