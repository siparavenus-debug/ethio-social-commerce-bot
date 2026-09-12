-- Day 14 invoice accounting:
-- commissionAmount is the signed subtotal of COMMISSION + ADJUSTMENT
-- invoice items. It may therefore be negative when later-period
-- refunds, reversals, waivers, or corrections exceed new commission
-- accruals for the invoice period.
--
-- subscriptionAmount remains nonnegative.
-- totalAmount remains nonnegative, so a negative payable invoice is
-- still prohibited until an explicit credit/refund policy exists.

ALTER TABLE "MerchantInvoice"
DROP CONSTRAINT "MerchantInvoice_commissionAmount_nonnegative_check";
