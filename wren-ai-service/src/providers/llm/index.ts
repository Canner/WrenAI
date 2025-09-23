import { getOpenAiClient } from './openai.js';
import { OllamaClient } from './ollama.js';

export type LlmKind = 'openai' | 'ollama';

/** LLM client for INSIGHTS ONLY */
export function getInsightsLlm() {
  const kind = (process.env.INSIGHTS_PROVIDER ?? 'openai').toLowerCase() as LlmKind;

  if (kind === 'ollama') {
    return new OllamaClient(
      process.env.INSIGHTS_OLLAMA_BASE ?? 'http://host.docker.internal:11434',
      process.env.INSIGHTS_OLLAMA_MODEL ?? 'llama3.1:8b'
    );
  }

  return getOpenAiClient({
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.INSIGHTS_MODEL || 'gpt-4o-mini'
  });
}
