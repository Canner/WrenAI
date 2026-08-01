import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const ANTHROPIC_ADAPTER_ID = "anthropic";

export interface AnthropicAdapterConfig {
  readonly model: string;
  readonly apiKey?: string;
}

export function createAnthropicAdapter(config: AnthropicAdapterConfig): LanguageModel {
  const provider = createAnthropic(
    config.apiKey !== undefined ? { apiKey: config.apiKey } : {},
  );
  return provider.languageModel(config.model);
}
