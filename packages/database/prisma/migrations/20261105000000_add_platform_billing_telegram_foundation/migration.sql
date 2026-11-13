-- Gate 15.6 Part B - B2 PostgreSQL migration
-- Generated schema, manual safeguards, legacy backfill

BEGIN;

-- CreateEnum
CREATE TYPE "PlatformBillingEventType" AS ENUM ('INVOICE_ISSUED', 'INVOICE_FIRST_OVERDUE', 'INVOICE_SECOND_OVERDUE', 'SETTLEMENT_SUBMITTED', 'SETTLEMENT_VERIFIED', 'INVOICE_PAID', 'SUBSCRIPTION_SUSPENDED');

-- CreateEnum
CREATE TYPE "PlatformBillingNotificationStatus" AS ENUM ('PENDING', 'COMPLETED', 'SUPPRESSED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PlatformBillingDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENDING', 'SENT', 'FAILED', 'SUPPRESSED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PlatformBillingAttemptOutcome" AS ENUM ('PREPARED', 'REQUEST_STARTED', 'SUCCEEDED', 'FAILED_PRE_SEND', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "PlatformBillingWebhookStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'REJECTED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PlatformBillingBotStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'INACTIVE', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "BillingDestinationStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "PlatformBillingAuditActorType" AS ENUM ('PLATFORM_USER', 'MERCHANT_OWNER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TelegramBotOwnerType" AS ENUM ('PLATFORM_BILLING', 'MERCHANT_COMMERCE');

-- CreateEnum
CREATE TYPE "TelegramBotReservationStatus" AS ENUM ('RESERVED', 'RELEASED');

-- AlterTable
ALTER TABLE "MerchantSubscription" ADD COLUMN     "suspensionGeneration" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MerchantInvoice" ADD COLUMN     "paidBySettlementId" TEXT;

-- CreateTable
CREATE TABLE "PlatformTelegramLinkToken" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByTokenVersion" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformTelegramLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantBillingTelegramDestination" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "platformBotId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "status" "BillingDestinationStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedByUserId" TEXT NOT NULL,
    "linkVersion" INTEGER NOT NULL DEFAULT 1,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantBillingTelegramDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBillingEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "PlatformBillingEventType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformBillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBillingNotification" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "PlatformBillingNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "terminalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBillingNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBillingNotificationDelivery" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "destinationId" TEXT,
    "destinationLinkVersion" INTEGER,
    "status" "PlatformBillingDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimId" TEXT,
    "processingUntil" TIMESTAMP(3),
    "terminalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBillingNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBillingNotificationAttempt" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "claimId" TEXT NOT NULL,
    "outcome" "PlatformBillingAttemptOutcome" NOT NULL DEFAULT 'PREPARED',
    "requestStartedAt" TIMESTAMP(3),
    "responseReceivedAt" TIMESTAMP(3),
    "sanitizedError" TEXT,
    "retryAfterSeconds" INTEGER,
    "telegramMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformBillingNotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBillingTelegramWebhookEvent" (
    "id" TEXT NOT NULL,
    "platformBotId" TEXT NOT NULL,
    "telegramUpdateId" TEXT NOT NULL,
    "status" "PlatformBillingWebhookStatus" NOT NULL DEFAULT 'PENDING',
    "sanitizedPayload" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimId" TEXT,
    "processingUntil" TIMESTAMP(3),
    "terminalReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformBillingTelegramWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBillingTelegramBot" (
    "id" TEXT NOT NULL,
    "botIdentityId" TEXT NOT NULL,
    "botTokenEncrypted" TEXT NOT NULL,
    "webhookSecretEncrypted" TEXT NOT NULL,
    "webhookKey" TEXT NOT NULL,
    "status" "PlatformBillingBotStatus" NOT NULL DEFAULT 'PROVISIONING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBillingTelegramBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBillingNotificationAudit" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "actorType" "PlatformBillingAuditActorType" NOT NULL,
    "actorMerchantUserId" TEXT,
    "actorPlatformUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sanitizedMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformBillingNotificationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramBotIdentityRegistry" (
    "id" TEXT NOT NULL,
    "telegramBotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramBotIdentityRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramBotOwnershipReservation" (
    "id" TEXT NOT NULL,
    "botIdentityId" TEXT NOT NULL,
    "ownerType" "TelegramBotOwnerType" NOT NULL,
    "status" "TelegramBotReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "merchantId" TEXT,
    "merchantIntegrationId" TEXT,
    "platformBillingBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramBotOwnershipReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformTelegramLinkToken_tokenHash_key" ON "PlatformTelegramLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformTelegramLinkToken_merchantId_expiresAt_idx" ON "PlatformTelegramLinkToken"("merchantId", "expiresAt");

-- CreateIndex
CREATE INDEX "PlatformTelegramLinkToken_createdByUserId_createdAt_idx" ON "PlatformTelegramLinkToken"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantBillingTelegramDestination_merchantId_status_idx" ON "MerchantBillingTelegramDestination"("merchantId", "status");

-- CreateIndex
CREATE INDEX "MerchantBillingTelegramDestination_platformBotId_chatId_idx" ON "MerchantBillingTelegramDestination"("platformBotId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantBillingTelegramDestination_id_merchantId_key" ON "MerchantBillingTelegramDestination"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantBillingTelegramDestination_id_merchantId_linkVersio_key" ON "MerchantBillingTelegramDestination"("id", "merchantId", "linkVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingEvent_occurrenceKey_key" ON "PlatformBillingEvent"("occurrenceKey");

-- CreateIndex
CREATE INDEX "PlatformBillingEvent_merchantId_type_createdAt_idx" ON "PlatformBillingEvent"("merchantId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingEvent_id_merchantId_key" ON "PlatformBillingEvent"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingNotification_eventId_key" ON "PlatformBillingNotification"("eventId");

-- CreateIndex
CREATE INDEX "PlatformBillingNotification_merchantId_status_idx" ON "PlatformBillingNotification"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingNotification_id_merchantId_key" ON "PlatformBillingNotification"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingNotification_eventId_merchantId_key" ON "PlatformBillingNotification"("eventId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingNotificationDelivery_notificationId_key" ON "PlatformBillingNotificationDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "PlatformBillingNotificationDelivery_status_nextAttemptAt_idx" ON "PlatformBillingNotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PlatformBillingNotificationDelivery_status_processingUntil_idx" ON "PlatformBillingNotificationDelivery"("status", "processingUntil");

-- CreateIndex
CREATE INDEX "PlatformBillingNotificationDelivery_claimId_idx" ON "PlatformBillingNotificationDelivery"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingNotificationDelivery_id_merchantId_key" ON "PlatformBillingNotificationDelivery"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingNotificationDelivery_notificationId_merchant_key" ON "PlatformBillingNotificationDelivery"("notificationId", "merchantId");

-- CreateIndex
CREATE INDEX "PlatformBillingNotificationAttempt_merchantId_createdAt_idx" ON "PlatformBillingNotificationAttempt"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingNotificationAttempt_deliveryId_attemptNumber_key" ON "PlatformBillingNotificationAttempt"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE INDEX "PlatformBillingTelegramWebhookEvent_status_nextAttemptAt_idx" ON "PlatformBillingTelegramWebhookEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PlatformBillingTelegramWebhookEvent_status_processingUntil_idx" ON "PlatformBillingTelegramWebhookEvent"("status", "processingUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingTelegramWebhookEvent_platformBotId_telegramU_key" ON "PlatformBillingTelegramWebhookEvent"("platformBotId", "telegramUpdateId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingTelegramBot_botIdentityId_key" ON "PlatformBillingTelegramBot"("botIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingTelegramBot_webhookKey_key" ON "PlatformBillingTelegramBot"("webhookKey");

-- CreateIndex
CREATE INDEX "PlatformBillingTelegramBot_status_idx" ON "PlatformBillingTelegramBot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingTelegramBot_id_botIdentityId_key" ON "PlatformBillingTelegramBot"("id", "botIdentityId");

-- CreateIndex
CREATE INDEX "PlatformBillingNotificationAudit_merchantId_createdAt_idx" ON "PlatformBillingNotificationAudit"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformBillingNotificationAudit_entityType_entityId_idx" ON "PlatformBillingNotificationAudit"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBotIdentityRegistry_telegramBotId_key" ON "TelegramBotIdentityRegistry"("telegramBotId");

-- CreateIndex
CREATE INDEX "TelegramBotOwnershipReservation_botIdentityId_status_idx" ON "TelegramBotOwnershipReservation"("botIdentityId", "status");

-- CreateIndex
CREATE INDEX "TelegramBotOwnershipReservation_merchantId_status_idx" ON "TelegramBotOwnershipReservation"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantUser_id_merchantId_key" ON "MerchantUser"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTelegramBotClaim_id_integrationId_merchantId_key" ON "MerchantTelegramBotClaim"("id", "integrationId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoice_paidBySettlementId_id_merchantId_key" ON "MerchantInvoice"("paidBySettlementId", "id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantInvoiceReminder_id_invoiceId_merchantId_type_key" ON "MerchantInvoiceReminder"("id", "invoiceId", "merchantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettlement_id_invoiceId_merchantId_key" ON "MerchantSettlement"("id", "invoiceId", "merchantId");

-- AddForeignKey
ALTER TABLE "MerchantInvoice" ADD CONSTRAINT "MerchantInvoice_paidBySettlementId_id_merchantId_fkey" FOREIGN KEY ("paidBySettlementId", "id", "merchantId") REFERENCES "MerchantSettlement"("id", "invoiceId", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformTelegramLinkToken" ADD CONSTRAINT "PlatformTelegramLinkToken_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformTelegramLinkToken" ADD CONSTRAINT "PlatformTelegramLinkToken_createdByUserId_merchantId_fkey" FOREIGN KEY ("createdByUserId", "merchantId") REFERENCES "MerchantUser"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBillingTelegramDestination" ADD CONSTRAINT "MerchantBillingTelegramDestination_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBillingTelegramDestination" ADD CONSTRAINT "MerchantBillingTelegramDestination_linkedByUserId_merchant_fkey" FOREIGN KEY ("linkedByUserId", "merchantId") REFERENCES "MerchantUser"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBillingTelegramDestination" ADD CONSTRAINT "MerchantBillingTelegramDestination_platformBotId_fkey" FOREIGN KEY ("platformBotId") REFERENCES "PlatformBillingTelegramBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingEvent" ADD CONSTRAINT "PlatformBillingEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingNotification" ADD CONSTRAINT "PlatformBillingNotification_eventId_merchantId_fkey" FOREIGN KEY ("eventId", "merchantId") REFERENCES "PlatformBillingEvent"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingNotificationDelivery" ADD CONSTRAINT "PlatformBillingNotificationDelivery_notificationId_merchan_fkey" FOREIGN KEY ("notificationId", "merchantId") REFERENCES "PlatformBillingNotification"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingNotificationDelivery" ADD CONSTRAINT "PlatformBillingNotificationDelivery_destinationId_merchant_fkey" FOREIGN KEY ("destinationId", "merchantId", "destinationLinkVersion") REFERENCES "MerchantBillingTelegramDestination"("id", "merchantId", "linkVersion") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingNotificationAttempt" ADD CONSTRAINT "PlatformBillingNotificationAttempt_deliveryId_merchantId_fkey" FOREIGN KEY ("deliveryId", "merchantId") REFERENCES "PlatformBillingNotificationDelivery"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingTelegramWebhookEvent" ADD CONSTRAINT "PlatformBillingTelegramWebhookEvent_platformBotId_fkey" FOREIGN KEY ("platformBotId") REFERENCES "PlatformBillingTelegramBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingTelegramBot" ADD CONSTRAINT "PlatformBillingTelegramBot_botIdentityId_fkey" FOREIGN KEY ("botIdentityId") REFERENCES "TelegramBotIdentityRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingNotificationAudit" ADD CONSTRAINT "PlatformBillingNotificationAudit_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingNotificationAudit" ADD CONSTRAINT "PlatformBillingNotificationAudit_actorMerchantUserId_merch_fkey" FOREIGN KEY ("actorMerchantUserId", "merchantId") REFERENCES "MerchantUser"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingNotificationAudit" ADD CONSTRAINT "PlatformBillingNotificationAudit_actorPlatformUserId_fkey" FOREIGN KEY ("actorPlatformUserId") REFERENCES "PlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBotOwnershipReservation" ADD CONSTRAINT "TelegramBotOwnershipReservation_botIdentityId_fkey" FOREIGN KEY ("botIdentityId") REFERENCES "TelegramBotIdentityRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBotOwnershipReservation" ADD CONSTRAINT "TelegramBotOwnershipReservation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBotOwnershipReservation" ADD CONSTRAINT "TelegramBotOwnershipReservation_merchantIntegrationId_merc_fkey" FOREIGN KEY ("merchantIntegrationId", "merchantId") REFERENCES "MerchantTelegramIntegration"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBotOwnershipReservation" ADD CONSTRAINT "TelegramBotOwnershipReservation_platformBillingBotId_botId_fkey" FOREIGN KEY ("platformBillingBotId", "botIdentityId") REFERENCES "PlatformBillingTelegramBot"("id", "botIdentityId") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Manual safeguards and legacy ownership backfill

-- Gate 15.6 Part B / B2.2
-- Manual PostgreSQL safeguards
-- DRAFT ONLY - NOT APPROVED FOR EXECUTION
--
-- This file supplements b2-incremental-clean.sql.
-- Do not execute independently.
-- Review constraints, backfill, and rollout before migration.

-- 1. One RESERVED ownership record per Telegram bot identity.
CREATE UNIQUE INDEX "TelegramBotOwnershipReservation_one_reserved_per_bot_idx"
ON "TelegramBotOwnershipReservation" ("botIdentityId")
WHERE "status" = 'RESERVED';

-- 2. One ACTIVE billing destination per merchant.
CREATE UNIQUE INDEX "MerchantBillingTelegramDestination_one_active_per_merchant_idx"
ON "MerchantBillingTelegramDestination" ("merchantId")
WHERE "status" = 'ACTIVE';

-- 3. One ACTIVE owner per platform bot/chat combination.
CREATE UNIQUE INDEX "MerchantBillingTelegramDestination_one_active_per_bot_chat_idx"
ON "MerchantBillingTelegramDestination" ("platformBotId", "chatId")
WHERE "status" = 'ACTIVE';

-- 4. One unresolved send attempt per delivery.
-- UNCERTAIN remains unresolved until explicit reconciliation.
CREATE UNIQUE INDEX "PlatformBillingNotificationAttempt_one_unresolved_per_delivery_idx"
ON "PlatformBillingNotificationAttempt" ("deliveryId")
WHERE "outcome" IN (
    'PREPARED',
    'REQUEST_STARTED',
    'UNCERTAIN'
);
-- 5. Ownership reservation must reference exactly the correct owner.
ALTER TABLE "TelegramBotOwnershipReservation"
ADD CONSTRAINT "TelegramBotOwnershipReservation_owner_type_check"
CHECK (
    (
        "ownerType" = 'MERCHANT_COMMERCE'
        AND "merchantId" IS NOT NULL
        AND (
            ("status" = 'RESERVED' AND "merchantIntegrationId" IS NOT NULL)
            OR "status" = 'RELEASED'
        )
        AND "platformBillingBotId" IS NULL
    )
    OR
    (
        "ownerType" = 'PLATFORM_BILLING'
        AND "platformBillingBotId" IS NOT NULL
        AND "merchantId" IS NULL
        AND "merchantIntegrationId" IS NULL
    )
);

-- 6. Reservation release timestamp must match lifecycle status.
ALTER TABLE "TelegramBotOwnershipReservation"
ADD CONSTRAINT "TelegramBotOwnershipReservation_release_check"
CHECK (
    (
        "status" = 'RESERVED'
        AND "releasedAt" IS NULL
    )
    OR
    (
        "status" = 'RELEASED'
        AND "releasedAt" IS NOT NULL
    )
);

-- 7. Billing destination link version must be positive.
ALTER TABLE "MerchantBillingTelegramDestination"
ADD CONSTRAINT "MerchantBillingTelegramDestination_link_version_check"
CHECK ("linkVersion" > 0);

-- 8. Billing destination revocation timestamp must match status.
ALTER TABLE "MerchantBillingTelegramDestination"
ADD CONSTRAINT "MerchantBillingTelegramDestination_revocation_check"
CHECK (
    (
        "status" = 'ACTIVE'
        AND "revokedAt" IS NULL
    )
    OR
    (
        "status" = 'REVOKED'
        AND "revokedAt" IS NOT NULL
    )
);
-- 9. Link token version must be positive.
ALTER TABLE "PlatformTelegramLinkToken"
ADD CONSTRAINT "PlatformTelegramLinkToken_version_check"
CHECK ("createdByTokenVersion" > 0);

-- 10. Link token cannot be both consumed and revoked.
ALTER TABLE "PlatformTelegramLinkToken"
ADD CONSTRAINT "PlatformTelegramLinkToken_lifecycle_check"
CHECK (
    "consumedAt" IS NULL
    OR "revokedAt" IS NULL
);

-- 11. Delivery attempt count cannot be negative.
ALTER TABLE "PlatformBillingNotificationDelivery"
ADD CONSTRAINT "PlatformBillingNotificationDelivery_attempt_count_check"
CHECK ("attemptCount" >= 0);

-- 12. Destination ID and link version must be supplied together.
ALTER TABLE "PlatformBillingNotificationDelivery"
ADD CONSTRAINT "PlatformBillingNotificationDelivery_destination_pair_check"
CHECK (
    (
        "destinationId" IS NULL
        AND "destinationLinkVersion" IS NULL
    )
    OR
    (
        "destinationId" IS NOT NULL
        AND "destinationLinkVersion" IS NOT NULL
    )
);

-- 13. A processing lease must have a claim identifier.
-- A claim identifier may remain for historical diagnostics.
ALTER TABLE "PlatformBillingNotificationDelivery"
ADD CONSTRAINT "PlatformBillingNotificationDelivery_lease_check"
CHECK (
    "processingUntil" IS NULL
    OR "claimId" IS NOT NULL
);

-- 14. Attempt numbers must be positive.
ALTER TABLE "PlatformBillingNotificationAttempt"
ADD CONSTRAINT "PlatformBillingNotificationAttempt_number_check"
CHECK ("attemptNumber" > 0);

-- 15. Retry-after values cannot be negative.
ALTER TABLE "PlatformBillingNotificationAttempt"
ADD CONSTRAINT "PlatformBillingNotificationAttempt_retry_check"
CHECK (
    "retryAfterSeconds" IS NULL
    OR "retryAfterSeconds" >= 0
);

-- 16. A response cannot precede the request start.
ALTER TABLE "PlatformBillingNotificationAttempt"
ADD CONSTRAINT "PlatformBillingNotificationAttempt_timestamp_check"
CHECK (
    "responseReceivedAt" IS NULL
    OR (
        "requestStartedAt" IS NOT NULL
        AND "responseReceivedAt" >= "requestStartedAt"
    )
);
-- 17. Audit actor references must match the actor type.
-- Merchant owners must belong to the recorded merchant.
-- Platform and system actions may optionally target a merchant.
ALTER TABLE "PlatformBillingNotificationAudit"
ADD CONSTRAINT "PlatformBillingNotificationAudit_actor_check"
CHECK (
    (
        "actorType" = 'MERCHANT_OWNER'
        AND "merchantId" IS NOT NULL
        AND "actorMerchantUserId" IS NOT NULL
        AND "actorPlatformUserId" IS NULL
    )
    OR
    (
        "actorType" = 'PLATFORM_USER'
        AND "actorPlatformUserId" IS NOT NULL
        AND "actorMerchantUserId" IS NULL
    )
    OR
    (
        "actorType" = 'SYSTEM'
        AND "actorMerchantUserId" IS NULL
        AND "actorPlatformUserId" IS NULL
    )
);
-- 18. Shared append-only enforcement function.
-- Billing events and audit records must not be updated or deleted.
CREATE FUNCTION platform_billing_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Append-only table % does not permit %',
        TG_TABLE_NAME,
        TG_OP
        USING ERRCODE = '23514';
END;
$$;

-- 19. Protect immutable billing events.
CREATE TRIGGER "PlatformBillingEvent_append_only"
BEFORE UPDATE OR DELETE
ON "PlatformBillingEvent"
FOR EACH ROW
EXECUTE FUNCTION platform_billing_reject_immutable_mutation();

-- 20. Protect immutable billing audit records.
CREATE TRIGGER "PlatformBillingNotificationAudit_append_only"
BEFORE UPDATE OR DELETE
ON "PlatformBillingNotificationAudit"
FOR EACH ROW
EXECUTE FUNCTION platform_billing_reject_immutable_mutation();
-- ============================================================
-- B2_LEGACY_OWNERSHIP_BACKFILL
-- DRAFT ONLY - NOT APPROVED FOR EXECUTION
--
-- Preconditions:
-- 1. New B2 tables and safeguards already exist.
-- 2. Legacy bot provisioning/replacement writes are blocked
--    or coordinated with global ownership reservations.
-- 3. Run within an explicitly controlled migration transaction.
-- 4. Do not call Telegram or modify existing webhooks.
-- ============================================================

DO $$
DECLARE
    conflict_count BIGINT;
BEGIN
    -- Serialize cooperating backfill executions.
    PERFORM pg_advisory_xact_lock(1506, 2);

    -- Every current integration bot identity must have
    -- a corresponding ACTIVE or PENDING legacy claim.
    SELECT COUNT(*)
    INTO conflict_count
    FROM "MerchantTelegramIntegration" i
    WHERE i."telegramBotId" IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM "MerchantTelegramBotClaim" c
          WHERE c."integrationId" = i."id"
            AND c."merchantId" = i."merchantId"
            AND c."telegramBotId" = i."telegramBotId"
      );

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'Legacy bot backfill aborted: % integration identities have no matching claim',
            conflict_count;
    END IF;

    -- B2_ACTIVE_INTEGRATION_CLAIM_GUARD
    -- An ACTIVE integration must have a current bot identity
    -- backed by an ACTIVE legacy claim.
    SELECT COUNT(*)
    INTO conflict_count
    FROM "MerchantTelegramIntegration" i
    WHERE i."status" = 'ACTIVE'
      AND (
          i."telegramBotId" IS NULL
          OR NOT EXISTS (
              SELECT 1
              FROM "MerchantTelegramBotClaim" c
              WHERE c."integrationId" = i."id"
                AND c."merchantId" = i."merchantId"
                AND c."telegramBotId" = i."telegramBotId"
                AND c."status" = 'ACTIVE'
          )
      );

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'Legacy bot backfill aborted: % ACTIVE integrations lack matching ACTIVE claims',
            conflict_count;
    END IF;

    -- Detect any existing reservation that assigns a
    -- claimed bot to a different owner.
    SELECT COUNT(*)
    INTO conflict_count
    FROM "MerchantTelegramBotClaim" c
    JOIN "TelegramBotIdentityRegistry" r
      ON r."telegramBotId" = c."telegramBotId"
    JOIN "TelegramBotOwnershipReservation" o
      ON o."botIdentityId" = r."id"
     AND o."status" = 'RESERVED'
    WHERE o."ownerType" <> 'MERCHANT_COMMERCE'
       OR o."merchantId" IS DISTINCT FROM c."merchantId"
       OR o."merchantIntegrationId" IS DISTINCT FROM c."integrationId";

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'Legacy bot backfill aborted: % conflicting ownership reservations',
            conflict_count;
    END IF;

    -- B2_HISTORICAL_RESERVATION_GUARD
    -- Fail closed if any claimed identity has been released
    -- or has historical ownership belonging to another owner.
    SELECT COUNT(*)
    INTO conflict_count
    FROM "MerchantTelegramBotClaim" c
    JOIN "TelegramBotIdentityRegistry" r
      ON r."telegramBotId" = c."telegramBotId"
    JOIN "TelegramBotOwnershipReservation" o
      ON o."botIdentityId" = r."id"
    WHERE o."status" = 'RELEASED'
       OR o."ownerType" <> 'MERCHANT_COMMERCE'
       OR o."merchantId" IS DISTINCT FROM c."merchantId"
       OR o."merchantIntegrationId" IS DISTINCT FROM c."integrationId";

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'Legacy bot backfill aborted: % historical ownership conflicts require reconciliation',
            conflict_count;
    END IF;

    -- Register every existing ACTIVE or PENDING claim identity.
    INSERT INTO "TelegramBotIdentityRegistry" (
        "id",
        "telegramBotId",
        "createdAt"
    )
    SELECT
        gen_random_uuid()::text,
        c."telegramBotId",
        CURRENT_TIMESTAMP
    FROM "MerchantTelegramBotClaim" c
    ON CONFLICT ("telegramBotId") DO NOTHING;

    -- Reserve every claimed identity for its existing merchant.
    INSERT INTO "TelegramBotOwnershipReservation" (
        "id",
        "botIdentityId",
        "ownerType",
        "status",
        "merchantId",
        "merchantIntegrationId",
        "platformBillingBotId",
        "createdAt",
        "releasedAt"
    )
    SELECT
        gen_random_uuid()::text,
        r."id",
        'MERCHANT_COMMERCE',
        'RESERVED',
        c."merchantId",
        c."integrationId",
        NULL,
        CURRENT_TIMESTAMP,
        NULL
    FROM "MerchantTelegramBotClaim" c
    JOIN "TelegramBotIdentityRegistry" r
      ON r."telegramBotId" = c."telegramBotId"
    WHERE NOT EXISTS (
        SELECT 1
        FROM "TelegramBotOwnershipReservation" o
        WHERE o."botIdentityId" = r."id"
    );

    -- Verify every legacy claim now has its correct reservation.
    SELECT COUNT(*)
    INTO conflict_count
    FROM "MerchantTelegramBotClaim" c
    JOIN "TelegramBotIdentityRegistry" r
      ON r."telegramBotId" = c."telegramBotId"
    WHERE NOT EXISTS (
        SELECT 1
        FROM "TelegramBotOwnershipReservation" o
        WHERE o."botIdentityId" = r."id"
          AND o."status" = 'RESERVED'
          AND o."ownerType" = 'MERCHANT_COMMERCE'
          AND o."merchantId" = c."merchantId"
          AND o."merchantIntegrationId" = c."integrationId"
    );

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'Legacy bot backfill verification failed: % claims lack matching reservations',
            conflict_count;
    END IF;
END;
$$;

COMMIT;
