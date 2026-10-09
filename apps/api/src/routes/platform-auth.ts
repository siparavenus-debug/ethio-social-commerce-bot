import { Router } from "express";

import {
  rateLimit
} from "express-rate-limit";

import {
  prisma
} from "@ethio-commerce/database";

import {
  hashPassword,
  verifyPassword
} from "../services/auth.js";

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
            user.displayName,
          role:
            user.role
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
 * PATCH /platform/auth/password
 *
 * A platform administrator may change only their own
 * password. Successful rotation increments tokenVersion,
 * invalidating every previously issued platform token.
 */
router.patch(
  "/password",
  requirePlatformAuth,
  async (req, res) => {
    try {
      const platformUserId =
        req.platformAuth?.id;

      if (!platformUserId) {
        res.status(401).json({
          error:
            "Platform authentication required"
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
        await prisma.platformUser.findUnique({
          where: {
            id:
              platformUserId
          },
          select: {
            passwordHash:
              true
          }
        });

      if (!user) {
        res.status(401).json({
          error:
            "Platform authentication required"
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
            await tx.platformUser.update({
              where: {
                id:
                  platformUserId
              },
              data: {
                passwordHash,
                tokenVersion: {
                  increment:
                    1
                }
              },
              select: {
                id: true
              }
            });

          await tx.platformAuditLog.create({
            data: {
              actorPlatformUserId:
                updatedUser.id,
              merchantId:
                null,
              action:
                "PLATFORM_PASSWORD_CHANGED",
              entityType:
                "PLATFORM_USER",
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
        "Platform password change failed:",
        error
      );

      res.status(500).json({
        error:
          "Platform password change failed"
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