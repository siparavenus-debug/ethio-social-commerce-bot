import type {
  AIToolCall
} from "./ai-intent.js";

import {
  searchProducts,
  getProduct,
  checkStock
} from "../tools/products.js";

import {
  getOrderStatus
} from "../tools/orders.js";

import {
  getPaymentInstructions
} from "../tools/payments.js";

const MAX_AI_SEARCH_QUERY_LENGTH = 500;

export type AIToolExecutionContext = {
  merchantId: string;
  customerId: string;
  excludeProductIds?: string[];
  priceBelow?: number;
  priceCurrency?: string;
};

export type AIProductSearchContext = {
  query: string;
  maxPrice?: number;
  currency?: string;
};

export type AIToolExecutionResult = {
  tool: AIToolCall["tool"];
  result: unknown;
  query?: string;
  searchContext?: AIProductSearchContext;
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
      if (
        query.length >
        MAX_AI_SEARCH_QUERY_LENGTH
      ) {
        throw new Error(
          `AI tool argument "query" must be at most ${MAX_AI_SEARCH_QUERY_LENGTH} characters.`
        );
      }

      const rawMaxPrice =
        args.maxPrice;

      if (
        rawMaxPrice !== undefined &&
        (
          typeof rawMaxPrice !== "number" ||
          !Number.isFinite(rawMaxPrice) ||
          rawMaxPrice <= 0
        )
      ) {
        throw new Error(
          'AI tool argument "maxPrice" must be a positive finite number.'
        );
      }

      const rawCurrency =
        args.currency;

      if (
        rawMaxPrice !== undefined &&
        rawCurrency === undefined
      ) {
        throw new Error(
          'AI tool argument "currency" is required when "maxPrice" is provided.'
        );
      }

      if (
        rawCurrency !== undefined &&
        (
          typeof rawCurrency !== "string" ||
          !/^[A-Za-z]{3}$/.test(
            rawCurrency.trim()
          )
        )
      ) {
        throw new Error(
          'AI tool argument "currency" must be a 3-letter currency code.'
        );
      }

      const maxPrice =
        rawMaxPrice as number | undefined;

      const currency =
        context.priceCurrency ??
        (
          typeof rawCurrency === "string"
            ? rawCurrency.trim().toUpperCase()
            : undefined
        );

      const rawAlternativeQueries =
        args.alternativeQueries;

      if (
        rawAlternativeQueries !== undefined &&
        (
          !Array.isArray(
            rawAlternativeQueries
          ) ||
          rawAlternativeQueries.some(
            (alternativeQuery) =>
              typeof alternativeQuery !==
              "string" ||
              !alternativeQuery.trim()
          )
        )
      ) {
        throw new Error(
          'AI tool argument "alternativeQueries" must be an array of non-empty strings.'
        );
      }

      if (
        Array.isArray(
          rawAlternativeQueries
        ) &&
        rawAlternativeQueries.length > 3
      ) {
        throw new Error(
          'AI tool argument "alternativeQueries" must contain at most 3 queries.'
        );
      }

      if (
        Array.isArray(
          rawAlternativeQueries
        ) &&
        rawAlternativeQueries.some(
          (alternativeQuery) =>
            typeof alternativeQuery ===
              "string" &&
            alternativeQuery.trim().length >
              MAX_AI_SEARCH_QUERY_LENGTH
        )
      ) {
        throw new Error(
          `AI tool argument "alternativeQueries" entries must be at most ${MAX_AI_SEARCH_QUERY_LENGTH} characters.`
        );
      }

      const alternativeQueries =
        (
          rawAlternativeQueries as
          string[] | undefined
        )?.map(
          (alternativeQuery) =>
            alternativeQuery.trim()
        ) ?? [];

      const queries = [
        query,
        ...alternativeQueries
      ].filter(
        (candidateQuery, index, allQueries) =>
          allQueries.indexOf(
            candidateQuery
          ) === index
      );

      const searchResults =
        await Promise.all(
          queries.map(
            (candidateQuery) =>
              searchProducts(
                context.merchantId,
                candidateQuery,
                {
                  maxPrice,
                  priceBelow:
                    context.priceBelow,
                  currency,
                  excludeProductIds:
                    context.excludeProductIds
                }
              )
          )
        );

      const productsById =
        new Map<
          string,
          (
            typeof searchResults
          )[number][number]
        >();

      for (
        const results
        of searchResults
      ) {
        for (
          const product
          of results
        ) {
          if (
            !productsById.has(
              product.id
            )
          ) {
            productsById.set(
              product.id,
              product
            );
          }
        }
      }

      return {
        tool: toolCall.tool,
        result: [
          ...productsById.values()
        ],
        query,
        searchContext: {
          query,
          ...(maxPrice !== undefined
            ? {
                maxPrice
              }
            : {}),
          ...(currency !== undefined
            ? {
                currency
              }
            : {})
        }
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
