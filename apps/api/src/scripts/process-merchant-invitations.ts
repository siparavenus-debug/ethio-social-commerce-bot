
import {
    prisma
  } from "@ethio-commerce/database";

  import dotenv from "dotenv";
  import path from "node:path";

  dotenv.config({
    path: path.resolve(process.cwd(), ".env"),
    override: false
  });

  import {
    cleanupExpiredMerchantInvitations,
    reconcileStaleMerchantInvitationSending
  } from "../services/merchant-invitation-delivery.js";

  import {
    processNextMerchantInvitation
  } from "../services/merchant-invitation-processor.js";

  const MAX_INVITATIONS_PER_RUN = 100;

  async function main() {
    console.log(
      "PROCESSING MERCHANT ACTIVATION INVITATIONS"
    );

  const apiKey =
    process.env.RESEND_API_KEY?.trim();

  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim();

  const activationBaseUrl =
    process.env.MERCHANT_ACTIVATION_BASE_URL?.trim();

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

    const reviewRequiredCount =
      await reconcileStaleMerchantInvitationSending();

    console.log(
      `Stale invitation deliveries moved to manual review: ${reviewRequiredCount}`
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
