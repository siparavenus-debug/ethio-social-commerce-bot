/*
  Warnings:

  - A unique constraint covering the columns `[adjustmentId]` on the table `MerchantInvoiceItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[adjustmentId,merchantId]` on the table `MerchantInvoiceItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[subscriptionId,billingPeriodStart,billingPeriodEnd]` on the table `MerchantInvoiceItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MerchantInvoiceItem" ADD COLUMN     "adjustmentId" TEXT,
ADD COLUMN     "billingPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "billingPeriodStart" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoiceItem_adjustmentId_key" ON "MerchantInvoiceItem"("adjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoiceItem_adjustmentId_merchantId_key" ON "MerchantInvoiceItem"("adjustmentId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoiceItem_subscriptionId_billingPeriodStart_billi_key" ON "MerchantInvoiceItem"("subscriptionId", "billingPeriodStart", "billingPeriodEnd");

-- AddForeignKey
ALTER TABLE "MerchantInvoiceItem" ADD CONSTRAINT "MerchantInvoiceItem_adjustmentId_merchantId_fkey" FOREIGN KEY ("adjustmentId", "merchantId") REFERENCES "CommissionAdjustment"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Day 14 financial source integrity:
-- Every invoice item must identify exactly the source required by its type.
ALTER TABLE "MerchantInvoiceItem"
ADD CONSTRAINT "MerchantInvoiceItem_source_integrity_check"
CHECK (
  (
    "type" = 'COMMISSION'
    AND "commissionId" IS NOT NULL
    AND "adjustmentId" IS NULL
    AND "subscriptionId" IS NULL
    AND "billingPeriodStart" IS NULL
    AND "billingPeriodEnd" IS NULL
  )
  OR
  (
    "type" = 'ADJUSTMENT'
    AND "commissionId" IS NULL
    AND "adjustmentId" IS NOT NULL
    AND "subscriptionId" IS NULL
    AND "billingPeriodStart" IS NULL
    AND "billingPeriodEnd" IS NULL
  )
  OR
  (
    "type" = 'SUBSCRIPTION'
    AND "commissionId" IS NULL
    AND "adjustmentId" IS NULL
    AND "subscriptionId" IS NOT NULL
    AND "billingPeriodStart" IS NOT NULL
    AND "billingPeriodEnd" IS NOT NULL
  )
);

-- A subscription charge must represent a real positive-length billing period.
ALTER TABLE "MerchantInvoiceItem"
ADD CONSTRAINT "MerchantInvoiceItem_billing_period_check"
CHECK (
  "type" <> 'SUBSCRIPTION'
  OR "billingPeriodEnd" > "billingPeriodStart"
);
