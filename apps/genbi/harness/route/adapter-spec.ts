import type { AuthChoice } from "../auth/index.js";
import type { AdapterSpec } from "../providers/index.js";
import { OPENAI_COMPATIBLE_ADAPTER_ID } from "../providers/index.js";

/** Default local endpoint used when a `LocalAuthChoice` omits `endpoint` (Ollama's default OpenAI-compatible port). */
export const DEFAULT_LOCAL_ENDPOINT = "http://localhost:11434/v1";

/**
 * Default local model used when neither `LocalAuthChoice` (which has no
 * `model` field of its own — see the API-surface mismatch note in this
 * ticket's report) nor `ModeAOptions.model` supplies one.
 */
export const DEFAULT_LOCAL_MODEL = "llama3.1";

export interface DeriveAdapterSpecOptions {
  /** Only consulted for `authChoice.mode === "local"`. See `DEFAULT_LOCAL_MODEL`. */
  readonly model?: string;
}

/**
 * Derives a concrete `AdapterSpec` (adapter id + config) for Mode A's three
 * `AuthChoice` variants:
 *
 * - `api-key` — passed straight through: `authChoice.adapter`/`config` already
 *   name a `ProviderRegistry` adapter id and its config (70a's `toAuthChoice`
 *   only emits a placeholder `adapter: ""`; a real choice is expected to name
 *   a registered adapter such as `"anthropic"`).
 * - `local` — mapped onto the built-in `openai-compatible` adapter, since
 *   "a model served on the local machine/network" (70a's doc comment) is
 *   exactly what that adapter targets. `endpoint` becomes `baseURL`; `model`
 *   comes from `options.model` (falling back to `DEFAULT_LOCAL_MODEL`) since
 *   `LocalAuthChoice` itself carries no model field.
 * - `gateway` — also mapped onto `openai-compatible` (an operator-managed
 *   gateway is, from this adapter's point of view, just another OpenAI-compatible
 *   endpoint); `authChoice.config` must already carry `baseURL`/`model`
 *   (and optionally `apiKey`) matching `OpenAICompatibleAdapterConfig` — 70a
 *   leaves this config shape unspecified, so this is this ticket's own
 *   assumption, not a contract 70a promises. Unlike `local` (which defaults
 *   endpoint/model), `gateway` has no sensible default, so a missing/empty
 *   `baseURL`/`model` is a loud `wren-harness`-level error here rather than a
 *   bare "Invalid URL" deep inside the adapter.
 */
export function deriveAdapterSpec(
  authChoice: Extract<AuthChoice, { mode: "api-key" | "local" | "gateway" }>,
  options: DeriveAdapterSpecOptions = {},
): AdapterSpec {
  switch (authChoice.mode) {
    case "api-key":
      return { adapter: authChoice.adapter, config: authChoice.config ?? {} };
    case "local":
      return {
        adapter: OPENAI_COMPATIBLE_ADAPTER_ID,
        config: {
          baseURL: authChoice.endpoint ?? DEFAULT_LOCAL_ENDPOINT,
          model: options.model ?? DEFAULT_LOCAL_MODEL,
        },
      };
    case "gateway": {
      const config = authChoice.config ?? {};
      const missing: string[] = [];
      if (!isNonEmptyString(config["baseURL"])) missing.push("baseURL");
      if (!isNonEmptyString(config["model"])) missing.push("model");
      if (missing.length > 0) {
        throw new Error(
          `gateway mode requires ${missing.join(" and ")} in config (pass --endpoint and --model)`,
        );
      }
      return { adapter: OPENAI_COMPATIBLE_ADAPTER_ID, config };
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
