/*
  Warnings:

  - Added the required column `passwordHash` to the `MerchantUser` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MerchantUser" ADD COLUMN     "passwordHash" TEXT NOT NULL;
