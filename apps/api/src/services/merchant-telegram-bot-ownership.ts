import { Prisma, TelegramBotOwnerType, TelegramBotReservationStatus } from "@ethio-commerce/database";

type Tx = Prisma.TransactionClient;

/** Must run in the same transaction as the legacy claim write. */
export async function reserveMerchantBot(
  tx: Tx,
  args: { merchantId: string; integrationId: string; telegramBotId: string }
): Promise<void> {
  const identity = await tx.telegramBotIdentityRegistry.upsert({
    where: { telegramBotId: args.telegramBotId },
    create: { telegramBotId: args.telegramBotId },
    update: {}
  });

  // Serializes competing ownership operations for the same identity.
  await tx.$queryRaw`SELECT "id" FROM "TelegramBotIdentityRegistry" WHERE "id" = ${identity.id} FOR UPDATE`;

  const reserved = await tx.telegramBotOwnershipReservation.findFirst({
    where: { botIdentityId: identity.id, status: TelegramBotReservationStatus.RESERVED }
  });
  if (reserved) {
    throw new BotOwnershipConflictError();
  }
  await tx.telegramBotOwnershipReservation.create({
    data: {
      botIdentityId: identity.id,
      ownerType: TelegramBotOwnerType.MERCHANT_COMMERCE,
      merchantId: args.merchantId,
      merchantIntegrationId: args.integrationId,
      status: TelegramBotReservationStatus.RESERVED
    }
  });
}

export class BotOwnershipConflictError extends Error {
  constructor() { super("Telegram bot is already reserved"); }
}

/** Keep history; detach the integration only when it is about to be deleted. */
export async function releaseMerchantBot(
  tx: Tx,
  args: { merchantId: string; integrationId: string; telegramBotId: string; detach?: boolean }
): Promise<void> {
  const identity = await tx.telegramBotIdentityRegistry.findUnique({
    where: { telegramBotId: args.telegramBotId }
  });
  if (!identity) throw new Error("Telegram bot ownership identity missing");
  await tx.$queryRaw`SELECT "id" FROM "TelegramBotIdentityRegistry" WHERE "id" = ${identity.id} FOR UPDATE`;
  const released = await tx.telegramBotOwnershipReservation.updateMany({
    where: {
      botIdentityId: identity.id,
      ownerType: TelegramBotOwnerType.MERCHANT_COMMERCE,
      merchantId: args.merchantId,
      merchantIntegrationId: args.integrationId,
      status: TelegramBotReservationStatus.RESERVED
    },
    data: {
      status: TelegramBotReservationStatus.RELEASED,
      releasedAt: new Date(),
      ...(args.detach ? { merchantIntegrationId: null } : {})
    }
  });
  if (released.count !== 1) throw new Error("Telegram bot ownership reservation changed concurrently");
}
