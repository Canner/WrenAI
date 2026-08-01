import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const OPENAI_COMPATIBLE_ADAPTER_ID = "openai-compatible";

// Covers any `/v1` OpenAI-compatible endpoint (vLLM, Ollama's compat API, ...)
// without depending on a community package for either.
export interface OpenAICompatibleAdapterConfig {
  readonly baseURL: string;
  readonly model: string;
  readonly apiKey?: string;
  /** Provider name reported in telemetry/errors. Defaults to the adapter id. */
  readonly name?: string;
}

export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleAdapterConfig,
): LanguageModel {
  const provider = createOpenAICompatible({
    name: config.name ?? OPENAI_COMPATIBLE_ADAPTER_ID,
    baseURL: config.baseURL,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
  });
  return provider.languageModel(config.model);
}
