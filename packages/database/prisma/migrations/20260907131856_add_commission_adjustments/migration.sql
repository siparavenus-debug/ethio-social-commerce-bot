-- CreateEnum
CREATE TYPE "CommissionAdjustmentType" AS ENUM ('REVERSAL', 'REFUND', 'WAIVER', 'CORRECTION');

-- CreateTable
CREATE TABLE "CommissionAdjustment" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "type" "CommissionAdjustmentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommissionAdjustment"
ADD CONSTRAINT "CommissionAdjustment_amount_nonzero_check"
CHECK ("amount" <> 0);

-- CreateIndex
CREATE INDEX "CommissionAdjustment_commissionId_idx" ON "CommissionAdjustment"("commissionId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_merchantId_createdAt_idx" ON "CommissionAdjustment"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionAdjustment_merchantId_idempotencyKey_key" ON "CommissionAdjustment"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionAdjustment_id_merchantId_key" ON "CommissionAdjustment"("id", "merchantId");

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_commissionId_merchantId_fkey" FOREIGN KEY ("commissionId", "merchantId") REFERENCES "Commission"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
