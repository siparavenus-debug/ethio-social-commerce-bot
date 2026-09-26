-- CreateEnum
CREATE TYPE "MerchantAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "accountStatus" "MerchantAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "accountSuspendedAt" TIMESTAMP(3),
ADD COLUMN     "accountSuspensionReason" TEXT;
