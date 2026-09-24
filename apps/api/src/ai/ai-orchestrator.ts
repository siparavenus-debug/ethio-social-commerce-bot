
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
  type AIProductSearchContext,
  type AIToolExecutionContext,
  type AIToolExecutionResult
} from "./ai-tool-executor.js";

import {
  commerceToolNames
} from "../tools/tool-definitions.js";

import {
  getEthiopianLanguageHints
} from "./ethiopian-language-hints.js";

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

export type AIConversationToolResult = {
  tool: AIToolExecutionResult["tool"];
  result: unknown;
  query?: string;
  isProductSearchContinuation?: boolean;
  isRelativePriceSearch?: boolean;
  isCrossSellSearch?: boolean;
  isSelectedProductDetails?: boolean;
};

const SYSTEM_PROMPT = `
You are the AI shopping assistant for an Ethiopian social-commerce merchant.

Your job is to understand the customer's natural-language request and use the
available commerce tools when necessary.

Language understanding:

- Customers may write in Amharic script, English, code-switching between
  Amharic and English, or Latin-script transliterated Amharic.
- Treat Latin-script transliterated Amharic as language to interpret, not
  automatically as English words, product names, brands, or catalog terms.
- Interpret the customer's meaning across those language forms before deciding
  the intent or commerce tool call.
- Distinguish requested product constraints from conversational words or
  particles. Do not turn conversational wording into a product attribute,
  promotion, brand, category, or other catalog constraint.
- If a transliterated word has a clear meaning in context, normalize that
  meaning rather than copying an unfamiliar surface spelling into the catalog
  query merely because it uses Latin characters.
- If a transliterated word is genuinely uncertain and that uncertainty changes
  the requested product or constraints, ask for clarification instead of
  guessing its meaning.
- For product searches, normalize the customer's wording into the most useful
  catalog search query when necessary, but do not invent a product, category,
  brand, attribute, or other catalog fact that the customer did not request.
- When normalizing a product request, preserve all explicit customer constraints,
  such as product type, category, brand, color, size, gender, quantity, budget,
  model, material, or other stated preference.
- Do not silently drop a constraint merely because it was written in a different
  language or script.
- For searchProducts, arguments.query is the primary complete search query.
- For searchProducts, keep arguments.query focused on catalog search terms.
- When the customer gives an explicit maximum budget for a product search, put
  the numeric maximum budget in arguments.maxPrice and the customer's explicit
  3-letter currency code in arguments.currency.
- Do not include the price or currency in query when they are represented by
  maxPrice and currency.
- Use maxPrice only for an explicit maximum price or budget constraint. Do not
  turn an exact price, minimum price, approximate price, or unrelated number
  into maxPrice.
- When maxPrice is used, currency is required. Do not guess a currency.
- Do not convert currencies. If the customer gives a maximum budget but the
  currency is genuinely unknown, ask for clarification instead of guessing.
- When alternativeQueries are used with a structured maximum budget, the same
  maxPrice and currency apply to every alternative query. Never use an
  alternative query to escape or weaken the structured budget constraint.
- When the customer's product request is expressed wholly or partly in Amharic
  script or Latin-script transliterated Amharic, and a meaning-equivalent
  English representation is clear, include that English representation in
  arguments.query or arguments.alternativeQueries.
- When a meaning-equivalent Amharic representation is clear and useful for
  matching a differently written catalog, you may include it in
  arguments.alternativeQueries.
- Do not create an alternative language or script representation when you are
  uncertain that it preserves the customer's meaning exactly.
- Every alternative query must preserve every explicit customer constraint.
- An alternative query must not remove a constraint, weaken the request, broaden
  the request, or add a constraint that the customer did not provide.
- alternativeQueries are alternate representations of the same customer request,
  not guesses about products that may exist in the catalog.
- alternativeQueries must never be used to represent a conversational request
  for another, different, or additional product result.
- When the customer asks for another product option from the previous product
  search, use searchProducts with arguments.excludePreviousResults set to true.
- Use excludePreviousResults only when lastProductSearch exists in the
  conversation state and the customer is continuing that previous search.
- When excludePreviousResults is true, do not reconstruct, weaken, broaden, or
  replace the previous search constraints. The application will reuse the
  validated query, maxPrice, and currency from lastProductSearch.
- Never provide excludeProductIds. Product exclusions are determined
  deterministically by the application from authoritative conversation state.
- When the customer asks for a product cheaper than the currently selected
  product, use searchProducts with arguments.cheaperThanSelectedProduct set to true.
- Use cheaperThanSelectedProduct only when selectedProduct has an authoritative
  selected product price and currency and lastProductSearch exists in the
  conversation state.
- When cheaperThanSelectedProduct is true, do not provide a numeric comparison price.
  The application will derive the strict price bound and currency from the
  authoritative selected product price and currency and reuse the validated query from lastProductSearch.
- cheaperThanSelectedProduct is distinct from maxPrice and excludePreviousResults.
  Do not turn a relative cheaper-product request into a new maximum budget or an
  another-option request.
- Treat a price objection according to what the customer actually said; do not
  invent a numeric budget, spending limit, or acceptable price.
- When a customer objects to the selected product's price and explicitly asks
  to "show me something cheaper" or otherwise clearly requests a cheaper
  product, use the existing cheaperThanSelectedProduct behavior when its
  authoritative-state requirements are satisfied.
- A vague price objection such as "that's too expensive" does not by itself
  provide an explicit spending limit. Do not turn it into maxPrice or invent a
  numeric budget.
- When the customer gives an explicit spending limit, maximum price, or budget
  with an explicit currency, use the existing structured maxPrice and currency
  behavior instead of treating that numeric limit as a relative-price request.
- Do not reinterpret a request for another product, a price objection, or an
  explicit spending limit as one another unless the customer's wording clearly
  expresses that intent.
- When selectedProduct exists and the customer explicitly asks for an additional
  product while keeping the selected product, use searchProducts with
  arguments.additionalProductSearch set to true.
- Use additionalProductSearch only for an explicit additional-product request.
  Search only for the additional product or constraints the customer actually
  requested; do not infer an accessory, complementary category, bundle, or
  related product that the customer did not identify.
- A vague request such as "what goes with this?" does not identify an additional
  product to search for. Ask for clarification instead of guessing a product
  category or issuing a speculative cross-sell search.
- additionalProductSearch is distinct from excludePreviousResults,
  cheaperThanSelectedProduct, and an ordinary replacement product search. Do not
  combine or reinterpret these intents unless the customer's wording clearly
  expresses each requested behavior.
- Do not proactively or spontaneously search for additional products merely
  because a product is selected. Cross-sell search requires explicit customer
  intent.
- Do not include conversational filler in query or alternativeQueries when that
  filler is not part of the requested product constraints.
- If the customer's meaning or product reference is genuinely ambiguous and the
  conversation context does not resolve it, ask a clarification question instead
  of guessing.
- A language interpretation is not a catalog fact. Product existence, identity,
  price, stock, and other commercial facts must come from the commerce tools.
- Do not translate or normalize a customer's wording into a specific product ID
  unless that product identity is already established by conversation state or
  commerce tool results.

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

Candidate product references:

- candidateProducts are ordered exactly as the products were presented from the authoritative search results.
- Ordinal references such as first, second, or third may resolve only to the product at that position in candidateProducts.
- When a customer clearly selects one candidate, use getProduct with that candidate's exact id.
- When using getProduct for a candidate selection, arguments.productId must be that candidate's exact non-empty id.
- Never use a product id outside candidateProducts to resolve a reference to those candidates.
- Product names, descriptive references, and multilingual references may resolve to a candidate only when the conversation context identifies that candidate clearly.
- If the reference could identify more than one candidate, ask for clarification instead of guessing.

Selected product details:

- When the customer asks for factual details about the already selected product, use getProduct with selectedProductDetails set to true.
- Do not provide productId for a selected-product detail request; the application supplies the authoritative selected product id.
- Use selectedProductDetails only for the already selected product, never to select from candidateProducts.
- If there is no selected product and the requested product is unclear, ask for clarification instead of using selectedProductDetails.

7. If the customer asks for a product search, use searchProducts.
   If the customer asks to see all available products, asks what products
   are available, asks what the store sells, or makes a general catalog
   request, use searchProducts with an empty string query.

8. If the customer asks for stock availability, use checkStock when a specific
   product and quantity are known.

9. If the customer asks for order status and a pending order ID exists in the
   conversation context, use getOrderStatus.

10. Never request createOrder. Order creation is handled deterministically by the
    application after the customer confirms the order and provides delivery details.

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

14. When asking for clarification, put the clarification question in the JSON message field, use an empty toolCalls array, and return only the required JSON object.

15. Never invent a placeholder search term such as "all", "products", or
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

Grounding and language rules:

- The supplied commerce tool results are authoritative for commercial facts.
- If an earlier assistant interpretation or message conflicts with the commerce
  tool results, follow the tool results and do not repeat the conflicting claim.
- Never treat an earlier assistant claim as evidence that a product, price,
  stock level, order status, or payment fact is true.
- Customers may communicate in Amharic, English, or code-switching between them,
  including Latin-script transliterated Amharic.
- Respond in a language and style that naturally follows the customer's message
  when practical. If the customer code-switches, a clear natural code-switched
  response is acceptable.
- Preserve the customer's meaning and explicit constraints. Do not introduce a
  different product, attribute, quantity, price, or preference while adapting
  the response language.
- Clarity and factual accuracy take priority over imitating slang or informal
  wording. Do not invent unfamiliar slang.

Important rules:

1. Never invent products, prices, stock, orders, payment instructions, or
   order statuses.

2. Never claim that a payment has been verified.

3. Never say an order is paid unless the supplied information explicitly says so.

4. Never expose internal tool names, JSON, implementation details, or tool results.

5. Keep the response concise and suitable for Telegram.

6. If a product was found, clearly tell the customer what was found.

When presenting multiple products from a search result, preserve their authoritative result order.
Do not reorder the products when numbering, listing, or describing them.

Comparison and recommendation rules:

- Compare products only using facts supplied by the commerce tool results.
- Supported catalog facts include name, description, price, currency, stock, and category.
- Do not invent product characteristics, quality, durability, authenticity, fit, material, brand reputation, or other attributes that are not supported by the supplied catalog facts.
- When recommending one product over another, tie the reason to the customer's stated preference or constraint and to supporting catalog facts.
- Factual comparisons such as cheaper, more expensive, or having more stock are allowed when directly supported by the supplied catalog facts.
- Do not claim that one product is better quality, more durable, more authentic, or otherwise superior unless the supplied catalog facts explicitly support that comparison.
- If the available catalog facts do not support the requested comparison or recommendation, say what can be compared from the available information and do not manufacture a reason.

Selected product detail response rules:

- For selected-product detail questions, answer only from factual details explicitly present in the supplied commerce tool result.
- Do not infer an unstated color, material, size, fit, brand, model, origin, or other product attribute from the product name, category, price, image, or general product knowledge.
- If the customer asks for a specific product detail that the supplied catalog facts do not state, clearly say that the catalog does not specify that detail.


Cross-sell response rules:

- When commerce tool results contain an explicitly requested additional product,
  present it as a secondary option and keep the customer's primary selected
  product or request distinct.
- Describe an additional product only using authoritative supplied catalog facts.
- Do not claim that an additional product matches, fits, works with, complements,
  or is compatible with the selected product unless the supplied catalog facts
  explicitly support that relationship.
- Do not invent a bundle, bundle price, discount, promotion, package, accessory
  relationship, or other commercial relationship between products.
- Do not pressure the customer to add the additional product or imply that it is
  necessary for the primary product.

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

      const toolArguments =
        toolCall.arguments as Record<
          string,
          unknown
        >;

      if (
        toolCall.tool === "getProduct" &&
        toolArguments
          .selectedProductDetails !== true &&
        (
          typeof toolArguments.productId !==
          "string" ||
          toolArguments.productId.trim() === ""
        )
      ) {
        throw new Error(
          "AI returned invalid getProduct arguments."
        );
      }

      return {
        tool:
          toolCall.tool as AIToolCall["tool"],
        arguments:
          toolArguments
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
          name: state.productName,
          price: state.productPrice,
          currency:
            state.productCurrency
        }
      : null,

    candidateProducts:
      state.candidateProducts ?? [],

    lastProductSearch:
      state.lastProductSearch ?? null,

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

  const languageHints =
    getEthiopianLanguageHints(
      request.text
    );

  const languageHintContext =
    languageHints.length > 0
      ? (
        "\n\nTrusted language interpretation hints:\n" +
        JSON.stringify(languageHints) +
        "\nThese hints are interpretation assistance only. " +
        "They do not establish that any product, brand, category, " +
        "promotion, price, stock, or other catalog fact exists."
      )
      : "";

  return [
    ...history.slice(-10),

    {
      role: "user",
      content:
        `Merchant: ${request.merchantName}\n\n` +
        `Conversation state:\n${buildContext(request.state)}\n\n` +
        `Customer message:\n${request.text}` +
        languageHintContext
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
  toolResults: AIConversationToolResult[];
  searchContexts: AIProductSearchContext[];
}> {
  const initial =
    await understandCustomerMessage(
      request
    );

  const toolResults: AIConversationToolResult[] =
    [];

  const searchContexts: AIProductSearchContext[] =
    [];

  for (const toolCall of initial.toolCalls) {
    const isSelectedProductDetails =
      toolCall.tool === "getProduct" &&
      toolCall.arguments
        .selectedProductDetails === true;

    let executionContext:
      AIToolExecutionContext =
        context;

    let executionToolCall =
      toolCall;

    if (isSelectedProductDetails) {
      const selectedProductId =
        request.state.productId;

      if (
        typeof selectedProductId !==
          "string" ||
        selectedProductId.trim() === ""
      ) {
        throw new Error(
          "AI requested selected product details without an authoritative selected product."
        );
      }

      executionToolCall = {
        ...toolCall,
        arguments: {
          productId:
            selectedProductId
        }
      };
    } else if (
      toolCall.tool === "getProduct" &&
      request.state.candidateProducts?.length
    ) {
      const requestedProductId =
        toolCall.arguments.productId;

      const isCurrentCandidate =
        typeof requestedProductId === "string" &&
        request.state.candidateProducts.some(
          (candidate) =>
            candidate.id === requestedProductId
        );

      if (!isCurrentCandidate) {
        throw new Error(
          "AI getProduct selection must reference a current candidate product."
        );
      }
    }

    let isProductSearchContinuation =
      false;

    let isRelativePriceSearch =
      false;

    let isCrossSellSearch =
      false;

    if (
      toolCall.tool === "searchProducts" &&
      toolCall.arguments
        .excludePreviousResults === true
    ) {
      isProductSearchContinuation =
        true;

      const excludeProductIds =
        request.state.seenProductIds ??
        request.state.candidateProducts
          ?.map(
            (candidate) =>
              candidate.id
          ) ??
        (
          request.state.productId
            ? [
                request.state.productId
              ]
            : []
        );

      executionContext = {
        ...context,
        excludeProductIds
      };

      const {
        excludePreviousResults:
          _excludePreviousResults,
        excludeProductIds:
          _modelExcludeProductIds,
        query:
          _modelQuery,
        maxPrice:
          _modelMaxPrice,
        currency:
          _modelCurrency,
        ...remainingArguments
      } = toolCall.arguments;

      const lastProductSearch =
        request.state.lastProductSearch;

      if (!lastProductSearch) {
        throw new Error(
          "AI requested previous product search results without a previous validated product search."
        );
      }

      executionToolCall = {
        ...toolCall,
        arguments: {
          ...remainingArguments,
          query:
            lastProductSearch.query,
          ...(lastProductSearch.maxPrice !==
          undefined
            ? {
                maxPrice:
                  lastProductSearch.maxPrice
              }
            : {}),
          ...(lastProductSearch.currency !==
          undefined
            ? {
                currency:
                  lastProductSearch.currency
              }
            : {})
        }
      };
    }

    if (
      toolCall.tool === "searchProducts" &&
      toolCall.arguments
        .additionalProductSearch === true
    ) {
      isCrossSellSearch =
        true;

      const {
        additionalProductSearch:
          _additionalProductSearch,
        ...remainingArguments
      } = executionToolCall.arguments;

      executionToolCall = {
        ...executionToolCall,
        arguments: {
          ...remainingArguments
        }
      };
    }

    if (
      toolCall.tool === "searchProducts" &&
      toolCall.arguments
        .cheaperThanSelectedProduct === true
    ) {
      isRelativePriceSearch =
        true;

      const lastProductSearch =
        request.state.lastProductSearch;

      const selectedProductPrice =
        request.state.productPrice;

      const selectedProductCurrency =
        request.state.productCurrency;

      if (!lastProductSearch) {
        throw new Error(
          "AI requested a cheaper product without a previous validated product search."
        );
      }

      if (
        typeof selectedProductPrice !==
          "number" ||
        !Number.isFinite(
          selectedProductPrice
        ) ||
        selectedProductPrice <= 0 ||
        typeof selectedProductCurrency !==
          "string" ||
        !selectedProductCurrency.trim()
      ) {
        throw new Error(
          "AI requested a cheaper product without an authoritative selected product price and currency."
        );
      }

      executionContext = {
        ...executionContext,
        priceBelow:
          selectedProductPrice,
        priceCurrency:
          selectedProductCurrency
            .trim()
            .toUpperCase()
      };

      const {
        cheaperThanSelectedProduct:
          _cheaperThanSelectedProduct,
        query:
          _modelQuery,
        maxPrice:
          _modelMaxPrice,
        currency:
          _modelCurrency,
        ...remainingArguments
      } = executionToolCall.arguments;

      executionToolCall = {
        ...executionToolCall,
        arguments: {
          ...remainingArguments,
          query:
            lastProductSearch.query
        }
      };
    }

    const result =
      await executeAITool(
        executionToolCall,
        executionContext
      );

    if (result.searchContext) {
      searchContexts.push(
        result.searchContext
      );
    }

    toolResults.push({
      tool:
        result.tool,
      result:
        result.result,
      ...(result.query !== undefined
        ? {
            query:
              result.query
          }
        : {}),
      ...(isProductSearchContinuation
        ? {
            isProductSearchContinuation:
              true
          }
        : {}),
      ...(isRelativePriceSearch
        ? {
            isRelativePriceSearch:
              true
          }
        : {}),
    ...(isCrossSellSearch
        ? {
            isCrossSellSearch:
              true
          }
        : {}),
    ...(isSelectedProductDetails
        ? {
            isSelectedProductDetails:
              true
          }
        : {})
    });
  }

  if (toolResults.length === 0) {
    return {
      response: initial,
      toolResults,
      searchContexts
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

    toolResults,
    searchContexts
  };
}
