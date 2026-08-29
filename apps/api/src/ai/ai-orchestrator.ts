
import {
  generateAIResponse,
  type AIMessage
} from "./ai-provider.js";

import {
  createAIResponse,
  type AIResponse,
  type AIIntent,
  type AIToolCall
} from "./ai-intent.js";

import {
  executeAITool,
  type AIToolExecutionContext,
  type AIToolExecutionResult
} from "./ai-tool-executor.js";

import {
  commerceToolNames
} from "../tools/tool-definitions.js";

import type {
  ShoppingState
} from "../conversation/conversation-state.js";

export type AIConversationRequest = {
  text: string;
  state: ShoppingState;
  merchantName: string;
  history?: AIMessage[];
};

export type AIConversationContext =
  AIToolExecutionContext;

const SYSTEM_PROMPT = `
You are the AI shopping assistant for an Ethiopian social-commerce merchant.

Your job is to understand the customer's natural-language request and use the
available commerce tools when necessary.

Available tools:
${commerceToolNames.map((name) => `- ${name}`).join("\n")}

Important rules:

1. Never invent products, prices, stock, orders, payment instructions, or order
   statuses. Use the commerce tools when factual data is needed.

2. Never claim that a payment has been verified.

3. Never mark an order as paid.

4. Payment verification is performed by the merchant separately.

5. Use conversation context when the customer says things like:
   "that one", "those", "two of those", "make it three", "actually four".

6. If a product is already selected in the conversation state, use that product
   when the customer refers to it indirectly.

7. If the customer asks for a product search, use searchProducts.
   If the customer asks to see all available products, asks what products
   are available, asks what the store sells, or makes a general catalog
   request, use searchProducts with an empty string query.

8. If the customer asks for stock availability, use checkStock when a specific
   product and quantity are known.

9. If the customer asks for order status and a pending order ID exists in the
   conversation context, use getOrderStatus.

10. createOrder should only be requested when the customer has clearly confirmed
    that they want to place the order.

11. Return ONLY valid JSON using this structure:

{
  "intent": "SEARCH_PRODUCT | GET_PRODUCT | CHECK_STOCK | CREATE_ORDER | GET_ORDER_STATUS | GET_PAYMENT_INSTRUCTIONS | GENERAL",
  "message": "short response",
  "toolCalls": [
    {
      "tool": "allowedToolName",
      "arguments": {}
    }
  ]
}

12. Do not use Markdown code fences around the JSON.

13. Do not include explanations before or after the JSON.

14. Never invent a placeholder search term such as "all", "products", or
    "available" for a broad catalog request. Use an empty query ("") instead.

If no tool is needed, return an empty toolCalls array.
`;

const FINAL_RESPONSE_PROMPT = `
You are the customer-facing AI shopping assistant for an Ethiopian
social-commerce merchant.

The commerce tools have already been executed.

Respond naturally and helpfully to the customer using ONLY:
- the conversation context
- the customer message
- the supplied commerce tool results

Important rules:

1. Never invent products, prices, stock, orders, payment instructions, or
   order statuses.

2. Never claim that a payment has been verified.

3. Never say an order is paid unless the supplied information explicitly says so.

4. Never expose internal tool names, JSON, implementation details, or tool results.

5. Keep the response concise and suitable for Telegram.

6. If a product was found, clearly tell the customer what was found.

7. If stock information was returned, use that information accurately.

8. If an order was created, clearly provide the order number and relevant
   order information.

9. If the customer needs to provide the next piece of information, clearly
   tell them what to send.

Return ONLY the customer-facing response text.
`;

function isAIIntent(
  value: unknown
): value is AIIntent {
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

/**
 * Claude normally returns plain JSON because the system prompt requests it.
 *
 * This parser is intentionally tolerant of accidental Markdown fences or
 * surrounding whitespace so a harmless formatting variation does not break
 * the Telegram conversation.
 */
function extractJSON(text: string): string {
  const trimmed = text.trim();

  // Best case: Claude returned pure JSON.
  if (
    trimmed.startsWith("{") &&
    trimmed.endsWith("}")
  ) {
    return trimmed;
  }

  // Handle ```json ... ``` or ``` ... ```
  const fencedMatch = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i
  );

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  // Handle accidental text before/after the JSON object.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (
    firstBrace >= 0 &&
    lastBrace > firstBrace
  ) {
    return trimmed.slice(
      firstBrace,
      lastBrace + 1
    );
  }

  return trimmed;
}

function parseAIResponse(
  text: string
): AIResponse {
  const jsonText = extractJSON(text);

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      `AI provider returned invalid JSON. Raw response: ${text}`
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null
  ) {
    throw new Error(
      "AI provider returned an invalid response."
    );
  }

  const value =
    parsed as Record<string, unknown>;

  if (!isAIIntent(value.intent)) {
    throw new Error(
      "AI provider returned an invalid intent."
    );
  }

  if (typeof value.message !== "string") {
    throw new Error(
      "AI provider returned an invalid message."
    );
  }

  if (!Array.isArray(value.toolCalls)) {
    throw new Error(
      "AI provider returned invalid tool calls."
    );
  }

  const toolCalls: AIToolCall[] =
    value.toolCalls.map((call) => {
      if (
        typeof call !== "object" ||
        call === null
      ) {
        throw new Error(
          "AI returned an invalid tool call."
        );
      }

      const toolCall =
        call as Record<string, unknown>;

      if (
        typeof toolCall.tool !== "string" ||
        !commerceToolNames.includes(
          toolCall.tool as typeof commerceToolNames[number]
        )
      ) {
        throw new Error(
          "AI returned an unauthorized commerce tool."
        );
      }

      if (
        typeof toolCall.arguments !== "object" ||
        toolCall.arguments === null ||
        Array.isArray(toolCall.arguments)
      ) {
        throw new Error(
          "AI returned invalid tool arguments."
        );
      }

      return {
        tool:
          toolCall.tool as AIToolCall["tool"],
        arguments:
          toolCall.arguments as Record<
            string,
            unknown
          >
      };
    });

  return createAIResponse(
    value.intent,
    value.message,
    toolCalls
  );
}

function buildContext(
  state: ShoppingState
): string {
  return JSON.stringify({
    selectedProduct: state.productId
      ? {
          id: state.productId,
          name: state.productName
        }
      : null,

    quantity:
      state.quantity ?? null,

    awaitingQuantity:
      state.awaitingQuantity ?? false,

    awaitingConfirmation:
      state.awaitingConfirmation ?? false,

    awaitingPayment:
      state.awaitingPayment ?? false,

    pendingOrderId:
      state.pendingOrderId ?? null,

    lastUserMessage:
      state.lastUserMessage ?? null,

    lastIntent:
      state.lastIntent ?? null
  });
}

function buildMessages(
  request: AIConversationRequest
): AIMessage[] {
  const history =
    request.history ?? [];

  return [
    ...history.slice(-10),

    {
      role: "user",
      content:
        `Merchant: ${request.merchantName}\n\n` +
        `Conversation state:\n${buildContext(request.state)}\n\n` +
        `Customer message:\n${request.text}`
    }
  ];
}

export async function understandCustomerMessage(
  request: AIConversationRequest
): Promise<AIResponse> {
  const response =
    await generateAIResponse({
      system: SYSTEM_PROMPT,
      messages:
        buildMessages(request),
      maxTokens: 800
    });

  return parseAIResponse(
    response.text
  );
}

export async function runAIConversation(
  request: AIConversationRequest,
  context: AIConversationContext
): Promise<{
  response: AIResponse;
  toolResults: AIToolExecutionResult[];
}> {
  const initial =
    await understandCustomerMessage(
      request
    );

  const toolResults: AIToolExecutionResult[] =
    [];

  for (const toolCall of initial.toolCalls) {
    const result =
      await executeAITool(
        toolCall,
        context
      );

    toolResults.push(result);
  }

  if (toolResults.length === 0) {
    return {
      response: initial,
      toolResults
    };
  }

  const finalResponse =
    await generateAIResponse({
      system:
        FINAL_RESPONSE_PROMPT,

      messages: [
        ...buildMessages(request),

        {
          role: "assistant",
          content:
            JSON.stringify(initial)
        },

        {
          role: "user",
          content:
            `Commerce tool results:\n${JSON.stringify(toolResults)}`
        }
      ],

      maxTokens: 500
    });

  return {
    response: createAIResponse(
      initial.intent,
      finalResponse.text.trim(),
      []
    ),

    toolResults
  };
}