
import {
    prisma
  } from "@ethio-commerce/database";

  import {
    env
  } from "../config/env.js";

  import {
    cleanupExpiredMerchantInvitations
  } from "../services/merchant-invitation-delivery.js";

  import {
    processNextMerchantInvitation
  } from "../services/merchant-invitation-processor.js";

  const MAX_INVITATIONS_PER_RUN = 100;

  async function main() {
    console.log(
      "PROCESSING MERCHANT ACTIVATION INVITATIONS"
    );

    const apiKey = env.resendApiKey;
    const fromEmail = env.resendFromEmail;
    const activationBaseUrl =
      env.merchantActivationBaseUrl;

    if (
      !apiKey ||
      !fromEmail ||
      !activationBaseUrl
    ) {
      throw new Error(
        "Merchant invitation email configuration is incomplete"
      );
    }

    const expiredCount =
      await cleanupExpiredMerchantInvitations();

    console.log(
      `Expired or consumed invitations cleaned: ${expiredCount}`
    );

    let processedCount = 0;

    while (
      processedCount < MAX_INVITATIONS_PER_RUN
    ) {
      const processed =
        await processNextMerchantInvitation({
          apiKey,
          fromEmail,
          activationBaseUrl
        });

      if (!processed) {
        break;
      }

      processedCount++;
    }

    console.log(
      `Invitation delivery attempts processed: ${processedCount}`
    );

    if (
      processedCount === MAX_INVITATIONS_PER_RUN
    ) {
      console.log(
        "Processing limit reached; remaining invitations will be handled by a later run"
      );
    }
  }

  main()
    .catch((error) => {
      console.error(
        "Merchant invitation processing failed:",
        error
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
