import type {
  AIToolCall
} from "./ai-intent.js";

import {
  searchProducts,
  getProduct,
  checkStock
} from "../tools/products.js";

import {
  createOrder,
  getOrderStatus
} from "../tools/orders.js";

import {
  getPaymentInstructions
} from "../tools/payments.js";

export type AIToolExecutionContext = {
  merchantId: string;
  customerId: string;
};

export type AIToolExecutionResult = {
  tool: AIToolCall["tool"];
  result: unknown;
};

function requireString(
  value: unknown,
  field: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `AI tool argument "${field}" must be a non-empty string.`
    );
  }

  return value.trim();
}

function requirePositiveInteger(
  value: unknown,
  field: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `AI tool argument "${field}" must be a positive integer.`
    );
  }

  return value;
}

export async function executeAITool(
  toolCall: AIToolCall,
  context: AIToolExecutionContext
): Promise<AIToolExecutionResult> {
  const args = toolCall.arguments;

  switch (toolCall.tool) {
    case "searchProducts": {
      const query =
        typeof args.query === "string"
          ? args.query.trim()
          : (() => {
              throw new Error(
                'AI tool argument "query" must be a string.'
              );
            })();

      const result =
        await searchProducts(
          context.merchantId,
          query
        );

      return {
        tool: toolCall.tool,
        result
      };
    }

    case "getProduct": {
      const productId =
        requireString(
          args.productId,
          "productId"
        );

      const result =
        await getProduct(
          context.merchantId,
          productId
        );

      return {
        tool: toolCall.tool,
        result
      };
    }

    case "checkStock": {
      const productId =
        requireString(
          args.productId,
          "productId"
        );

      const quantity =
        requirePositiveInteger(
          args.quantity,
          "quantity"
        );

      const result =
        await checkStock(
          context.merchantId,
          productId,
          quantity
        );

      return {
        tool: toolCall.tool,
        result
      };
    }

    case "createOrder": {
      const productId =
        requireString(
          args.productId,
          "productId"
        );

      const quantity =
        requirePositiveInteger(
          args.quantity,
          "quantity"
        );

      const result =
        await createOrder(
          context.merchantId,
          context.customerId,
          productId,
          quantity
        );

      return {
        tool: toolCall.tool,
        result
      };
    }

    case "getOrderStatus": {
      const orderId =
        requireString(
          args.orderId,
          "orderId"
        );

      const result =
        await getOrderStatus(
          context.merchantId,
          context.customerId,
          orderId
        );

      return {
        tool: toolCall.tool,
        result
      };
    }

    case "getPaymentInstructions": {
      const result =
        await getPaymentInstructions(
          context.merchantId
        );

      return {
        tool: toolCall.tool,
        result
      };
    }

    default: {
      const exhaustiveCheck:
        never = toolCall.tool;

      throw new Error(
        `Unsupported AI commerce tool: ${exhaustiveCheck}`
      );
    }
  }
}
