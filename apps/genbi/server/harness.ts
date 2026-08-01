/**
 * GET /api/harness — read-only introspection of how the CURRENTLY compiled
 * profile is realized. `buildHarnessDto` is a pure mapping from an
 * already-loaded `Bundle` + the store's runtime settings/context + the
 * harness's own base route options onto the BFF's `HarnessDto` wire
 * contract — it does no compiling and touches no turn/answer logic.
 *
 * Each component's `model`/`tiers` are derived from the REAL
 * tier -> model binding `route()`/`runModeADefault` would actually apply for
 * `baseRouteOptions` (see `buildRealTierResolver`), not from the Setup
 * page's editable seeded `store.getRuntimeSettings()`. Those two can
 * legitimately differ (e.g. a seeded `claude-haiku`/`claude-sonnet` display
 * while `WREN_HARNESS_MODEL`/a gateway override actually routes every tier
 * to `gpt-4o`), and per-component introspection's whole job is to report
 * what that component would really run.
 *
 * `runtime.tierModels` (the top-level runtime summary, distinct
 * from each component's own `tiers`) instead reuses `store.getRuntimeSettings()`
 * directly, the SAME source `GET /api/config/runtime` reports (see
 * `buildRuntime`). It used to share the "real binding" resolver above, but
 * under a `subscription` auth choice that real binding is genuinely
 * unobservable here (the `warble-agent-sdk` dispatcher owns model routing
 * internally) and the resolver could only report the same auth label
 * ("Subscription (claude)") for every tier — leaking a non-answer where the
 * UI needs an actual model name, and disagreeing with `/api/config/runtime`
 * for no good reason. `runtime.tierModels` also no longer carries the
 * internal `modeA`/`modeB` dispatch bucket — see `runtimeBackendAndLabel`.
 *
 * Naming note — bundle "components" (`HarnessDto.components`,
 * `bundle.agents`) are presented in the frontend as **Components** — not
 * "sub-agents" (that framing is reserved for the profile level). This
 * harness's runtime (`harness/session/run.ts`) only ever executes ONE agent per
 * turn (`answer_query`, the single orchestrator) — the other bundle agents
 * surfaced here are read-only declared components of the compiled bundle,
 * not concurrently-running sub-agents. This comment plus the one on
 * `HarnessComponent`/`HarnessDto` in `wire-types.ts` document that framing.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { describeConnection, resolveConnectionSource } from "./conn-config.js";
import { bundleFormatVersion, deriveAdapterSpec, findLockedGatedCheck } from "../harness/index.js";
import type { AdapterSpec, Agent, Bundle, Capability, Guardrail, RouteOptions, Step } from "../harness/index.js";
import type { Store } from "./db.js";
import type {
  CapabilityOutcome,
  HarnessCapability,
  HarnessComponent,
  HarnessConnection,
  HarnessDto,
  HarnessGuardrail,
  HarnessProfile,
  HarnessRuntime,
  HarnessRuntimeBackend,
  HarnessRuntimeDispatcher,
  HarnessStep,
  TierModelBinding,
} from "./wire-types.js";

type BaseRouteOptions = Omit<RouteOptions, "question" | "onEvent">;

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
 * `runtime.tierModels`' model source is `store.getRuntimeSettings().tierModels`,
 * the exact same data `GET /api/config/runtime` returns, so the two endpoints always agree.
 * Unlike `configuredFallbackModel` (used only as a last-resort fallback for the per-component
 * REAL binding), this is the PRIMARY source for `runtime.tierModels`, so it carries no
 * "(configured)" qualifier — it's simply the answer, not a fallback from something else.
 */
function storeTierModel(tier: string, store: Store): string {
  const configured = store.getRuntimeSettings().tierModels.find((binding) => binding.tier === tier)?.model;
  return configured ?? `${tier} (unbound)`;
}

interface RealTierResolver {
  resolve(tier: string): string;
}

/**
 * Builds a resolver mirroring the tier -> model binding `route()`/
 * `runModeADefault` (`harness/route/mode-a.ts`) actually apply for
 * `baseRouteOptions`, so `runtime.tierModels` and each component's `model`
 * reflect what really runs rather than the Setup page's seeded settings:
 *
 * - `subscription` (Mode B): there is no per-tier `AdapterSpec` at all — the
 *   `warble-agent-sdk` dispatcher CLI owns model routing internally, and any
 *   `--models-config` override is opaque YAML this harness never parses (see
 *   `ModeBOptions.modelsConfig`'s doc comment) — so every tier honestly
 *   reports the same subscription label (matching `runtimeModeAndLabel`'s
 *   own `"Subscription (<provider>)"` wording).
 * - a `tierBinding` override present (hybrid mode, Mode A only): resolves
 *   per-tier via the caller-supplied `AdapterSpec` map, exactly like
 *   `buildHybridTierBinding` does for the `answer_query` agent at run time.
 *   A tier this map doesn't cover (e.g. a different bundle component uses a
 *   tier name `answer_query` never uses, so the hybrid map was never
 *   required to cover it) is genuinely unresolvable from the real binding —
 *   falls back to the Setup-configured value, visibly labeled as such.
 * - otherwise (uniform, Mode A's default path): derives ONE `AdapterSpec` via
 *   `deriveAdapterSpec(authChoice, model)` — the exact call `runModeADefault`
 *   itself makes — which realizes every tier alike. If that derivation
 *   itself throws (e.g. `gateway` mode missing `baseURL`/`model`), the same
 *   failure would occur at turn-execution time too; report every tier via
 *   the configured fallback rather than 500ing `GET /api/harness`.
 */
function buildRealTierResolver(baseRouteOptions: BaseRouteOptions, store: Store): RealTierResolver {
  const { authChoice } = baseRouteOptions;

  if (authChoice.mode === "subscription") {
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
 * meaningful auth-strategy name — rather than the internal `modeA`/`modeB`
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
 * Mirrors `route()`'s OWN back-end predicate (`harness/route/route.ts`,
 * `if (authChoice.mode === "subscription")`) verbatim — a `subscription`
 * `authChoice` is the one and only condition under which `route()` sends the
 * turn to Mode B (`runModeBDefault`, which shells the warble `claude-agent-sdk`
 * dispatcher CLI); every other mode goes to Mode A (`runModeADefault`, fully
 * in-process, no dispatcher subprocess at all). This is deliberately the same
 * condition as `runtimeBackendAndLabel`'s `"subscription"` case rather than an
 * independently-maintained copy of the auth-mode list, so the two can never
 * drift apart.
 */
function runtimeDispatcher(authChoice: RouteOptions["authChoice"]): HarnessRuntimeDispatcher {
  return authChoice.mode === "subscription" ? "claude-agent-sdk" : "in-process";
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
// Setup-editable store) — mirrors what `runModeADefault` would actually bind for this agent's
// steps. NOTE: only `answer_query` is ever actually executed by the runtime (see this file's
// module doc comment); every component's tiers/model are the real binding "as if" that
// component ran, for introspection purposes.
function buildComponent(agent: Agent, resolver: RealTierResolver): HarnessComponent {
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
    status: "ready",
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

function buildProfile(bundle: Bundle, baseRouteOptions: BaseRouteOptions, store: Store): HarnessProfile {
  const verifyGate = bundle.agents.some((agent) => findLockedGatedCheck(agent) !== undefined);
  return {
    id: bundle.profile,
    name: humanize(bundle.profile),
    boundContext: path.basename(baseRouteOptions.userProject),
    verifyGate,
    bundleId: `${bundle.profile}@${bundle.target}`,
    bundleVersion: bundleFormatVersion(bundle),
    irVersion: deriveIrVersion(bundle.compat),
    dispatchTarget: bundle.target,
    bundleHash: computeBundleHash(bundle),
    status: deriveProfileStatus(store),
  };
}

function collectBundleTierNames(bundle: Bundle): string[] {
  const seen = new Set<string>();
  for (const agent of bundle.agents) {
    for (const step of agent.steps) seen.add(step.tier);
  }
  return [...seen];
}

function buildRuntime(bundle: Bundle, baseRouteOptions: BaseRouteOptions, store: Store): HarnessRuntime {
  const { backend, label } = runtimeBackendAndLabel(baseRouteOptions.authChoice);
  const dispatcher = runtimeDispatcher(baseRouteOptions.authChoice);
  const tierModels: TierModelBinding[] = collectBundleTierNames(bundle).map((tier) => ({ tier, model: storeTierModel(tier, store) }));
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
function buildConnection(baseRouteOptions: BaseRouteOptions, store: Store): HarnessConnection {
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

export function buildHarnessDto(bundle: Bundle, store: Store, baseRouteOptions: BaseRouteOptions): HarnessDto {
  const resolver = buildRealTierResolver(baseRouteOptions, store);
  return {
    profile: buildProfile(bundle, baseRouteOptions, store),
    runtime: buildRuntime(bundle, baseRouteOptions, store),
    connection: buildConnection(baseRouteOptions, store),
    components: bundle.agents.map((agent) => buildComponent(agent, resolver)),
  };
}
