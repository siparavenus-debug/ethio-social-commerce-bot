-- CreateEnum
CREATE TYPE "MerchantInvoiceReminderType" AS ENUM ('FIRST_OVERDUE');

-- CreateTable
CREATE TABLE "MerchantInvoiceReminder" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" "MerchantInvoiceReminderType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantInvoiceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantInvoiceReminder_merchantId_createdAt_idx" ON "MerchantInvoiceReminder"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantInvoiceReminder_invoiceId_createdAt_idx" ON "MerchantInvoiceReminder"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoiceReminder_invoiceId_type_key" ON "MerchantInvoiceReminder"("invoiceId", "type");

-- AddForeignKey
ALTER TABLE "MerchantInvoiceReminder" ADD CONSTRAINT "MerchantInvoiceReminder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantInvoiceReminder" ADD CONSTRAINT "MerchantInvoiceReminder_invoiceId_merchantId_fkey" FOREIGN KEY ("invoiceId", "merchantId") REFERENCES "MerchantInvoice"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
