import {
  MerchantSubscriptionStatus
} from "@ethio-commerce/database";

export type MerchantEntitlement =
  | "READ_COMMERCE"
  | "CREATE_COMMERCE"
  | "MUTATE_CATALOG"
  | "MUTATE_CUSTOMER"
  | "MUTATE_COMMERCE_CONFIG"
  | "PROCESS_EXISTING_COMMERCE"
  | "BILLING_RECOVERY";

export type SubscriptionEntitlementStatus =
  | MerchantSubscriptionStatus
  | null;

const alwaysAllowedEntitlements:
readonly MerchantEntitlement[] = [
  "READ_COMMERCE",
  "PROCESS_EXISTING_COMMERCE",
  "BILLING_RECOVERY"
];

const operationalEntitlements:
readonly MerchantEntitlement[] = [
  ...alwaysAllowedEntitlements,
  "CREATE_COMMERCE",
  "MUTATE_CATALOG",
  "MUTATE_CUSTOMER",
  "MUTATE_COMMERCE_CONFIG"
];

export function hasMerchantEntitlement(
  status: SubscriptionEntitlementStatus,
  entitlement: MerchantEntitlement
): boolean {
  switch (status) {
    case MerchantSubscriptionStatus.TRIAL:
    case MerchantSubscriptionStatus.ACTIVE:
    case MerchantSubscriptionStatus.PAST_DUE:
      return operationalEntitlements.includes(
        entitlement
      );

    case MerchantSubscriptionStatus.SUSPENDED:
    case MerchantSubscriptionStatus.CANCELLED:
    case null:
      return alwaysAllowedEntitlements.includes(
        entitlement
      );
  }
}
