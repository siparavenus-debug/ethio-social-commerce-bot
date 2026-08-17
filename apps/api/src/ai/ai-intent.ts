import {
  commerceToolNames,
  type CommerceToolName
} from "../tools/tool-definitions.js";

export type AIIntent =
  | "SEARCH_PRODUCT"
  | "GET_PRODUCT"
  | "CHECK_STOCK"
  | "CREATE_ORDER"
  | "GET_ORDER_STATUS"
  | "GET_PAYMENT_INSTRUCTIONS"
  | "GENERAL";

export type AIToolCall = {
  tool: CommerceToolName;
  arguments: Record<string, unknown>;
};

export type AIResponse = {
  intent: AIIntent;
  message: string;
  toolCalls: AIToolCall[];
};

export function isAllowedAITool(
  tool: string
): tool is CommerceToolName {
  return commerceToolNames.includes(
    tool as CommerceToolName
  );
}

export function createAIResponse(
  intent: AIIntent,
  message: string,
  toolCalls: AIToolCall[] = []
): AIResponse {
  for (const toolCall of toolCalls) {
    if (!isAllowedAITool(toolCall.tool)) {
      throw new Error(
        `AI attempted to call an unauthorized commerce tool: ${toolCall.tool}`
      );
    }
  }

  return {
    intent,
    message,
    toolCalls
  };
}
