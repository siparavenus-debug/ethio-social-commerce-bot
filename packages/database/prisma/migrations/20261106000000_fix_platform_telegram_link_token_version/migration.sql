
-- Gate 15.6 Part B3.2
-- Align billing Telegram link-token versions with MerchantUser.tokenVersion.
-- MerchantUser.tokenVersion defaults to 0.
-- Preserve non-negative version enforcement.

ALTER TABLE "PlatformTelegramLinkToken"
  DROP CONSTRAINT "PlatformTelegramLinkToken_version_check";

ALTER TABLE "PlatformTelegramLinkToken"
  ADD CONSTRAINT "PlatformTelegramLinkToken_version_check"
  CHECK ("createdByTokenVersion" >= 0);
