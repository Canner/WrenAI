/**
 * The BFF's UI-facing wire contract.
 *
 * These types are the UI's frozen consumer contract, reproduced verbatim
 * (exact field names/casing) from the `WrenAI-genbi` frontend's expected
 * shapes. They are deliberately NOT imported from that repo — this harness
 * repo must not read or depend on it — so this file is the single source of
 * truth for what the BFF serializes onto the wire. Keep it byte-for-byte in
 * sync with the frontend if the UI contract ever changes; do not "improve" the
 * shapes here independently of that source.
 *
 * The one exception is `RenderEnvelope`: that type is owned by this harness
 * (`harness/render/index.ts`) and is imported directly rather than redefined.
 */
import type { RenderEnvelope } from "../harness/render/index.js";
import type { ArtifactContentDto, ArtifactContentUnavailableReason } from "../harness/route/index.js";

export type { RenderEnvelope };
export type { ArtifactContentDto, ArtifactContentUnavailableReason };

// ---------------------------------------------------------------------------
// Ask page: work log + session events
// ---------------------------------------------------------------------------

export type SessionEventKind = "user" | "clarify" | "answer" | "refusal" | "artifact" | "published" | "saved" | "setup_status";

/**
 * A BFF-owned, bounded inspection record for a Setup work-log row. Unlike
 * `input` and `detail`, this is safe to persist and return from Setup
 * recovery: it contains only an allowlisted command/action summary, output
 * or an actionable error, and an optional elapsed duration.
 */
export interface ToolStepInspection {
  readonly action?: string;
  readonly output?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface ToolStep {
  readonly id: string;
  readonly label: string;
  readonly state: "running" | "done" | "error";
  /**
   * `"tool"` — a tool call. `"subagent"` — a nested sub-agent/Task turn
   * (subscription dispatchers only; the in-process path has no such mechanism). `"step"` — one of
   * Mode A's own bundle-declared LLM steps (`step.start`/`step.finish`), i.e.
   * the agent's own reasoning/output for that step, distinct from any tool
   * calls it happened to make along the way. `"decision"` — a
   * deterministic control-flow decision the BFF made for the turn (intent
   * routing, clarify, verify-gate verdict), display-only; it is not produced
   * by the agent runtime and carries no tool/step of its own.
   */
  readonly kind: "tool" | "subagent" | "step" | "decision";
  readonly parent?: string;
  readonly depth?: number;
  /** The tool call's input (e.g. the `query` tool's `{sql}`), so the UI can expand a step to show what it ran. */
  readonly input?: unknown;
  /** A compact, bounded summary — success result summary, or the error message on a failed step. Never full result rows. */
  readonly detail?: string;
  /** Server-owned safe projection used by Setup work logs; never raw tool input or detail. */
  readonly inspection?: ToolStepInspection;
}

export interface UserEvent {
  readonly id: string;
  readonly kind: "user";
  readonly text: string;
}

/** BFF-produced (see `server/clarify.ts`'s D1 heuristic) — never comes from the agent runtime. */
export interface ClarifyEvent {
  readonly id: string;
  readonly kind: "clarify";
  readonly prompt: string;
  readonly chips: readonly string[];
}

export interface TextAnswerPayload {
  readonly form: "text";
  readonly text: string;
  readonly verified: boolean;
  /**
   * Whether this turn attempted a data task (ran a query or assembled a
   * dashboard), including one that failed or was refused — as opposed to a
   * pure conversational/capability reply that made no data claim at all.
   * The UI shows the Verified/Unverified badge only when this is `true`;
   * a conversational answer (`false`) hides the badge entirely rather than
   * showing a misleading "Unverified".
   */
  readonly dataAnswer: boolean;
}

export interface RichAnswerPayload {
  readonly form: "rich";
  readonly envelope: RenderEnvelope;
}

export interface AnswerEvent {
  readonly id: string;
  readonly kind: "answer";
  readonly answer: TextAnswerPayload | RichAnswerPayload;
}

/** `fix` is BFF-synthesized — the agent runtime's `RefusalResult` carries no remediation text. */
export interface RefusalEvent {
  readonly id: string;
  readonly kind: "refusal";
  readonly reason: string;
  readonly fix: string;
}

export type ArtifactKind = "dashboard" | "report" | "chart";

export interface ArtifactEvent {
  /** Generic stream event id (`evt-*`) — used by the UI for React keys/dedup. Not the artifact row id. */
  readonly id: string;
  readonly kind: "artifact";
  readonly name: string;
  readonly artifactKind: ArtifactKind;
  readonly location: string;
  /** The persisted artifact row id (`artifact-*`, from `store.createArtifact`) — pass this to the publish route. */
  readonly artifactId: string;
}

export type PublishScope = "workspace" | "link" | "public";

export interface PublishedEvent {
  readonly id: string;
  readonly kind: "published";
  readonly artifactName: string;
  readonly link: string;
  readonly scope: PublishScope;
}

/**
 * A distinct, persisted event marking that an artifact was saved
 * to the Artifacts page. Deliberately NOT a field on `ArtifactEvent` itself:
 * session events are replayed verbatim from storage (see
 * `getAskSessionData`), so "is this saved" must be recomputed by the UI
 * scanning for this event rather than baked into the artifact event's own
 * stored payload — that's what makes the saved state correct after a
 * reload/replay with zero extra bookkeeping.
 *
 * Keyed on `artifactId` (the persisted artifact row id), NOT `artifactName`:
 * two artifacts in the same session can share a name (e.g. re-running the
 * same prompt twice), and matching on name alone would mark the *other*,
 * never-saved artifact as saved too — with no way left to save it from the
 * UI. `artifactName` is kept for display only. (`PublishedEvent` has this
 * same name-keyed flaw; it's intentionally left as-is since the publish UI
 * is hidden behind `PUBLISH_UI_ENABLED` and tracked separately.)
 */
export interface SavedEvent {
  readonly id: string;
  readonly kind: "saved";
  readonly artifactId: string;
  readonly artifactName: string;
  readonly savedAt: string;
}

/**
 * The mirror of `SavedEvent`: marks that a previously-saved
 * artifact was un-saved ("unpinned") from the Artifacts page. Appended
 * instead of deleting the earlier `SavedEvent`: the session's event log is a
 * persisted, replayed history (see `getAskSessionData`), and deleting a
 * stored event would corrupt that replay. "Is this artifact currently saved"
 * is instead recomputed by scanning for whichever `SavedEvent`/`UnsavedEvent`
 * for this `artifactId` is most recent (latest-wins) — see the frontend's
 * `isArtifactSaved`. Keyed on `artifactId`, not `artifactName`, for the same
 * reason as `SavedEvent`.
 */
export interface UnsavedEvent {
  readonly id: string;
  readonly kind: "unsaved";
  readonly artifactId: string;
  readonly artifactName: string;
  readonly unsavedAt: string;
}

/**
 * One resumable choice a setup turn is blocked on (`SetupStatusEvent.decision`
 * or `SetupAdoptResponse.decision`, status `"needs_decision"`) — e.g. an
 * `error_max_turns` checkpoint (continue vs stop), a same-name project
 * conflict (rename/clean/cancel), an unbuilt-context confirmation
 * (`build_context`: build/cancel), or an unpinned-project profile choice
 * (`select_profile`: one option per candidate profile). `kind` distinguishes
 * which checkpoint this is. Every kind except `select_profile` resolves via
 * `POST /api/setup/decision`, which carries the `id` of the chosen `options`
 * entry back; `select_profile` is stateless and instead resolves by
 * re-POSTing `/api/setup/adopt` with the chosen option's `id` as `profile`
 * (see `SetupAdoptResponse`'s doc comment). Kept minimal/generic (a bare
 * string `kind`, not a closed union) so adding a future checkpoint kind never
 * requires touching this wire type again.
 */
export interface SetupDecision {
  readonly kind: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly detail?: string;
}

/**
 * `POST /api/setup/adopt`'s request body — the one required input is an
 * absolute path to an existing wren project directory (has its own
 * `wren_project.yml`; may or may not have a pinned `profile:` yet, and may or
 * may not have a built `target/mdl.json` yet). Unlike the create flow's
 * `projectName`, this is a full path, not a single safe path segment under a
 * configured workspace root — adopt points at a project that can live
 * anywhere on disk.
 *
 * `profile` is optional and only ever sent on a *second* call: when the
 * first call comes back `needs_decision` with `decision.kind ===
 * "select_profile"`, the caller re-POSTs the same `projectPath` plus the
 * chosen candidate's `name` as `profile`. That re-POST runs
 * `wren context set-profile <profile>` to write a durable pin before
 * re-verifying — see `server/adopt.ts`'s module doc comment for the full
 * three-state flow this drives.
 */
export interface SetupAdoptRequest {
  readonly projectPath: string;
  readonly profile?: string;
}

/**
 * `POST /api/setup/adopt`'s synchronous response — verification (path
 * validity, profile pin/resolution, live connection smoke test) runs inline,
 * no SSE turn involved, so the outcome comes back as a plain JSON body
 * rather than a streamed `SetupStatusEvent`. The three outcomes mirror
 * `SetupStatusEvent.status` on purpose (same three-way shape the frontend
 * already knows how to render), just delivered synchronously:
 *
 *  - `"ok"`: the project verified AND already has a built context — bound
 *    immediately, wizard lands on "bind".
 *  - `"needs_decision"`: the project verified but needs one more round-trip
 *    before it can bind. Two distinct checkpoints share this status, told
 *    apart by `decision.kind`:
 *     - `"build_context"` (options `"build"` | `"cancel"`) — connection
 *       verified, no built context yet. Resolve via the existing
 *       `POST /api/setup/decision` endpoint; choosing "build" dispatches the
 *       same `build_context` agentic turn the create flow's context step
 *       uses (open its `{turnId}` on
 *       `GET /api/sessions/:id/stream?turn=<turnId>` exactly like a
 *       context-step turn), and binds the project once that turn's
 *       `SETUP_STATUS: ok` verifies `target/mdl.json`. Choosing "cancel"
 *       just drops the pending decision — nothing was bound, so there's
 *       nothing to undo. Returned with HTTP 200.
 *     - `"select_profile"` (one option per candidate profile, `id`/`label`
 *       both the profile name) — the project has no `profile:` pin, but one
 *       or more profiles in `~/.wren/profiles.yml` share its `data_source`.
 *       Each candidate is `{name, datasource}` only — never any other
 *       profile field (host/port/credentials never cross the wire). Resolve
 *       by re-POSTing `/api/setup/adopt` with `profile` set to the chosen
 *       candidate's name (NOT via `/api/setup/decision` — that endpoint's
 *       session/pending-decision bookkeeping doesn't apply here, this
 *       checkpoint is stateless). Returned with **HTTP 409**, not 200 — see
 *       below.
 *  - `"error"`: verification failed (bad path, no `wren_project.yml`,
 *    unsupported connector, no compatible profile found for an unpinned
 *    project, or a failed live smoke query) — nothing was bound. `message`
 *    names which check failed.
 *
 * HTTP status: `"ok"` and `"needs_decision"` with `decision.kind ===
 * "build_context"` both return 200 (a well-formed request that produced a
 * definite, structured result needing no retry of the *same* request).
 * `"needs_decision"` with `decision.kind === "select_profile"` returns
 * **409 Conflict** instead, since the caller must re-issue a *different*
 * request (this same route, with `profile` now set) to proceed — the 409
 * signals "resubmit with more information," which plain 200 does not.
 * `"error"` also returns 200 (a well-formed request whose verification
 * failed is still a successful call to this endpoint); 400 is reserved for a
 * malformed request (missing/non-string `projectPath`).
 */
export interface SetupAdoptResponse {
  readonly sessionId?: string;
  readonly status: "ok" | "needs_decision" | "error";
  readonly message: string;
  readonly decision?: SetupDecision;
}

/**
 * Terminal event for a setup-wizard turn (agentic `connect`/`connect_resume`
 * dispatch — see `harness/setup/runner.ts`'s `parseSetupTerminal`). Distinct from
 * `AnswerEvent`: a setup turn's finalText is a scaffolding narration, not an
 * answer to show verbatim, and its outcome is one of four states the UI must
 * branch on (advance the wizard / prompt for `.env` completion / show an
 * error / resolve a checkpoint decision), not a yes/no verified answer.
 * `decision` is present iff `status === "needs_decision"`.
 */
export interface SetupStatusEvent {
  readonly id: string;
  readonly kind: "setup_status";
  readonly status: "ok" | "needs_input" | "error" | "needs_decision";
  readonly message: string;
  readonly decision?: SetupDecision;
}

export type SessionEvent =
  | UserEvent
  | ClarifyEvent
  | AnswerEvent
  | RefusalEvent
  | ArtifactEvent
  | PublishedEvent
  | SavedEvent
  | UnsavedEvent
  | SetupStatusEvent;

export interface AskSessionData {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly events: readonly SessionEvent[];
  readonly workLog: readonly ToolStep[];
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Context page
// ---------------------------------------------------------------------------

export type SemanticColumnKey = "pk" | "fk";

export interface SemanticColumn {
  readonly name: string;
  readonly type: string;
  readonly key?: SemanticColumnKey;
}

export interface SemanticModel {
  readonly key: string;
  readonly name: string;
  readonly columns: readonly SemanticColumn[];
  /** Optional: the BFF's live-project remap has no ER layout source and omits this — the UI must lay itself out when absent. Still populated by the seeded fixture path. */
  readonly position?: { readonly x: number; readonly y: number };
}

export type RelationshipType = "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

export interface SemanticRelationship {
  readonly key: string;
  readonly name: string;
  readonly fromModel: string;
  readonly toModel: string;
  readonly type: RelationshipType;
}

export type MeasureAdditivity = "additive" | "non-additive";

export interface SemanticMeasure {
  readonly key: string;
  readonly name: string;
  readonly baseModel: string;
  readonly expression: string;
  readonly additivity: MeasureAdditivity;
}

export interface KnowledgeStatus {
  readonly instructionsPresent: boolean;
  readonly verifiedPairCount: number;
}

export interface ContextOverview {
  readonly models: readonly SemanticModel[];
  readonly relationships: readonly SemanticRelationship[];
  readonly measures: readonly SemanticMeasure[];
  readonly knowledge: KnowledgeStatus;
  readonly projectName: string;
  /** The full bound project directory path (`resolveUserProject`), not just its basename — "" when unbound, same guard as `projectName`. */
  readonly projectPath: string;
}

export type ContextFileKind = "model" | "relationship" | "cube" | "knowledge" | "view";

export interface ContextFileNode {
  readonly key: string;
  readonly title: string;
  readonly children?: readonly ContextFileNode[];
  readonly kind?: ContextFileKind;
  readonly path?: string;
  readonly content?: string;
  readonly entityKey?: string;
}

export type ImpactSeverity = "none" | "compatibility" | "structural" | "semantic";
export type ImpactNodeKind = "model" | "measure" | "relationship" | "view";

export interface ImpactNode {
  readonly key: string;
  readonly name: string;
  readonly kind: ImpactNodeKind;
}

export interface BlastRadius {
  readonly seed: ImpactNode;
  readonly downstream: readonly ImpactNode[];
  readonly severity: ImpactSeverity;
}

export interface BrokenPair {
  readonly question: string;
  readonly refs: readonly string[];
  readonly hitDownstreamKeys: readonly string[];
}

export interface ImpactResponse {
  readonly blastRadius: BlastRadius;
  readonly brokenPairs: readonly BrokenPair[];
}

// ---------------------------------------------------------------------------
// Eval page
// ---------------------------------------------------------------------------

export interface EvalRun {
  readonly id: string;
  readonly when: string;
  readonly score: number;
  readonly gateThreshold: number;
  readonly gatePass: boolean;
  readonly regressions: number;
  readonly cost: string;
  readonly p50: string;
}

export interface ComponentScore {
  readonly component: string;
  readonly score: number;
  readonly delta: number;
}

// ---------------------------------------------------------------------------
// Setup page
// ---------------------------------------------------------------------------

/**
 * `"adopt"` stands in for `"connect"` in the step SEQUENCE (not alongside it)
 * once the wizard's mode is `"adopt"` — see `SetupMode`/`GET+POST
 * /api/setup/mode`: the adopt flow points at an existing project directory
 * (`POST /api/setup/adopt`) instead of scaffolding+crediting a new one, so it
 * has no need for a separate "connect" step. `POST /api/setup/mode` rewrites
 * `setup.steps` to swap the one entry for the other; the array is always
 * exactly one of {`"connect"`, `"adopt"`}, never both.
 */
export type StepKey = "runtime" | "connect" | "adopt" | "context" | "bind" | "ask";
export type StepState = "done" | "current" | "todo";

export interface SetupStep {
  readonly key: StepKey;
  readonly title: string;
  readonly state: StepState;
}

/** A safe, read-only snapshot of the most recent retryable setup failure. */
export interface SetupFailureRecovery {
  readonly attempt: "connect" | "connect_resume" | "context";
  readonly projectName: string;
  readonly sourceType: string;
  readonly error: string;
  readonly workLog: readonly ToolStep[];
}

/** Safe reload snapshot for a completed setup turn paused on user input. */
export interface SetupNeedsInputRecovery {
  readonly attempt: "connect" | "connect_resume" | "context";
  readonly projectName: string;
  readonly sourceType: string;
  readonly message: string;
  readonly workLog: readonly ToolStep[];
}

/** `GET /api/setup/recovery` intentionally exposes no SDK session anchor. */
export interface SetupRecoveryResponse {
  readonly failure?: SetupFailureRecovery;
  /** Latest public paused terminal; its `sessionId` is the BFF setup session, never an SDK id. */
  readonly needsInput?: SetupNeedsInputRecovery;
  /** Reload-safe public context decision; never includes a provider anchor. */
  readonly sessionId?: string;
  readonly decision?: SetupDecision;
}

/**
 * The setup wizard's two entry paths, chosen once at wizard start (`POST
 * /api/setup/mode`): `"create"` scaffolds a brand-new project (the
 * pre-existing connect -> context -> bind flow, unchanged); `"adopt"` points
 * the wizard at an existing wren project directory (`POST /api/setup/adopt`)
 * and — when that project already has a built `target/mdl.json` — skips
 * straight to bind, no context step needed. `GET /api/setup/mode` returns
 * `{ mode: undefined }` before the user has picked either, which the frontend
 * reads as "show the create-vs-adopt choice screen."
 */
export type SetupMode = "create" | "adopt";

/**
 * One field key discovered in the scaffolded project's `.env` template (see
 * `GET /api/setup/connect/env-fields`, `server/app.ts`) — never a value, only
 * the key name plus a secret/non-secret display hint so the frontend can
 * render a masked `Input.Password` for credential-shaped keys.
 */
export interface SetupEnvField {
  readonly key: string;
  readonly secret: boolean;
}

export type AuthMode = "subscription" | "byo" | "local";
export type Deployment = "personal" | "hosted";
export type SubscriptionProvider = "claude" | "codex";

/** One non-sensitive model suggestion reported by the signed-in subscription provider. */
export interface SubscriptionModelCatalogEntry {
  readonly model: string;
  readonly displayName: string;
  readonly description?: string;
  readonly isDefault?: boolean;
  readonly reasoningEfforts?: readonly {
    readonly value: string;
    readonly displayName: string;
    readonly description?: string;
  }[];
}

/** Sanitized result of provider-owned model discovery. */
export type SubscriptionModelCatalog =
  | {
      readonly version: 1;
      readonly status: "ready";
      readonly provider: SubscriptionProvider;
      readonly models: readonly SubscriptionModelCatalogEntry[];
    }
  | {
      readonly version: 1;
      readonly status: "unavailable";
      readonly provider: SubscriptionProvider;
      readonly code: "not_authenticated" | "runtime_unavailable" | "timeout" | "protocol_error";
      readonly retryable: boolean;
    };

/** A concrete adapter selectable for an individual compiled-bundle tier. */
export type RuntimeTierAdapter = "anthropic" | "openai-compatible" | "local";

/** Kept as the legacy/default-runtime spelling used by the BYO auth control. */
export type ApiKeyAdapter = "anthropic" | "openai-compatible";

/** NOTE: unrelated to the harness's own `AdapterSpec`/`tierBinding` — this is UI-facing config only. */
export interface TierModelBinding {
  readonly tier: string;
  /** Explicit override; when omitted, `RuntimeSettings.apiKeyModel` is the default. */
  readonly model?: string;
  /** Explicit override; when omitted, the runtime's selected/default adapter applies. */
  readonly adapter?: RuntimeTierAdapter;
  /** Required for openai-compatible/local overrides; never contains credentials. */
  readonly baseURL?: string;
}

export interface RuntimeSettings {
  readonly authMode: AuthMode;
  /** Which personal subscription CLI is used when `authMode` is `"subscription"`. */
  readonly subscriptionProvider?: SubscriptionProvider;
  readonly tierModels: readonly TierModelBinding[];
  readonly hybrid: boolean;
  readonly deployment: Deployment;
  /** Which api-key adapter `"byo"` dispatches through. Non-secret — never the key itself. */
  readonly apiKeyAdapter?: ApiKeyAdapter;
  /** Model name override for the api-key adapter. Non-secret. */
  readonly apiKeyModel?: string;
  /** Base URL override, `openai-compatible` only. Non-secret. */
  readonly apiKeyBaseURL?: string;
  /**
   * Model for the subscription dispatcher itself. This is deliberately NOT a
   * profile tier: compiled bundles own their step tiers, while subscription
   * dispatchers need a separate driver model.
   */
  readonly subscriptionDriverModel?: string;
}

/** Login availability only. No credential contents or metadata cross this boundary. */
export interface SubscriptionLoginStatus {
  readonly claude: boolean;
  readonly codex: boolean;
}

/** `PUT /api/config/runtime`'s response — the persisted settings plus any compliance warnings (e.g. the subscription ToS notice) surfaced for this save. `GET /api/config/runtime` stays a plain `RuntimeSettings` — warnings are a save-time concern only. */
export interface NativeRuntimeBindingDto {
  readonly configured: boolean;
  readonly generation: number;
  readonly provider?: SubscriptionProvider;
  readonly target?: "claude-code:interactive" | "codex:interactive";
  readonly targetLabel?: "Claude CLI" | "Codex CLI";
}

export type RuntimeSettingsPutResponse = RuntimeSettings & { readonly warnings: readonly string[]; readonly nativeSessionBinding: NativeRuntimeBindingDto };

/** Read-only health of the saved Runtime, for correcting legacy settings before dispatch. */
export type RuntimeSettingsReadiness = { readonly valid: true } | { readonly valid: false; readonly correction: string };

/**
 * Whether each api-key adapter's required credential env var is present on the BFF process —
 * booleans only, never the key value/prefix/suffix/length. Powers the setup wizard's api-key
 * step so it can say "detected"/"missing" without ever handling the secret itself. See `GET
 * /api/config/env-detect` (`server/app.ts`) and `detectAdapterEnv` (`server/env-detect.ts`).
 */
export interface AdapterEnvStatus {
  readonly anthropic: boolean;
  readonly openaiCompatible: boolean;
}

// ---------------------------------------------------------------------------
// Artifacts page
// ---------------------------------------------------------------------------

export interface PublishedInfo {
  readonly link: string;
  readonly scope: PublishScope;
}

export interface ArtifactDto {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly artifactKind: ArtifactKind;
  readonly location: string;
  readonly verified: boolean;
  readonly createdAt: string;
  readonly published?: PublishedInfo;
  /** Present only once the artifact has been saved to the Artifacts page. */
  readonly savedAt?: string;
  /** Native provenance is safe routing metadata; credentials and binding identity never cross this DTO. */
  readonly nativeSessionId?: string;
}

// ---------------------------------------------------------------------------
// Harness introspection (GET /api/harness) — read-only view of how the
// CURRENTLY compiled profile is realized: identity, runtime tier bindings,
// connection status, and each compiled agent's tiers/capabilities/guardrails.
// ---------------------------------------------------------------------------

export interface HarnessProfile {
  readonly id: string;
  readonly name: string;
  readonly boundContext: string;
  readonly verifyGate: boolean;
  readonly bundleId: string;
  readonly bundleVersion: string;
  /**
   * The bundle's declared IR compatibility range (`bundle.compat`) — e.g.
   * `"0.3"` when `min_ir_version === max_ir_version`, or `"0.3–0.4"` when the
   * bundle spans a range. See `buildProfile` in `server/harness.ts`.
   */
  readonly irVersion: string;
  /** `bundle.target` — the compiled dispatch target, e.g. `"vercel:headless"`. */
  readonly dispatchTarget: string;
  /**
   * A short (first 7 hex chars), deterministic sha256 content hash of the
   * compiled bundle (canonical, sorted-key JSON stringify — see
   * `computeBundleHash` in `server/harness.ts`). NOT a "last compiled"
   * timestamp; the store tracks no such thing.
   */
  readonly bundleHash: string;
  /**
   * Derived from real state (the Setup wizard's "bind" step), not a
   * hardcoded literal — see `deriveProfileStatus` in `server/harness.ts`.
   * `"Bound"` once the user has completed Setup's Compile & Bind step;
   * an honest alternative (e.g. `"Not bound yet"`) otherwise.
   */
  readonly status: string;
}

/**
 * Which auth strategy is actually configured — mirrors
 * `AuthChoice["mode"]` (`harness/auth/index.ts`) verbatim. Deliberately NOT the
 * internal `modeA`/`modeB` framework-dispatch bucketing (that terminology
 * must never reach the wire); see `runtimeBackendAndLabel` in
 * `server/harness.ts`.
 */
export type HarnessRuntimeBackend = "subscription" | "api-key" | "local" | "gateway";

/**
 * Which provider-specific back-end owns this configuration. Claude and
 * Codex subscriptions use their respective local dispatchers; api-key,
 * local, and gateway modes run in-process. Codex Ask can still be disabled
 * independently, which is surfaced on component status.
 */
export type HarnessRuntimeDispatcher = "claude-agent-sdk" | "codex-local" | "in-process";

export interface HarnessRuntime {
  readonly backend: HarnessRuntimeBackend;
  readonly label: string;
  /** See `HarnessRuntimeDispatcher`'s doc comment. */
  readonly dispatcher: HarnessRuntimeDispatcher;
  /**
   * The SAME source `GET /api/config/runtime` reports
   * (`store.getRuntimeSettings().tierModels`), filtered to the tiers this
   * bundle actually declares — so the two endpoints always agree on what
   * model backs each tier. Previously this derived the tier -> model
   * binding `route()` would really apply (see `server/harness.ts` git
   * history), but under a `subscription` auth choice that real binding is
   * genuinely unobservable from this harness (the `warble-agent-sdk`
   * dispatcher owns model routing internally), which surfaced the same
   * auth label for every tier instead of a real model name. Reusing the
   * store's settings directly fixes that and keeps this DTO consistent with
   * `RuntimeSettings.tierModels`. Each component's own `model`/`tiers`
   * (`HarnessComponent`) are unaffected — those still report the real
   * per-component binding, see `buildComponent`.
   */
  readonly tierModels: readonly TierModelBinding[];
}

export type ConnectionHealth = "healthy" | "degraded" | "down";

/**
 * The Harness page's "Data source · connection" panel — see `buildConnection`
 * in `server/harness.ts`. `type`/`location` are resolved by
 * `server/conn-config.ts`'s `resolveConnectionSource`, in order:
 * the onboarding-only `conn.yml` first, if it happens to exist and carries a
 * `datasource`; otherwise the project's persistent `wren_project.yml` —
 * `data_source:` (always present) is `type`, and its pinned `profile:`, if
 * any, is resolved against `~/.wren/profiles.yml` to supply the fields
 * `describeConnection` turns into `location` (a duckdb path, or an
 * allowlisted host/database-shaped string for DB-type sources — never a
 * credential). A project with no profile pin honestly reports `type` with
 * `location` `"—"` rather than fabricating one from the profiles store's
 * global `active` profile. `via`/`lastSync` stay honest `"—"` placeholders —
 * there is no real "which mechanism"/"last synced at" signal available from
 * this harness. `tablesSynced` is real (`store.getContextModels().length`).
 */
export interface HarnessConnection {
  readonly type: string;
  readonly location: string;
  readonly via: string;
  readonly tablesSynced: number;
  readonly lastSync: string;
  readonly health: ConnectionHealth;
}

export type CapabilityOutcome = "native" | "realize-via";

export interface HarnessCapability {
  readonly capability: string;
  readonly outcome: CapabilityOutcome;
  readonly providedBy: string;
  readonly criticality?: string;
}

export interface HarnessGuardrail {
  readonly name: string;
  readonly enforcement: string;
  readonly locked: boolean;
  /** Present only when the guardrail carries a numeric limit, e.g. `row_limit` = 1000, `statement_timeout` = 30. */
  readonly threshold?: number;
}

/**
 * One step of a component's declared step→artifact dataflow (`agent.steps[]`
 * in the compiled bundle) — read-only introspection of the wiring the
 * executor itself keys on (`consumes` is a hard precondition), not something
 * this DTO executes.
 */
export interface HarnessStep {
  readonly name: string;
  readonly tier: string;
  readonly consumes: readonly string[];
  readonly produces: string;
  /** `step.realization.kind` — `"independent"` or `"repair_fold"`. */
  readonly realization: string;
  /** `step.when?.guard`, e.g. `"on_failure"` — present only when the step is conditionally gated. */
  readonly guard?: string;
  /** `step.realization.fold_into` — present only for `"repair_fold"` steps. */
  readonly foldInto?: string;
  /** `step.realization.max_attempts` — present only for `"repair_fold"` steps. */
  readonly maxAttempts?: number;
}

/**
 * A bundle-declared agent ("component" in the DTO/bundle vocabulary), shown
 * on the frontend as a **Component** — not a "sub-agent": that framing is
 * reserved for the profile level. This harness's runtime routes exactly ONE
 * component per turn from the user's intent, so every other component listed
 * here is a read-only declared part of the compiled bundle, not a
 * concurrently-running sub-agent. `model`/`tiers` are the REAL tier binding
 * resolved as if this component were the one running (see `buildComponent`
 * in `server/harness.ts`), not the Setup page's seeded settings.
 */
export interface HarnessComponent {
  readonly id: string;
  readonly name: string;
  readonly componentType: string;
  /** `agent.realization_kind`, e.g. `"skill"`. */
  readonly realizationKind: string;
  /** `agent.trigger`, e.g. `"one_shot"`. */
  readonly trigger: string;
  /** `agent.outcome`, e.g. `"none"`. */
  readonly outcome: string;
  readonly callableAs: string;
  readonly model: string;
  readonly tiers: readonly TierModelBinding[];
  readonly capabilities: readonly HarnessCapability[];
  readonly guardrails: readonly HarnessGuardrail[];
  /** `agent.tools[]` — e.g. `{ name: "query", source: "mcp:sample/query" }`. */
  readonly tools: readonly { readonly name: string; readonly source: string }[];
  /**
   * The declared render-block `type` consts from `agent.output_schema`
   * (`blocks.items.anyOf[].properties.type.const`, or the single-item form
   * when there's no `anyOf`) — `[]` when the component declares no typed
   * output blocks. See `extractOutputBlocks` in `server/harness.ts`.
   */
  readonly outputBlocks: readonly string[];
  /** The component's declared step→artifact dataflow (`agent.steps[]`). */
  readonly steps: readonly HarnessStep[];
  readonly status: string;
  /** Stable display-only explanation; never exposes a target capability or execution plan. */
  readonly unavailableReason?: string;
  /**
   * Present only when this component is unavailable on the compiled dispatch
   * target (`agent.availability`) but the currently-selected purpose's native
   * session IS available — i.e. it actually runs, just not via the
   * programmatic path. `status` is `"ready"` in this case; the programmatic
   * limitation moves here instead of being promoted into `unavailableReason`.
   * Keyed off which `buildComponent` branch produced the status, never off
   * matching Warble's reason string.
   */
  readonly nativeAvailability?: {
    /** The native session's target label, e.g. `"Claude CLI"` — why this actually runs. */
    readonly viaLabel: "Claude CLI" | "Codex CLI";
    /** The compiled dispatch target that cannot run it, e.g. `"claude-agent-sdk:local"`. */
    readonly compiledDispatchTarget: string;
    /** `agent.availability.reason` — the original bundle-level explanation, preserved for the expanded row. */
    readonly compiledUnavailableReason: string;
  };
}

export interface HarnessDto {
  /** The single server-owned native purpose whose bundle is described below. */
  readonly purpose: HarnessPurpose;
  readonly profile: HarnessProfile;
  readonly runtime: HarnessRuntime;
  readonly connection: HarnessConnection;
  /** See `HarnessComponent`'s doc comment — bundle agents are shown as Components, not sub-agents. */
  readonly components: readonly HarnessComponent[];
  /** Closed native dispatch registry projected from the same runtime binding as launch. */
  readonly nativeSessions: {
    readonly binding: NativeRuntimeBindingDto;
    readonly dispatches: readonly {
      readonly purpose: "analysis" | "setup" | "context_enrichment";
      readonly profile: string;
      readonly scopeKind: "bootstrap" | "bound_project";
      readonly target?: "claude-code:interactive" | "codex:interactive";
      readonly targetLabel?: "Claude CLI" | "Codex CLI";
      readonly available: boolean;
      readonly reason?: string;
    }[];
  };
}

/**
 * A read-only projection of the selected purpose. Profile, scope, Runtime
 * target and readiness all come from the server's native dispatch registry;
 * no browser-provided launch/profile/target input is represented here.
 */
export interface HarnessPurpose {
  readonly purpose: "setup" | "analysis" | "context_enrichment";
  readonly profile: "genbi-setup" | "genbi-default" | "genbi-enrich-context";
  readonly scopeKind: "bootstrap" | "bound_project";
  readonly target?: "claude-code:interactive" | "codex:interactive";
  readonly targetLabel?: "Claude CLI" | "Codex CLI";
  readonly available: boolean;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// SSE wire framing (BFF -> UI). Matches the `StreamHandlers` contract:
// event: worklog | event | error | done
// ---------------------------------------------------------------------------

export type SseEventName = "worklog" | "event" | "error" | "done";

export type SseFrame =
  | { readonly event: "worklog"; readonly data: readonly ToolStep[] }
  | { readonly event: "event"; readonly data: SessionEvent }
  | { readonly event: "error"; readonly data: { readonly message: string } }
  | { readonly event: "done"; readonly data: Record<string, never> };
