/*
  Warnings:

  - A unique constraint covering the columns `[pendingTelegramBotId]` on the table `MerchantTelegramIntegration` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MerchantTelegramIntegration" ADD COLUMN     "pendingTelegramBotId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramIntegration_pendingTelegramBotId_key" ON "MerchantTelegramIntegration"("pendingTelegramBotId");
