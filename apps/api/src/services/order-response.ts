export function sanitizeOrderForResponse<
  T extends Record<string, unknown>
>(order: T) {
  const {
    deliveryConfirmationCodeHash: _deliveryConfirmationCodeHash,
    deliveryConfirmationCodeExpiresAt: _deliveryConfirmationCodeExpiresAt,
    deliveryConfirmationAttempts: _deliveryConfirmationAttempts,
    deliveryConfirmationSentAt: _deliveryConfirmationSentAt,
    ...safeOrder
  } = order;

  return safeOrder;
}

export function sanitizeOrderForBillingResponse<
  T extends Record<string, unknown>
>(order: T) {
  const {
    deliveryName: _deliveryName,
    deliveryPhone: _deliveryPhone,
    deliveryAddress: _deliveryAddress,
    ...safeOrder
  } = sanitizeOrderForResponse(order);

  return safeOrder;
}