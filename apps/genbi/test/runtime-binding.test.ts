import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadBundle } from "../harness/index.js";
import type { AuthChoice } from "../harness/index.js";
import {
  codexModelsForRuntime,
  collectBundleTierNames,
  collectIrTierNames,
  materializeRuntimeRouteOptions,
  requiredModeACredentialEnvVars,
  runtimeSettingsCorrection,
  RuntimeBindingError,
  validateRuntimeTierBindings,
} from "../server/runtime-binding.js";
import type { RuntimeSettings } from "../server/wire-types.js";
import { Store } from "../server/db.js";
import { effectiveRouteOptions } from "../server/turn.js";
import type { TurnDeps } from "../server/turn.js";
import { readFixture } from "./fixtures.js";

const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
const tiers = collectBundleTierNames(bundle);

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    authMode: "byo",
    tierModels: [
      { tier: "cheap", adapter: "local", model: "local-small", baseURL: "http://localhost:11434/v1" },
      { tier: "strong", adapter: "anthropic", model: "claude-sonnet" },
    ],
    hybrid: true,
    deployment: "personal",
    apiKeyAdapter: "anthropic",
    ...overrides,
  };
}

describe("runtime tier binding compiler", () => {
  it("uses the compiled bundle's cheap/strong tiers, never an orchestrator UI tier", () => {
    expect(tiers).toEqual(["cheap", "strong"]);
  });

  it("rejects missing, extra, and duplicate bindings before a caller can mutate live state", () => {
    expect(() => validateRuntimeTierBindings(settings({ tierModels: [{ tier: "cheap", model: "x" }] }), tiers)).toThrow(/missing: strong/);
    expect(() => validateRuntimeTierBindings(settings({ tierModels: [...settings().tierModels, { tier: "orchestrator", model: "x" }] }), tiers)).toThrow(/unknown: orchestrator/);
    expect(() => validateRuntimeTierBindings(settings({ tierModels: [{ tier: "cheap", model: "x" }, { tier: "cheap", model: "y" }, { tier: "strong", model: "z" }] }), tiers)).toThrow(RuntimeBindingError);
  });

  it("materializes distinct Mode A AdapterSpecs from per-tier overrides", () => {
    const runtime = settings();
    validateRuntimeTierBindings(runtime, tiers);
    const options = materializeRuntimeRouteOptions(runtime, { mode: "api-key", adapter: "anthropic" });
    expect(options.tierBinding).toMatchObject({
      cheap: { adapter: "openai-compatible", config: { model: "local-small", baseURL: "http://localhost:11434/v1" } },
      strong: { adapter: "anthropic", config: { model: "claude-sonnet" } },
    });
  });

  it("validates credentials for the adapters materialized by tier rows, not an unused global adapter", () => {
    const runtime = settings({ apiKeyAdapter: "openai-compatible" });
    expect(requiredModeACredentialEnvVars(runtime)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("reads ordered unique tiers from compiled IR and rejects malformed tier contracts", () => {
    expect(collectIrTierNames({ components: [{ llm_calls: [{ tier: "strong" }, { tier: "strong" }] }, { llm_calls: [{ tier: "cheap" }] }] })).toEqual(["strong", "cheap"]);
    expect(() => collectIrTierNames({ components: [{ llm_calls: [{ tier: "" }] }] })).toThrow(RuntimeBindingError);
    expect(() => collectIrTierNames({ components: [] })).toThrow(/no llm_call tiers/);
  });

  it("generates Claude Mode B modelsConfig without persisting an API key and retains a separate driver", () => {
    vi.stubEnv("OPENAI_API_KEY", "must-not-appear");
    const runtime = settings({
      authMode: "subscription",
      subscriptionProvider: "claude",
      subscriptionDriverModel: "sonnet",
      tierModels: [
        { tier: "cheap", model: "haiku" },
        { tier: "strong", model: "sonnet" },
      ],
    });
    validateRuntimeTierBindings(runtime, tiers);
    const options = materializeRuntimeRouteOptions(runtime, { mode: "subscription", provider: "claude" });
    const yaml = readFileSync(options.modelsConfig!, "utf8");
    expect(yaml).toContain('"cheap":');
    expect(yaml).toContain('"cheap": "haiku"');
    expect(yaml).toContain('"orchestrator": "sonnet"');
    expect(yaml).not.toContain("must-not-appear");
    vi.unstubAllEnvs();
  });

  it("accepts only dispatcher-realizable Claude per-step aliases while retaining a free-form driver", () => {
    const runtime = settings({
      authMode: "subscription",
      subscriptionProvider: "claude",
      // The driver is passed through independently; only `tiers.*` becomes
      // warble-agent-sdk's per-step `agents[].model` surface.
      subscriptionDriverModel: "default",
      tierModels: [
        { tier: "cheap", model: "haiku" },
        { tier: "strong", model: "default" },
      ],
    });
    expect(() => validateRuntimeTierBindings(runtime, tiers)).toThrow(/Claude per-step tier "strong" must use one of sonnet, opus, haiku, inherit/);
    expect(runtimeSettingsCorrection(runtime)).toMatch(/Runtime needs correction in Setup/);

    const corrected = { ...runtime, tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] };
    expect(() => validateRuntimeTierBindings(corrected, tiers)).not.toThrow();
    expect(runtimeSettingsCorrection(corrected)).toBeUndefined();
  });

  it("keeps Codex's separate driver model and cheap/strong dispatcher models", () => {
    const runtime = settings({ authMode: "subscription", subscriptionProvider: "codex", subscriptionDriverModel: "gpt-driver" });
    validateRuntimeTierBindings(runtime, tiers);
    expect(codexModelsForRuntime(runtime)).toEqual({ orchestrator: "gpt-driver", cheap: "local-small", strong: "claude-sonnet" });
  });

  it("replaces mutually-exclusive boot routing fields when the live auth mode changes", () => {
    const store = new Store(":memory:");
    let authChoice: AuthChoice = { mode: "subscription", provider: "claude" };
    const deps: TurnDeps = {
      store,
      route: async () => {
        throw new Error("not called");
      },
      baseRouteOptions: {
        authChoice,
        profileSource: "/fixture/profile",
        userProject: "/fixture/project",
        tierBinding: { stale: { adapter: "mock", config: {} } },
        modelsConfig: "/stale/models.yaml",
        codexModels: { orchestrator: "stale", cheap: "stale", strong: "stale" },
      },
      getAuthChoice: () => authChoice,
    };

    store.setRuntimeSettings(settings({
      authMode: "subscription",
      subscriptionProvider: "claude",
      subscriptionDriverModel: "sonnet",
      tierModels: [
        { tier: "cheap", model: "haiku" },
        { tier: "strong", model: "sonnet" },
      ],
    }));
    const claude = effectiveRouteOptions(deps);
    expect(claude.modelsConfig).toBeDefined();
    expect(claude.modelsConfig).not.toBe("/stale/models.yaml");
    expect(claude.tierBinding).toBeUndefined();
    expect(claude.codexModels).toBeUndefined();

    authChoice = { mode: "local" };
    store.setRuntimeSettings(settings({
      authMode: "local",
      tierModels: [
        { tier: "cheap", adapter: "local", model: "local-small", baseURL: "http://localhost:11434/v1" },
        { tier: "strong", adapter: "local", model: "local-large", baseURL: "http://localhost:11434/v1" },
      ],
    }));
    const local = effectiveRouteOptions(deps);
    expect(local.tierBinding).toBeDefined();
    expect(local.modelsConfig).toBeUndefined();
    expect(local.codexModels).toBeUndefined();
  });

  it("preserves API-key boot credentials and model until runtime settings are explicitly saved", () => {
    const store = new Store(":memory:");
    const bootAuth: AuthChoice = {
      mode: "api-key",
      adapter: "openai-compatible",
      config: { apiKey: "boot-secret", baseURL: "https://boot.example/v1", model: "boot-model" },
    };
    const deps: TurnDeps = {
      store,
      route: async () => { throw new Error("not called"); },
      baseRouteOptions: {
        authChoice: bootAuth,
        profileSource: "/fixture/profile",
        userProject: "/fixture/project",
        model: "boot-model",
      },
      getAuthChoice: () => bootAuth,
    };

    expect(store.hasExplicitRuntimeSettings()).toBe(false);
    expect(effectiveRouteOptions(deps)).toMatchObject({ authChoice: bootAuth, model: "boot-model" });
    expect(effectiveRouteOptions(deps).tierBinding).toBeUndefined();
  });

  it("preserves local boot endpoint and model until runtime settings are explicitly saved", () => {
    const store = new Store(":memory:");
    const bootAuth: AuthChoice = { mode: "local", endpoint: "http://localhost:11434/v1" };
    const deps: TurnDeps = {
      store,
      route: async () => { throw new Error("not called"); },
      baseRouteOptions: {
        authChoice: bootAuth,
        profileSource: "/fixture/profile",
        userProject: "/fixture/project",
        model: "boot-local-model",
      },
      getAuthChoice: () => bootAuth,
    };

    expect(effectiveRouteOptions(deps)).toMatchObject({ authChoice: bootAuth, model: "boot-local-model" });
    expect(effectiveRouteOptions(deps).tierBinding).toBeUndefined();
  });
});
