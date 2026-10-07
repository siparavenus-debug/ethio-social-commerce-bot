/*
  Warnings:

  - A unique constraint covering the columns `[telegramBotId]` on the table `MerchantTelegramIntegration` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MerchantTelegramIntegration" ADD COLUMN     "telegramBotId" TEXT,
ADD COLUMN     "telegramBotUsername" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramIntegration_telegramBotId_key" ON "MerchantTelegramIntegration"("telegramBotId");
