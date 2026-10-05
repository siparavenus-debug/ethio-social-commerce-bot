import {
  MerchantTelegramIntegrationStatus,
  prisma
} from "@ethio-commerce/database";

import {
  decryptTelegramCredential
} from "./telegram-credential-encryption.js";

export async function getActiveMerchantTelegramBotToken(
  merchantId: string
): Promise<string> {
  const integration =
    await prisma.merchantTelegramIntegration.findFirst({
      where: {
        merchantId,
        status:
          MerchantTelegramIntegrationStatus.ACTIVE
      },
      select: {
        botTokenEncrypted: true
      }
    });

  if (!integration) {
    throw new Error(
      "Active merchant Telegram integration not found"
    );
  }

  return decryptTelegramCredential(
    integration.botTokenEncrypted
  );
}

export type ActiveMerchantTelegramWebhookIntegration = {
  merchantId: string;
  botToken: string;
  webhookSecret: string;
};

export async function getActiveMerchantTelegramWebhookIntegration(
  webhookKey: string
): Promise<ActiveMerchantTelegramWebhookIntegration | null> {
  const integration =
    await prisma.merchantTelegramIntegration.findFirst({
      where: {
        webhookKey,
        status:
          MerchantTelegramIntegrationStatus.ACTIVE
      },
      select: {
        merchantId: true,
        botTokenEncrypted: true,
        webhookSecretEncrypted: true
      }
    });

  if (!integration) {
    return null;
  }

  return {
    merchantId:
      integration.merchantId,

    botToken:
      decryptTelegramCredential(
        integration.botTokenEncrypted
      ),

    webhookSecret:
      decryptTelegramCredential(
        integration.webhookSecretEncrypted
      )
  };
}
