import {
  searchProducts,
  getProduct,
  checkStock
} from "./products.js";

import {
  createOrder,
  getOrderStatus
} from "./orders.js";

import {
  getPaymentInstructions
} from "./payments.js";

export const commerceTools = {
  searchProducts,
  getProduct,
  checkStock,
  createOrder,
  getOrderStatus,
  getPaymentInstructions
};

export type CommerceToolName = keyof typeof commerceTools;

export function hasCommerceTool(
  name: string
): name is CommerceToolName {
  return Object.prototype.hasOwnProperty.call(
    commerceTools,
    name
  );
}