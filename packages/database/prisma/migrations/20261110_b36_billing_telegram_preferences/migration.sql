-- Gate 15.6 Part B / B3.6
-- Merchant billing Telegram notification preferences.
-- Existing destinations remain enabled by default.

ALTER TABLE "MerchantBillingTelegramDestination"
ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT TRUE;