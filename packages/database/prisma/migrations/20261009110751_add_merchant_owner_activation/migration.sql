-- CreateTable
CREATE TABLE "MerchantOwnerActivation" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "ownerDisplayName" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantOwnerActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantOwnerActivation_tokenHash_key" ON "MerchantOwnerActivation"("tokenHash");

-- CreateIndex
CREATE INDEX "MerchantOwnerActivation_merchantId_idx" ON "MerchantOwnerActivation"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantOwnerActivation_ownerEmail_idx" ON "MerchantOwnerActivation"("ownerEmail");

-- CreateIndex
CREATE INDEX "MerchantOwnerActivation_expiresAt_idx" ON "MerchantOwnerActivation"("expiresAt");

-- AddForeignKey
ALTER TABLE "MerchantOwnerActivation" ADD CONSTRAINT "MerchantOwnerActivation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
