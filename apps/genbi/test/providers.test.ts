import { generateText, type LanguageModel } from "ai";
import type { LanguageModelV4, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import {
  ANTHROPIC_ADAPTER_ID,
  createDefaultProviderRegistry,
  createProviderRegistry,
  MOCK_ADAPTER_ID,
  OPENAI_COMPATIBLE_ADAPTER_ID,
  resolveStepModel,
  resolveTierModel,
  UnknownAdapterError,
  UnknownTierError,
} from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { readFixture } from "./fixtures.js";

const EMPTY_USAGE: LanguageModelV4Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

function scriptedTextResult(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: EMPTY_USAGE,
    warnings: [],
  };
}

// The registry/binding surface resolves to the broad AI SDK `LanguageModel`
// union (which also allows a bare global-model-id string). Every adapter in
// this package resolves to a concrete `LanguageModelV4` instance, never a
// string — narrow for assertions in these construction-only checks.
function asResolvedModel(model: LanguageModel): LanguageModelV4 {
  if (typeof model === "string") {
    throw new Error("expected a resolved model instance, not a global model id string");
  }
  return model as LanguageModelV4;
}

describe("provider registry + tier binding resolver", () => {
  it("resolves the same tier to different adapter-backed models by swapping only the binding", () => {
    const registry = createDefaultProviderRegistry();

    const anthropicBinding: TierBinding = {
      tiers: {
        strong: { adapter: ANTHROPIC_ADAPTER_ID, config: { model: "claude-sonnet-4-5", apiKey: "test-key" } },
      },
    };
    const openaiCompatibleBinding: TierBinding = {
      tiers: {
        strong: {
          adapter: OPENAI_COMPATIBLE_ADAPTER_ID,
          config: { baseURL: "http://localhost:11434/v1", model: "qwen2.5", apiKey: "unused" },
        },
      },
    };

    // Same calling code (resolveTierModel with tier "strong"); only the
    // binding object differs, and the resolved model's provider differs.
    const viaAnthropic = asResolvedModel(resolveTierModel(anthropicBinding, "strong", registry));
    const viaOpenAICompatible = asResolvedModel(
      resolveTierModel(openaiCompatibleBinding, "strong", registry),
    );

    expect(viaAnthropic.provider).toMatch(/anthropic/);
    expect(viaOpenAICompatible.provider).toMatch(/openai-compatible/);
    expect(viaAnthropic.provider).not.toEqual(viaOpenAICompatible.provider);
  });

  it("drives a scripted generateText end-to-end through the mock adapter, fully offline", async () => {
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: { doGenerate: scriptedTextResult("the mocked answer") },
        },
      },
    };

    const model = resolveTierModel(binding, "cheap", registry);
    const result = await generateText({ model, prompt: "irrelevant — response is scripted" });

    expect(result.text).toBe("the mocked answer");
  });

  it("throws a clear, named error for a tier absent from the binding", () => {
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = { tiers: {} };

    expect(() => resolveTierModel(binding, "nonexistent", registry)).toThrow(UnknownTierError);
    expect(() => resolveTierModel(binding, "nonexistent", registry)).toThrow(/nonexistent/);
  });

  it("throws a clear, named error for an adapter id absent from the registry", () => {
    const registry = createProviderRegistry(); // empty — no built-ins registered
    const binding: TierBinding = {
      tiers: { cheap: { adapter: "not-a-real-adapter", config: {} } },
    };

    expect(() => resolveTierModel(binding, "cheap", registry)).toThrow(UnknownAdapterError);
    expect(() => resolveTierModel(binding, "cheap", registry)).toThrow(/not-a-real-adapter/);
  });

  it("resolves purely from a runtime-injected binding — no bundle needed, and a bundle never supplies tier->model info", () => {
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: { cheap: { adapter: MOCK_ADAPTER_ID, config: {} } },
    };

    // No bundle loaded at all — resolution works from the binding alone.
    expect(() => resolveTierModel(binding, "cheap", registry)).not.toThrow();

    // Even when a real bundle *is* loaded, its steps only carry an open-string
    // `tier` name — never adapter/model info — so resolution for one of its
    // steps still comes entirely from the runtime binding.
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
    expect(agent).toBeDefined();
    const step = agent!.steps[0]!;
    expect(typeof step.tier).toBe("string");

    const model = resolveStepModel(step, binding, registry);
    expect(model).toBeDefined();
  });

  it("constructs an openai-compatible model pointed at the given baseURL/model without a network call", () => {
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: OPENAI_COMPATIBLE_ADAPTER_ID,
          config: { baseURL: "http://localhost:8000/v1", model: "qwen2.5-coder" },
        },
      },
    };

    const model = asResolvedModel(resolveTierModel(binding, "cheap", registry));

    expect(model.provider).toMatch(/openai-compatible/);
    expect(model.modelId).toBe("qwen2.5-coder");
  });

  it("supports registering additional adapters onto the registry", () => {
    const registry = createProviderRegistry();
    expect(registry.has("custom")).toBe(false);

    registry.register("custom", () =>
      resolveTierModel(
        { tiers: { any: { adapter: MOCK_ADAPTER_ID, config: {} } } },
        "any",
        createDefaultProviderRegistry(),
      ),
    );

    expect(registry.has("custom")).toBe(true);
    expect(() => registry.create("custom", {})).not.toThrow();
  });
});
