/*
  Warnings:

  - A unique constraint covering the columns `[merchantId,idempotencyKey]` on the table `MerchantSettlement` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `idempotencyKey` to the `MerchantSettlement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MerchantSettlement" ADD COLUMN     "idempotencyKey" VARCHAR(200) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettlement_merchantId_idempotencyKey_key" ON "MerchantSettlement"("merchantId", "idempotencyKey");
