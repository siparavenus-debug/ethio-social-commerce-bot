import {
    resolvePlatformBillingTransportContext
  } from "./platform-billing-notification-transport-context.js";

  import {
    verifyPlatformBillingBotCredential
  } from "./platform-billing-bot-credential-verification.js";

  import {
    markPlatformBillingNotificationRequestStarted
  } from "./platform-billing-notification-attempt-fence.js";

  import {
    preparePlatformBillingSendCapability
  } from "./platform-billing-notification-send-capability.js";

  export type BillingRequestStartIntegrationResult =
  | {
      started: true;
      sendAuthorized: false;
      attemptId: string;
      destinationId: string;
      platformBotId: string;
      botIdentityId: string;
    }
  | {
      started: false;
      sendAuthorized: false;
      reason: string;
    };

  function reject(
    reason: string
  ): BillingRequestStartIntegrationResult {
    return {
      started: false,
      sendAuthorized: false,
      reason
    };
  }

  /**
   * B6-IMP2-C
   *
   * Non-sending request-start orchestration.
   *
   * Production credential verification remains fail-closed.
   * No Telegram API calls.
   * No authorization capability is issued.
   */
  export async function integratePlatformBillingRequestStart(
    deliveryId: string,
    claimId: string,
    attemptId: string
  ): Promise<BillingRequestStartIntegrationResult> {
    if (
      !deliveryId?.trim() ||
      !claimId?.trim() ||
      !attemptId?.trim()
    ) {
      return reject("INVALID_REQUEST_START_INPUT");
    }

    const context =
      await resolvePlatformBillingTransportContext(
        deliveryId,
        claimId,
        attemptId
      );

    if (!context.resolved) {
      return reject(
        `TRANSPORT_${context.reason}`
      );
    }

    const verification =
      await verifyPlatformBillingBotCredential(
        context.platformBotId,
        context.botIdentityId
      );

    if (!verification.verified) {
      return reject(
        `CREDENTIAL_${verification.reason}`
      );
    }

    // Re-resolve after verification. The durable fence
    // independently rechecks current eligibility and lease.
    const refreshed =
      await resolvePlatformBillingTransportContext(
        deliveryId,
        claimId,
        attemptId
      );

    if (
      !refreshed.resolved ||
      refreshed.destinationId !== context.destinationId ||
      refreshed.platformBotId !== context.platformBotId ||
      refreshed.botIdentityId !== context.botIdentityId ||
      refreshed.chatId !== context.chatId
    ) {
      return reject("TRANSPORT_CHANGED");
    }

    const started =
      await markPlatformBillingNotificationRequestStarted(
        deliveryId,
        claimId,
        attemptId
      );

      if (!started.started) {
        return reject(
          `FENCE_${started.reason}`
        );
      }

      if (
        started.destinationId !== refreshed.destinationId ||
        started.platformBotId !== refreshed.platformBotId ||
        started.botIdentityId !== refreshed.botIdentityId
      ) {
        return reject("FENCE_BINDING_CHANGED_REVIEW_REQUIRED");
      }

      const capabilityResult =
  preparePlatformBillingSendCapability({
    deliveryId,
    claimId,
    attemptId: started.attemptId,
    destinationId: started.destinationId,
    platformBotId: started.platformBotId,
    botIdentityId: started.botIdentityId
  });

if (!capabilityResult.prepared) {
  return {
    started: true,
    sendAuthorized: false,
    attemptId: started.attemptId,
    destinationId: started.destinationId,
    platformBotId: started.platformBotId,
    botIdentityId: started.botIdentityId
  };
}

return {
  started: true,
  sendAuthorized: false,
  attemptId: started.attemptId,
  destinationId: started.destinationId,
  platformBotId: started.platformBotId,
  botIdentityId: started.botIdentityId
};
  }
