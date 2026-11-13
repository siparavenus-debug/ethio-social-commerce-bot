import {
  evaluatePlatformBillingDeliveryClaim,
  applyPlatformBillingPreSendDecision
} from "./platform-billing-notification-decision.js";

import {
  preparePlatformBillingNotificationAttempt
} from "./platform-billing-notification-attempt-fence.js";

export type BillingB63Result =
  | {
      outcome: "PREPARED";
      attemptId: string;
      attemptNumber: number;
      sendAuthorized: false;
    }
  | {
      outcome: "DISPOSITION_APPLIED";
      disposition: "SUPPRESS" | "DEFER" | "REVIEW_REQUIRED";
      sendAuthorized: false;
    }
  | {
      outcome: "NOT_PREPARED";
      reason: string;
      sendAuthorized: false;
    };

export async function processClaimedPlatformBillingNotificationB63(
  deliveryId: string,
  claimId: string
): Promise<BillingB63Result> {
  const claim = await evaluatePlatformBillingDeliveryClaim(
    deliveryId,
    claimId
  );

  if (!claim.valid) {
    if (claim.reason === "PRIOR_ATTEMPT_NOT_SAFE") {
      const disposition = await applyPlatformBillingPreSendDecision(
        deliveryId,
        claimId
      );

      if (disposition.applied) {
        return {
          outcome: "DISPOSITION_APPLIED",
          disposition: disposition.disposition,
          sendAuthorized: false
        };
      }

      return {
        outcome: "NOT_PREPARED",
        reason: disposition.reason,
        sendAuthorized: false
      };
    }

    return {
      outcome: "NOT_PREPARED",
      reason: claim.reason,
      sendAuthorized: false
    };
  }

  const preparation =
    await preparePlatformBillingNotificationAttempt(
      deliveryId,
      claimId
    );

  if (preparation.prepared) {
    return {
      outcome: "PREPARED",
      attemptId: preparation.attemptId,
      attemptNumber: preparation.attemptNumber,
      sendAuthorized: false
    };
  }

  if (preparation.reason.startsWith("PRE_SEND_")) {
    const disposition = await applyPlatformBillingPreSendDecision(
      deliveryId,
      claimId
    );

    if (disposition.applied) {
      return {
        outcome: "DISPOSITION_APPLIED",
        disposition: disposition.disposition,
        sendAuthorized: false
      };
    }

    return {
      outcome: "NOT_PREPARED",
      reason: disposition.reason,
      sendAuthorized: false
    };
  }

  return {
    outcome: "NOT_PREPARED",
    reason: preparation.reason,
    sendAuthorized: false
  };
}
