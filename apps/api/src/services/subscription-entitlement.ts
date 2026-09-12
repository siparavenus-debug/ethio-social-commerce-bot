import {
  Prisma
} from "@ethio-commerce/database";

import {
  hasMerchantEntitlement,
  type MerchantEntitlement,
  type SubscriptionEntitlementStatus
} from "../domain/subscription-entitlement.js";

type SubscriptionEntitlementClient =
  Pick<
    Prisma.TransactionClient,
    "merchantSubscription"
  >;

export async function getMerchantSubscriptionStatus(
  client: SubscriptionEntitlementClient,
  merchantId: string
): Promise<SubscriptionEntitlementStatus> {
  const subscription =
    await client.merchantSubscription.findUnique({
      where: {
        merchantId
      },
      select: {
        status: true
      }
    });

  return subscription?.status ?? null;
}

export async function merchantHasEntitlement(
  client: SubscriptionEntitlementClient,
  merchantId: string,
  entitlement: MerchantEntitlement
): Promise<boolean> {
  const status =
    await getMerchantSubscriptionStatus(
      client,
      merchantId
    );

  return hasMerchantEntitlement(
    status,
    entitlement
  );
}

export async function requireMerchantEntitlement(
  client: SubscriptionEntitlementClient,
  merchantId: string,
  entitlement: MerchantEntitlement
): Promise<void> {
  const allowed =
    await merchantHasEntitlement(
      client,
      merchantId,
      entitlement
    );

  if (!allowed) {
    throw new Error(
      `Merchant is not entitled to ${entitlement}`
    );
  }
}
