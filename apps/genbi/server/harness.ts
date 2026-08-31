/**
 * GET /api/harness — read-only introspection of how the CURRENTLY compiled
 * profile is realized. `buildHarnessDto` is a pure mapping from an
 * already-loaded `Bundle` + the store's runtime settings/context + the
 * harness's own base route options onto the BFF's `HarnessDto` wire
 * contract — it does no compiling and touches no turn/answer logic.
 *
 * Each component's `model`/`tiers` are derived from the REAL
 * tier -> model binding `route()`/`runInProcessDefault` would actually apply for
 * `baseRouteOptions` (see `buildRealTierResolver`), not from the Setup
 * page's editable seeded `store.getRuntimeSettings()`. Those two can
 * legitimately differ (e.g. a seeded `claude-haiku`/`claude-sonnet` display
 * while `WREN_HARNESS_MODEL`/a gateway override actually routes every tier
 * to `gpt-4o`), and per-component introspection's whole job is to report
 * what that component would really run.
 *
 * `runtime.tierModels` (the top-level runtime summary) shares that same
 * effective resolver, so it cannot disagree with the per-component rows.
 * Explicit subscription settings are knowable because this process generated
 * the dispatcher models config from them; an unsaved boot-time subscription
 * config remains opaque and is labeled as such.
 *
 * Naming note — bundle "components" (`HarnessDto.components`,
 * `bundle.agents`) are presented in the frontend as **Components** — not
 * "sub-agents" (that framing is reserved for the profile level). This
 * harness runtime routes exactly ONE component per turn from the user's
 * intent (for example `answer_query` or `generate_dashboard`) — the other
 * bundle agents surfaced here are read-only declared components of the
 * compiled bundle, not concurrently-running sub-agents. This comment plus the one on
 * `HarnessComponent`/`HarnessDto` in `wire-types.ts` document that framing.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { describeConnection, resolveConnectionSource } from "./conn-config.js";
import { bundleFormatVersion, deriveAdapterSpec, findLockedGatedCheck } from "../harness/index.js";
import type { AdapterSpec, Agent, Bundle, Capability, Guardrail, RouteOptions, Step } from "../harness/index.js";
import type { Store } from "./db.js";
import { assertHarnessPurposeProfile, NATIVE_DISPATCH_REGISTRY } from "./native-dispatch-registry.js";
import type { NativePurpose } from "./native-dispatch-registry.js";
import type { NativeSessionReadiness } from "./native-sessions.js";
import { collectBundleTierNames as collectCompiledBundleTierNames, effectiveTierModel } from "./runtime-binding.js";
import type {
  CapabilityOutcome,
  HarnessCapability,
  HarnessComponent,
  HarnessConnection,
  HarnessDto,
  HarnessGuardrail,
  HarnessProfile,
  HarnessPurpose,
  HarnessRuntime,
  HarnessRuntimeBackend,
  HarnessRuntimeDispatcher,
  HarnessStep,
  TierModelBinding,
} from "./wire-types.js";

type BaseRouteOptions = Omit<RouteOptions, "question" | "onEvent">;

export interface HarnessSetupReadiness {
  readonly available: boolean;
  readonly reason?: string;
}

/** snake_case/kebab-case id -> Title Case display name, e.g. "answer_query" -> "Answer Query". */
function humanize(id: string): string {
  return id
    .split(/[_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolves an `AdapterSpec` to the display model string the runtime will
 * ACTUALLY realize — i.e. the same `config.model` field the `anthropic`/
 * `openai-compatible` adapters consult (`harness/providers/adapters/*.ts`). An
 * adapter with no concrete `model` string in its config (e.g. `mock`, which
 * only exists for tests/synthetic bundles and takes a scriptable generator
 * instead of a model name) has no real model to show — label it honestly
 * rather than fabricate a model name.
 */
function adapterDisplayModel(spec: AdapterSpec): string {
  const config = spec.config as Record<string, unknown> | undefined;
  const model = config && isNonEmptyString(config["model"]) ? config["model"] : undefined;
  return model ?? `${spec.adapter} (no fixed model)`;
}

/**
 * Store's Setup-editable seeded tier -> model map, consulted ONLY as the
 * last-resort fallback when the real binding genuinely can't resolve a tier
 * (see `buildRealTierResolver`) — e.g. a hybrid `tierBinding` that doesn't
 * cover a tier some other bundle component uses, or a `gateway` auth choice
 * missing its required config. Always labeled so it's never mistaken for a
 * measured/real value.
 */
function configuredFallbackModel(tier: string, store: Store): string {
  const configured = store.getRuntimeSettings().tierModels.find((binding) => binding.tier === tier)?.model;
  return configured !== undefined ? `${configured} (configured)` : `${tier} (unbound)`;
}

/**
 * Explicit persisted model source. It is authoritative only after a validated
 * save; seeded Setup defaults never use this path.
 */
function storeTierModel(tier: string, store: Store): string {
  const settings = store.getRuntimeSettings();
  const configured = settings.tierModels.find((binding) => binding.tier === tier);
  return configured ? effectiveTierModel(configured, settings) ?? `${tier} (unbound)` : `${tier} (unbound)`;
}

interface RealTierResolver {
  resolve(tier: string): string;
}

/**
 * Builds a resolver mirroring the tier -> model binding `route()`/
 * `runInProcessDefault` (`harness/route/in-process.ts`) actually apply for
 * `baseRouteOptions`, so `runtime.tierModels` and each component's `model`
 * reflect what really runs rather than the Setup page's seeded settings:
 *
 * - `subscription` (dispatched): there is no per-tier `AdapterSpec` at all — the
 *   provider-specific subscription dispatcher owns model routing internally, and any
 *   `--models-config` override is opaque YAML this harness never parses (see
 *   `DispatchedOptions.modelsConfig`'s doc comment) — so every tier honestly
 *   reports the same subscription label (matching `runtimeModeAndLabel`'s
 *   own `"Subscription (<provider>)"` wording).
 * - a `tierBinding` override present (hybrid mode, in-process only): resolves
 *   per-tier via the caller-supplied `AdapterSpec` map, exactly like
 *   `buildHybridTierBinding` does for the `answer_query` agent at run time.
 *   A tier this map doesn't cover (e.g. a different bundle component uses a
 *   tier name `answer_query` never uses, so the hybrid map was never
 *   required to cover it) is genuinely unresolvable from the real binding —
 *   falls back to the Setup-configured value, visibly labeled as such.
 * - otherwise (uniform, in-process's default path): derives ONE `AdapterSpec` via
 *   `deriveAdapterSpec(authChoice, model)` — the exact call `runInProcessDefault`
 *   itself makes — which realizes every tier alike. If that derivation
 *   itself throws (e.g. `gateway` mode missing `baseURL`/`model`), the same
 *   failure would occur at turn-execution time too; report every tier via
 *   the configured fallback rather than 500ing `GET /api/harness`.
 */
function buildRealTierResolver(baseRouteOptions: BaseRouteOptions, store: Store): RealTierResolver {
  const { authChoice } = baseRouteOptions;

  if (authChoice.mode === "subscription") {
    if (store.hasExplicitRuntimeSettings()) {
      return { resolve: (tier) => storeTierModel(tier, store) };
    }
    const label = `Subscription (${authChoice.provider})`;
    return { resolve: () => label };
  }

  if (baseRouteOptions.tierBinding !== undefined) {
    const hybrid = baseRouteOptions.tierBinding;
    return {
      resolve: (tier) => {
        const spec = hybrid[tier];
        return spec ? adapterDisplayModel(spec) : configuredFallbackModel(tier, store);
      },
    };
  }

  try {
    const uniformModel = adapterDisplayModel(
      deriveAdapterSpec(authChoice, baseRouteOptions.model !== undefined ? { model: baseRouteOptions.model } : {}),
    );
    return { resolve: () => uniformModel };
  } catch {
    return { resolve: (tier) => configuredFallbackModel(tier, store) };
  }
}

/**
 * `backend` mirrors `authChoice.mode` verbatim — a real, already-
 * meaningful auth-strategy name — rather than the internal `inProcess`/`dispatched`
 * framework-dispatch bucket the DTO used to leak.
 */
function runtimeBackendAndLabel(authChoice: RouteOptions["authChoice"]): { backend: HarnessRuntimeBackend; label: string } {
  switch (authChoice.mode) {
    case "subscription":
      return { backend: "subscription", label: `Subscription (${authChoice.provider})` };
    case "api-key":
      return { backend: "api-key", label: `API key (${authChoice.adapter})` };
    case "local":
      return { backend: "local", label: authChoice.endpoint ? `Local (${authChoice.endpoint})` : "Local" };
    case "gateway":
      return { backend: "gateway", label: "Gateway" };
  }
}

/**
 * Reports the provider-specific dispatcher that owns the configured product
 * path: Claude subscription uses `claude-agent-sdk`, Codex subscription uses
 * `codex-local`, and non-subscription modes run in-process.
 */
function runtimeDispatcher(authChoice: RouteOptions["authChoice"]): HarnessRuntimeDispatcher {
  if (authChoice.mode !== "subscription") return "in-process";
  return authChoice.provider === "codex" ? "codex-local" : "claude-agent-sdk";
}

function buildCapability(capability: Capability): HarnessCapability {
  const outcome: CapabilityOutcome = capability.outcome === "native" ? "native" : "realize-via";
  return {
    capability: capability.capability,
    outcome,
    providedBy: capability.provided_by,
    ...(capability.criticality !== undefined ? { criticality: capability.criticality } : {}),
  };
}

function buildGuardrails(guardrails: Agent["guardrails"]): HarnessGuardrail[] {
  return Object.entries(guardrails).map(([name, guardrail]: [string, Guardrail]) => ({
    name,
    enforcement: guardrail.enforcement,
    locked: guardrail.locked,
    ...(guardrail.threshold !== undefined ? { threshold: guardrail.threshold } : {}),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts the declared render-block `type` consts from an agent's
 * `output_schema` — `blocks.items.anyOf[].properties.type.const` when the
 * schema unions multiple block shapes (e.g. `answer_query`'s
 * table/definition), or the single-item form (`blocks.items.properties.type.const`
 * directly, no `anyOf`) when it only ever emits one block shape (e.g.
 * `explain_change`'s `narrative`). Deliberately defensive — `output_schema`
 * is stored as an untyped JSON Schema document (see `OutputSchema` in
 * `harness/bundle/schema.ts`), so this tolerates a missing `blocks`/`items`, no
 * `anyOf`, or a variant with no `const`, yielding `[]` rather than throwing.
 */
function extractOutputBlocks(outputSchema: Agent["output_schema"]): string[] {
  const properties = isRecord(outputSchema) ? outputSchema["properties"] : undefined;
  const blocks = isRecord(properties) ? properties["blocks"] : undefined;
  const items = isRecord(blocks) ? blocks["items"] : undefined;
  if (!isRecord(items)) return [];

  const variants = Array.isArray(items["anyOf"]) ? items["anyOf"] : [items];
  const consts: string[] = [];
  for (const variant of variants) {
    if (!isRecord(variant)) continue;
    const variantProperties = isRecord(variant["properties"]) ? variant["properties"] : undefined;
    const typeProperty = variantProperties && isRecord(variantProperties["type"]) ? variantProperties["type"] : undefined;
    const constValue = typeProperty?.["const"];
    if (isNonEmptyString(constValue)) consts.push(constValue);
  }
  return consts;
}

function buildStep(step: Step): HarnessStep {
  return {
    name: step.name,
    tier: step.tier,
    consumes: step.consumes,
    produces: step.produces,
    realization: step.realization.kind,
    ...(step.when?.guard !== undefined ? { guard: step.when.guard } : {}),
    ...(step.realization.fold_into !== undefined ? { foldInto: step.realization.fold_into } : {}),
    ...(step.realization.max_attempts !== undefined ? { maxAttempts: step.realization.max_attempts } : {}),
  };
}

// The agent's distinct step tiers, each resolved to its REAL model via `resolver` (not the
// Setup-editable store) — mirrors what `runInProcessDefault` would actually bind for this agent's
// steps. The runtime routes one component per turn; each component's tiers/model report the
// real binding that applies when that component is selected.
/** Public, purpose-level reason used only when native readiness cannot execute the selected purpose. */
const NATIVE_PURPOSE_UNAVAILABLE_REASON = "The selected native session is unavailable.";

/**
 * A component can be unavailable for two independent reasons, and only one
 * of them is ever safe to promote:
 *
 * - "bundle-level" (`"availability" in agent`): Warble's compiled dispatch
 *   target declared this component unavailable on the PROGRAMMATIC path
 *   (e.g. `apply_enrichment`'s `human_approval: fail`) — but the currently
 *   selected purpose's native CLI session may still be able to run it. When
 *   it can, this promotes the row to `"ready"`, qualified by the native
 *   target label, and moves the programmatic limitation into
 *   `nativeAvailability` for the expanded row rather than dropping it.
 * - "purpose-level" (native session readiness for the selected purpose):
 *   there is no execution path at all right now — never promoted.
 *
 * The branch taken here (not any comparison against Warble's reason string)
 * is what decides promotion, per the DTO's typed `nativeAvailability` field.
 */
function buildComponent(agent: Agent, resolver: RealTierResolver, dispatchTarget: string, purposeInfo: HarnessPurpose): HarnessComponent {
  if ("availability" in agent) {
    const viaLabel = purposeInfo.executionKind === "native_session" && purposeInfo.available
      ? purposeInfo.targetLabel
      : undefined;
    return {
      id: agent.id,
      name: humanize(agent.id),
      componentType: agent.component_type,
      realizationKind: agent.realization_kind,
      trigger: agent.trigger,
      outcome: agent.outcome,
      callableAs: agent.verb ?? agent.id,
      model: "—",
      tiers: [],
      capabilities: [],
      guardrails: [],
      tools: [],
      outputBlocks: [],
      steps: [],
      ...(viaLabel !== undefined
        ? {
            status: "ready",
            nativeAvailability: {
              viaLabel,
              compiledDispatchTarget: dispatchTarget,
              compiledUnavailableReason: agent.availability.reason,
            },
          }
        : { status: "unavailable", unavailableReason: agent.availability.reason }),
    };
  }
  const distinctTiers = [...new Set(agent.steps.map((step) => step.tier))];
  const tiers: TierModelBinding[] = distinctTiers.map((tier) => ({ tier, model: resolver.resolve(tier) }));
  const lastStep = agent.steps[agent.steps.length - 1];
  const model = lastStep ? resolver.resolve(lastStep.tier) : "—";

  return {
    id: agent.id,
    name: humanize(agent.id),
    componentType: agent.component_type,
    realizationKind: agent.realization_kind,
    trigger: agent.trigger,
    outcome: agent.outcome,
    callableAs: agent.verb ?? agent.id,
    model,
    tiers,
    capabilities: agent.capabilities.map(buildCapability),
    guardrails: buildGuardrails(agent.guardrails),
    tools: agent.tools.map((tool) => ({ name: tool.name, source: tool.source })),
    outputBlocks: extractOutputBlocks(agent.output_schema),
    steps: agent.steps.map(buildStep),
    ...(purposeInfo.available
      ? { status: "ready" }
      : { status: "unavailable", unavailableReason: purposeInfo.reason ?? NATIVE_PURPOSE_UNAVAILABLE_REASON }),
  };
}

/**
 * `"Bound"` when the user has walked the Setup wizard's Compile & Bind step
 * (`POST /api/setup/compile-bind`, the only writer of the "bind" step's
 * `state: "done"`) — the most honest available signal, since `GET
 * /api/harness` itself can independently compile the same bundle (via its
 * own `describeBundle` call) without the user ever having completed Setup.
 * Anything else reports the honest, non-hardcoded alternative rather than a
 * literal `"Bound"` the frontend previously had no real state to key off of.
 */
function deriveProfileStatus(store: Store): string {
  const bindStep = store.getSetupSteps().find((step) => step.key === "bind");
  return bindStep?.state === "done" ? "Bound" : "Not bound yet";
}

function deriveIrVersion(compat: Bundle["compat"]): string {
  return compat.min_ir_version === compat.max_ir_version ? compat.min_ir_version : `${compat.min_ir_version}–${compat.max_ir_version}`;
}

/** Deterministic JSON serialization (recursively sorted object keys) so `computeBundleHash` doesn't depend on property insertion order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A short, stable, content-derived id for the compiled bundle — NOT a "last compiled" timestamp, which the store has none of. */
function computeBundleHash(bundle: Bundle): string {
  return createHash("sha256").update(canonicalJson(bundle)).digest("hex").slice(0, 7);
}

function buildProfile(bundle: Bundle, baseRouteOptions: BaseRouteOptions, store: Store, purpose: NativePurpose): HarnessProfile {
  const verifyGate = bundle.agents.some((agent) => findLockedGatedCheck(agent) !== undefined);
  return {
    id: bundle.profile,
    name: humanize(bundle.profile),
    boundContext: purpose === "setup" ? "Bootstrap workspace (no project bound)" : path.basename(baseRouteOptions.userProject),
    verifyGate,
    bundleId: `${bundle.profile}@${bundle.target}`,
    bundleVersion: bundleFormatVersion(bundle),
    irVersion: deriveIrVersion(bundle.compat),
    dispatchTarget: bundle.target,
    bundleHash: computeBundleHash(bundle),
    status: purpose === "setup" ? "Bootstrap" : deriveProfileStatus(store),
  };
}

/** Exported bundle-derived source used by runtime configuration validation. */
export function collectBundleTierNames(bundle: Bundle): string[] {
  return collectCompiledBundleTierNames(bundle);
}

/**
 * Keep the compiled bundle's declared profile tied to the BFF-selected
 * purpose before exposing it through the read-only Harness DTO.
 */
export function assertHarnessBundlePurpose(bundle: Bundle, purpose: NativePurpose): void {
  assertHarnessPurposeProfile(purpose, bundle.profile);
}

function buildRuntime(bundle: Bundle, baseRouteOptions: BaseRouteOptions, resolver: RealTierResolver): HarnessRuntime {
  const { backend, label } = runtimeBackendAndLabel(baseRouteOptions.authChoice);
  const dispatcher = runtimeDispatcher(baseRouteOptions.authChoice);
  const tierModels: TierModelBinding[] = collectBundleTierNames(bundle).map((tier) => ({ tier, model: resolver.resolve(tier) }));
  return { backend, label, dispatcher, tierModels };
}

// `type`/`location` are resolved via `server/conn-config.ts`'s
// `resolveConnectionSource`: the project's persistent `wren_project.yml`
// `data_source:` (always present) is `type`, and its pinned `profile:`
// resolved against `~/.wren/profiles.yml` supplies the fields
// `describeConnection` turns into `location` (a duckdb path, or an
// allowlisted host/database for DB-type sources — never a credential). A
// project with no profile pin honestly reports `type` with location "—"
// rather than fabricating one from the profiles store's global `active`
// profile. There is still no real "last synced at"/"via which mechanism"
// signal available from this harness, so `via`/`lastSync` stay honest "—"
// too. `tablesSynced` comes from real store data (the context model count).
function buildConnection(baseRouteOptions: BaseRouteOptions, store: Store, purpose: NativePurpose): HarnessConnection {
  if (purpose === "setup") {
    return { type: "—", location: "—", via: "Bootstrap workspace", tablesSynced: 0, lastSync: "—", health: "degraded" };
  }
  const tablesSynced = store.getContextModels().length;
  const source = resolveConnectionSource(baseRouteOptions.userProject);
  const { type, location } = describeConnection(source.datasource, source.fields);
  return {
    type,
    location,
    via: "—",
    tablesSynced,
    lastSync: "—",
    health: tablesSynced > 0 ? "healthy" : "degraded",
  };
}

function setupRunnerTarget(authChoice: RouteOptions["authChoice"]): Pick<Extract<HarnessPurpose, { executionKind: "setup_runner" }>, "target" | "targetLabel"> {
  switch (runtimeDispatcher(authChoice)) {
    case "claude-agent-sdk": return { target: "claude-agent-sdk:setup", targetLabel: "Claude Setup runner" };
    case "codex-local": return { target: "codex-local:setup", targetLabel: "Codex Setup runner" };
    case "in-process": return { target: "in-process:setup", targetLabel: "In-process Setup runner" };
  }
}

function buildHarnessPurpose(purpose: NativePurpose, baseRouteOptions: BaseRouteOptions, nativeReadiness?: NativeSessionReadiness, setupReadiness?: HarnessSetupReadiness): HarnessPurpose {
  const definition = NATIVE_DISPATCH_REGISTRY[purpose];
  if (purpose === "setup") {
    const available = setupReadiness?.available ?? false;
    return {
      ...definition,
      executionKind: "setup_runner",
      ...setupRunnerTarget(baseRouteOptions.authChoice),
      available,
      ...(!available ? { reason: setupReadiness?.reason ?? "The selected Setup runner is unavailable." } : {}),
    };
  }
  const readiness = nativeReadiness?.purposes[purpose];
  const available = readiness?.available ?? false;
  return {
    ...definition,
    executionKind: "native_session",
    ...(readiness?.target ? { target: readiness.target, targetLabel: readiness.targetLabel as "Claude CLI" | "Codex CLI" } : {}),
    available,
    ...(!available ? { reason: readiness?.reason ?? NATIVE_PURPOSE_UNAVAILABLE_REASON } : {}),
  };
}

export function buildHarnessDto(bundle: Bundle, store: Store, baseRouteOptions: BaseRouteOptions, purpose: NativePurpose = "analysis", nativeReadiness?: NativeSessionReadiness, setupReadiness?: HarnessSetupReadiness): HarnessDto {
  const resolver = buildRealTierResolver(baseRouteOptions, store);
  const purposeInfo = buildHarnessPurpose(purpose, baseRouteOptions, nativeReadiness, setupReadiness);
  return {
    purpose: purposeInfo,
    profile: buildProfile(bundle, baseRouteOptions, store, purpose),
    runtime: buildRuntime(bundle, baseRouteOptions, resolver),
    connection: buildConnection(baseRouteOptions, store, purpose),
    components: bundle.agents.map((agent) => buildComponent(agent, resolver, bundle.target, purposeInfo)),
    nativeSessions: {
      binding: store.getNativeRuntimeBinding(),
      dispatches: Object.values(NATIVE_DISPATCH_REGISTRY).map((definition) => {
        const readiness = nativeReadiness?.purposes[definition.purpose];
        return { purpose: definition.purpose, profile: definition.profile, scopeKind: definition.scopeKind, ...(readiness?.target ? { target: readiness.target, targetLabel: readiness.targetLabel as "Claude CLI" | "Codex CLI" } : {}), available: readiness?.available ?? false, ...(readiness?.reason ? { reason: readiness.reason } : {}) };
      }),
    },
  };
}
