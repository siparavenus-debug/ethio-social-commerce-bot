/*
  Warnings:

  - You are about to drop the column `pendingTelegramBotId` on the `MerchantTelegramIntegration` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[id,merchantId]` on the table `MerchantTelegramIntegration` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "MerchantTelegramBotClaimStatus" AS ENUM ('ACTIVE', 'PENDING');

-- DropIndex
DROP INDEX "MerchantTelegramIntegration_pendingTelegramBotId_key";

-- AlterTable
ALTER TABLE "MerchantTelegramIntegration" DROP COLUMN "pendingTelegramBotId";

-- CreateTable
CREATE TABLE "MerchantTelegramBotClaim" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "telegramBotId" TEXT NOT NULL,
    "status" "MerchantTelegramBotClaimStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantTelegramBotClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramBotClaim_telegramBotId_key" ON "MerchantTelegramBotClaim"("telegramBotId");

-- CreateIndex
CREATE INDEX "MerchantTelegramBotClaim_merchantId_status_idx" ON "MerchantTelegramBotClaim"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramBotClaim_integrationId_status_key" ON "MerchantTelegramBotClaim"("integrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramIntegration_id_merchantId_key" ON "MerchantTelegramIntegration"("id", "merchantId");

-- AddForeignKey
ALTER TABLE "MerchantTelegramBotClaim" ADD CONSTRAINT "MerchantTelegramBotClaim_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantTelegramBotClaim" ADD CONSTRAINT "MerchantTelegramBotClaim_integrationId_merchantId_fkey" FOREIGN KEY ("integrationId", "merchantId") REFERENCES "MerchantTelegramIntegration"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill active ownership claims for existing Telegram integrations.
INSERT INTO "MerchantTelegramBotClaim" (
    "id",
    "merchantId",
    "integrationId",
    "telegramBotId",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    'telegram-claim-' || "id",
    "merchantId",
    "id",
    "telegramBotId",
    'ACTIVE'::"MerchantTelegramBotClaimStatus",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "MerchantTelegramIntegration"
WHERE "telegramBotId" IS NOT NULL;