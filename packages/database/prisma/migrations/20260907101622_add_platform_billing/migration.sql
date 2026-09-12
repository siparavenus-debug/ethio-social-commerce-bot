/*
  Warnings:

  - A unique constraint covering the columns `[id,merchantId]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,merchantId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "MerchantSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionBillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'INVOICED', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "MerchantInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "MerchantInvoiceItemType" AS ENUM ('SUBSCRIPTION', 'COMMISSION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MerchantSettlementStatus" AS ENUM ('REVIEW_REQUIRED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MerchantSettlementProvider" AS ENUM ('TELEBIRR', 'CBE_BIRR', 'OTHER');

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(12,2) NOT NULL,
    "annualPrice" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "commissionRate" DECIMAL(7,6) NOT NULL,
    "features" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSubscription" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "MerchantSubscriptionStatus" NOT NULL,
    "billingInterval" "SubscriptionBillingInterval" NOT NULL,
    "priceSnapshot" DECIMAL(12,2) NOT NULL,
    "commissionRateSnapshot" DECIMAL(7,6) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "transactionAmount" DECIMAL(12,2) NOT NULL,
    "commissionRate" DECIMAL(7,6) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantInvoice" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "subscriptionAmount" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "status" "MerchantInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantInvoiceItem" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" "MerchantInvoiceItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "commissionId" TEXT,
    "subscriptionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSettlement" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" "MerchantSettlementProvider" NOT NULL,
    "status" "MerchantSettlementStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "transactionReference" TEXT,
    "receiptUrl" TEXT,
    "receiptMetadata" JSONB,
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettlement_pkey" PRIMARY KEY ("id")
);

-- Financial integrity checks

ALTER TABLE "SubscriptionPlan"
ADD CONSTRAINT "SubscriptionPlan_monthlyPrice_nonnegative_check"
CHECK ("monthlyPrice" >= 0);

ALTER TABLE "SubscriptionPlan"
ADD CONSTRAINT "SubscriptionPlan_annualPrice_nonnegative_check"
CHECK ("annualPrice" >= 0);

ALTER TABLE "SubscriptionPlan"
ADD CONSTRAINT "SubscriptionPlan_commissionRate_range_check"
CHECK ("commissionRate" >= 0 AND "commissionRate" <= 1);


ALTER TABLE "MerchantSubscription"
ADD CONSTRAINT "MerchantSubscription_priceSnapshot_nonnegative_check"
CHECK ("priceSnapshot" >= 0);

ALTER TABLE "MerchantSubscription"
ADD CONSTRAINT "MerchantSubscription_commissionRateSnapshot_range_check"
CHECK ("commissionRateSnapshot" >= 0 AND "commissionRateSnapshot" <= 1);

ALTER TABLE "MerchantSubscription"
ADD CONSTRAINT "MerchantSubscription_period_check"
CHECK ("currentPeriodEnd" > "currentPeriodStart");


ALTER TABLE "Commission"
ADD CONSTRAINT "Commission_transactionAmount_nonnegative_check"
CHECK ("transactionAmount" >= 0);

ALTER TABLE "Commission"
ADD CONSTRAINT "Commission_commissionRate_range_check"
CHECK ("commissionRate" >= 0 AND "commissionRate" <= 1);

ALTER TABLE "Commission"
ADD CONSTRAINT "Commission_commissionAmount_nonnegative_check"
CHECK ("commissionAmount" >= 0);


ALTER TABLE "MerchantInvoice"
ADD CONSTRAINT "MerchantInvoice_period_check"
CHECK ("periodEnd" > "periodStart");

ALTER TABLE "MerchantInvoice"
ADD CONSTRAINT "MerchantInvoice_subscriptionAmount_nonnegative_check"
CHECK ("subscriptionAmount" >= 0);

ALTER TABLE "MerchantInvoice"
ADD CONSTRAINT "MerchantInvoice_commissionAmount_nonnegative_check"
CHECK ("commissionAmount" >= 0);

ALTER TABLE "MerchantInvoice"
ADD CONSTRAINT "MerchantInvoice_totalAmount_nonnegative_check"
CHECK ("totalAmount" >= 0);


ALTER TABLE "MerchantSettlement"
ADD CONSTRAINT "MerchantSettlement_amount_nonnegative_check"
CHECK ("amount" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_isActive_idx" ON "SubscriptionPlan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSubscription_merchantId_key" ON "MerchantSubscription"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantSubscription_planId_idx" ON "MerchantSubscription"("planId");

-- CreateIndex
CREATE INDEX "MerchantSubscription_status_currentPeriodEnd_idx" ON "MerchantSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSubscription_id_merchantId_key" ON "MerchantSubscription"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_paymentId_key" ON "Commission"("paymentId");

-- CreateIndex
CREATE INDEX "Commission_merchantId_status_createdAt_idx" ON "Commission"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Commission_orderId_idx" ON "Commission"("orderId");

-- CreateIndex
CREATE INDEX "Commission_subscriptionId_idx" ON "Commission"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_paymentId_merchantId_key" ON "Commission"("paymentId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_id_merchantId_key" ON "Commission"("id", "merchantId");

-- CreateIndex
CREATE INDEX "MerchantInvoice_merchantId_status_createdAt_idx" ON "MerchantInvoice"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantInvoice_merchantId_dueAt_idx" ON "MerchantInvoice"("merchantId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoice_merchantId_invoiceNumber_key" ON "MerchantInvoice"("merchantId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoice_merchantId_periodStart_periodEnd_key" ON "MerchantInvoice"("merchantId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoice_id_merchantId_key" ON "MerchantInvoice"("id", "merchantId");

-- CreateIndex
CREATE INDEX "MerchantInvoiceItem_merchantId_invoiceId_idx" ON "MerchantInvoiceItem"("merchantId", "invoiceId");

-- CreateIndex
CREATE INDEX "MerchantInvoiceItem_type_idx" ON "MerchantInvoiceItem"("type");

-- CreateIndex
CREATE INDEX "MerchantInvoiceItem_subscriptionId_idx" ON "MerchantInvoiceItem"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoiceItem_commissionId_key" ON "MerchantInvoiceItem"("commissionId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoiceItem_commissionId_merchantId_key" ON "MerchantInvoiceItem"("commissionId", "merchantId");

-- CreateIndex
CREATE INDEX "MerchantSettlement_merchantId_status_createdAt_idx" ON "MerchantSettlement"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantSettlement_invoiceId_idx" ON "MerchantSettlement"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettlement_provider_transactionReference_key" ON "MerchantSettlement"("provider", "transactionReference");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_merchantId_key" ON "Order"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_merchantId_key" ON "Payment"("id", "merchantId");

-- AddForeignKey
ALTER TABLE "MerchantSubscription" ADD CONSTRAINT "MerchantSubscription_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSubscription" ADD CONSTRAINT "MerchantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_paymentId_merchantId_fkey" FOREIGN KEY ("paymentId", "merchantId") REFERENCES "Payment"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_orderId_merchantId_fkey" FOREIGN KEY ("orderId", "merchantId") REFERENCES "Order"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_subscriptionId_merchantId_fkey" FOREIGN KEY ("subscriptionId", "merchantId") REFERENCES "MerchantSubscription"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantInvoice" ADD CONSTRAINT "MerchantInvoice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantInvoiceItem" ADD CONSTRAINT "MerchantInvoiceItem_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantInvoiceItem" ADD CONSTRAINT "MerchantInvoiceItem_invoiceId_merchantId_fkey" FOREIGN KEY ("invoiceId", "merchantId") REFERENCES "MerchantInvoice"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantInvoiceItem" ADD CONSTRAINT "MerchantInvoiceItem_commissionId_merchantId_fkey" FOREIGN KEY ("commissionId", "merchantId") REFERENCES "Commission"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantInvoiceItem" ADD CONSTRAINT "MerchantInvoiceItem_subscriptionId_merchantId_fkey" FOREIGN KEY ("subscriptionId", "merchantId") REFERENCES "MerchantSubscription"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSettlement" ADD CONSTRAINT "MerchantSettlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSettlement" ADD CONSTRAINT "MerchantSettlement_invoiceId_merchantId_fkey" FOREIGN KEY ("invoiceId", "merchantId") REFERENCES "MerchantInvoice"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
