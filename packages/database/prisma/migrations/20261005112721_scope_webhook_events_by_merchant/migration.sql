/*
  Warnings:

  - A unique constraint covering the columns `[merchantId,provider,eventId]` on the table `WebhookEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "WebhookEvent_provider_eventId_key";

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_merchantId_provider_eventId_key" ON "WebhookEvent"("merchantId", "provider", "eventId");
