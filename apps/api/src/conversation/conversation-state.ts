import type { AIMessage } from "../ai/ai-provider.js";

export type ShoppingState = {
  productId?: string;
  productName?: string;
  quantity?: number;

  awaitingQuantity?: boolean;
  awaitingConfirmation?: boolean;

  awaitingDeliveryName?: boolean;
  awaitingDeliveryPhone?: boolean;
  awaitingDeliveryAddress?: boolean;

  deliveryName?: string;
  deliveryPhone?: string;
  deliveryAddress?: string;

  awaitingPayment?: boolean;
  pendingOrderId?: string;

  lastUserMessage?: string;

  lastIntent?:
    | "SEARCH_PRODUCT"
    | "GET_PRODUCT"
    | "CHECK_STOCK"
    | "CREATE_ORDER"
    | "GET_ORDER_STATUS"
    | "GET_PAYMENT_INSTRUCTIONS"
    | "GENERAL";

  history?: AIMessage[];
};

const stateStore =
  new Map<string, ShoppingState>();

export function getConversationState(
  chatId: string
): ShoppingState {
  return stateStore.get(chatId) ?? {};
}

export function setConversationState(
  chatId: string,
  state: ShoppingState
): void {
  stateStore.set(chatId, state);
}

export function updateConversationState(
  chatId: string,
  update: Partial<ShoppingState>
): ShoppingState {
  const current =
    getConversationState(chatId);

  const next = {
    ...current,
    ...update
  };

  stateStore.set(chatId, next);

  return next;
}

export function clearConversationState(
  chatId: string
): void {
  stateStore.delete(chatId);
}