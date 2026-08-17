export type ShoppingState = {
  productId?: string;
  productName?: string;
  quantity?: number;
  awaitingQuantity?: boolean;
  awaitingConfirmation?: boolean;
  awaitingPayment?: boolean;
  pendingOrderId?: string;
};

const stateStore = new Map<string, ShoppingState>();

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

export function clearConversationState(
  chatId: string
): void {
  stateStore.delete(chatId);
}
