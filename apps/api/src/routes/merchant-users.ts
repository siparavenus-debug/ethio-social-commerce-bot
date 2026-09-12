import { Router } from "express";

import {
  MerchantUserRole,
  prisma
} from "@ethio-commerce/database";

import {
  requireAuth,
  requireMerchantAccess,
  requireRole
} from "../middleware/auth.js";

import {
  hashPassword
} from "../services/auth.js";

const router = Router();

router.use(requireAuth);

/*
 * GET /:merchantId/users
 *
 * List employees for the current merchant.
 */
router.get(
  "/:merchantId/users",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const users =
        await prisma.merchantUser.findMany({
          where: {
            merchantId
          },
          select: {
            id: true,
            merchantId: true,
            email: true,
            displayName: true,
            role: true,
            createdAt: true,
            updatedAt: true
          },
          orderBy: {
            createdAt: "asc"
          }
        });

      res.json({
        users
      });
    } catch (error) {
      console.error(
        "Failed to list merchant users:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load merchant users"
      });
    }
  }
);

/*
 * GET /:merchantId/users/:userId
 *
 * Get one employee.
 */
router.get(
  "/:merchantId/users/:userId",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const userId =
        String(req.params.userId);

      const user =
        await prisma.merchantUser.findFirst({
          where: {
            id: userId,
            merchantId
          },
          select: {
            id: true,
            merchantId: true,
            email: true,
            displayName: true,
            role: true,
            createdAt: true,
            updatedAt: true
          }
        });

      if (!user) {
        res.status(404).json({
          error:
            "Merchant user not found"
        });
        return;
      }

      res.json({
        user
      });
    } catch (error) {
      console.error(
        "Failed to load merchant user:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load merchant user"
      });
    }
  }
);

/*
 * POST /:merchantId/users
 *
 * Create an employee.
 */
router.post(
  "/:merchantId/users",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";

      const displayName =
        typeof req.body?.displayName === "string"
          ? req.body.displayName.trim()
          : "";

      const password =
        typeof req.body?.password === "string"
          ? req.body.password
          : "";

      const role =
        typeof req.body?.role === "string"
          ? req.body.role.trim().toUpperCase()
          : "";

      if (!email || !password || !role) {
        res.status(400).json({
          error:
            "Email, password, and role are required"
        });
        return;
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        res.status(400).json({
          error: "Invalid email address"
        });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({
          error:
            "Password must contain at least 8 characters."
        });
        return;
      }

      if (
        role !== "ADMIN" &&
        role !== "STAFF"
      ) {
        res.status(400).json({
          error:
            "New employees may only have ADMIN or STAFF roles"
        });
        return;
      }

      const existingUser =
        await prisma.merchantUser.findUnique({
          where: {
            email
          },
          select: {
            id: true
          }
        });

      if (existingUser) {
        res.status(409).json({
          error:
            "An account with that email already exists"
        });
        return;
      }

      const passwordHash =
        await hashPassword(password);

      const user =
        await prisma.merchantUser.create({
          data: {
            merchantId,
            email,
            passwordHash,
            displayName:
              displayName || null,
            role:
              role === "ADMIN"
                ? MerchantUserRole.ADMIN
                : MerchantUserRole.STAFF
          },
          select: {
            id: true,
            merchantId: true,
            email: true,
            displayName: true,
            role: true,
            createdAt: true,
            updatedAt: true
          }
        });

      res.status(201).json({
        user
      });
    } catch (error) {
      console.error(
        "Failed to create merchant user:",
        error
      );

      res.status(500).json({
        error:
          "Failed to create merchant user"
      });
    }
  }
);

/*
 * PATCH /:merchantId/users/:userId
 *
 * Update an employee's display name,
 * role, and/or password.
 */
router.patch(
  "/:merchantId/users/:userId",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const userId =
        String(req.params.userId);

      const targetUser =
        await prisma.merchantUser.findFirst({
          where: {
            id: userId,
            merchantId
          },
          select: {
            id: true,
            role: true
          }
        });

      if (!targetUser) {
        res.status(404).json({
          error:
            "Merchant user not found"
        });
        return;
      }

      if (targetUser.role === "OWNER") {
        res.status(403).json({
          error:
            "The owner account cannot be modified here"
        });
        return;
      }

      const data: {
        displayName?: string | null;
        role?: MerchantUserRole;
        passwordHash?: string;
        tokenVersion?: {
          increment: number;
        };
      } = {};

      if (
        req.body &&
        Object.prototype.hasOwnProperty.call(
          req.body,
          "displayName"
        )
      ) {
        if (
          req.body.displayName !== null &&
          typeof req.body.displayName !== "string"
        ) {
          res.status(400).json({
            error:
              "displayName must be a string or null"
          });
          return;
        }

        const displayName =
          typeof req.body.displayName === "string"
            ? req.body.displayName.trim()
            : "";

        data.displayName =
          displayName || null;
      }

      if (
        req.body &&
        Object.prototype.hasOwnProperty.call(
          req.body,
          "role"
        )
      ) {
        if (
          req.body.role !== "ADMIN" &&
          req.body.role !== "STAFF"
        ) {
          res.status(400).json({
            error:
              "Employee role must be ADMIN or STAFF"
          });
          return;
        }

        data.role =
          req.body.role === "ADMIN"
            ? MerchantUserRole.ADMIN
            : MerchantUserRole.STAFF;
      }

      if (
        req.body &&
        Object.prototype.hasOwnProperty.call(
          req.body,
          "password"
        )
      ) {
        if (
          typeof req.body.password !== "string" ||
          req.body.password.length < 8
        ) {
          res.status(400).json({
            error:
              "Password must contain at least 8 characters."
          });
          return;
        }

        data.passwordHash =
          await hashPassword(
            req.body.password
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(req.body, "role") ||
        Object.prototype.hasOwnProperty.call(req.body, "password")
      ) {
        data.tokenVersion = {
          increment: 1
        };
      }

      if (
        Object.keys(data).length === 0
      ) {
        res.status(400).json({
          error:
            "No valid fields were provided"
        });
        return;
      }

      const user =
        await prisma.merchantUser.update({
          where: {
            id: targetUser.id
          },
          data,
          select: {
            id: true,
            merchantId: true,
            email: true,
            displayName: true,
            role: true,
            createdAt: true,
            updatedAt: true
          }
        });

      res.json({
        user
      });
    } catch (error) {
      console.error(
        "Failed to update merchant user:",
        error
      );

      res.status(500).json({
        error:
          "Failed to update merchant user"
      });
    }
  }
);

/*
 * DELETE /:merchantId/users/:userId
 *
 * Delete an employee.
 */
router.delete(
  "/:merchantId/users/:userId",
  requireMerchantAccess,
  requireRole("OWNER"),
  async (req, res) => {
    try {
      const merchantId =
        String(req.params.merchantId);

      const userId =
        String(req.params.userId);

      const targetUser =
        await prisma.merchantUser.findFirst({
          where: {
            id: userId,
            merchantId
          },
          select: {
            id: true,
            role: true
          }
        });

      if (!targetUser) {
        res.status(404).json({
          error:
            "Merchant user not found"
        });
        return;
      }

      if (
        targetUser.role === "OWNER" ||
        targetUser.id === req.auth!.id
      ) {
        res.status(403).json({
          error:
            "The owner account cannot be deleted"
        });
        return;
      }

      await prisma.merchantUser.delete({
        where: {
          id: targetUser.id
        }
      });

      res.sendStatus(204);
    } catch (error) {
      console.error(
        "Failed to delete merchant user:",
        error
      );

      res.status(500).json({
        error:
          "Failed to delete merchant user"
      });
    }
  }
);

export default router;
