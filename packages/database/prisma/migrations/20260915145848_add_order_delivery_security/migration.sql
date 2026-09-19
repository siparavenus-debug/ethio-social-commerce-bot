-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryConfirmationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryConfirmationCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "deliveryConfirmationCodeHash" TEXT,
ADD COLUMN     "deliveryConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryName" TEXT,
ADD COLUMN     "deliveryPhone" TEXT;
