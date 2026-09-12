import {
  MerchantSubscriptionStatus
} from "@ethio-commerce/database";
import {
  describe,
  expect,
  it
} from "vitest";

import {
  hasMerchantEntitlement,
  type MerchantEntitlement
} from "../src/domain/subscription-entitlement.js";

const allEntitlements:
readonly MerchantEntitlement[] = [
  "READ_COMMERCE",
  "CREATE_COMMERCE",
  "MUTATE_CATALOG",
  "MUTATE_CUSTOMER",
  "MUTATE_COMMERCE_CONFIG",
  "PROCESS_EXISTING_COMMERCE",
  "BILLING_RECOVERY"
];

const restrictedEntitlements:
readonly MerchantEntitlement[] = [
  "CREATE_COMMERCE",
  "MUTATE_CATALOG",
  "MUTATE_CUSTOMER",
  "MUTATE_COMMERCE_CONFIG"
];

const recoveryEntitlements:
readonly MerchantEntitlement[] = [
  "READ_COMMERCE",
  "PROCESS_EXISTING_COMMERCE",
  "BILLING_RECOVERY"
];

describe(
  "subscription entitlement policy",
  () => {
    it.each([
      MerchantSubscriptionStatus.TRIAL,
      MerchantSubscriptionStatus.ACTIVE,
      MerchantSubscriptionStatus.PAST_DUE
    ])(
      "allows all normal operations for %s",
      (status) => {
        for (
          const entitlement
          of allEntitlements
        ) {
          expect(
            hasMerchantEntitlement(
              status,
              entitlement
            )
          ).toBe(true);
        }
      }
    );

    it.each([
      MerchantSubscriptionStatus.SUSPENDED,
      MerchantSubscriptionStatus.CANCELLED
    ])(
      "blocks new commercial operations for %s",
      (status) => {
        for (
          const entitlement
          of restrictedEntitlements
        ) {
          expect(
            hasMerchantEntitlement(
              status,
              entitlement
            )
          ).toBe(false);
        }
      }
    );

    it.each([
      MerchantSubscriptionStatus.SUSPENDED,
      MerchantSubscriptionStatus.CANCELLED
    ])(
      "preserves historical, existing-commerce, and billing recovery access for %s",
      (status) => {
        for (
          const entitlement
          of recoveryEntitlements
        ) {
          expect(
            hasMerchantEntitlement(
              status,
              entitlement
            )
          ).toBe(true);
        }
      }
    );

    it(
      "blocks new commercial operations when the merchant has no subscription",
      () => {
        for (
          const entitlement
          of restrictedEntitlements
        ) {
          expect(
            hasMerchantEntitlement(
              null,
              entitlement
            )
          ).toBe(false);
        }
      }
    );

    it(
      "preserves historical, existing-commerce, and billing recovery access when the merchant has no subscription",
      () => {
        for (
          const entitlement
          of recoveryEntitlements
        ) {
          expect(
            hasMerchantEntitlement(
              null,
              entitlement
            )
          ).toBe(true);
        }
      }
    );
  }
);
