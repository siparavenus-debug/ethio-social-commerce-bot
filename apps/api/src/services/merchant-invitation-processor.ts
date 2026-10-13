import {
    claimMerchantInvitationDelivery,
    completeMerchantInvitationDelivery,
    failMerchantInvitationDelivery,
    isMerchantInvitationReadyToSend,
    permanentlyFailMerchantInvitationDelivery
  } from "./merchant-invitation-delivery.js";


  import {
    decryptMerchantInvitation
  } from "./merchant-invitation-encryption.js";

  import {
    sendMerchantActivationEmail
  } from "./resend-email.js";

  interface MerchantInvitationProcessorConfig {
    apiKey: string;
    fromEmail: string;
    activationBaseUrl: string;
  }

  export async function processNextMerchantInvitation(
    config: MerchantInvitationProcessorConfig
  ): Promise<boolean> {
    if (
      !config.apiKey?.trim() ||
      !config.fromEmail?.trim() ||
      !config.activationBaseUrl?.trim()
    ) {
      throw new Error(
        "Merchant invitation email configuration is incomplete"
      );
    }

    const baseUrl = new URL(config.activationBaseUrl);

    if (baseUrl.protocol !== "https:") {
      throw new Error(
        "Merchant activation URL must use HTTPS"
      );
    }

    const delivery =
      await claimMerchantInvitationDelivery();

    if (!delivery) {
      return false;
    }

    try {
      const ready =
        await isMerchantInvitationReadyToSend({
          deliveryId: delivery.id,
          attemptCount: delivery.attemptCount
        });

      if (!ready || !delivery.encryptedToken) {
        return true;
      }


      let token: string;

      try {
        token = decryptMerchantInvitation(
          delivery.encryptedToken
        );
      } catch {
        await permanentlyFailMerchantInvitationDelivery({
          deliveryId: delivery.id,
          attemptCount: delivery.attemptCount
        });

        return true;
      }


      const activationUrl = new URL(baseUrl.toString());

      activationUrl.searchParams.set(
        "token",
        token
      );

      // Recheck eligibility immediately before the
      // external email request.
      const stillReady =
        await isMerchantInvitationReadyToSend({
          deliveryId: delivery.id,
          attemptCount: delivery.attemptCount
        });

      if (!stillReady) {
        return true;
      }

      await sendMerchantActivationEmail({
        apiKey: config.apiKey,
        fromEmail: config.fromEmail,
        recipientEmail: delivery.recipientEmail,
        activationUrl: activationUrl.toString(),
        deliveryId: delivery.id
      });

      await completeMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: delivery.attemptCount
      });

      return true;
    } catch {
      await failMerchantInvitationDelivery({
        deliveryId: delivery.id,
        attemptCount: delivery.attemptCount,
        errorMessage:
          "Merchant invitation email processing failed"
      });

      return true;
    }
  }
