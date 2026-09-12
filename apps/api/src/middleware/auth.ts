import type {
  NextFunction,
  Request,
  Response
} from "express";

import { prisma } from "@ethio-commerce/database";

import {
  verifyAuthToken,
  type AuthenticatedUser
} from "../services/auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
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

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token =
    getBearerToken(req);

  if (!token) {
    res.status(401).json({
      error:
        "Authentication required"
    });

    return;
  }

  const tokenPayload =
    verifyAuthToken(token);

  if (!tokenPayload) {
    res.status(401).json({
      error:
        "Invalid or expired authentication token"
    });

    return;
  }

  try {
    const user =
      await prisma.merchantUser.findUnique({
        where: {
          id: tokenPayload.userId
        },
        select: {
          id: true,
          merchantId: true,
          email: true,
          displayName: true,
          role: true,
          tokenVersion: true
        }
      });

    if (!user) {
      res.status(401).json({
        error:
          "Authenticated user no longer exists"
      });

      return;
    }

    if (
      user.merchantId !==
      tokenPayload.merchantId
    ) {
      res.status(401).json({
        error:
          "Authentication token is no longer valid"
      });

      return;
    }

    if (
      user.role !==
      tokenPayload.role
    ) {
      res.status(401).json({
        error:
          "Authentication token is no longer valid"
      });

      return;
    }

    if (user.tokenVersion !== tokenPayload.tokenVersion) {
      res.status(401).json({
        error: "Authentication token is no longer valid"
      });

      return;
    }

    req.auth = {
      id: user.id,
      merchantId: user.merchantId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      tokenVersion: user.tokenVersion
    };

    next();
  } catch (error) {
    console.error(
      "Authentication lookup failed:",
      error
    );

    res.status(500).json({
      error:
        "Authentication service failed"
    });
  }
}

export function requireMerchantAccess(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.auth) {
    res.status(401).json({
      error:
        "Authentication required"
    });

    return;
  }

  const requestedMerchantId =
    req.params.merchantId;

  if (
    requestedMerchantId &&
    requestedMerchantId !==
    req.auth.merchantId
  ) {
    res.status(403).json({
      error:
        "You are not authorized to access this merchant"
    });

    return;
  }

  next();
}

export function requireRole(
  ...allowedRoles: string[]
) {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.auth) {
      res.status(401).json({
        error:
          "Authentication required"
      });

      return;
    }

    if (
      !allowedRoles.includes(
        req.auth.role
      )
    ) {
      res.status(403).json({
        error:
          "You do not have permission to perform this action"
      });

      return;
    }

    next();
  };
}