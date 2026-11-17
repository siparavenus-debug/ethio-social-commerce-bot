
/**
 * B6-IMP2-D
 *
 * Process-local, single-use capability registry.
 *
 * This is a non-sending primitive. Issuance does not
 * authorize Telegram sending.
 */

export type BillingSendCapabilityBinding = Readonly<{
    deliveryId: string;
    claimId: string;
    attemptId: string;
    destinationId: string;
    platformBotId: string;
    botIdentityId: string;
  }>;

  type Capability = Readonly<{
    readonly id: symbol;
  }>;

  type Entry = {
    binding: BillingSendCapabilityBinding;
    consumed: boolean;
  };

  export type BillingCapabilityRegistry = Readonly<{
    issue(
      binding: BillingSendCapabilityBinding
    ): Capability | null;

    consume(
      capability: Capability,
      expected: BillingSendCapabilityBinding
    ): boolean;
  }>;

  function validBinding(
    binding: BillingSendCapabilityBinding
  ): boolean {
    return Object.values(binding).every(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0
    );
  }

  /**
   * Creates an isolated, process-local registry.
   *
   * The registry is not a production authorization boundary.
   * Callers cannot obtain sending authorization from it.
   */
  export function createBillingCapabilityRegistry():
    BillingCapabilityRegistry {
    const entries = new WeakMap<object, Entry>();
    const issuedAttempts = new Set<string>();

    return {
      issue(binding) {
        if (!validBinding(binding)) {
          return null;
        }

        const attemptKey = binding.attemptId;

        if (issuedAttempts.has(attemptKey)) {
          return null;
        }

        issuedAttempts.add(attemptKey);

        const capability = Object.freeze({
          id: Symbol("billing-send-capability")
        });

        entries.set(capability, {
          binding: Object.freeze({ ...binding }),
          consumed: false
        });

        return capability;
      },

      consume(capability, expected) {
        if (
          !capability ||
          typeof capability !== "object" ||
          !validBinding(expected)
        ) {
          return false;
        }

        const entry = entries.get(capability);

        if (!entry || entry.consumed) {
          return false;
        }

        const actual = entry.binding;

        if (
          actual.deliveryId !== expected.deliveryId ||
          actual.claimId !== expected.claimId ||
          actual.attemptId !== expected.attemptId ||
          actual.destinationId !== expected.destinationId ||
          actual.platformBotId !== expected.platformBotId ||
          actual.botIdentityId !== expected.botIdentityId
        ) {
          return false;
        }

        // No await between checking and consuming.
        entry.consumed = true;

        return true;
      }
    };
  }

  /**
   * Production entry point remains fail-closed.
   */
  export function preparePlatformBillingSendCapability(
    binding: BillingSendCapabilityBinding
  ): {
    prepared: false;
    sendAuthorized: false;
    reason: "TRUSTED_SENDER_NOT_CONNECTED";
  } {
    void binding;

    return {
      prepared: false,
      sendAuthorized: false,
      reason: "TRUSTED_SENDER_NOT_CONNECTED"
    };
  }
