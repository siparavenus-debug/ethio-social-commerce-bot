import {
  Prisma
} from "@ethio-commerce/database";

/**
 * Coordinates billing transactions with destination
 * linking, preferences, and unlink operations.
 *
 * Must be called before financial-record mutations.
 *
 * This helper does not enforce merchant ACTIVE status.
 * Notification eligibility is checked separately.
 */
export async function lockPlatformBillingMerchant(
  tx: Prisma.TransactionClient,
  merchantId: string
): Promise<void> {
  const normalizedMerchantId = merchantId.trim();

  if (!normalizedMerchantId) {
    throw new Error(
      "Merchant ID is required for billing coordination"
    );
  }

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Merchant"
    WHERE "id" = ${normalizedMerchantId}
    FOR UPDATE
  `;
}