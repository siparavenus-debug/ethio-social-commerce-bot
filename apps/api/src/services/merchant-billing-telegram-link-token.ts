
import {
    createHash,
    randomBytes
} from "node:crypto";

import {
    Prisma,
    prisma
} from "@ethio-commerce/database";

const TOKEN_TTL_MS = 10 * 60 * 1000;

export class BillingTelegramLinkNotEligibleError
  extends Error {
  constructor() {
    super("Billing Telegram linking is not permitted");
    this.name = "BillingTelegramLinkNotEligibleError";
  }
}

export type BillingTelegramLinkTokenResult = {
    token: string;
    expiresAt: Date;
};

export async function createBillingTelegramLinkToken(
    merchantId: string,
    ownerUserId: string,
    ownerTokenVersion: number
): Promise<BillingTelegramLinkTokenResult> {

    if (
        !Number.isSafeInteger(ownerTokenVersion) ||
        ownerTokenVersion < 0
    ) {
        throw new BillingTelegramLinkNotEligibleError();
    }

    const token = randomBytes(32).toString("base64url");

    const tokenHash = createHash("sha256")
        .update(token)
        .digest("hex");

    const expiresAt = new Date(
        Date.now() + TOKEN_TTL_MS
    );

    await prisma.$transaction(
        async (tx) => {
            // Serialize issuance for the same merchant.
            const locked = await tx.$queryRaw<
                Array<{ id: string }>
            >`
          SELECT id
          FROM "Merchant"
          WHERE id = ${merchantId}
            AND "accountStatus" = 'ACTIVE'
          FOR UPDATE
        `;

            if (locked.length !== 1) {
                throw new BillingTelegramLinkNotEligibleError();
            }

            // Revalidate the OWNER inside the transaction.
            const owner = await tx.merchantUser.findFirst({
                where: {
                    id: ownerUserId,
                    merchantId,
                    role: "OWNER",
                    tokenVersion: ownerTokenVersion
                },
                select: {
                    id: true
                }
            });

            if (!owner) {
                throw new BillingTelegramLinkNotEligibleError();
            }

            // Invalidate previous unused link tokens.
            await tx.platformTelegramLinkToken.updateMany({
                where: {
                    merchantId,
                    consumedAt: null,
                    revokedAt: null
                },
                data: {
                    revokedAt: new Date()
                }
            });

            await tx.platformTelegramLinkToken.create({
                data: {
                    merchantId,
                    createdByUserId: ownerUserId,
                    createdByTokenVersion:
                        ownerTokenVersion,
                    tokenHash,
                    expiresAt
                }
            });
        },
        {
            isolationLevel:
                Prisma.TransactionIsolationLevel.ReadCommitted
        }
    );

    return {
        token,
        expiresAt
    };
}
