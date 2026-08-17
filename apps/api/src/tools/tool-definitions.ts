export const commerceToolNames = [
  "searchProducts",
  "getProduct",
  "checkStock",
  "createOrder",
  "getOrderStatus",
  "getPaymentInstructions"
] as const;

export type CommerceToolName =
  (typeof commerceToolNames)[number];

export function isCommerceToolName(
  name: string
): name is CommerceToolName {
  return commerceToolNames.includes(
    name as CommerceToolName
  );
}
