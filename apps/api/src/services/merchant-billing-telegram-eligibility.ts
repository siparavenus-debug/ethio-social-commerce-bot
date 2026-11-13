
import { prisma } from "@ethio-commerce/database";

export type BillingTelegramEligibilityResult =
  | {
      ok: true;
      value: {
        tokenId: string;
        merchantId: string;
        createdByUserId: string;
      };
    }
  | {
      ok: false;
      reason: "NOT_ELIGIBLE";
    };

export async function checkBillingTelegramLinkEligibility(
  tokenHash: string,
  now: Date = new Date()
): Promise<BillingTelegramEligibilityResult> {
  const notEligible = {
    ok: false as const,
    reason: "NOT_ELIGIBLE" as const
  };

  if (
    typeof tokenHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(tokenHash) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    return notEligible;
  }

  const token =
    await prisma.platformTelegramLinkToken.findUnique({
      where: {
        tokenHash
      },
      select: {
        id: true,
        merchantId: true,
        createdByUserId: true,
        createdByTokenVersion: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        merchant: {
          select: {
            accountStatus: true
          }
        },
        creator: {
          select: {
            id: true,
            merchantId: true,
            role: true,
            tokenVersion: true
          }
        }
      }
    });

  if (
    !token ||
    token.expiresAt.getTime() <= now.getTime() ||
    token.consumedAt !== null ||
    token.revokedAt !== null ||
    token.merchant.accountStatus !== "ACTIVE" ||
    token.creator.id !== token.createdByUserId ||
    token.creator.merchantId !== token.merchantId ||
    token.creator.role !== "OWNER" ||
    token.creator.tokenVersion !==
      token.createdByTokenVersion
  ) {
    return notEligible;
  }

  return {
    ok: true,
    value: {
      tokenId: token.id,
      merchantId: token.merchantId,
      createdByUserId: token.createdByUserId
    }
  };
}
