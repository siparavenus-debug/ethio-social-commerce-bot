import type {
  NextFunction,
  Request,
  Response
} from "express";

import {
  prisma
} from "@ethio-commerce/database";

import type {
  MerchantEntitlement
} from "../domain/subscription-entitlement.js";
import {
  merchantHasEntitlement
} from "../services/subscription-entitlement.js";

export function requireMerchantEntitlement(
  entitlement: MerchantEntitlement
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({
        error:
          "Authentication required"
      });

      return;
    }

    const merchantId =
      req.params.merchantId;

    if (
      typeof merchantId !== "string" ||
      merchantId.length === 0
    ) {
      res.status(400).json({
        error:
          "Merchant id is required"
      });

      return;
    }

    /*
     * Merchant ownership/access remains the responsibility
     * of requireMerchantAccess.
     *
     * This middleware only evaluates subscription
     * entitlement for the requested merchant.
     */
    try {
      const allowed =
        await merchantHasEntitlement(
          prisma,
          merchantId,
          entitlement
        );

      if (!allowed) {
        res.status(403).json({
          error:
            "Merchant subscription does not allow this action"
        });

        return;
      }

      next();
    } catch (error) {
      console.error(
        "Merchant entitlement lookup failed:",
        error
      );

      res.status(500).json({
        error:
          "Merchant entitlement service failed"
      });
    }
  };
}
