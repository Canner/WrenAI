/**
 * Harness page domain types — a read-only status view over how the CURRENT
 * agent profile is realized: the compiled bundle's declared components (the
 * bundle's own `agents[]` — never called "sub-agents": that vocabulary is
 * reserved for the profile level, see `AgentProfileRow`), each component's
 * capability resolution / guardrails / step→artifact dataflow, the
 * runtime/back-end tier bindings, and the connection status. See
 * `src/harness/fixtures.ts` for sample data.
 */

/** How a declared capability is realized: built into the runtime, or delegated. */
export type CapabilityOutcome = 'native' | 'realize-via';

export interface Capability {
  capability: string;
  outcome: CapabilityOutcome;
  /** What actually backs the capability (e.g. `"runtime"`). */
  providedBy: string;
  criticality?: string;
}

export interface Guardrail {
  name: string;
  enforcement: string;
  locked: boolean;
  /** Present only when the guardrail carries a numeric limit, e.g. `row_limit` = 1000. */
  threshold?: number;
}

export interface Step {
  name: string;
  tier: string;
  consumes: string[];
  produces: string;
  /** `"independent"` or `"repair_fold"`. */
  realization: string;
  /** Present only when the step is conditionally gated, e.g. `"on_failure"`. */
  guard?: string;
  /** Present only for `"repair_fold"` steps. */
  foldInto?: string;
  /** Present only for `"repair_fold"` steps. */
  maxAttempts?: number;
}

export interface TierModelBinding {
  tier: string;
  model: string;
}

/**
 * A bundle-declared agent, shown on the frontend as a **Component** — not a
 * "sub-agent": that framing is reserved for the profile level (see
 * `AgentProfileRow`). This harness's runtime only ever executes one agent per
 * turn; every other component is a read-only declared part of the compiled
 * bundle, not a concurrently-running sub-agent.
 */
export interface Component {
  id: string;
  name: string;
  componentType: string;
  /** `"skill"`. */
  realizationKind: string;
  /**
   * Derived display label: `realizationKind` alone, plus `"· split"` when the
   * component's steps span more than one distinct tier
   * (`new Set(steps.map(s => s.tier)).size > 1`), plus `"· scheduled"` when
   * `trigger === "scheduled"` (e.g. `"tool · scheduled"`). See
   * `realization.ts`'s `deriveRealizationLabel` — the single source of this
   * derivation, shared by the live BFF mapping and the fixtures so they can't
   * drift.
   */
  realizationLabel: string;
  trigger: string;
  outcome: string;
  callableAs: string;
  model: string;
  tiers: TierModelBinding[];
  capabilities: Capability[];
  guardrails: Guardrail[];
  tools: { name: string; source: string }[];
  outputBlocks: string[];
  steps: Step[];
  status: string;
  unavailableReason?: string;
  /**
   * Present only when this component is unavailable on the compiled dispatch
   * target but the currently-selected purpose's native session can still run
   * it — `status` is `"ready"` in this case, qualified by `viaLabel`. The
   * programmatic limitation lives here (for the expanded row) instead of
   * being promoted into `unavailableReason`.
   */
  nativeAvailability?: {
    viaLabel: 'Claude CLI' | 'Codex CLI';
    compiledDispatchTarget: string;
    compiledUnavailableReason: string;
  };
}

export interface ProfileInfo {
  id: string;
  name: string;
  boundContext: string;
  verifyGate: boolean;
  bundleId: string;
  bundleVersion: string;
  /** e.g. `"0.3"` or `"0.3–0.4"`. */
  irVersion: string;
  /**
   * Whichever back-end actually runs a turn: `"claude-agent-sdk:local"` when
   * the runtime is the claude-agent-sdk dispatcher (subscription auth), or
   * `"vercel:headless"` for the in-process vercel back-end (api-key/local/
   * gateway auth) — always agrees with `runtime.dispatcher`, never a fixed
   * value.
   */
  dispatchTarget: string;
  /** First 7 hex chars of a deterministic content hash — never a "last compiled" timestamp. */
  bundleHash: string;
  status: string;
}

/**
 * Auth/runtime back-end is intentionally modeled as an opaque enum — the UI
 * never needs to know more than the human `label` and the tier→model
 * bindings that back-end produces.
 */
export type RuntimeBackendKind = 'subscription' | 'api-key' | 'local' | 'gateway';

/**
 * The dispatcher that actually executes this profile's turns — orthogonal to
 * the auth back-end above: `backend` says how calls are authenticated, this
 * says which execution engine runs them (e.g. the claude-subscription
 * back-end runs via the Claude Agent SDK dispatcher). Optional so an older
 * BFF that hasn't shipped this field yet degrades gracefully — the UI simply
 * omits the line rather than crashing.
 */
export type RuntimeDispatcherKind = 'claude-agent-sdk' | 'codex-local' | 'in-process';

export interface RuntimeInfo {
  backend: RuntimeBackendKind;
  label: string;
  tierModels: TierModelBinding[];
  dispatcher?: RuntimeDispatcherKind;
}

export type ConnectionHealth = 'healthy' | 'degraded' | 'down';

/**
 * The "Data source · connection" panel. In live mode `type`/`location` come
 * from the bound project's real `conn.yml` (the BFF's `HarnessConnection` —
 * see `server/wire-types.ts` in the harness): `type` is the real datasource
 * (e.g. `"duckdb"`, `"postgres"`, `"bigquery"`), `location` is its real,
 * non-secret connection location (a duckdb/local-file path, or an
 * allowlisted host/database-shaped string for DB-type sources — the BFF
 * never forwards credentials). Both fall back to an honest `"—"` when
 * there's nothing to read, rather than a fabricated generic label.
 */
export interface ConnectionStatus {
  type: string;
  location: string;
  /** Generic execution path label (e.g. "query engine") — never private infra. Honest `"—"` when there's no real value (the current live BFF has none). */
  via: string;
  tablesSynced: number;
  lastSync: string;
  health: ConnectionHealth;
}

/**
 * One row of the "Agent profiles" table — profile-level vocabulary
 * (`orchestrator` / `sub-agent`) lives here, never on `Component`. Live mode
 * only ever has one bound profile (the orchestrator row); Phase-3 spawnable
 * sub-agent profiles render as greyed placeholder rows (`callableAs`
 * omitted, `status` an honest "planned" label).
 */
export interface AgentProfileRow {
  name: string;
  role: 'orchestrator' | 'sub-agent';
  tierModel: string;
  capabilities: Capability[];
  callableAs?: string;
  status: string;
}

export type HarnessPurpose = 'setup' | 'analysis' | 'context_enrichment';

/** Server-derived active execution metadata for the profile currently rendered. */
interface HarnessPurposeInfoBase {
  purpose: HarnessPurpose;
  profile: 'genbi-setup' | 'genbi-default' | 'genbi-enrich-context';
  scopeKind: 'bootstrap' | 'bound_project';
  available: boolean;
  reason?: string;
}

export type HarnessPurposeInfo = HarnessPurposeInfoBase & (
  | {
      executionKind: 'setup_runner';
      target: 'claude-agent-sdk:setup' | 'codex-local:setup' | 'in-process:setup';
      targetLabel: 'Claude Setup runner' | 'Codex Setup runner' | 'In-process Setup runner';
    }
  | {
      executionKind: 'native_session';
      target?: 'claude-code:interactive' | 'codex:interactive';
      targetLabel?: 'Claude CLI' | 'Codex CLI';
    }
);

/** Everything the Harness overview page renders, for one server-owned purpose profile. */
export interface HarnessView {
  purpose: HarnessPurposeInfo;
  profile: ProfileInfo;
  runtime: RuntimeInfo;
  connection: ConnectionStatus;
  components: Component[];
  agentProfiles: AgentProfileRow[];
  nativeSessions: {
    binding: { configured: boolean; generation: number; targetLabel?: string };
    dispatches: Array<{ purpose: string; profile: string; scopeKind: string; targetLabel?: string; available: boolean; reason?: string }>;
  };
}
