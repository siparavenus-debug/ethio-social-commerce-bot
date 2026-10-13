-- CreateEnum
CREATE TYPE "MerchantOnboardingStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DISCARDED');

-- CreateTable
CREATE TABLE "MerchantOnboardingApplication" (
    "id" TEXT NOT NULL,
    "status" "MerchantOnboardingStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "name" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "address" TEXT,
    "telegramUsername" TEXT,
    "ownerEmail" TEXT NOT NULL,
    "ownerDisplayName" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "merchantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantOnboardingApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantOnboardingApplication_merchantId_key" ON "MerchantOnboardingApplication"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantOnboardingApplication_status_createdAt_idx" ON "MerchantOnboardingApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantOnboardingApplication_createdById_createdAt_idx" ON "MerchantOnboardingApplication"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantOnboardingApplication_reviewedById_reviewedAt_idx" ON "MerchantOnboardingApplication"("reviewedById", "reviewedAt");

-- AddForeignKey
ALTER TABLE "MerchantOnboardingApplication" ADD CONSTRAINT "MerchantOnboardingApplication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "PlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantOnboardingApplication" ADD CONSTRAINT "MerchantOnboardingApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "PlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantOnboardingApplication" ADD CONSTRAINT "MerchantOnboardingApplication_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
