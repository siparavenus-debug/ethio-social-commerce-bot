import type {
    NextFunction,
    Request,
    Response
  } from "express";

  import {
    prisma,
    type PlatformUserRole
  } from "@ethio-commerce/database";

  import {
    verifyAuthToken
  } from "../services/auth.js";

  import {
    verifyPlatformAuthToken,
    type AuthenticatedPlatformUser
  } from "../services/platform-auth.js";

  declare global {
    namespace Express {
      interface Request {
        platformAuth?: AuthenticatedPlatformUser;
      }
    }
  }

  function getBearerToken(
    req: Request
  ): string | null {
    const authorization =
      req.get("authorization");

    if (!authorization) {
      return null;
    }

    const match =
      authorization.match(
        /^Bearer\s+(.+)$/i
      );

    return match?.[1]?.trim() || null;
  }

  export async function requirePlatformAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const token =
      getBearerToken(req);

    if (!token) {
      res.status(401).json({
        error:
          "Platform authentication required"
      });

      return;
    }

    const tokenPayload =
      verifyPlatformAuthToken(token);

    if (!tokenPayload) {
      /*
       * A valid merchant credential proves that the caller
       * is authenticated, but merchant identities have no
       * authority in the platform administration domain.
       */
      const merchantPayload =
        verifyAuthToken(token);

      if (merchantPayload) {
        res.status(403).json({
          error:
            "Merchant accounts are not authorized to access platform administration"
        });

        return;
      }

      res.status(401).json({
        error:
          "Invalid or expired platform authentication token"
      });

      return;
    }

    try {
      const user =
        await prisma.platformUser.findUnique({
          where: {
            id: tokenPayload.platformUserId
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            tokenVersion: true
          }
        });

      if (!user) {
        res.status(401).json({
          error:
            "Authenticated platform user no longer exists"
        });

        return;
      }

      if (
        user.tokenVersion !==
        tokenPayload.tokenVersion
      ) {
        res.status(401).json({
          error:
            "Platform authentication token is no longer valid"
        });

        return;
      }

      req.platformAuth = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        tokenVersion: user.tokenVersion
      };

      next();
    } catch (error) {
      console.error(
        "Platform authentication lookup failed:",
        error
      );

      res.status(500).json({
        error:
          "Platform authentication service failed"
      });
    }
  }

  export function requirePlatformRole(
    ...allowedRoles: PlatformUserRole[]
  ) {
    return (
      req: Request,
      res: Response,
      next: NextFunction
    ): void => {
      if (!req.platformAuth) {
        res.status(401).json({
          error:
            "Platform authentication required"
        });

        return;
      }

      if (
        !allowedRoles.includes(
          req.platformAuth.role
        )
      ) {
        res.status(403).json({
          error:
            "You do not have permission to perform this platform action"
        });

        return;
      }

      next();
    };
  }
