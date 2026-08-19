import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

export type AIMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AIProviderRequest = {
  system: string;
  messages: AIMessage[];
  maxTokens?: number;
};

export type AIProviderResponse = {
  text: string;
};

// Claude 3.5 Haiku was retired.
// Current recommended fast/cost-effective model:
// Claude Haiku 4.5
const DEFAULT_MODEL = "claude-haiku-4-5";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!env.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured."
    );
  }

  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: env.anthropicApiKey
    });
  }

  return anthropicClient;
}

export async function generateAIResponse(
  request: AIProviderRequest
): Promise<AIProviderResponse> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: request.maxTokens ?? 800,
    system: request.system,
    messages: request.messages
  });

  const text = response.content
    .filter(
      (block): block is Anthropic.TextBlock =>
        block.type === "text"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error(
      "AI provider returned an empty response."
    );
  }

  return {
    text
  };
}