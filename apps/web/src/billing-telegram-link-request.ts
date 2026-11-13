
import {
    validateBillingTelegramLinkTokenResponse,
    type BillingTelegramLinkTokenResult
  } from "./billing-telegram-link-token.js";

  export type BillingTelegramLinkRequestContext = {
    merchantId: string;
    isCurrentRequest: () => boolean;
    apiFetch: (
      path: string,
      options?: RequestInit
    ) => Promise<Response>;
  };

  export async function issueBillingTelegramLinkToken(
    context: BillingTelegramLinkRequestContext
  ): Promise<BillingTelegramLinkTokenResult | null> {
    const {
      merchantId,
      isCurrentRequest,
      apiFetch
    } = context;

    if (!isCurrentRequest()) {
      return null;
    }

    const response = await apiFetch(
      `/merchants/${merchantId}/billing-telegram/link-token`,
      {
        method: "POST",
        cache: "no-store"
      }
    );

    if (!isCurrentRequest()) {
      return null;
    }

    if (response.status !== 201) {
      throw new Error("Link token issuance failed");
    }

    const data: unknown = await response.json();

    if (!isCurrentRequest()) {
      return null;
    }

    const result =
      validateBillingTelegramLinkTokenResponse(data);

    if (!isCurrentRequest()) {
      return null;
    }

    return result;
  }
