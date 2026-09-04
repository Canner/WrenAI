/**
 * Compiles the Setup runtime form into the binding actually consumed by the
 * harness.  Settings deliberately contain no credential values; this module
 * reads an API key only while constructing an in-memory in-process adapter spec.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveHubDir, resolveWarbleBinary, runWarble } from "../harness/index.js";
import type { AuthChoice, AdapterSpec, RouteOptions } from "../harness/index.js";
import type { CodexManifestModels } from "../harness/route/codex-local-manifest.js";
import type { RuntimeSettings, RuntimeTierAdapter, TierModelBinding } from "./wire-types.js";

export class RuntimeBindingError extends Error {}

/**
 * The Claude Agent SDK accepts concrete model ids for its top-level driver,
 * but its per-step `agents[].model` surface is deliberately narrower. Keep
 * this product-side contract explicit so an invalid saved Runtime is rejected
 * before a user turn reaches the dispatcher.
 */
export const CLAUDE_AGENT_SDK_PER_STEP_MODELS = ["sonnet", "opus", "haiku", "inherit"] as const;

const CLAUDE_AGENT_SDK_PER_STEP_MODEL_SET = new Set<string>(CLAUDE_AGENT_SDK_PER_STEP_MODELS);

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function absoluteHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function bindingByTier(settings: RuntimeSettings): Map<string, TierModelBinding> {
  const bindings = new Map<string, TierModelBinding>();
  for (const binding of settings.tierModels) {
    if (!nonEmpty(binding.tier)) throw new RuntimeBindingError("A tier binding must name a tier.");
    if (bindings.has(binding.tier)) throw new RuntimeBindingError(`Duplicate tier binding: ${binding.tier}`);
    bindings.set(binding.tier, binding);
  }
  return bindings;
}

/** The old single Model field is the default for every tier without a model override. */
export function effectiveTierModel(binding: TierModelBinding, settings: RuntimeSettings): string | undefined {
  return nonEmpty(binding.model) ?? nonEmpty(settings.apiKeyModel);
}

/**
 * Returns a browser-safe correction for an already persisted Runtime. This is
 * intentionally narrower than catalog validation: provider catalog entries
 * remain free-form wherever their dispatcher accepts concrete model ids. Only
 * Claude's SDK subagent tier field has the closed alias union below.
 */
export function runtimeSettingsCorrection(settings: RuntimeSettings): string | undefined {
  if (settings.authMode !== "subscription" || settings.subscriptionProvider !== "claude") return undefined;
  for (const binding of settings.tierModels) {
    const model = effectiveTierModel(binding, settings);
    if (model && !CLAUDE_AGENT_SDK_PER_STEP_MODEL_SET.has(model)) {
      return `Runtime needs correction in Setup: Claude per-step tier "${binding.tier}" must use one of ${CLAUDE_AGENT_SDK_PER_STEP_MODELS.join(", ")}.`;
    }
  }
  return undefined;
}

/** Throws the same actionable error at every persisted-runtime dispatch boundary. */
export function assertRuntimeSettingsDispatchable(settings: RuntimeSettings): void {
  const correction = runtimeSettingsCorrection(settings);
  if (correction) throw new RuntimeBindingError(correction);
}

function requireModel(tier: string, binding: TierModelBinding, settings: RuntimeSettings): string {
  const model = effectiveTierModel(binding, settings);
  if (!model) throw new RuntimeBindingError(`Tier "${tier}" needs a model override or the default Model.`);
  if (absoluteHttpUrl(model)) {
    throw new RuntimeBindingError(
      `Tier "${tier}": Model must be a model name, not a URL — got "${model}". Check that Model and Base URL weren't swapped.`,
    );
  }
  return model;
}

function requireBaseUrl(tier: string, binding: TierModelBinding, settings: RuntimeSettings): string {
  // A row without an explicit adapter is using the legacy/default runtime;
  // retain its single Base URL as the default just as Model is a default.
  const baseURL = nonEmpty(binding.baseURL) ?? (binding.adapter === undefined ? nonEmpty(settings.apiKeyBaseURL) : undefined);
  const adapter = effectiveAdapter(binding, settings);
  if (!baseURL) throw new RuntimeBindingError(`A Base URL is required for the ${adapter} adapter on tier "${tier}" — there is no default.`);
  if (!absoluteHttpUrl(baseURL)) {
    throw new RuntimeBindingError(
      `Tier "${tier}": Base URL must be an absolute http(s) URL — got "${baseURL}". Check that Model and Base URL weren't swapped.`,
    );
  }
  return baseURL;
}

function effectiveAdapter(binding: TierModelBinding, settings: RuntimeSettings): RuntimeTierAdapter {
  if (binding.adapter) return binding.adapter;
  if (settings.authMode === "local") return "local";
  return settings.apiKeyAdapter ?? "anthropic";
}

/** Credential env vars used by the materialized in-process rows (local rows need none). */
export function requiredInProcessCredentialEnvVars(settings: RuntimeSettings): string[] {
  const required = new Set<string>();
  for (const binding of settings.tierModels) {
    const adapter = effectiveAdapter(binding, settings);
    if (adapter === "anthropic") required.add("ANTHROPIC_API_KEY");
    if (adapter === "openai-compatible") required.add("OPENAI_API_KEY");
  }
  return [...required];
}

/** Validates the complete bundle map before Store/auth/live-route mutation. */
export function validateRuntimeTierBindings(settings: RuntimeSettings, bundleTiers: readonly string[]): void {
  const expected = new Set(bundleTiers);
  if (expected.size === 0) throw new RuntimeBindingError("The compiled bundle declares no step tiers.");
  const bindings = bindingByTier(settings);
  const missing = bundleTiers.filter((tier) => !bindings.has(tier));
  const extra = [...bindings.keys()].filter((tier) => !expected.has(tier));
  if (missing.length || extra.length) {
    const parts = [
      ...(missing.length ? [`missing: ${missing.join(", ")}`] : []),
      ...(extra.length ? [`unknown: ${extra.join(", ")}`] : []),
    ];
    throw new RuntimeBindingError(`Tier bindings must exactly match the compiled bundle (${parts.join("; ")}).`);
  }

  for (const tier of bundleTiers) {
    const binding = bindings.get(tier)!;
    requireModel(tier, binding, settings);
    const adapter = effectiveAdapter(binding, settings);
    if (adapter === "openai-compatible" || adapter === "local") requireBaseUrl(tier, binding, settings);
  }

  if (settings.authMode === "subscription" && !nonEmpty(settings.subscriptionDriverModel)) {
    throw new RuntimeBindingError("A subscription dispatcher driver model is required.");
  }
  assertRuntimeSettingsDispatchable(settings);
}

function inProcessSpec(tier: string, binding: TierModelBinding, settings: RuntimeSettings): AdapterSpec {
  const model = requireModel(tier, binding, settings);
  switch (effectiveAdapter(binding, settings)) {
    case "anthropic":
      // The Anthropic adapter reads ANTHROPIC_API_KEY from its environment.
      return { adapter: "anthropic", config: { model } };
    case "openai-compatible":
      // The transient AdapterSpec may carry the env-backed credential, but the
      // persisted settings and generated YAML never do.
      return { adapter: "openai-compatible", config: { model, baseURL: requireBaseUrl(tier, binding, settings), apiKey: process.env["OPENAI_API_KEY"] ?? "" } };
    case "local":
      return { adapter: "openai-compatible", config: { model, baseURL: requireBaseUrl(tier, binding, settings) } };
  }
}

function dispatchedTierYaml(tier: string, binding: TierModelBinding, settings: RuntimeSettings): string[] {
  const model = requireModel(tier, binding, settings);
  const adapter = effectiveAdapter(binding, settings);
  const key = JSON.stringify(tier);
  if (adapter === "anthropic") return [`  ${key}: ${JSON.stringify(model)}`];
  return [
    `  ${key}:`,
    "    provider: openai_compat",
    `    endpoint: ${JSON.stringify(requireBaseUrl(tier, binding, settings))}`,
    `    model: ${JSON.stringify(model)}`,
  ];
}

/** Generates the dispatcher-owned models config without ever serializing an API key. */
export function writeClaudeModelsConfig(settings: RuntimeSettings, bundleTiers: readonly string[]): string {
  const bindings = bindingByTier(settings);
  const lines = ["tiers:"];
  for (const tier of bundleTiers) lines.push(...dispatchedTierYaml(tier, bindings.get(tier)!, settings));
  // `orchestrator` is a dispatcher driver entry, deliberately separate from
  // the bundle tier rows that the user edits.
  lines.push(`  "orchestrator": ${JSON.stringify(nonEmpty(settings.subscriptionDriverModel) ?? "")}`, "");
  const contents = lines.join("\n");
  const dir = path.join(tmpdir(), "wren-harness-runtime");
  mkdirSync(dir, { recursive: true });
  const filename = `models-${createHash("sha256").update(contents).digest("hex").slice(0, 16)}.yaml`;
  const output = path.join(dir, filename);
  writeFileSync(output, contents, { mode: 0o600 });
  return output;
}

export function codexModelsForRuntime(settings: RuntimeSettings): CodexManifestModels {
  const bindings = bindingByTier(settings);
  const model = (tier: string) => requireModel(tier, bindings.get(tier) ?? { tier }, settings);
  return {
    orchestrator: nonEmpty(settings.subscriptionDriverModel) ?? "",
    cheap: model("cheap"),
    strong: model("strong"),
  };
}

/** Materializes the already-validated live binding for the selected runtime. */
export function materializeRuntimeRouteOptions(
  settings: RuntimeSettings,
  authChoice: AuthChoice,
): Pick<RouteOptions, "tierBinding" | "modelsConfig" | "codexModels"> {
  const tiers = settings.tierModels.map((binding) => binding.tier);
  if (authChoice.mode === "subscription") {
    if (authChoice.provider === "codex") return { codexModels: codexModelsForRuntime(settings) };
    return { modelsConfig: writeClaudeModelsConfig(settings, tiers) };
  }
  const bindings = bindingByTier(settings);
  return {
    tierBinding: Object.fromEntries(tiers.map((tier) => [tier, inProcessSpec(tier, bindings.get(tier)!, settings)])),
  };
}

/** Bundle-owned tier names, in first-seen order. */
export function collectBundleTierNames(bundle: { readonly agents: readonly { readonly steps: readonly { readonly tier: string }[] }[] }): string[] {
  const seen = new Set<string>();
  for (const agent of bundle.agents) for (const step of agent.steps) seen.add(step.tier);
  return [...seen];
}

/** Reads the tier contract directly from a compiled Warble IR document. */
export function collectIrTierNames(ir: unknown): string[] {
  if (ir === null || typeof ir !== "object" || !("components" in ir) || !Array.isArray(ir.components)) {
    throw new RuntimeBindingError("Compiled profile IR must contain a components array.");
  }

  const seen = new Set<string>();
  for (const component of ir.components) {
    if (component === null || typeof component !== "object" || !("llm_calls" in component) || !Array.isArray(component.llm_calls)) {
      throw new RuntimeBindingError("Every compiled profile component must contain an llm_calls array.");
    }
    for (const call of component.llm_calls) {
      if (call === null || typeof call !== "object" || !("tier" in call) || typeof call.tier !== "string" || !call.tier.trim()) {
        throw new RuntimeBindingError("Every compiled profile llm_call must name a non-empty tier.");
      }
      seen.add(call.tier.trim());
    }
  }
  if (seen.size === 0) throw new RuntimeBindingError("The compiled profile declares no llm_call tiers.");
  return [...seen];
}

/**
 * Reads the profile's tier contract, which the Setup form needs before an auth
 * choice or a user project exists.
 *
 * A tier name is a static property of the profile — it comes from each
 * `llm_calls[].tier` — so nothing here depends on what project is bound. The
 * profile ships its own compiled IR next to it, so the contract is read from
 * that and no Warble process runs at all.
 *
 * Compiling instead is the fallback, and only for a profile source that has no
 * golden beside it (`WREN_HARNESS_PROFILE` pointed at someone's own profile
 * tree). It is a fallback rather than the default because `warble compile`
 * requires a resolvable context binding, and the shipped profiles are bound to
 * a path that only resolves inside a checkout of this repository: in an
 * installed package that compile fails, and the Setup form has no rows.
 */
export async function compileUnboundProfileTierNames(options: {
  readonly profileSource: string;
  readonly warbleBin?: string;
}): Promise<string[]> {
  const goldenPath = path.join(path.resolve(options.profileSource), "ir.golden.json");
  if (existsSync(goldenPath)) {
    return collectIrTierNames(JSON.parse(await readFile(goldenPath, "utf8")) as unknown);
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "wren-harness-runtime-tiers-"));
  try {
    const irPath = path.join(workDir, "ir.json");
    const warbleBin = await resolveWarbleBinary(options.warbleBin);
    // Same reason as the compile pipeline's own invocation (see `resolveHubDir`): name the Hub root
    // the resolved binary belongs to, so a `warble` that isn't a checkout-local build can't
    // silently resolve components against the wrong library — or none.
    const hubDir = resolveHubDir(warbleBin);
    const hubDirArgs = hubDir !== undefined ? ["--hub-dir", hubDir] : [];
    await runWarble(warbleBin, ["compile", path.resolve(options.profileSource), "-o", irPath, ...hubDirArgs]);
    const ir = JSON.parse(await readFile(irPath, "utf8")) as unknown;
    return collectIrTierNames(ir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
