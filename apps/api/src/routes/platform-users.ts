import {
  Prisma,
  prisma
} from "@ethio-commerce/database";

  import {
    Router
  } from "express";

  import {
    requirePlatformAuth,
    requirePlatformRole
  } from "../middleware/platform-auth.js";

  import {
    hashPassword
  } from "../services/auth.js";

  const router =
    Router();

  router.use(
    requirePlatformAuth
  );

  router.use(
    requirePlatformRole(
      "OWNER"
    )
  );

  router.get(
    "/",
    async (_req, res) => {
      try {
        const users =
          await prisma.platformUser.findMany({
            select: {
              id: true,
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
          "Failed to list platform users:",
          error
        );

        res.status(500).json({
          error:
            "Failed to load platform users"
        });
      }
    }
  );

  router.post(
    "/",
    async (req, res) => {
      try {
        const email =
          typeof req.body?.email === "string"
            ? req.body.email
                .trim()
                .toLowerCase()
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
            ? req.body.role
                .trim()
                .toUpperCase()
            : "";

        if (
          !email ||
          !password ||
          !role
        ) {
          res.status(400).json({
            error:
              "Email, password, and role are required"
          });

          return;
        }

        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            email
          )
        ) {
          res.status(400).json({
            error:
              "Invalid email address"
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
              "New platform users may only have ADMIN or STAFF roles"
          });

          return;
        }

        const existingUser =
          await prisma.platformUser.findUnique({
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
          await hashPassword(
            password
          );

        const user =
          await prisma.$transaction(
            async (tx) => {
              const createdUser =
                await tx.platformUser.create({
                  data: {
                    email,
                    passwordHash,
                    displayName:
                      displayName || null,
                    role:
                      role === "ADMIN"
                        ? "ADMIN"
                        : "STAFF"
                  },
                  select: {
                    id: true,
                    email: true,
                    displayName: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true
                  }
                });

              await tx.platformAuditLog.create({
                data: {
                  actorPlatformUserId:
                    req.platformAuth!.id,
                  action:
                    "PLATFORM_USER_CREATED",
                  entityType:
                    "PLATFORM_USER",
                  entityId:
                    createdUser.id,
                  metadata: {
                    role:
                      createdUser.role
                  }
                }
              });

              return createdUser;
            }
          );

        res.status(201).json({
          user
        });
      } catch (error) {
        if (
          error instanceof
            Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          res.status(409).json({
            error:
              "An account with that email already exists"
          });
          return;
        }

        console.error(
          "Failed to create platform user:",
          error
        );

        res.status(500).json({
          error:
            "Failed to create platform user"
        });
      }
    }
  );

  router.patch(
    "/:userId",
    async (req, res) => {
      try {
        const userId =
          String(req.params.userId);

        const targetUser =
          await prisma.platformUser.findUnique({
            where: {
              id: userId
            },
            select: {
                id: true,
                role: true,
                tokenVersion: true
              }
          });

        if (!targetUser) {
          res.status(404).json({
            error:
              "Platform user not found"
          });

          return;
        }

        if (
          targetUser.role === "OWNER"
        ) {
          res.status(403).json({
            error:
              "The platform OWNER account cannot be modified here"
          });

          return;
        }

        const requestedRole =
        typeof req.body?.role === "string"
          ? req.body.role.trim().toUpperCase()
          : null;

      if (
        requestedRole !== "ADMIN" &&
        requestedRole !== "STAFF"
      ) {
        res.status(400).json({
          error:
            "Platform user role may only be ADMIN or STAFF"
        });
        return;
      }

      if (requestedRole === targetUser.role) {
        const currentUser =
          await prisma.platformUser.findUnique({
            where: {
              id: targetUser.id
            },
            select: {
              id: true,
              email: true,
              displayName: true,
              role: true,
              tokenVersion: true,
              createdAt: true,
              updatedAt: true
            }
          });

        if (
          !currentUser ||
          currentUser.role !== targetUser.role ||
          currentUser.tokenVersion !==
            targetUser.tokenVersion
        ) {
          res.status(409).json({
            error:
              "Platform user changed concurrently"
          });

          return;
        }

        const {
          tokenVersion: _tokenVersion,
          ...safeUser
        } = currentUser;

        res.json({
          user: safeUser
        });

        return;
      }

      const user = await prisma.$transaction(
        async (tx) => {
          const claim =
            await tx.platformUser.updateMany({
              where: {
                id: targetUser.id,
                role: targetUser.role,
                tokenVersion:
                  targetUser.tokenVersion
              },
              data: {
                role: requestedRole,
                tokenVersion: {
                  increment: 1
                }
              }
            });

          if (claim.count !== 1) {
            return null;
          }

          const updatedUser =
            await tx.platformUser.findUniqueOrThrow({
              where: {
                id: targetUser.id
              },
              select: {
                id: true,
                email: true,
                displayName: true,
                role: true,
                createdAt: true,
                updatedAt: true
              }
            });

          await tx.platformAuditLog.create({
            data: {
              actorPlatformUserId:
                req.platformAuth!.id,
              action:
                "PLATFORM_USER_UPDATED",
              entityType:
                "PLATFORM_USER",
              entityId:
                updatedUser.id,
              metadata: {
                changedFields: ["role"],
                previousRole:
                  targetUser.role,
                role:
                  updatedUser.role
              }
            }
          });

          return updatedUser;
        }
      );

      if (!user) {
        res.status(409).json({
          error:
            "Platform user changed concurrently"
        });

        return;
      }

      res.json({ user });
      } catch (error) {
        console.error(
          "Failed to update platform user:",
          error
        );

        res.status(500).json({
          error:
            "Failed to update platform user"
        });
      }
    }
  );

  router.patch(
    "/:userId/password",
    async (req, res) => {
      try {
        const userId =
          String(req.params.userId);

        const targetUser =
          await prisma.platformUser.findUnique({
            where: { id: userId },
            select: {
              id: true,
              role: true
            }
          });

        if (!targetUser) {
          res.status(404).json({
            error: "Platform user not found"
          });
          return;
        }

        if (targetUser.role === "OWNER") {
          res.status(403).json({
            error:
              "The platform OWNER account cannot be modified here"
          });
          return;
        }

        const newPassword =
          typeof req.body?.newPassword === "string"
            ? req.body.newPassword
            : "";

        if (newPassword.length < 8) {
          res.status(400).json({
            error:
              "New password must be at least 8 characters"
          });
          return;
        }

        const passwordHash =
          await hashPassword(newPassword);

        await prisma.$transaction(
          async (tx) => {
            await tx.platformUser.update({
              where: {
                id: targetUser.id,
                role: targetUser.role
              },
              data: {
                passwordHash,
                tokenVersion: {
                  increment: 1
                }
              }
            });

            await tx.platformAuditLog.create({
              data: {
                actorPlatformUserId:
                  req.platformAuth!.id,
                action:
                  "PLATFORM_USER_PASSWORD_RESET",
                entityType:
                  "PLATFORM_USER",
                entityId:
                  targetUser.id
              }
            });
          }
        );

        res.json({
          message:
            "Platform user password reset successfully"
        });
      } catch (error) {
        if (
          error instanceof
            Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          res.status(409).json({
            error:
              "Platform user changed concurrently"
          });
          return;
        }

        console.error(
          "Failed to reset platform user password:",
          error
        );

        res.status(500).json({
          error:
            "Failed to reset platform user password"
        });
      }
    }
  );

  export default router;
