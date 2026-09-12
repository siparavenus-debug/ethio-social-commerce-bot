import {
    MerchantSubscriptionStatus
  } from "@ethio-commerce/database";
  import {
    describe,
    expect,
    it
  } from "vitest";

  import {
    applySubscriptionStatusTransition
  } from "../src/domain/subscription-state.js";

  describe(
    "subscription state machine",
    () => {
      it(
        "moves TRIAL to ACTIVE",
        () => {
          expect(
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.TRIAL,
              MerchantSubscriptionStatus.ACTIVE
            )
          ).toBe(
            MerchantSubscriptionStatus.ACTIVE
          );
        }
      );

      it(
        "allows a trial subscription to be cancelled",
        () => {
          expect(
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.TRIAL,
              MerchantSubscriptionStatus.CANCELLED
            )
          ).toBe(
            MerchantSubscriptionStatus.CANCELLED
          );
        }
      );

      it(
        "moves ACTIVE to PAST_DUE",
        () => {
          expect(
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.ACTIVE,
              MerchantSubscriptionStatus.PAST_DUE
            )
          ).toBe(
            MerchantSubscriptionStatus.PAST_DUE
          );
        }
      );

      it(
        "moves PAST_DUE back to ACTIVE",
        () => {
          expect(
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.PAST_DUE,
              MerchantSubscriptionStatus.ACTIVE
            )
          ).toBe(
            MerchantSubscriptionStatus.ACTIVE
          );
        }
      );

      it(
        "moves PAST_DUE to SUSPENDED",
        () => {
          expect(
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.PAST_DUE,
              MerchantSubscriptionStatus.SUSPENDED
            )
          ).toBe(
            MerchantSubscriptionStatus.SUSPENDED
          );
        }
      );

      it(
        "allows a suspended subscription to recover to ACTIVE",
        () => {
          expect(
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.SUSPENDED,
              MerchantSubscriptionStatus.ACTIVE
            )
          ).toBe(
            MerchantSubscriptionStatus.ACTIVE
          );
        }
      );

      it(
        "allows ACTIVE to be cancelled",
        () => {
          expect(
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.ACTIVE,
              MerchantSubscriptionStatus.CANCELLED
            )
          ).toBe(
            MerchantSubscriptionStatus.CANCELLED
          );
        }
      );

      it(
        "does not allow ACTIVE to jump directly to SUSPENDED",
        () => {
          expect(() =>
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.ACTIVE,
              MerchantSubscriptionStatus.SUSPENDED
            )
          ).toThrow(
            "Subscription cannot move from ACTIVE to SUSPENDED"
          );
        }
      );

      it(
        "does not allow TRIAL to move directly to PAST_DUE",
        () => {
          expect(() =>
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.TRIAL,
              MerchantSubscriptionStatus.PAST_DUE
            )
          ).toThrow(
            "Subscription cannot move from TRIAL to PAST_DUE"
          );
        }
      );

      it(
        "does not allow a CANCELLED subscription to reactivate",
        () => {
          expect(() =>
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.CANCELLED,
              MerchantSubscriptionStatus.ACTIVE
            )
          ).toThrow(
            "Subscription cannot move from CANCELLED to ACTIVE"
          );
        }
      );

      it(
        "does not allow a no-op transition",
        () => {
          expect(() =>
            applySubscriptionStatusTransition(
              MerchantSubscriptionStatus.ACTIVE,
              MerchantSubscriptionStatus.ACTIVE
            )
          ).toThrow(
            "Subscription is already ACTIVE"
          );
        }
      );
    }
  );
