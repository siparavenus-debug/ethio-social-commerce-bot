-- CreateEnum
CREATE TYPE "MerchantTelegramIntegrationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "MerchantTelegramIntegration" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "webhookKey" TEXT NOT NULL,
    "botTokenEncrypted" TEXT NOT NULL,
    "webhookSecretEncrypted" TEXT NOT NULL,
    "status" "MerchantTelegramIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantTelegramIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramIntegration_merchantId_key" ON "MerchantTelegramIntegration"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramIntegration_webhookKey_key" ON "MerchantTelegramIntegration"("webhookKey");

-- CreateIndex
CREATE INDEX "MerchantTelegramIntegration_status_idx" ON "MerchantTelegramIntegration"("status");

-- AddForeignKey
ALTER TABLE "MerchantTelegramIntegration" ADD CONSTRAINT "MerchantTelegramIntegration_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
