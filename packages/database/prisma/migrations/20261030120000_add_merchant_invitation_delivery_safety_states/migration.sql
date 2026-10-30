-- AlterEnum
ALTER TYPE "MerchantInvitationDeliveryStatus"
ADD VALUE 'SENDING';

ALTER TYPE "MerchantInvitationDeliveryStatus"
ADD VALUE 'REVIEW_REQUIRED';

-- AlterTable
ALTER TABLE "MerchantInvitationDelivery"
ADD COLUMN "providerMessageId" TEXT;