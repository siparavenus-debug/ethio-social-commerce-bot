-- CreateEnum
CREATE TYPE "MerchantInvitationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "MerchantInvitationDelivery" (
    "id" TEXT NOT NULL,
    "activationId" TEXT NOT NULL,
    "status" "MerchantInvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "recipientEmail" TEXT NOT NULL,
    "encryptedToken" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantInvitationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvitationDelivery_activationId_key" ON "MerchantInvitationDelivery"("activationId");

-- CreateIndex
CREATE INDEX "MerchantInvitationDelivery_status_nextAttemptAt_idx" ON "MerchantInvitationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MerchantInvitationDelivery_status_processingUntil_idx" ON "MerchantInvitationDelivery"("status", "processingUntil");

-- AddForeignKey
ALTER TABLE "MerchantInvitationDelivery" ADD CONSTRAINT "MerchantInvitationDelivery_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES "MerchantOwnerActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
