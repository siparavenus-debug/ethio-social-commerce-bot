import {
  createAIResponse,
  type AIResponse
} from "./ai-intent.js";

import {
  generateAIResponse,
  type AIMessage
} from "./ai-provider.js";

export type AIConversationContext = {
  merchantName: string;
  currentProductName?: string;
  currentProductId?: string;
  currentQuantity?: number;
};

const SYSTEM_PROMPT = `
You are the AI shopping assistant for an Ethiopian social-commerce store.

Your job is to understand the customer's natural-language request and return
ONLY valid JSON.

You may identify these intents:

SEARCH_PRODUCT
GET_PRODUCT
CHECK_STOCK
CREATE_ORDER
GET_ORDER_STATUS
GET_PAYMENT_INSTRUCTIONS
GENERAL

Available commerce tools:

searchProducts
getProduct
checkStock
createOrder
getOrderStatus
getPaymentInstructions

Rules:

1. Never invent product IDs.
2. Never invent order IDs.
3. Never claim an order was created unless the application actually creates it.
4. Never claim a payment was verified.
5. Never directly perform database operations.
6. Only request tools that exist in the allowed tool list.
7. For product discovery such as "show me dresses" or "do you have shoes",
   use searchProducts.
8. If the customer refers to "that", "those", or "it", use the supplied
   conversation context when available.
9. If the customer changes a quantity, understand the new quantity but do not
   create an order automatically.
10. For order-status questions, use getOrderStatus when the application has
    enough context to identify the order.
11. If a request cannot safely be mapped to a commerce operation, use GENERAL.
12. Keep the customer-facing message short and natural.

The response MUST have exactly this structure:

{
  "intent": "SEARCH_PRODUCT",
  "message": "short customer-facing response",
  "toolCalls": [
    {
      "tool": "searchProducts",
      "arguments": {
        "query": "dresses"
      }
    }
  ]
}

If no tool is needed:

{
  "intent": "GENERAL",
  "message": "customer-facing response",
  "toolCalls": []
}

Do not use markdown.
Do not include explanations outside the JSON.
`;

function extractJSON(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error(
        "AI returned an invalid JSON response."
      );
    }

    return JSON.parse(
      trimmed.slice(start, end + 1)
    );
  }
}

function isAIIntent(
  value: unknown
): value is AIResponse["intent"] {
  return (
    value === "SEARCH_PRODUCT" ||
    value === "GET_PRODUCT" ||
    value === "CHECK_STOCK" ||
    value === "CREATE_ORDER" ||
    value === "GET_ORDER_STATUS" ||
    value === "GET_PAYMENT_INSTRUCTIONS" ||
    value === "GENERAL"
  );
}

export async function understandCustomerMessage(
  text: string,
  context: AIConversationContext
): Promise<AIResponse> {
  const contextLines = [
    `Merchant: ${context.merchantName}`,
    `Current product: ${context.currentProductName ?? "none"}`,
    `Current product ID: ${context.currentProductId ?? "none"}`,
    `Current quantity: ${context.currentQuantity ?? "none"}`
  ];

  const messages: AIMessage[] = [
    {
      role: "user",
      content:
        `Conversation context:\n${contextLines.join("\n")}\n\n` +
        `Customer message:\n${text}`
    }
  ];

  const response =
    await generateAIResponse({
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: 500
    });

  const parsed =
    extractJSON(response.text);

  if (
    typeof parsed !== "object" ||
    parsed === null
  ) {
    throw new Error(
      "AI returned an invalid response structure."
    );
  }

  const value =
    parsed as Record<string, unknown>;

  if (!isAIIntent(value.intent)) {
    throw new Error(
      "AI returned an invalid intent."
    );
  }

  if (typeof value.message !== "string") {
    throw new Error(
      "AI returned an invalid message."
    );
  }

  if (!Array.isArray(value.toolCalls)) {
    throw new Error(
      "AI returned invalid tool calls."
    );
  }

  const toolCalls =
    value.toolCalls.map((toolCall) => {
      if (
        typeof toolCall !== "object" ||
        toolCall === null
      ) {
        throw new Error(
          "AI returned an invalid tool call."
        );
      }

      const call =
        toolCall as Record<string, unknown>;

      if (typeof call.tool !== "string") {
        throw new Error(
          "AI returned a tool call without a tool name."
        );
      }

      if (
        typeof call.arguments !== "object" ||
        call.arguments === null ||
        Array.isArray(call.arguments)
      ) {
        throw new Error(
          "AI returned invalid tool arguments."
        );
      }

      return {
        tool: call.tool as any,
        arguments:
          call.arguments as Record<string, unknown>
      };
    });

  return createAIResponse(
    value.intent,
    value.message,
    toolCalls
  );
}
