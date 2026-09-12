ALTER TABLE "MerchantSettlement"
DROP CONSTRAINT "MerchantSettlement_amount_nonnegative_check";

ALTER TABLE "MerchantSettlement"
ADD CONSTRAINT "MerchantSettlement_amount_positive_check"
CHECK ("amount" > 0);
