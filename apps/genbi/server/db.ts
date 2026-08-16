/**
 * Single-file SQLite storage for the BFF, via Node's
 * built-in `node:sqlite` (experimental as of Node 23; no flag required). One
 * `Store` per process; pass `":memory:"` in tests, a real file path in
 * `server/bin.ts`.
 *
 * The schema has two small additive columns beyond the original design, each
 * added for a concrete reason (see inline comments on `events.turn_id` and
 * `turns.error_message` below); every other table and column is exactly as
 * originally specified.
 *
 * `node:sqlite`'s `SQLInputValue` has no native boolean — every boolean
 * column (`artifacts.verified`, `eval_runs.gate_pass`) is stored as `0`/`1`
 * and converted back on read (`intToBool`/`boolToInt`).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  ArtifactKind,
  BlastRadius,
  ComponentScore,
  ContextFileNode,
  EvalRun,
  KnowledgeStatus,
  PublishScope,
  RuntimeSettings,
  SemanticMeasure,
  SemanticModel,
  SemanticRelationship,
  SessionEvent,
  SetupMode,
  SetupStep,
  SetupStatusEvent,
} from "./wire-types.js";
import { hashEnrichmentOperation, normalizeEnrichmentConfidence } from "./enrichment.js";
import type { EnrichmentApprovalAttestation, EnrichmentBinding, EnrichmentMode, EnrichmentOperation, EnrichmentOperationState, EnrichmentRisk, EnrichmentRunStatus, ProjectIdentity, UnversionedEnrichmentBinding } from "./enrichment.js";
import { resolveNativeRuntimeBinding } from "./native-dispatch-registry.js";
import type { NativeRuntimeBinding } from "./native-dispatch-registry.js";

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export type SessionStatus = "active" | "awaiting_clarify" | "streaming" | "awaiting_decision";
export type TurnResultKind = "clarify" | "answer" | "refusal" | "error";
export type SetupContextLifecyclePrefix = "none" | "discovery" | "validate" | "build";

/**
 * Opaque, non-secret evidence retained only while a context step is being
 * corrected. `identityFingerprint` binds it to the canonical project and its
 * selected/profile source declaration; no project path or credentials are
 * persisted here.
 */
export interface SetupContextLifecycleEvidence {
  readonly sessionId: string;
  readonly identityFingerprint: string;
  readonly completed: SetupContextLifecyclePrefix;
}

/** Deliberately separate from Ask's `sessions` table and wire contract. */
export type NativeSessionStatus = "creating" | "running" | "detached" | "exited" | "stopped" | "interrupted" | "failed" | "stale";
export type NativeSessionPurpose = "analysis" | "setup" | "context_enrichment";
export type NativeSessionVendor = "claude" | "codex";
export type NativeSessionScopeKind = "bootstrap" | "bound_project";
export type NativeSetupRecoveryPhase = "connect" | "context";
export type NativeSetupRecoveryState = "working" | "needs_input" | "needs_decision" | "retryable_failure" | "reported_complete";
export type NativeSetupRecoveryCode = "in_progress" | "user_action_required" | "continue_or_stop" | "retryable" | "completion_reported";

export interface NativeSessionRow {
  readonly id: string;
  readonly purpose: NativeSessionPurpose;
  readonly vendor: NativeSessionVendor;
  readonly agent: string;
  readonly scopeKind: NativeSessionScopeKind;
  readonly scopeId: string;
  readonly projectIdentity: string | null;
  readonly bindingGeneration: number | null;
  readonly projectRevision: string | null;
  readonly dispatchProfile: string | null;
  readonly dispatchTarget: string | null;
  readonly runtimeGeneration: number | null;
  readonly status: NativeSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly failure: string | null;
}

/**
 * Opaque, sealed provider continuation material. The handle is never joined
 * into a browser-facing native-session row.
 */
export interface NativeSessionResumeHandle {
  readonly sessionId: string;
  readonly provider: NativeSessionVendor;
  readonly sealedHandle: string;
  readonly consumedAt: string | null;
}

/** Durable idempotency fence for a provider continuation attempt. */
export interface NativeSessionResumeAction {
  readonly sourceSessionId: string;
  readonly idempotencyKey: string;
  readonly scopeFingerprint: string;
  readonly resumedSessionId: string;
}

/**
 * Session-scoped, typed answer material retained for native follow-up tools.
 * `envelopeJson` is limited by the native-artifact contract to table and
 * definition blocks; it deliberately never contains terminal bytes or a
 * driver/subagent transcript.
 */
export interface NativeStructuredAnswerRow {
  readonly id: string;
  readonly nativeSessionId: string;
  /** Caller retry authority only; canonical answer provenance is host-minted. */
  readonly idempotencyKey: string;
  readonly envelopeJson: string;
  readonly digest: string;
  readonly createdAt: string;
}

/** Retained answers are intentionally bounded without a global cleanup job. */
export const MAX_NATIVE_STRUCTURED_ANSWERS_PER_SESSION = 32;

/** Durable, redacted projection of the producer-owned Setup recovery report. */
export interface NativeSetupRecoveryRow {
  readonly sessionId: string;
  readonly phase: NativeSetupRecoveryPhase;
  readonly state: NativeSetupRecoveryState;
  readonly code: NativeSetupRecoveryCode;
  readonly sequence: number;
  readonly decision: "continue_or_stop" | null;
  /** Host-owned completion result; never inferred from a report or PTY exit. */
  readonly completionValidated: boolean;
  /** Monotonic compare-and-swap token for browser recovery actions. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionRow {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: SessionStatus;
  readonly pendingQuestion: string | null;
  /** JSON-serialized `PendingDecisionPayload`, set alongside `status: "awaiting_decision"` — mirrors `pendingQuestion`'s `awaiting_clarify` pairing. */
  readonly pendingDecision: string | null;
}

/**
 * JSON-serialized shape of `SessionRow.pendingDecision`, one variant per
 * decision `kind` this BFF knows how to resume (see `wire-types.ts`'s
 * `SetupDecision.kind`, which is the UI-facing side of the same checkpoint —
 * this is the BFF-internal "how to resume" half). `POST /api/setup/decision`
 * reads this back out to know which action to drive for a given `choiceId`.
 */
export type PendingDecisionPayload =
  | {
      readonly kind: "max_turns_continue";
      readonly stepKey: "context";
      /**
       * Plan A session resume: the SDK session id the failed turn ran under (captured from a
       * `ModeBSessionError`, `harness/route/mode-b.ts`), if the runner reported one. When present,
       * `POST /api/setup/decision`'s "continue" branch resumes this SAME agent-sdk conversation
       * instead of recomposing a disk-state prompt (`composeSetupPrompt`'s `resumeFromDisk`).
       * `undefined` for decisions recorded before this field existed, or when the runner never
       * reported a session id at all; `null` when the runner reported the line but the SDK itself
       * produced no session id to resume.
       */
      readonly sessionId?: string | null;
      /** Server-only origin identity; both fields are required to resume. */
      readonly sessionProvider?: string;
      readonly sessionRunner?: string;
      /** Preserves an adopted context turn's cwd across the decision. */
      readonly workspaceRoot?: string;
    }
  | {
      /** One explicit recovery from a terminal context turn with no successful schema discovery. */
      readonly kind: "schema_discovery_retry";
      readonly stepKey: "context";
      /** Captured from the completed Mode-B turn when available, so retry can continue the same conversation. */
      readonly sessionId?: string | null;
      /** Server-only origin identity; both fields are required to resume. */
      readonly sessionProvider?: string;
      readonly sessionRunner?: string;
      /** Carries an adopted project's dirname across the decision, when this was not the bootstrap workspace root. */
      readonly workspaceRoot?: string;
    }
  | {
      readonly kind: "name_conflict";
      readonly projectName: string;
      readonly sourceType: string;
      /** The chosen connection shape, so "clean" rebuilds the same one the user picked. */
      readonly variant?: string;
    }
  | {
      readonly kind: "build_context";
      /** Absolute path to the adopted project (see `SetupAdoptRequest.projectPath`) — reconstructed into `{workspaceRoot: dirname, projectName: basename}` for `composeSetupPrompt`/the resumed turn's `TurnRow.workspaceRoot`. */
      readonly projectPath: string;
      readonly sourceType: string;
    };

export interface StoredEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly kind: SessionEvent["kind"];
  readonly payload: SessionEvent;
  readonly createdAt: string;
  readonly turnId: string | null;
}

export interface TurnRow {
  readonly id: string;
  readonly sessionId: string;
  readonly question: string;
  readonly composedInput: string | null;
  readonly backend: string | null;
  readonly resultKind: TurnResultKind | null;
  readonly answerSummary: string | null;
  readonly traceJson: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  /** The intent router's chosen agent id for this turn (see `classifyIntent`). NULL for rows created before intent routing existed. */
  readonly agentId: string | null;
  /**
   * Marks this turn as a step of the agentic setup/connect flow (`"connect"`
   * | `"connect_resume"`, see `server/compose.ts`'s `SetupStepKey`) rather
   * than a normal Ask turn. NULL for every non-setup turn (the overwhelming
   * majority). `executeTurn` (`server/turn.ts`) branches on this being
   * non-null to dispatch via `SetupStepRunner` instead of `deps.route(...)`.
   */
  readonly setupStepKey: string | null;
  /**
   * Plan A session resume: an SDK session id this turn should resume (forwarded to
   * `SetupStepRunOptions.resumeSessionId`, `harness/setup/runner.ts`) instead of dispatching a fresh
   * agent-sdk conversation. Set only on a turn created by `POST /api/setup/decision`'s
   * "continue" branch when the prior failed turn reported a resumable session id. NULL for every
   * other turn, and for turns created before this column existed.
   */
  readonly resumeSessionId: string | null;
  /** Subscription provider that created `resumeSessionId`; required before an explicit retry may reuse it. */
  readonly resumeSessionProvider: string | null;
  /** Canonical selected setup-runner identity that created `resumeSessionId` (for example `subscription:claude`). */
  readonly resumeRunner: string | null;
  /**
   * A bounded setup workflow recovery already consumed by this turn. NULL for
   * ordinary setup/Ask turns. "lifecycle" marks a retained-proof corrective
   * turn; "schema_discovery" additionally prevents that bounded retry from
   * offering the same retry or a chained max-turn continuation again.
   */
  readonly contextRecovery: string | null;
  /**
   * Per-turn override for `TurnDeps.workspaceRoot`, used ONLY by the adopt
   * flow's `build_context` decision resolution (`POST /api/setup/decision`,
   * `server/app.ts`): an adopted project can live anywhere on disk, not just
   * under the BFF's configured bootstrap `workspaceRoot`, so its context-step
   * turn carries its own root (`path.dirname(<adopted project path>)`) rather
   * than relying on the process-wide config. `executeSetupTurn`
   * (`server/turn.ts`) resolves `turn.workspaceRoot ?? deps.workspaceRoot` so
   * every pre-existing create-flow turn (this column NULL) is unaffected.
   */
  readonly workspaceRoot: string | null;
}

export interface ArtifactRow {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly kind: ArtifactKind;
  readonly location: string;
  readonly verified: boolean;
  readonly createdAt: string;
  /**
   * Set when the user explicitly saved this artifact to the Artifacts
   * page (`Store.saveArtifact`), else `null`. Auto-created artifacts (Mode
   * A/B) always start with this unset — only `listArtifacts()` filters on
   * it; `getArtifact()` stays unfiltered so the content read-back route
   * and the save endpoint itself can still reach an unsaved row.
   */
  readonly savedAt: string | null;
  /** Native-session provenance is additive; legacy Ask artifacts leave these null. */
  readonly nativeSessionId: string | null;
  readonly projectIdentity: string | null;
  readonly bindingGeneration: number | null;
  readonly projectRevision: string | null;
  readonly nativeVendor: NativeSessionVendor | null;
  readonly nativeAgent: string | null;
  readonly contentDigest: string | null;
  /** Opaque retry key, never returned on an artifact DTO. */
  readonly idempotencyKey: string | null;
  /** Source provenance for a reference-backed native save; legacy/payload saves leave these null. */
  readonly sourceAnswerId: string | null;
}

export interface PublicationRow {
  readonly artifactId: string;
  readonly link: string;
  readonly scope: PublishScope;
  readonly createdAt: string;
}

export interface EvalRunWithScores extends EvalRun {
  readonly componentScores: readonly ComponentScore[];
}

export interface PriorTurn {
  readonly question: string;
  readonly answerSummary: string | undefined;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  status TEXT NOT NULL,              -- 'active' | 'awaiting_clarify' | 'streaming' | 'awaiting_decision'
  pending_question TEXT,
  pending_decision TEXT              -- JSON-serialized PendingDecisionPayload, set with status = 'awaiting_decision'
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
  -- additive: scopes an event to the turn whose execution produced it, so a
  -- resolved-turn SSE replay can select exactly its own answer/refusal/
  -- artifact event without also replaying the turn's own leading 'user'
  -- event or a sibling turn's events. NULL for 'published' events, which
  -- aren't tied to any single turn's execution.
  turn_id TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question TEXT NOT NULL, composed_input TEXT,
  backend TEXT, result_kind TEXT, answer_summary TEXT, trace_json TEXT, created_at TEXT NOT NULL,
  -- additive: the terminal error message when result_kind = 'error', so a
  -- resumed SSE stream for an already-errored turn can replay the exact
  -- 'error' frame without re-invoking route().
  error_message TEXT,
  -- additive: the intent router's chosen agent id
  -- (classifyIntent, computed once at postTurn time), persisted so
  -- executeTurn passes it to route() and a later SSE replay of an already-
  -- resolved turn never has to re-classify (or re-invoke route() at all).
  -- NULL for turns created before this column existed.
  agent_id TEXT
  -- additive: Plan A session resume anchor (resume_session_id), added via
  -- migrateSchema() below rather than here so an existing on-disk DB still
  -- opens cleanly — see addColumnIfMissing("turns", "resume_session_id", ...).
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  location TEXT NOT NULL, verified INTEGER, created_at TEXT NOT NULL,
  -- NULL until the user explicitly saves this artifact from the Ask
  -- thread; listArtifacts() filters on it so auto-created artifacts don't
  -- appear on the Artifacts page until saved. Also added via migrateSchema()
  -- below for an existing on-disk DB file predating this column.
  saved_at TEXT,
  native_session_id TEXT, project_identity TEXT, binding_generation INTEGER, project_revision TEXT,
  native_vendor TEXT, native_agent TEXT, content_digest TEXT, idempotency_key TEXT,
  source_answer_id TEXT
);
CREATE TABLE IF NOT EXISTS publications (
  artifact_id TEXT PRIMARY KEY, link TEXT NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY, when_ts TEXT NOT NULL, score REAL NOT NULL, gate_threshold REAL NOT NULL,
  gate_pass INTEGER NOT NULL, regressions INTEGER NOT NULL, cost TEXT NOT NULL, p50 TEXT NOT NULL,
  component_scores_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL
);
-- Operational enrichment state is deliberately host-owned and outside the
-- project tree.  These rows contain only safe ids, hashes, summaries and
-- digests; raw source material and runner/session anchors are never stored.
CREATE TABLE IF NOT EXISTS enrichment_runs (
  id TEXT PRIMARY KEY, mode TEXT NOT NULL, project_path TEXT NOT NULL,
  project_identity TEXT NOT NULL DEFAULT '', project_revision TEXT NOT NULL, proposal_id TEXT NOT NULL, proposal_hash TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  validation_digest TEXT, build_digest TEXT, error_message TEXT, binding_generation INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS enrichment_operations (
  run_id TEXT NOT NULL, operation_id TEXT NOT NULL, sink TEXT NOT NULL, risk TEXT NOT NULL,
  summary TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '', change_kind TEXT NOT NULL DEFAULT 'knowledge_append', confidence TEXT NOT NULL, decision TEXT, completed INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'awaiting_decision', attempt INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_expires_at TEXT, idempotency_key TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (run_id, operation_id)
);
CREATE TABLE IF NOT EXISTS enrichment_approvals (
  run_id TEXT NOT NULL, operation_id TEXT NOT NULL, project_revision TEXT NOT NULL,
  proposal_hash TEXT NOT NULL, risk TEXT NOT NULL, attested_at TEXT NOT NULL,
  project_path TEXT NOT NULL DEFAULT '', project_identity TEXT NOT NULL DEFAULT '', binding_generation INTEGER NOT NULL DEFAULT 0,
  operation_hash TEXT NOT NULL DEFAULT '', sink TEXT NOT NULL DEFAULT '', change_kind TEXT NOT NULL DEFAULT '',
  evidence_ref TEXT NOT NULL DEFAULT '', nonce TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (run_id, operation_id)
);
CREATE TABLE IF NOT EXISTS enrichment_events (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
);
-- Native Sessions are a control-plane namespace. They intentionally do not
-- share Ask session identity and never store terminal bytes or input.
CREATE TABLE IF NOT EXISTS native_sessions (
  id TEXT PRIMARY KEY, purpose TEXT NOT NULL, vendor TEXT NOT NULL, agent TEXT NOT NULL,
  scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
  project_identity TEXT, binding_generation INTEGER, project_revision TEXT,
  dispatch_profile TEXT, dispatch_target TEXT, runtime_generation INTEGER,
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  started_at TEXT, ended_at TEXT, exit_code INTEGER, failure TEXT
);
CREATE INDEX IF NOT EXISTS native_sessions_updated_at ON native_sessions(updated_at DESC);
-- Provider conversation identity is an opaque, sealed server-side value. It
-- deliberately has no foreign-key cascade: historical session rows remain a
-- truthful record even after their one-shot resume authority is consumed.
CREATE TABLE IF NOT EXISTS native_session_resume_handles (
  session_id TEXT PRIMARY KEY, provider TEXT NOT NULL, sealed_handle TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS native_session_resume_actions (
  session_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, scope_fingerprint TEXT NOT NULL,
  resumed_session_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, idempotency_key)
);
-- Setup recovery stores an intentionally closed, redacted projection. It has
-- no terminal bytes, prompt, credential, capability, path, or tool payload.
CREATE TABLE IF NOT EXISTS native_setup_recoveries (
  session_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL, state TEXT NOT NULL, code TEXT NOT NULL,
  sequence INTEGER NOT NULL, decision TEXT,
  completion_validated INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- A browser-only recovery action secret is never stored raw. A per-row salt
-- and verifier survive BFF restart so an interrupted session can be retried.
CREATE TABLE IF NOT EXISTS native_setup_recovery_actions (
  session_id TEXT PRIMARY KEY,
  salt TEXT NOT NULL, verifier TEXT NOT NULL, claimed_at TEXT
);
-- A native answer is retained only as its typed render envelope. Native
-- sessions still never store terminal bytes, prompts, or transcripts.
CREATE TABLE IF NOT EXISTS native_structured_answers (
  id TEXT PRIMARY KEY,
  native_session_id TEXT NOT NULL REFERENCES native_sessions(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(native_session_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS native_structured_answers_session_created_at
  ON native_structured_answers(native_session_id, created_at DESC);
`;

export interface EnrichmentRunRow {
  readonly id: string;
  readonly mode: EnrichmentMode;
  readonly projectPath: string;
  readonly projectIdentity: string;
  readonly projectRevision: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly status: EnrichmentRunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly validationDigest: string | null;
  readonly buildDigest: string | null;
  readonly errorMessage: string | null;
  readonly bindingGeneration: number;
  /** Monotonic optimistic-concurrency token; never use `updatedAt` as authority. */
  readonly version: number;
}

export interface EnrichmentOperationRow extends EnrichmentOperation {
  readonly decision: "accept" | "edit" | "skip" | null;
  readonly completed: boolean;
  readonly state: import("./enrichment.js").EnrichmentOperationState;
  readonly attempt: number;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: string | null;
  readonly idempotencyKey: string;
}

export interface EnrichmentEventRow { readonly id: string; readonly runId: string; readonly kind: string; readonly message: string; readonly createdAt: string; }

/** A single optimistic, binding-fenced metadata mutation for a run. */
export interface EnrichmentMetadataTransition {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly binding: EnrichmentBinding;
  readonly operation?: {
    readonly id: string;
    readonly expectedState: EnrichmentOperationState;
    readonly expectedDecision?: "accept" | "edit" | "skip" | null;
    readonly decision?: "accept" | "edit" | "skip";
    readonly nextState: EnrichmentOperationState;
  };
  readonly status?: EnrichmentRunStatus;
  readonly errorMessage?: string | null;
  /** A callback-minted record; browser input can never supply this object. */
  readonly attestation?: EnrichmentApprovalAttestation;
  readonly event?: { readonly kind: string; readonly message: string };
  /** Additional events share this exact operation/run/version transaction. */
  readonly additionalEvents?: readonly { readonly kind: string; readonly message: string }[];
}

/** The authoritative transaction for every apply/reconcile/lease mutation. */
export interface EnrichmentExecutionTransition {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly binding: EnrichmentBinding;
  readonly operationId: string;
  readonly expectedStates: readonly EnrichmentOperationState[];
  readonly expectedAttempt?: number;
  readonly expectedLeaseToken?: string | null;
  readonly nextState: EnrichmentOperationState;
  readonly nextAttempt?: number;
  readonly leaseToken?: string | null;
  readonly leaseExpiresAt?: string | null;
  readonly completed?: boolean;
  readonly status: EnrichmentRunStatus;
  readonly validationDigest?: string | null;
  readonly buildDigest?: string | null;
  readonly errorMessage?: string | null;
  readonly event: { readonly kind: string; readonly message: string };
}

/**
 * Replaces a browser-edited draft only after the host has canonicalized it.
 * This keeps the operation, proposal hash, run version, and audit event in
 * one binding-fenced transaction.
 */
export interface EnrichmentEditTransition {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly binding: EnrichmentBinding;
  readonly operationId: string;
  readonly operation: EnrichmentOperation;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly event: { readonly kind: string; readonly message: string };
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: unknown): boolean {
  return Number(value) === 1;
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new TypeError(`expected column "${key}" to be a string, got ${typeof value}`);
  }
  return value;
}

function strOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function num(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new TypeError(`expected column "${key}" to be numeric, got ${typeof value}`);
  }
  return Number(value);
}

function recoveryCapabilityVerifier(salt: string, capability: string): string {
  return createHash("sha256").update(`${salt}:${capability}`, "utf8").digest("hex");
}

function sameRecoveryCapability(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

/**
 * The setup wizard's initial config, seeded on first init and restored by
 * `resetSetup()`. Kept as module consts so "seed" and "reset" can never drift.
 */
const SEED_RUNTIME_SETTINGS: RuntimeSettings = {
  authMode: "subscription",
  subscriptionProvider: "claude",
  tierModels: [
    // Tier identities come from the compiled runtime contract. Models are
    // deliberately blank: a provider catalog is a suggestion, never a
    // product-owned selection on the user's behalf.
    { tier: "cheap", model: "" },
    { tier: "strong", model: "" },
  ],
  hybrid: false,
  deployment: "personal",
};

const SEED_SETUP_STEPS: SetupStep[] = [
  { key: "runtime", title: "Runtime & auth", state: "current" },
  { key: "connect", title: "Connect a warehouse", state: "todo" },
  { key: "context", title: "Build context", state: "todo" },
  { key: "bind", title: "Compile & bind", state: "todo" },
  { key: "ask", title: "Ask questions", state: "todo" },
];

/**
 * Invariant guard: a later step in the sequence must never be `"done"` while an
 * earlier one is still `"todo"` — that combination reads to the wizard sidebar as "you're on
 * step 5 but haven't started step 2", which is never a state any single setup-step transition
 * should intentionally produce. Every call site that flips a step to `"done"` is expected to
 * also advance its own predecessors, but this coerces any earlier `"todo"` forward as a
 * last-line-of-defense so a missed call site degrades to a merely-optimistic "done" rather than
 * a visibly broken sidebar. Only touches `"todo"` — a `"current"` step earlier in the array is
 * left alone (that combination shouldn't arise, and silently completing an in-flight step out
 * from under the caller would be a worse failure mode than leaving it visible).
 */
function coerceOrphanedTodoSteps(steps: SetupStep[]): SetupStep[] {
  let sawDoneAfter = false;
  const result = new Array<SetupStep>(steps.length);
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.state === "done") {
      sawDoneAfter = true;
      result[i] = step;
    } else if (sawDoneAfter && step.state === "todo") {
      result[i] = { ...step, state: "done" };
    } else {
      result[i] = step;
    }
  }
  return result;
}

export interface StoreOptions {
  /**
   * Test-only fault seam for the atomic context-success transaction. It runs
   * after the named write while the SQLite transaction is still open, so a
   * thrown error verifies that every preceding write is rolled back too.
   */
  readonly onContextSuccessWrite?: (phase: "after_steps" | "after_event" | "after_turn") => void;
  /** Test-only fault seam for enrichment's run/op/event CAS transaction. */
  readonly onEnrichmentTransitionWrite?: (phase: "after_operation" | "after_run" | "after_event") => void;
  /** Test-only fault seam for atomic enrichment-run creation. */
  readonly onEnrichmentCreationWrite?: (phase: "after_run" | "after_operations" | "after_event") => void;
  /** Test-only clock so lease-expiry behavior is deterministic. */
  readonly now?: () => Date;
}

export interface ContextSetupSuccessPersistence {
  readonly sessionId: string;
  readonly turnId: string;
  readonly steps: SetupStep[];
  readonly statusEvent: SetupStatusEvent;
  readonly backend: string | null;
  readonly answerSummary: string | null;
  readonly traceJson: string | null;
  readonly errorMessage: string | null;
}

export class Store {
  private readonly db: DatabaseSync;
  private readonly onContextSuccessWrite: StoreOptions["onContextSuccessWrite"];
  private readonly onEnrichmentTransitionWrite: StoreOptions["onEnrichmentTransitionWrite"];
  private readonly onEnrichmentCreationWrite: StoreOptions["onEnrichmentCreationWrite"];
  private readonly now: () => Date;

  constructor(path: string, options: StoreOptions = {}) {
    this.db = new DatabaseSync(path);
    this.onContextSuccessWrite = options.onContextSuccessWrite;
    this.onEnrichmentTransitionWrite = options.onEnrichmentTransitionWrite;
    this.onEnrichmentCreationWrite = options.onEnrichmentCreationWrite;
    this.now = options.now ?? (() => new Date());
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.migrateSchema();
    this.seedIfEmpty();
    this.reconcileOrphanedSetupTurns();
    this.reconcileOrphanedEnrichmentRuns();
    this.reconcileOrphanedNativeSessions();
  }

  /**
   * A setup turn is executed only by the owning BFF process. If that process
   * exits, a NULL result cannot still represent running work after restart.
   * Convert only setup turns (never ordinary Ask turns) to a bounded, public
   * recovery error. The old trace is deliberately discarded: it may predate
  * the setup-boundary redaction rules and must not be replayed to the UI.
  */
  private reconcileOrphanedSetupTurns(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const orphanSessions = this.db
        .prepare(`SELECT DISTINCT session_id FROM turns WHERE result_kind IS NULL AND setup_step_key IS NOT NULL`)
        .all()
        .map((row) => str(row as Record<string, unknown>, "session_id"));
      if (orphanSessions.length === 0) {
        this.db.exec("COMMIT");
        return;
      }
      const message = "a previous setup execution was interrupted by a BFF restart; Continue & repair to inspect the preserved project and resume safely";
      this.db
        .prepare(`UPDATE turns SET backend = NULL, result_kind = 'error', answer_summary = NULL, trace_json = '[]', error_message = ? WHERE result_kind IS NULL AND setup_step_key IS NOT NULL`)
        .run(message);
      // A stale streaming status otherwise leaves reload hydration presenting
      // an indefinitely-running turn even though the row is now recoverable.
      const clearStreaming = this.db.prepare(`UPDATE sessions SET status = 'active', pending_question = NULL, updated_at = ? WHERE id = ? AND status = 'streaming'`);
      for (const sessionId of orphanSessions) clearStreaming.run(this.now().toISOString(), sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * An enrichment draft is executed only by the owning BFF process. If that
   * process exits mid-draft, a 'drafting' row cannot still represent running
   * work after restart -- convert it to a terminal, classifiable state
   * (mirrors `reconcileOrphanedSetupTurns` above) so the UI never shows a
   * run stuck at "in progress" forever after a crash or redeploy.
   */
  private reconcileOrphanedEnrichmentRuns(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const orphanRunIds = this.db
        .prepare(`SELECT id FROM enrichment_runs WHERE status = 'drafting'`)
        .all()
        .map((row) => str(row as Record<string, unknown>, "id"));
      if (orphanRunIds.length === 0) {
        this.db.exec("COMMIT");
        return;
      }
      const now = this.now().toISOString();
      const message = "a previous enrichment draft was interrupted by a BFF restart; start a new enrichment run";
      this.db
        .prepare(`UPDATE enrichment_runs SET error_message = ?, updated_at = ?, version = version + 1, status = 'failed' WHERE status = 'drafting'`)
        .run(message, now);
      const insertEvent = this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, 'failed', ?, ?)`);
      for (const runId of orphanRunIds) insertEvent.run(newId("enrichment-event"), runId, "Enrichment draft failed.", now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** A PTY belongs to this BFF process, so it cannot survive a restart. */
  private reconcileOrphanedNativeSessions(): void {
    const now = this.now().toISOString();
    this.db.prepare(
      `UPDATE native_sessions SET status = 'interrupted', failure = ?, ended_at = ?, updated_at = ?
       WHERE status IN ('creating', 'running', 'detached')`,
    ).run("native session interrupted by BFF restart", now, now);
  }

  /**
   * Additive, idempotent migrations for columns added after a DB file may
   * already exist on disk. `CREATE TABLE IF NOT EXISTS` above only defines
   * the schema for a BRAND NEW file — an existing sqlite file's `turns`
   * table predates `agent_id` and needs it added explicitly. Guarded by a
   * `PRAGMA table_info` check so re-running this on an already-migrated (or
   * brand-new, already-current) file is a no-op rather than an error.
   */
  private migrateSchema(): void {
    this.addColumnIfMissing("turns", "agent_id", "TEXT");
    this.addColumnIfMissing("turns", "setup_step_key", "TEXT");
    this.addColumnIfMissing("turns", "resume_session_id", "TEXT");
    this.addColumnIfMissing("turns", "resume_session_provider", "TEXT");
    this.addColumnIfMissing("turns", "resume_runner", "TEXT");
    this.addColumnIfMissing("turns", "workspace_root", "TEXT");
    this.addColumnIfMissing("turns", "context_recovery", "TEXT");
    this.addColumnIfMissing("sessions", "pending_decision", "TEXT");
    this.addColumnIfMissing("artifacts", "saved_at", "TEXT");
    this.addColumnIfMissing("artifacts", "native_session_id", "TEXT");
    this.addColumnIfMissing("artifacts", "project_identity", "TEXT");
    this.addColumnIfMissing("artifacts", "binding_generation", "INTEGER");
    this.addColumnIfMissing("artifacts", "project_revision", "TEXT");
    this.addColumnIfMissing("artifacts", "native_vendor", "TEXT");
    this.addColumnIfMissing("artifacts", "native_agent", "TEXT");
    this.addColumnIfMissing("artifacts", "content_digest", "TEXT");
    this.addColumnIfMissing("artifacts", "idempotency_key", "TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS artifacts_native_idempotency_unique ON artifacts(native_session_id, idempotency_key) WHERE native_session_id IS NOT NULL AND idempotency_key IS NOT NULL");
    this.addColumnIfMissing("enrichment_operations", "draft", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_operations", "change_kind", "TEXT NOT NULL DEFAULT 'knowledge_append'");
    this.addColumnIfMissing("enrichment_operations", "state", "TEXT NOT NULL DEFAULT 'awaiting_decision'");
    this.addColumnIfMissing("enrichment_operations", "attempt", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("enrichment_operations", "lease_token", "TEXT");
    this.addColumnIfMissing("enrichment_operations", "lease_expires_at", "TEXT");
    this.addColumnIfMissing("enrichment_operations", "idempotency_key", "TEXT NOT NULL DEFAULT ''");
    this.db.prepare(`UPDATE enrichment_operations SET idempotency_key = run_id || ':' || operation_id WHERE idempotency_key = ''`).run();
    this.addColumnIfMissing("enrichment_runs", "binding_generation", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("enrichment_runs", "project_identity", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_runs", "version", "INTEGER NOT NULL DEFAULT 1");
    this.addColumnIfMissing("enrichment_approvals", "project_path", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_approvals", "project_identity", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_approvals", "binding_generation", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("enrichment_approvals", "operation_hash", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_approvals", "sink", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_approvals", "change_kind", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_approvals", "evidence_ref", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_approvals", "nonce", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enrichment_approvals", "expires_at", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("native_sessions", "dispatch_profile", "TEXT");
    this.addColumnIfMissing("native_sessions", "dispatch_target", "TEXT");
    this.addColumnIfMissing("native_sessions", "runtime_generation", "INTEGER");
    this.addColumnIfMissing("artifacts", "source_answer_id", "TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS enrichment_approvals_nonce_unique ON enrichment_approvals(nonce) WHERE nonce <> ''");
  }

  private addColumnIfMissing(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = columns.some((row) => str(row as Record<string, unknown>, "name") === column);
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------
  // sessions
  // ---------------------------------------------------------------------

  createSession(title: string): SessionRow {
    const now = this.now().toISOString();
    const row: SessionRow = { id: newId("session"), title, createdAt: now, updatedAt: now, status: "active", pendingQuestion: null, pendingDecision: null };
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, created_at, updated_at, status, pending_question, pending_decision) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.title, row.createdAt, row.updatedAt, row.status, row.pendingQuestion, row.pendingDecision);
    return row;
  }

  // ---------------------------------------------------------------------
  // native Sessions control plane (never Ask sessions / never transcript)
  // ---------------------------------------------------------------------

  createNativeSession(params: {
    id: string; purpose: NativeSessionPurpose; vendor: NativeSessionVendor; agent: string;
    scopeKind: NativeSessionScopeKind; scopeId: string; projectIdentity?: string;
    bindingGeneration?: number; projectRevision?: string;
    dispatchProfile?: string; dispatchTarget?: string; runtimeGeneration?: number;
  }): NativeSessionRow {
    const now = this.now().toISOString();
    this.db.prepare(
      `INSERT INTO native_sessions (id, purpose, vendor, agent, scope_kind, scope_id, project_identity, binding_generation, project_revision, dispatch_profile, dispatch_target, runtime_generation, status, created_at, updated_at, started_at, ended_at, exit_code, failure)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, NULL, NULL, NULL, NULL)`,
    ).run(params.id, params.purpose, params.vendor, params.agent, params.scopeKind, params.scopeId,
      params.projectIdentity ?? null, params.bindingGeneration ?? null, params.projectRevision ?? null, params.dispatchProfile ?? null, params.dispatchTarget ?? null, params.runtimeGeneration ?? null, now, now);
    return this.getNativeSession(params.id)!;
  }

  /** Stores a sealed provider handle only; callers must never pass plaintext. */
  saveNativeSessionResumeHandle(sessionId: string, provider: NativeSessionVendor, sealedHandle: string): void {
    this.db.prepare(
      `INSERT INTO native_session_resume_handles (session_id, provider, sealed_handle, consumed_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(session_id) DO UPDATE SET provider = excluded.provider, sealed_handle = excluded.sealed_handle, consumed_at = NULL`,
    ).run(sessionId, provider, sealedHandle);
  }

  getNativeSessionResumeHandle(sessionId: string): NativeSessionResumeHandle | undefined {
    const row = this.db.prepare(`SELECT * FROM native_session_resume_handles WHERE session_id = ?`).get(sessionId) as Record<string, unknown> | undefined;
    return row ? {
      sessionId: str(row, "session_id"), provider: str(row, "provider") as NativeSessionVendor,
      sealedHandle: str(row, "sealed_handle"), consumedAt: strOrNull(row, "consumed_at"),
    } : undefined;
  }

  /** Browser-safe availability bit; the opaque sealed value never leaves Store. */
  hasAvailableNativeSessionResume(sessionId: string, provider: NativeSessionVendor): boolean {
    return this.db.prepare(
      `SELECT 1 FROM native_session_resume_handles WHERE session_id = ? AND provider = ? AND consumed_at IS NULL`,
    ).get(sessionId, provider) !== undefined;
  }

  getNativeSessionResumeAction(sourceSessionId: string, idempotencyKey: string): NativeSessionResumeAction | undefined {
    const row = this.db.prepare(
      `SELECT session_id, idempotency_key, scope_fingerprint, resumed_session_id
       FROM native_session_resume_actions WHERE session_id = ? AND idempotency_key = ?`,
    ).get(sourceSessionId, idempotencyKey) as Record<string, unknown> | undefined;
    return row ? {
      sourceSessionId: str(row, "session_id"),
      idempotencyKey: str(row, "idempotency_key"),
      scopeFingerprint: str(row, "scope_fingerprint"),
      resumedSessionId: str(row, "resumed_session_id"),
    } : undefined;
  }

  invalidateNativeSessionResume(sessionId: string): void {
    const now = this.now().toISOString();
    this.db.prepare(`UPDATE native_session_resume_handles SET consumed_at = COALESCE(consumed_at, ?) WHERE session_id = ?`).run(now, sessionId);
  }

  /**
   * Atomically consumes a source conversation authority and creates its child
   * process row. A duplicate action returns its original child, while another
   * click can never fork the same provider conversation.
   */
  reserveNativeSessionResume(params: {
    readonly sourceSessionId: string;
    readonly idempotencyKey: string;
    readonly scopeFingerprint: string;
    readonly child: {
      readonly id: string; readonly purpose: NativeSessionPurpose; readonly vendor: NativeSessionVendor; readonly agent: string;
      readonly scopeKind: NativeSessionScopeKind; readonly scopeId: string; readonly projectIdentity?: string;
      readonly bindingGeneration?: number; readonly projectRevision?: string;
      readonly dispatchProfile?: string; readonly dispatchTarget?: string; readonly runtimeGeneration?: number;
    };
    readonly sealedHandle: string;
  }): { readonly row: NativeSessionRow; readonly created: boolean } | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare(
        `SELECT scope_fingerprint, resumed_session_id FROM native_session_resume_actions WHERE session_id = ? AND idempotency_key = ?`,
      ).get(params.sourceSessionId, params.idempotencyKey) as Record<string, unknown> | undefined;
      if (existing) {
        if (str(existing, "scope_fingerprint") !== params.scopeFingerprint) throw new Error("native session resume action is stale");
        const row = this.getNativeSession(str(existing, "resumed_session_id"));
        this.db.exec("COMMIT");
        return row ? { row, created: false } : undefined;
      }
      const handle = this.getNativeSessionResumeHandle(params.sourceSessionId);
      if (!handle || handle.provider !== params.child.vendor || handle.consumedAt !== null) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      const source = this.getNativeSession(params.sourceSessionId);
      if (!source || source.vendor !== params.child.vendor) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      const now = this.now().toISOString();
      const child = params.child;
      this.db.prepare(
        `INSERT INTO native_sessions (id, purpose, vendor, agent, scope_kind, scope_id, project_identity, binding_generation, project_revision, dispatch_profile, dispatch_target, runtime_generation, status, created_at, updated_at, started_at, ended_at, exit_code, failure)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, NULL, NULL, NULL, NULL)`,
      ).run(child.id, child.purpose, child.vendor, child.agent, child.scopeKind, child.scopeId,
        child.projectIdentity ?? null, child.bindingGeneration ?? null, child.projectRevision ?? null, child.dispatchProfile ?? null, child.dispatchTarget ?? null, child.runtimeGeneration ?? null, now, now);
      this.db.prepare(`INSERT INTO native_session_resume_actions (session_id, idempotency_key, scope_fingerprint, resumed_session_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        params.sourceSessionId, params.idempotencyKey, params.scopeFingerprint, child.id, now,
      );
      this.db.prepare(`UPDATE native_session_resume_handles SET consumed_at = ? WHERE session_id = ? AND consumed_at IS NULL`).run(now, params.sourceSessionId);
      this.saveNativeSessionResumeHandle(child.id, child.vendor, params.sealedHandle);
      const row = this.getNativeSession(child.id)!;
      this.db.exec("COMMIT");
      return { row, created: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getNativeSession(id: string): NativeSessionRow | undefined {
    const row = this.db.prepare(`SELECT * FROM native_sessions WHERE id = ?`).get(id);
    return row ? rowToNativeSession(row) : undefined;
  }

  createNativeStructuredAnswer(params: {
    readonly id: string;
    readonly nativeSessionId: string;
    readonly idempotencyKey: string;
    readonly envelopeJson: string;
    readonly digest: string;
  }): { readonly row: NativeStructuredAnswerRow; readonly created: boolean } {
    const existing = this.getNativeStructuredAnswerByIdempotency(params.nativeSessionId, params.idempotencyKey);
    if (existing) return { row: existing, created: false };
    const createdAt = this.now().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        `INSERT INTO native_structured_answers (id, native_session_id, idempotency_key, envelope_json, digest, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(params.id, params.nativeSessionId, params.idempotencyKey, params.envelopeJson, params.digest, createdAt);
      this.db.prepare(
        `DELETE FROM native_structured_answers
         WHERE id IN (
           SELECT id FROM native_structured_answers
           WHERE native_session_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT -1 OFFSET ?
         )`,
      ).run(params.nativeSessionId, MAX_NATIVE_STRUCTURED_ANSWERS_PER_SESSION);
      const row = this.getNativeStructuredAnswer(params.id)!;
      this.db.exec("COMMIT");
      return { row, created: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      const winner = this.getNativeStructuredAnswerByIdempotency(params.nativeSessionId, params.idempotencyKey);
      if (winner) return { row: winner, created: false };
      throw error;
    }
  }

  getNativeStructuredAnswer(id: string): NativeStructuredAnswerRow | undefined {
    const row = this.db.prepare(`SELECT * FROM native_structured_answers WHERE id = ?`).get(id);
    return row ? rowToNativeStructuredAnswer(row) : undefined;
  }

  getNativeStructuredAnswerByIdempotency(nativeSessionId: string, idempotencyKey: string): NativeStructuredAnswerRow | undefined {
    const row = this.db.prepare(
      `SELECT * FROM native_structured_answers WHERE native_session_id = ? AND idempotency_key = ?`,
    ).get(nativeSessionId, idempotencyKey);
    return row ? rowToNativeStructuredAnswer(row) : undefined;
  }

  listNativeSessions(): NativeSessionRow[] {
    return this.db.prepare(`SELECT * FROM native_sessions ORDER BY updated_at DESC, rowid DESC`).all().map(rowToNativeSession);
  }

  transitionNativeSession(id: string, status: NativeSessionStatus, patch: { exitCode?: number | null; failure?: string | null; started?: boolean; ended?: boolean } = {}): NativeSessionRow | undefined {
    const existing = this.getNativeSession(id);
    if (!existing) return undefined;
    const now = this.now().toISOString();
    this.db.prepare(
      `UPDATE native_sessions SET status = ?, updated_at = ?, started_at = COALESCE(started_at, ?), ended_at = ?, exit_code = ?, failure = ? WHERE id = ?`,
    ).run(status, now, patch.started ? now : null, patch.ended ? now : existing.endedAt,
      patch.exitCode === undefined ? existing.exitCode : patch.exitCode,
      patch.failure === undefined ? existing.failure : patch.failure, id);
    return this.getNativeSession(id);
  }

  getNativeSetupRecovery(sessionId: string): NativeSetupRecoveryRow | undefined {
    const row = this.db.prepare(`SELECT * FROM native_setup_recoveries WHERE session_id = ?`).get(sessionId);
    return row ? rowToNativeSetupRecovery(row) : undefined;
  }

  /**
   * Accepts one already-validated closed v1 report when its producer sequence
   * moves forward. An identical producer replay at the current sequence is an
   * idempotent acknowledgement; any other replay or stale report fails closed.
   */
  recordNativeSetupRecovery(input: {
    readonly sessionId: string;
    readonly phase: NativeSetupRecoveryPhase;
    readonly state: NativeSetupRecoveryState;
    readonly code: NativeSetupRecoveryCode;
    readonly sequence: number;
    readonly decision: "continue_or_stop" | null;
    readonly completionValidated: boolean;
  }): NativeSetupRecoveryRow | undefined {
    const now = this.now().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getNativeSetupRecovery(input.sessionId);
      if (existing && input.sequence <= existing.sequence) {
        const sameProducerReport = input.sequence === existing.sequence
          && input.phase === existing.phase
          && input.state === existing.state
          && input.code === existing.code
          && input.decision === existing.decision;
        this.db.exec("ROLLBACK");
        return sameProducerReport ? existing : undefined;
      }
      if (existing) {
        this.db.prepare(
          `UPDATE native_setup_recoveries
           SET phase = ?, state = ?, code = ?, sequence = ?, decision = ?, completion_validated = ?, version = version + 1, updated_at = ?
           WHERE session_id = ? AND version = ?`,
        ).run(input.phase, input.state, input.code, input.sequence, input.decision, boolToInt(input.completionValidated), now, input.sessionId, existing.version);
      } else {
        this.db.prepare(
          `INSERT INTO native_setup_recoveries (session_id, phase, state, code, sequence, decision, completion_validated, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        ).run(input.sessionId, input.phase, input.state, input.code, input.sequence, input.decision, boolToInt(input.completionValidated), now, now);
      }
      const result = this.getNativeSetupRecovery(input.sessionId);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Creates a restart-safe, browser-held action secret without persisting it raw. */
  issueNativeSetupRecoveryAction(sessionId: string, capability: string): void {
    const salt = randomBytes(32).toString("hex");
    const verifier = recoveryCapabilityVerifier(salt, capability);
    this.db.prepare(
      `INSERT INTO native_setup_recovery_actions (session_id, salt, verifier, claimed_at) VALUES (?, ?, ?, NULL)
       ON CONFLICT(session_id) DO UPDATE SET salt = excluded.salt, verifier = excluded.verifier, claimed_at = NULL`,
    ).run(sessionId, salt, verifier);
  }

  /**
   * Claims one recovery action atomically after checking its salted verifier
   * and the browser's exact recovery version. A missing report has version 0
   * so a BFF-restart interruption can still be retried honestly.
   */
  claimNativeSetupRecoveryAction(sessionId: string, capability: string, expectedVersion: number): boolean {
    const action = this.db.prepare(`SELECT salt, verifier FROM native_setup_recovery_actions WHERE session_id = ? AND claimed_at IS NULL`).get(sessionId) as Record<string, unknown> | undefined;
    if (!action) return false;
    const salt = str(action, "salt");
    const verifier = str(action, "verifier");
    if (!sameRecoveryCapability(verifier, recoveryCapabilityVerifier(salt, capability))) return false;
    const changed = this.db.prepare(
      `UPDATE native_setup_recovery_actions SET claimed_at = ?
       WHERE session_id = ? AND verifier = ? AND claimed_at IS NULL
         AND COALESCE((SELECT version FROM native_setup_recoveries WHERE session_id = native_setup_recovery_actions.session_id), 0) = ?`,
    ).run(this.now().toISOString(), sessionId, verifier, expectedVersion).changes;
    return changed === 1;
  }

  /** Releases a failed launch claim so the same browser-held secret can retry. */
  releaseNativeSetupRecoveryAction(sessionId: string): void {
    this.db.prepare(`UPDATE native_setup_recovery_actions SET claimed_at = NULL WHERE session_id = ?`).run(sessionId);
  }

  /** Atomically make a native row stopped and consume any durable recovery verifier. */
  stopNativeSessionAndRevokeRecoveryAction(id: string, patch: { failure?: string | null } = {}): NativeSessionRow | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getNativeSession(id);
      if (!existing) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      const now = this.now().toISOString();
      this.db.prepare(
        `UPDATE native_sessions SET status = 'stopped', updated_at = ?, ended_at = ?, failure = ? WHERE id = ?`,
      ).run(now, existing.endedAt ?? now, patch.failure === undefined ? existing.failure : patch.failure, id);
      this.db.prepare(`DELETE FROM native_setup_recovery_actions WHERE session_id = ?`).run(id);
      const result = this.getNativeSession(id);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listSessions(): SessionRow[] {
    const rows = this.db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all();
    return rows.map(rowToSession);
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
    return row ? rowToSession(row) : undefined;
  }

  updateSessionStatus(id: string, status: SessionStatus, pendingQuestion: string | null): void {
    this.db
      .prepare(`UPDATE sessions SET status = ?, pending_question = ?, updated_at = ? WHERE id = ?`)
      .run(status, pendingQuestion, new Date().toISOString(), id);
  }

  /** Mirrors `updateSessionStatus`, but for the `pendingDecision` column (`status: "awaiting_decision"` checkpoints) — kept as a separate method/column so a pending clarify and a pending decision can never silently clobber each other. */
  updateSessionDecision(id: string, status: SessionStatus, pendingDecision: string | null): void {
    this.db
      .prepare(`UPDATE sessions SET status = ?, pending_decision = ?, updated_at = ? WHERE id = ?`)
      .run(status, pendingDecision, new Date().toISOString(), id);
  }

  touchSession(id: string): void {
    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  /**
   * Deletes a session row along with everything scoped to it — turns, events, artifacts, and any
   * publications for those artifacts — so no dangling rows survive the session itself. No FK
   * cascade is configured on this schema (see SCHEMA_SQL above), so each child table needs its
   * own explicit DELETE. Used by `resetSetup()` to remove an orphaned tracked setup session
   * rather than merely forgetting its id.
   */
  deleteSession(id: string): void {
    const artifactRows = this.db.prepare(`SELECT id FROM artifacts WHERE session_id = ?`).all(id);
    for (const row of artifactRows) {
      this.db.prepare(`DELETE FROM publications WHERE artifact_id = ?`).run(str(row as Record<string, unknown>, "id"));
    }
    this.db.prepare(`DELETE FROM artifacts WHERE session_id = ?`).run(id);
    this.db.prepare(`DELETE FROM events WHERE session_id = ?`).run(id);
    this.db.prepare(`DELETE FROM turns WHERE session_id = ?`).run(id);
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  // ---------------------------------------------------------------------
  // events
  // ---------------------------------------------------------------------

  nextSeq(sessionId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(seq), -1) AS maxSeq FROM events WHERE session_id = ?`).get(sessionId);
    return row ? num(row, "maxSeq") + 1 : 0;
  }

  insertEvent(params: { sessionId: string; kind: SessionEvent["kind"]; payload: SessionEvent; turnId: string | null }): StoredEvent {
    const seq = this.nextSeq(params.sessionId);
    const row: StoredEvent = {
      id: newId("event"),
      sessionId: params.sessionId,
      seq,
      kind: params.kind,
      payload: params.payload,
      createdAt: new Date().toISOString(),
      turnId: params.turnId,
    };
    this.db
      .prepare(`INSERT INTO events (id, session_id, seq, kind, payload_json, created_at, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.sessionId, row.seq, row.kind, JSON.stringify(row.payload), row.createdAt, row.turnId);
    return row;
  }

  listEventsForSession(sessionId: string): StoredEvent[] {
    const rows = this.db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC`).all(sessionId);
    return rows.map(rowToEvent);
  }

  listEventsForTurn(turnId: string): StoredEvent[] {
    const rows = this.db.prepare(`SELECT * FROM events WHERE turn_id = ? ORDER BY seq ASC`).all(turnId);
    return rows.map(rowToEvent);
  }

  // ---------------------------------------------------------------------
  // turns
  // ---------------------------------------------------------------------

  createTurn(params: {
    id: string;
    sessionId: string;
    question: string;
    composedInput: string | null;
    agentId?: string | null;
    /** Pre-seed the work log with the turn's decision entries (Route, and Clarify for a clarify turn), so they persist and replay. */
    traceJson?: string | null;
    /** Marks this as a setup-wizard turn (see `TurnRow.setupStepKey`). Undefined/null for a normal Ask turn. */
    setupStepKey?: string | null;
    /** Plan A session resume anchor for this turn (see `TurnRow.resumeSessionId`). Undefined/null when the turn should dispatch fresh. */
    resumeSessionId?: string | null;
    /** Provider/runner identity that created `resumeSessionId`; retained only for an explicit same-backend retry. */
    resumeSessionProvider?: string | null;
    resumeRunner?: string | null;
    /** Bounded context workflow recovery marker. */
    contextRecovery?: "lifecycle" | "schema_discovery" | null;
    /** Per-turn workspace root override for the adopt flow (see `TurnRow.workspaceRoot`). Undefined/null for every non-adopt turn — falls back to `TurnDeps.workspaceRoot`. */
    workspaceRoot?: string | null;
  }): TurnRow {
    const row: TurnRow = {
      id: params.id,
      sessionId: params.sessionId,
      question: params.question,
      composedInput: params.composedInput,
      backend: null,
      resultKind: null,
      answerSummary: null,
      traceJson: params.traceJson ?? null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      agentId: params.agentId ?? null,
      setupStepKey: params.setupStepKey ?? null,
      resumeSessionId: params.resumeSessionId ?? null,
      resumeSessionProvider: params.resumeSessionProvider ?? null,
      resumeRunner: params.resumeRunner ?? null,
      contextRecovery: params.contextRecovery ?? null,
      workspaceRoot: params.workspaceRoot ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO turns (id, session_id, question, composed_input, backend, result_kind, answer_summary, trace_json, created_at, error_message, agent_id, setup_step_key, resume_session_id, resume_session_provider, resume_runner, context_recovery, workspace_root)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.sessionId,
        row.question,
        row.composedInput,
        row.backend,
        row.resultKind,
        row.answerSummary,
        row.traceJson,
        row.createdAt,
        row.errorMessage,
        row.agentId,
        row.setupStepKey,
        row.resumeSessionId,
        row.resumeSessionProvider,
        row.resumeRunner,
        row.contextRecovery,
        row.workspaceRoot,
      );
    return row;
  }

  /**
   * Atomically coalesces duplicate setup dispatches for one session/step.
   * A second tab can attach to the same pending turn, but cannot create a
   * competing mutation of the project.
   */
  createOrGetActiveSetupTurn(params: {
    id: string;
    sessionId: string;
    question: string;
    composedInput: string | null;
    agentId?: string | null;
    traceJson?: string | null;
    setupStepKey: string;
    resumeSessionId?: string | null;
    resumeSessionProvider?: string | null;
    resumeRunner?: string | null;
    contextRecovery?: "lifecycle" | "schema_discovery" | null;
    workspaceRoot?: string | null;
  }): { readonly turn: TurnRow; readonly created: boolean } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const active = this.db
        .prepare(
          `SELECT * FROM turns
           WHERE session_id = ? AND setup_step_key = ? AND result_kind IS NULL
             AND rowid = (SELECT rowid FROM turns WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
        )
        .get(params.sessionId, params.setupStepKey, params.sessionId);
      const result = active
        ? { turn: rowToTurn(active), created: false }
        : { turn: this.createTurn(params), created: true };
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getTurn(id: string): TurnRow | undefined {
    const row = this.db.prepare(`SELECT * FROM turns WHERE id = ?`).get(id);
    return row ? rowToTurn(row) : undefined;
  }

  resolveTurn(
    id: string,
    patch: {
      backend: string | null;
      resultKind: TurnResultKind;
      answerSummary: string | null;
      traceJson: string | null;
      errorMessage: string | null;
    },
  ): void {
    this.db
      .prepare(`UPDATE turns SET backend = ?, result_kind = ?, answer_summary = ?, trace_json = ?, error_message = ? WHERE id = ?`)
      .run(patch.backend, patch.resultKind, patch.answerSummary, patch.traceJson, patch.errorMessage, id);
  }

  /**
   * Retains the dispatcher session anchor after a completed setup turn's
   * host-contract recovery ultimately fails. A later explicit retry can use
   * this durable anchor; it is never sent over the REST/SSE wire.
   */
  setTurnResumeAnchor(id: string, anchor: { readonly sessionId: string; readonly provider: string; readonly runner: string }): void {
    this.db
      .prepare(`UPDATE turns SET resume_session_id = ?, resume_session_provider = ?, resume_runner = ? WHERE id = ?`)
      .run(anchor.sessionId, anchor.provider, anchor.runner, id);
  }

  markTurnClarify(id: string): void {
    this.db.prepare(`UPDATE turns SET result_kind = 'clarify' WHERE id = ?`).run(id);
  }

  /** Most recent turn (any result kind) for a session — drives the Ask page's current work log. */
  getLatestTurn(sessionId: string): TurnRow | undefined {
    const row = this.db.prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(sessionId);
    return row ? rowToTurn(row) : undefined;
  }

  /** Resolved turns newest-first, used to recover an earlier safe setup pause after a later retry fails. */
  listTurnsForSession(sessionId: string): TurnRow[] {
    return this.db
      .prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY created_at DESC, rowid DESC`)
      .all(sessionId)
      .map(rowToTurn);
  }

  /** D3 context composition source: last `limit` resolved (answer/refusal) turns, chronological ascending. */
  listRecentResolvedTurns(sessionId: string, limit: number): PriorTurn[] {
    const rows = this.db
      .prepare(
        // rowid (monotonic insertion order) is the tiebreak: created_at is a
        // millisecond ISO string, so turns created in the same ms would
        // otherwise order non-deterministically and pick an arbitrary window.
        `SELECT question, answer_summary FROM turns
         WHERE session_id = ? AND result_kind IN ('answer', 'refusal')
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(sessionId, limit);
    return rows
      .map((row) => ({ question: str(row, "question"), answerSummary: strOrNull(row, "answer_summary") ?? undefined }))
      .reverse();
  }

  // ---------------------------------------------------------------------
  // artifacts / publications
  // ---------------------------------------------------------------------

  createArtifact(params: { sessionId: string; name: string; kind: ArtifactKind; location: string; verified: boolean }): ArtifactRow {
    const row: ArtifactRow = {
      id: newId("artifact"),
      sessionId: params.sessionId,
      name: params.name,
      kind: params.kind,
      location: params.location,
      verified: params.verified,
      createdAt: new Date().toISOString(),
      savedAt: null,
      nativeSessionId: null,
      projectIdentity: null,
      bindingGeneration: null,
      projectRevision: null,
      nativeVendor: null,
      nativeAgent: null,
      contentDigest: null,
      idempotencyKey: null,
      sourceAnswerId: null,
    };
    this.db
      .prepare(`INSERT INTO artifacts (id, session_id, name, kind, location, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.sessionId, row.name, row.kind, row.location, boolToInt(row.verified), row.createdAt);
    return row;
  }

  /**
   * Inserts a host-persisted native artifact as already Saved. The unique
   * native-session/idempotency pair is the retry authority; callers receive
   * the original row when another request won the race.
   */
  createNativeArtifact(params: {
    id: string; sessionId: string; nativeSessionId: string; name: string; location: string;
    projectIdentity: string; bindingGeneration: number; projectRevision: string;
    vendor: NativeSessionVendor; agent: string; digest: string; idempotencyKey: string;
    sourceAnswerId?: string;
  }): { readonly row: ArtifactRow; readonly created: boolean } {
    const existing = this.getNativeArtifactByIdempotency(params.nativeSessionId, params.idempotencyKey);
    if (existing) return { row: existing, created: false };
    const createdAt = new Date().toISOString();
    const row: ArtifactRow = {
      id: params.id, sessionId: params.sessionId, name: params.name, kind: "dashboard", location: params.location,
      verified: true, createdAt, savedAt: createdAt, nativeSessionId: params.nativeSessionId,
      projectIdentity: params.projectIdentity, bindingGeneration: params.bindingGeneration,
      projectRevision: params.projectRevision, nativeVendor: params.vendor, nativeAgent: params.agent,
      contentDigest: params.digest, idempotencyKey: params.idempotencyKey,
      sourceAnswerId: params.sourceAnswerId ?? null,
    };
    try {
      this.db.prepare(`INSERT INTO artifacts (
        id, session_id, name, kind, location, verified, created_at, saved_at,
        native_session_id, project_identity, binding_generation, project_revision,
        native_vendor, native_agent, content_digest, idempotency_key, source_answer_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.sessionId, row.name, row.kind, row.location, 1, row.createdAt, row.savedAt,
          row.nativeSessionId, row.projectIdentity, row.bindingGeneration, row.projectRevision,
          row.nativeVendor, row.nativeAgent, row.contentDigest, row.idempotencyKey,
          row.sourceAnswerId);
      return { row, created: true };
    } catch (error) {
      const winner = this.getNativeArtifactByIdempotency(params.nativeSessionId, params.idempotencyKey);
      if (winner) return { row: winner, created: false };
      throw error;
    }
  }

  getNativeArtifactByIdempotency(nativeSessionId: string, idempotencyKey: string): ArtifactRow | undefined {
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE native_session_id = ? AND idempotency_key = ?`).get(nativeSessionId, idempotencyKey);
    return row ? rowToArtifact(row) : undefined;
  }

  getArtifact(id: string): ArtifactRow | undefined {
    const row = this.db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id);
    return row ? rowToArtifact(row) : undefined;
  }

  /** Only artifacts the user explicitly saved — see `saveArtifact`. Auto-created (Mode A/B) rows stay off the Artifacts page until saved. `getArtifact` stays unfiltered for direct-id lookups (content route, save route). */
  listArtifacts(): ArtifactRow[] {
    const rows = this.db.prepare(`SELECT * FROM artifacts WHERE saved_at IS NOT NULL ORDER BY created_at DESC`).all();
    return rows.map(rowToArtifact);
  }

  /**
   * Marks an artifact saved (visible via `listArtifacts()`). Idempotent: a
   * repeat call on an already-saved artifact is a no-op that returns the
   * existing row unchanged — it never overwrites the original `saved_at`.
   * Returns `undefined` if the artifact doesn't exist.
   */
  saveArtifact(artifactId: string): ArtifactRow | undefined {
    const existing = this.getArtifact(artifactId);
    if (!existing) return undefined;
    if (existing.savedAt !== null) return existing;
    const savedAt = new Date().toISOString();
    this.db.prepare(`UPDATE artifacts SET saved_at = ? WHERE id = ?`).run(savedAt, artifactId);
    return { ...existing, savedAt };
  }

  /**
   * The mirror of `saveArtifact`: clears `saved_at` back to
   * `null`, removing the artifact from `listArtifacts()` while leaving its
   * row and envelope file untouched (Unpin is fully reversible — see
   * `unsaveArtifactForSession`). Idempotent: a repeat call on an
   * already-unsaved artifact is a no-op that returns the existing row
   * unchanged. Returns `undefined` if the artifact doesn't exist.
   */
  unsaveArtifact(artifactId: string): ArtifactRow | undefined {
    const existing = this.getArtifact(artifactId);
    if (!existing) return undefined;
    if (existing.savedAt === null) return existing;
    this.db.prepare(`UPDATE artifacts SET saved_at = NULL WHERE id = ?`).run(artifactId);
    return { ...existing, savedAt: null };
  }

  publishArtifact(artifactId: string, link: string, scope: PublishScope): PublicationRow {
    const row: PublicationRow = { artifactId, link, scope, createdAt: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO publications (artifact_id, link, scope, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(artifact_id) DO UPDATE SET link = excluded.link, scope = excluded.scope, created_at = excluded.created_at`,
      )
      .run(row.artifactId, row.link, row.scope, row.createdAt);
    return row;
  }

  getPublication(artifactId: string): PublicationRow | undefined {
    const row = this.db.prepare(`SELECT * FROM publications WHERE artifact_id = ?`).get(artifactId);
    return row
      ? { artifactId: str(row, "artifact_id"), link: str(row, "link"), scope: str(row, "scope") as PublishScope, createdAt: str(row, "created_at") }
      : undefined;
  }

  // ---------------------------------------------------------------------
  // eval runs
  // ---------------------------------------------------------------------

  listEvalRuns(): EvalRun[] {
    const rows = this.db.prepare(`SELECT * FROM eval_runs ORDER BY when_ts DESC`).all();
    return rows.map(rowToEvalRun);
  }

  getEvalRun(id: string): EvalRunWithScores | undefined {
    const row = this.db.prepare(`SELECT * FROM eval_runs WHERE id = ?`).get(id);
    if (!row) return undefined;
    const componentScores = JSON.parse(str(row, "component_scores_json")) as ComponentScore[];
    return { ...rowToEvalRun(row), componentScores };
  }

  // ---------------------------------------------------------------------
  // config (generic JSON blob store)
  // ---------------------------------------------------------------------

  getConfigJson<T>(key: string): T | undefined {
    const row = this.db.prepare(`SELECT value_json FROM config WHERE key = ?`).get(key);
    return row ? (JSON.parse(str(row, "value_json")) as T) : undefined;
  }

  setConfigJson(key: string, value: unknown): void {
    this.db
      .prepare(`INSERT INTO config (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
      .run(key, JSON.stringify(value));
  }

  /** Removes a config key entirely (so its getter falls back to `undefined`). Used by `resetSetup`. */
  deleteConfig(key: string): void {
    this.db.prepare(`DELETE FROM config WHERE key = ?`).run(key);
  }

  // ---------------------------------------------------------------------
  // typed config accessors
  // ---------------------------------------------------------------------

  getRuntimeSettings(): RuntimeSettings {
    const settings = this.getConfigJson<RuntimeSettings>("runtime.settings");
    if (!settings) throw new Error("runtime.settings missing — seedIfEmpty should have populated it");
    // Backward-compatible read for databases created before the provider was
    // persisted explicitly. Claude was the only subscription backend then.
    const legacyDriver = settings.tierModels.find((binding) => binding.tier === "orchestrator")?.model;
    return {
      ...settings,
      subscriptionProvider: settings.subscriptionProvider ?? "claude",
      // Databases written before tier rows became bundle-owned may contain an
      // `orchestrator` pseudo-tier. Read it as the dispatcher driver while
      // ensuring it never reappears as a user-facing compiled-bundle row.
      tierModels: settings.tierModels.filter((binding) => binding.tier !== "orchestrator"),
      ...(settings.subscriptionDriverModel !== undefined || legacyDriver === undefined
        ? {}
        : { subscriptionDriverModel: legacyDriver }),
    };
  }

  /**
   * Persists a user-validated runtime choice. The separate marker matters:
   * seeded display defaults are not authority to replace environment/CLI boot
   * routing. Only a successful PUT (or an explicit programmatic equivalent)
   * may supersede those boot flags.
   */
  setRuntimeSettings(settings: RuntimeSettings, explicit = true): void {
    this.setConfigJson("runtime.settings", settings);
    if (explicit) this.setConfigJson("runtime.settings.explicit", true);
    else this.deleteConfig("runtime.settings.explicit");
    this.setConfigJson("runtime.settings.generation", this.getRuntimeGeneration() + 1);
  }

  getRuntimeGeneration(): number {
    return this.getConfigJson<number>("runtime.settings.generation") ?? 0;
  }

  getNativeRuntimeBinding(): NativeRuntimeBinding {
    return resolveNativeRuntimeBinding(this.getRuntimeSettings(), this.hasExplicitRuntimeSettings(), this.getRuntimeGeneration());
  }

  /** Atomically persist a new runtime fence and stop every incompatible live row. */
  setRuntimeSettingsAndRevokeIncompatibleNativeSessions(settings: RuntimeSettings, explicit = true): readonly string[] {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const generation = this.getRuntimeGeneration() + 1;
      const target = resolveNativeRuntimeBinding(settings, explicit, generation).target ?? null;
      const ids = this.db.prepare(
        `SELECT id FROM native_sessions WHERE status IN ('creating', 'running', 'detached')
         AND (? IS NULL OR dispatch_target IS NULL OR dispatch_target <> ?)`,
      ).all(target, target).map((row) => str(row as Record<string, unknown>, "id"));
      const now = this.now().toISOString();
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        this.db.prepare(`UPDATE native_sessions SET status = 'stopped', updated_at = ?, ended_at = ?, failure = 'native runtime binding changed' WHERE id IN (${placeholders})`).run(now, now, ...ids);
        this.db.prepare(`DELETE FROM native_setup_recovery_actions WHERE session_id IN (${placeholders})`).run(...ids);
      }
      this.setConfigJson("runtime.settings", settings);
      if (explicit) this.setConfigJson("runtime.settings.explicit", true);
      else this.deleteConfig("runtime.settings.explicit");
      this.setConfigJson("runtime.settings.generation", generation);
      this.db.exec("COMMIT");
      return ids;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Whether runtime.settings came from an explicit validated save, not seed data. */
  hasExplicitRuntimeSettings(): boolean {
    const marker = this.getConfigJson<boolean>("runtime.settings.explicit");
    if (marker !== undefined) return marker;
    // Backward-compatible inference for databases written before the marker:
    // saving runtime settings also completed the wizard's runtime step.
    return this.getSetupSteps().find((step) => step.key === "runtime")?.state === "done";
  }

  getSetupSteps(): SetupStep[] {
    const steps = this.getConfigJson<SetupStep[]>("setup.steps");
    if (!steps) throw new Error("setup.steps missing — seedIfEmpty should have populated it");
    return steps;
  }

  setSetupSteps(steps: SetupStep[]): void {
    this.setConfigJson("setup.steps", coerceOrphanedTodoSteps(steps));
  }

  /**
   * Commits the context foundation's accepted lifecycle as one SQLite unit.
   * The caller has already completed parser/artifact/compile gates; this
   * method makes its visible success state reload-safe by never exposing a
   * partial step/event/turn/session transition.
   */
  completeContextSetupSuccess(params: ContextSetupSuccessPersistence): void {
    this.db.exec("BEGIN");
    try {
      this.setSetupSteps(params.steps);
      this.onContextSuccessWrite?.("after_steps");
      this.insertEvent({ sessionId: params.sessionId, kind: "setup_status", payload: params.statusEvent, turnId: params.turnId });
      this.onContextSuccessWrite?.("after_event");
      this.resolveTurn(params.turnId, {
        backend: params.backend,
        resultKind: "answer",
        answerSummary: params.answerSummary,
        traceJson: params.traceJson,
        errorMessage: params.errorMessage,
      });
      this.onContextSuccessWrite?.("after_turn");
      this.updateSessionStatus(params.sessionId, "active", null);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Which of the wizard's two entry paths the user picked (`SetupMode`,
   * `POST /api/setup/mode`) — `undefined` before they've picked either,
   * which the frontend reads as "show the create-vs-adopt choice screen"
   * (see `GET /api/setup/mode`). Not seeded (no `SEED_*` constant): a fresh
   * DB simply has no value here until the user chooses.
   */
  getSetupMode(): SetupMode | undefined {
    return this.getConfigJson<SetupMode>("setup.mode");
  }

  setSetupMode(mode: SetupMode): void {
    this.setConfigJson("setup.mode", mode);
  }

  getVerifyGatePassed(): boolean {
    return this.getConfigJson<boolean>("setup.verifyGatePassed") ?? false;
  }

  setVerifyGatePassed(value: boolean): void {
    this.setConfigJson("setup.verifyGatePassed", value);
  }

  /**
   * The single dedicated session the setup wizard's connect/resume turns run
   * in (get-or-create — see `POST /api/setup/connect`). Kept separate from
   * the Ask page's session list so setup dispatches never appear there.
   *
   * Single-bootstrap-per-process assumption: this is a process-wide singleton
   * (one row in config), not scoped per browser tab/user — fine for the
   * one-BFF-per-project bootstrap flow, but would need to become session- or
   * request-scoped if this BFF ever serves multiple concurrent setup wizards.
   */
  getSetupSessionId(): string | undefined {
    return this.getConfigJson<string>("setup.sessionId");
  }

  setSetupSessionId(id: string): void {
    this.setConfigJson("setup.sessionId", id);
  }

  /**
   * The connect form's structured values (project name + source type),
   * persisted at `POST /api/setup/connect` time so the `connect_resume` turn
   * doesn't require the frontend to resend them, and so `executeSetupTurn`
   * (`server/turn.ts`) has the `{root, name}` context `parseSetupTerminal`
   * needs without having to parse it back out of `composedInput` prose.
   */
  getSetupConnectForm(): { projectName: string; sourceType: string; variant?: string } | undefined {
    return this.getConfigJson<{ projectName: string; sourceType: string; variant?: string }>("setup.connectForm");
  }

  setSetupConnectForm(form: { projectName: string; sourceType: string; variant?: string }): void {
    this.setConfigJson("setup.connectForm", form);
  }

  getSetupContextLifecycleEvidence(sessionId: string, identityFingerprint: string): SetupContextLifecycleEvidence | undefined {
    const value = this.getConfigJson<unknown>("setup.contextLifecycleEvidence");
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).sessionId !== sessionId ||
      (value as Record<string, unknown>).identityFingerprint !== identityFingerprint ||
      !["none", "discovery", "validate", "build"].includes((value as Record<string, unknown>).completed as string)
    ) {
      // A malformed, stale-session, or stale-identity checkpoint must never
      // influence a new project. Remove it rather than guessing how to merge.
      if (value !== undefined) this.deleteConfig("setup.contextLifecycleEvidence");
      return undefined;
    }
    return value as SetupContextLifecycleEvidence;
  }

  mergeSetupContextLifecycleEvidence(input: SetupContextLifecycleEvidence): SetupContextLifecycleEvidence {
    const current = this.getSetupContextLifecycleEvidence(input.sessionId, input.identityFingerprint);
    const rank = (value: SetupContextLifecyclePrefix): number => ["none", "discovery", "validate", "build"].indexOf(value);
    const merged: SetupContextLifecycleEvidence = {
      sessionId: input.sessionId,
      identityFingerprint: input.identityFingerprint,
      completed: current && rank(current.completed) > rank(input.completed) ? current.completed : input.completed,
    };
    this.setConfigJson("setup.contextLifecycleEvidence", merged);
    return merged;
  }

  clearSetupContextLifecycleEvidence(): void {
    this.deleteConfig("setup.contextLifecycleEvidence");
  }

  getContextModels(): SemanticModel[] {
    return this.getConfigJson<SemanticModel[]>("context.models") ?? [];
  }

  getContextRelationships(): SemanticRelationship[] {
    return this.getConfigJson<SemanticRelationship[]>("context.relationships") ?? [];
  }

  getContextMeasures(): SemanticMeasure[] {
    return this.getConfigJson<SemanticMeasure[]>("context.measures") ?? [];
  }

  getContextKnowledge(): KnowledgeStatus {
    return this.getConfigJson<KnowledgeStatus>("context.knowledge") ?? { instructionsPresent: false, verifiedPairCount: 0 };
  }

  getContextFiles(): ContextFileNode[] {
    return this.getConfigJson<ContextFileNode[]>("context.files") ?? [];
  }

  getBlastRadius(entityKey: string): BlastRadius | undefined {
    const map = this.getConfigJson<Record<string, BlastRadius>>("context.blastRadius") ?? {};
    return map[entityKey];
  }

  getVerifiedPairs(): { question: string; refs: string[] }[] {
    return this.getConfigJson<{ question: string; refs: string[] }[]>("context.verifiedPairs") ?? [];
  }

  // ---------------------------------------------------------------------
  // Optional post-bind enrichment. The durable operation ledger lives here,
  // never in a project artifact or a provider session.
  // ---------------------------------------------------------------------

  /**
   * Persists a run BEFORE any model turn is dispatched, in a running
   * ('drafting') state, with the bound revision and generation locked for
   * the lifetime of the draft. This is the enrichment analogue of
   * `postTurn` creating a turn row (`resultKind: null`) ahead of `route()`:
   * the row -- and therefore `GET /api/context/enrichment`'s visibility of
   * it -- exists for the entire ~minutes-long dispatch, not only after it
   * resolves. Every exit path from that dispatch must resolve this row to a
   * terminal status via `finalizeEnrichmentDraft` or `failEnrichmentRun`
   * (or, after a process restart, `reconcileOrphanedEnrichmentRuns`).
   */
  createDraftingEnrichmentRun(params: { readonly id: string; readonly mode: EnrichmentMode; readonly binding: EnrichmentBinding }): EnrichmentRunRow {
    const now = this.now().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`INSERT INTO enrichment_runs (id, mode, project_path, project_identity, project_revision, proposal_id, proposal_hash, status, created_at, updated_at, validation_digest, build_digest, error_message, binding_generation, version) VALUES (?, ?, ?, ?, ?, '', '', 'drafting', ?, ?, NULL, NULL, NULL, ?, 1)`).run(params.id, params.mode, params.binding.path, params.binding.identity, params.binding.revision, now, now, params.binding.generation);
      this.onEnrichmentCreationWrite?.("after_run");
      this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, 'started', ?, ?)`).run(newId("enrichment-event"), params.id, "Enrichment draft started.", now);
      this.onEnrichmentCreationWrite?.("after_event");
      this.db.exec("COMMIT");
      return this.getEnrichmentRun(params.id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Transitions a 'drafting' run to 'awaiting_decision' once the draft
   * callback has resolved AND been independently canonicalized by the host.
   * Fenced on `status = 'drafting'` plus the CAS version, so a run that a
   * restart already reconciled to 'failed' (or that was somehow already
   * finalized) cannot be resurrected by a late completion.
   */
  finalizeEnrichmentDraft(params: { readonly runId: string; readonly expectedVersion: number; readonly proposalId: string; readonly proposalHash: string; readonly operations: readonly EnrichmentOperation[]; readonly validationDigest?: string; readonly buildDigest?: string }): boolean {
    this.db.exec("BEGIN");
    try {
      const now = this.now().toISOString();
      const changedRun = this.db.prepare(`UPDATE enrichment_runs SET status = 'awaiting_decision', proposal_id = ?, proposal_hash = ?, validation_digest = ?, build_digest = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'drafting'`).run(params.proposalId, params.proposalHash, params.validationDigest ?? null, params.buildDigest ?? null, now, params.runId, params.expectedVersion).changes;
      if (Number(changedRun) !== 1) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.onEnrichmentCreationWrite?.("after_run");
      for (const operation of params.operations) this.db.prepare(`INSERT INTO enrichment_operations (run_id, operation_id, sink, risk, summary, draft, change_kind, confidence, decision, completed, state, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'awaiting_decision', ?)`).run(params.runId, operation.id, operation.sink, operation.risk, operation.summary, operation.draft, operation.changeKind, operation.confidence, `${params.runId}:${operation.id}`);
      this.onEnrichmentCreationWrite?.("after_operations");
      this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, 'drafted', ?, ?)`).run(newId("enrichment-event"), params.runId, "A typed enrichment proposal is ready for review.", now);
      this.onEnrichmentCreationWrite?.("after_event");
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Resolves a 'drafting' run to the terminal 'failed' status -- the
   * enrichment analogue of `resolveTurn(..., { resultKind: "error" })` in
   * every catch clause of `executeTurn`. Called on a thrown draft/contract
   * error, a stale post-draft binding, or (via
   * `reconcileOrphanedEnrichmentRuns`) a BFF restart. Fenced on
   * `status = 'drafting'` so it can never clobber a run that already
   * finalized.
   */
  failEnrichmentRun(params: { readonly runId: string; readonly expectedVersion: number; readonly message: string }): boolean {
    this.db.exec("BEGIN");
    try {
      const now = this.now().toISOString();
      const changedRun = this.db.prepare(`UPDATE enrichment_runs SET status = 'failed', error_message = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'drafting'`).run(params.message, now, params.runId, params.expectedVersion).changes;
      if (Number(changedRun) !== 1) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.onEnrichmentTransitionWrite?.("after_run");
      this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, 'failed', ?, ?)`).run(newId("enrichment-event"), params.runId, "Enrichment draft failed.", now);
      this.onEnrichmentTransitionWrite?.("after_event");
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createEnrichmentRun(params: { readonly id: string; readonly mode: EnrichmentMode; readonly binding: EnrichmentBinding; readonly proposalId: string; readonly proposalHash: string; readonly operations: readonly EnrichmentOperation[]; readonly validationDigest?: string; readonly buildDigest?: string }): EnrichmentRunRow {
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`INSERT INTO enrichment_runs (id, mode, project_path, project_identity, project_revision, proposal_id, proposal_hash, status, created_at, updated_at, validation_digest, build_digest, error_message, binding_generation, version) VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_decision', ?, ?, ?, ?, NULL, ?, 1)`).run(params.id, params.mode, params.binding.path, params.binding.identity, params.binding.revision, params.proposalId, params.proposalHash, now, now, params.validationDigest ?? null, params.buildDigest ?? null, params.binding.generation);
      this.onEnrichmentCreationWrite?.("after_run");
      for (const operation of params.operations) this.db.prepare(`INSERT INTO enrichment_operations (run_id, operation_id, sink, risk, summary, draft, change_kind, confidence, decision, completed, state, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'awaiting_decision', ?)`).run(params.id, operation.id, operation.sink, operation.risk, operation.summary, operation.draft, operation.changeKind, operation.confidence, `${params.id}:${operation.id}`);
      this.onEnrichmentCreationWrite?.("after_operations");
      this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, 'drafted', ?, ?)`).run(newId("enrichment-event"), params.id, "A typed enrichment proposal is ready for review.", now);
      this.onEnrichmentCreationWrite?.("after_event");
      this.db.exec("COMMIT");
      return this.getEnrichmentRun(params.id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Every bind, including the same canonical directory, creates a new
   * generation. `bindProject` (the foundation path) never has a built
   * project's revision to offer — binding must succeed for an unbuilt
   * project — so it activates identity alone; the stored placeholder
   * revision is never read as a trusted value. Every consumer re-resolves
   * the revision fresh from disk before treating a binding as current (see
   * `currentEnrichmentBinding` in app.ts), so a placeholder here cannot
   * leak into a fencing decision.
   */
  activateEnrichmentBinding(binding: UnversionedEnrichmentBinding | ProjectIdentity): EnrichmentBinding {
    const current = this.getEnrichmentBinding();
    const revision = "revision" in binding ? binding.revision : "";
    const next: EnrichmentBinding = { ...binding, revision, generation: (current?.generation ?? 0) + 1 };
    this.setConfigJson("enrichment.binding", next);
    return next;
  }

  /**
   * Advances the project binding and stops every live project-scoped native
   * session in one transaction. The caller must immediately discard the
   * corresponding in-memory PTY and MCP capabilities using the returned ids.
   * Bootstrap Setup sessions deliberately remain outside this project fence.
   */
  activateEnrichmentBindingAndRevokeBoundNativeSessions(binding: UnversionedEnrichmentBinding | ProjectIdentity): { readonly binding: EnrichmentBinding; readonly revokedNativeSessionIds: readonly string[] } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getEnrichmentBinding();
      const revision = "revision" in binding ? binding.revision : "";
      const next: EnrichmentBinding = { ...binding, revision, generation: (current?.generation ?? 0) + 1 };
      const ids = this.db.prepare(
        `SELECT id FROM native_sessions
         WHERE status IN ('creating', 'running', 'detached') AND project_identity IS NOT NULL`,
      ).all().map((row) => str(row as Record<string, unknown>, "id"));
      const now = this.now().toISOString();
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        this.db.prepare(`UPDATE native_sessions SET status = 'stopped', updated_at = ?, ended_at = ?, failure = 'native project binding changed' WHERE id IN (${placeholders})`).run(now, now, ...ids);
        this.db.prepare(`DELETE FROM native_setup_recovery_actions WHERE session_id IN (${placeholders})`).run(...ids);
      }
      this.setConfigJson("enrichment.binding", next);
      this.db.exec("COMMIT");
      return { binding: next, revokedNativeSessionIds: ids };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  getEnrichmentBinding(): EnrichmentBinding | undefined { return this.getConfigJson<EnrichmentBinding>("enrichment.binding"); }

  getEnrichmentRun(id: string): EnrichmentRunRow | undefined { const row = this.db.prepare(`SELECT * FROM enrichment_runs WHERE id = ?`).get(id); return row ? rowToEnrichmentRun(row) : undefined; }
  getLatestEnrichmentRun(): EnrichmentRunRow | undefined { const row = this.db.prepare(`SELECT * FROM enrichment_runs ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(); return row ? rowToEnrichmentRun(row) : undefined; }
  listEnrichmentOperations(runId: string): EnrichmentOperationRow[] { return this.db.prepare(`SELECT * FROM enrichment_operations WHERE run_id = ? ORDER BY rowid ASC`).all(runId).map(rowToEnrichmentOperation); }
  getEnrichmentOperation(runId: string, operationId: string): EnrichmentOperationRow | undefined { const row = this.db.prepare(`SELECT * FROM enrichment_operations WHERE run_id = ? AND operation_id = ?`).get(runId, operationId); return row ? rowToEnrichmentOperation(row) : undefined; }
  appendEnrichmentEvent(runId: string, kind: string, message: string): void { this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)`).run(newId("enrichment-event"), runId, kind, message, new Date().toISOString()); }
  listEnrichmentEvents(runId: string): EnrichmentEventRow[] { return this.db.prepare(`SELECT * FROM enrichment_events WHERE run_id = ? ORDER BY created_at ASC, rowid ASC`).all(runId).map(rowToEnrichmentEvent); }
  /**
   * The authority for non-lease enrichment mutations. It checks both the
   * caller's snapshot and the DB version before making *any* write; operation,
   * attestation, run metadata and event then commit or roll back together.
   */
  transitionEnrichmentMetadata(params: EnrichmentMetadataTransition): boolean {
    this.db.exec("BEGIN");
    try {
      const run = this.getEnrichmentRun(params.runId);
      if (!run
        || run.version !== params.expectedVersion
        || run.projectPath !== params.binding.path
        || run.projectIdentity !== params.binding.identity
        || run.projectRevision !== params.binding.revision
        || run.bindingGeneration !== params.binding.generation) {
        this.db.exec("ROLLBACK");
        return false;
      }
      if (params.operation) {
        const operation = params.operation;
        const decisionClause = operation.expectedDecision === undefined
          ? ""
          : operation.expectedDecision === null ? " AND decision IS NULL" : " AND decision = ?";
        const values: (string | null)[] = [operation.decision ?? null, operation.nextState, params.runId, operation.id, operation.expectedState];
        if (operation.expectedDecision !== undefined && operation.expectedDecision !== null) values.push(operation.expectedDecision);
        const changed = this.db.prepare(`UPDATE enrichment_operations SET decision = COALESCE(?, decision), state = ? WHERE run_id = ? AND operation_id = ? AND state = ?${decisionClause}`).run(...values).changes;
        if (Number(changed) !== 1) { this.db.exec("ROLLBACK"); return false; }
        this.onEnrichmentTransitionWrite?.("after_operation");
      }
      if (params.attestation !== undefined) {
        const operation = params.operation ? this.getEnrichmentOperation(params.runId, params.operation.id) : undefined;
        const attestation = params.attestation;
        if (!operation
          || attestation.binding.path !== run.projectPath
          || attestation.binding.identity !== run.projectIdentity
          || attestation.binding.generation !== run.bindingGeneration
          || attestation.binding.revision !== run.projectRevision
          || attestation.proposalHash !== run.proposalHash
          || attestation.operationHash !== hashEnrichmentOperation(operation)
          || !Number.isFinite(Date.parse(attestation.expiresAt))
          || Date.parse(attestation.expiresAt) <= this.now().getTime()) {
          this.db.exec("ROLLBACK");
          return false;
        }
        try {
          this.db.prepare(`INSERT INTO enrichment_approvals (run_id, operation_id, project_revision, proposal_hash, risk, attested_at, project_path, project_identity, binding_generation, operation_hash, sink, change_kind, evidence_ref, nonce, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(params.runId, operation.id, run.projectRevision, run.proposalHash, operation.risk, this.now().toISOString(), run.projectPath, run.projectIdentity, run.bindingGeneration, attestation.operationHash, operation.sink, operation.changeKind, attestation.evidenceRef, attestation.nonce, attestation.expiresAt);
        } catch {
          this.db.exec("ROLLBACK");
          return false;
        }
      }
      const now = this.now().toISOString();
      const changedRun = this.db.prepare(`UPDATE enrichment_runs SET status = COALESCE(?, status), error_message = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`).run(params.status ?? null, params.errorMessage === undefined ? run.errorMessage : params.errorMessage, now, params.runId, params.expectedVersion).changes;
      if (Number(changedRun) !== 1) { this.db.exec("ROLLBACK"); return false; }
      this.onEnrichmentTransitionWrite?.("after_run");
      for (const event of [params.event, ...(params.additionalEvents ?? [])].filter((value): value is { readonly kind: string; readonly message: string } => value !== undefined)) {
        this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)`).run(newId("enrichment-event"), params.runId, event.kind, event.message, now);
        this.onEnrichmentTransitionWrite?.("after_event");
      }
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  transitionEnrichmentEdit(params: EnrichmentEditTransition): boolean {
    this.db.exec("BEGIN");
    try {
      const run = this.getEnrichmentRun(params.runId);
      const current = this.getEnrichmentOperation(params.runId, params.operationId);
      if (!run || !current || run.version !== params.expectedVersion
        || run.projectPath !== params.binding.path || run.projectIdentity !== params.binding.identity
        || run.projectRevision !== params.binding.revision || run.bindingGeneration !== params.binding.generation
        || current.state !== "awaiting_decision" || current.decision !== "edit") {
        this.db.exec("ROLLBACK");
        return false;
      }
      const changedOperation = this.db.prepare(`UPDATE enrichment_operations SET operation_id = ?, sink = ?, risk = ?, summary = ?, draft = ?, change_kind = ?, confidence = ?, decision = NULL, state = 'awaiting_decision', attempt = 0, lease_token = NULL, lease_expires_at = NULL, idempotency_key = ? WHERE run_id = ? AND operation_id = ? AND state = 'awaiting_decision' AND decision = 'edit'`)
        .run(params.operation.id, params.operation.sink, params.operation.risk, params.operation.summary, params.operation.draft, params.operation.changeKind, params.operation.confidence, `${params.runId}:${params.operation.id}`, params.runId, params.operationId).changes;
      if (Number(changedOperation) !== 1) { this.db.exec("ROLLBACK"); return false; }
      this.onEnrichmentTransitionWrite?.("after_operation");
      const now = this.now().toISOString();
      const changedRun = this.db.prepare(`UPDATE enrichment_runs SET proposal_id = ?, proposal_hash = ?, status = 'awaiting_decision', error_message = NULL, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
        .run(params.proposalId, params.proposalHash, now, params.runId, params.expectedVersion).changes;
      if (Number(changedRun) !== 1) { this.db.exec("ROLLBACK"); return false; }
      this.onEnrichmentTransitionWrite?.("after_run");
      this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)`).run(newId("enrichment-event"), params.runId, params.event.kind, params.event.message, now);
      this.onEnrichmentTransitionWrite?.("after_event");
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  transitionEnrichmentExecution(params: EnrichmentExecutionTransition): boolean {
    this.db.exec("BEGIN");
    try {
      const run = this.getEnrichmentRun(params.runId);
      const operation = this.getEnrichmentOperation(params.runId, params.operationId);
      if (!run || !operation || run.version !== params.expectedVersion
        || run.projectPath !== params.binding.path || run.projectIdentity !== params.binding.identity
        || run.projectRevision !== params.binding.revision || run.bindingGeneration !== params.binding.generation
        || !params.expectedStates.includes(operation.state)
        || (params.expectedAttempt !== undefined && operation.attempt !== params.expectedAttempt)
        || (params.expectedLeaseToken !== undefined && operation.leaseToken !== params.expectedLeaseToken)) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const changedOperation = this.db.prepare(`UPDATE enrichment_operations SET state = ?, attempt = ?, lease_token = ?, lease_expires_at = ?, completed = ? WHERE run_id = ? AND operation_id = ? AND state = ? AND attempt = ? AND (lease_token IS ? OR lease_token = ?)`)
        .run(params.nextState, params.nextAttempt ?? operation.attempt, params.leaseToken === undefined ? operation.leaseToken : params.leaseToken, params.leaseExpiresAt === undefined ? operation.leaseExpiresAt : params.leaseExpiresAt, boolToInt(params.completed ?? operation.completed), params.runId, params.operationId, operation.state, operation.attempt, operation.leaseToken, operation.leaseToken).changes;
      if (Number(changedOperation) !== 1) { this.db.exec("ROLLBACK"); return false; }
      this.onEnrichmentTransitionWrite?.("after_operation");
      const now = this.now().toISOString();
      const changedRun = this.db.prepare(`UPDATE enrichment_runs SET status = ?, validation_digest = ?, build_digest = ?, error_message = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
        .run(params.status, params.validationDigest === undefined ? run.validationDigest : params.validationDigest, params.buildDigest === undefined ? run.buildDigest : params.buildDigest, params.errorMessage === undefined ? run.errorMessage : params.errorMessage, now, params.runId, params.expectedVersion).changes;
      if (Number(changedRun) !== 1) { this.db.exec("ROLLBACK"); return false; }
      this.onEnrichmentTransitionWrite?.("after_run");
      this.db.prepare(`INSERT INTO enrichment_events (id, run_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)`).run(newId("enrichment-event"), params.runId, params.event.kind, params.event.message, now);
      this.onEnrichmentTransitionWrite?.("after_event");
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  hasExactEnrichmentAttestation(runId: string, operationId: string): boolean {
    const run = this.getEnrichmentRun(runId);
    const operation = this.getEnrichmentOperation(runId, operationId);
    if (!run || !operation) return false;
    return this.db.prepare(`SELECT 1 FROM enrichment_approvals WHERE run_id = ? AND operation_id = ? AND project_path = ? AND project_identity = ? AND binding_generation = ? AND project_revision = ? AND proposal_hash = ? AND operation_hash = ? AND risk = ? AND sink = ? AND change_kind = ? AND expires_at > ? AND evidence_ref <> '' AND nonce <> ''`).get(runId, operationId, run.projectPath, run.projectIdentity, run.bindingGeneration, run.projectRevision, run.proposalHash, hashEnrichmentOperation(operation), operation.risk, operation.sink, operation.changeKind, this.now().toISOString()) !== undefined;
  }

  // ---------------------------------------------------------------------
  // seed data (first init only — a fresh :memory: or file DB has no sessions row)
  // ---------------------------------------------------------------------

  private seedIfEmpty(): void {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM eval_runs`).get();
    if (row && num(row, "n") > 0) return; // already seeded

    this.seedEvalRuns();
    this.setRuntimeSettings(SEED_RUNTIME_SETTINGS, false);
    this.setSetupSteps(SEED_SETUP_STEPS);
    this.setVerifyGatePassed(false);
    this.seedContext();
  }

  /**
   * Restores the setup wizard to its first-run state (for the "Reset setup"
   * action): steps back to step 1, runtime settings back to defaults, verify
   * gate off, and the connect form + setup session cleared. Non-destructive —
   * this only touches wizard STATE; it never deletes scaffolded project files
   * on disk (the caller unbinds the bootstrap project separately). Leaves the
   * seeded eval/context fixtures alone (they aren't part of the wizard).
   *
   * Clearing `setup.sessionId` used to leave the tracked
   * setup session's ROW behind. `GET /api/sessions` filters the list by id
   * against `getSetupSessionId()`, so once the id was forgotten that row
   * matched nothing and leaked back into the Ask sidebar as an orphaned
   * "Setup: <name>" session. Delete the row (and its turns/events/artifacts)
   * BEFORE forgetting the id, so no orphan is ever left behind.
   */
  resetSetup(): readonly string[] {
    const staleSetupSessionId = this.getSetupSessionId();
    if (staleSetupSessionId !== undefined) this.deleteSession(staleSetupSessionId);

    this.setSetupSteps(SEED_SETUP_STEPS);
    const revokedNativeSessionIds = this.setRuntimeSettingsAndRevokeIncompatibleNativeSessions(SEED_RUNTIME_SETTINGS, false);
    this.setVerifyGatePassed(false);
    this.deleteConfig("setup.connectForm");
    this.deleteConfig("setup.sessionId");
    this.deleteConfig("setup.mode");
    this.clearSetupContextLifecycleEvidence();
    return revokedNativeSessionIds;
  }

  private seedEvalRuns(): void {
    const runs: (EvalRun & { componentScores: ComponentScore[] })[] = [
      {
        id: "eval-1",
        when: "2026-07-10T09:00:00Z",
        score: 0.87,
        gateThreshold: 0.8,
        gatePass: true,
        regressions: 0,
        cost: "$1.20",
        p50: "820ms",
        componentScores: [
          { component: "sql_generation", score: 0.91, delta: 0.02 },
          { component: "render", score: 0.85, delta: -0.01 },
        ],
      },
      {
        id: "eval-2",
        when: "2026-07-13T09:00:00Z",
        score: 0.79,
        gateThreshold: 0.8,
        gatePass: false,
        regressions: 2,
        cost: "$1.35",
        p50: "910ms",
        componentScores: [
          { component: "sql_generation", score: 0.8, delta: -0.11 },
          { component: "render", score: 0.78, delta: -0.07 },
        ],
      },
      {
        id: "eval-3",
        when: "2026-07-16T09:00:00Z",
        score: 0.91,
        gateThreshold: 0.8,
        gatePass: true,
        regressions: 0,
        cost: "$1.10",
        p50: "790ms",
        componentScores: [
          { component: "sql_generation", score: 0.94, delta: 0.14 },
          { component: "render", score: 0.88, delta: 0.1 },
        ],
      },
    ];
    const stmt = this.db.prepare(
      `INSERT INTO eval_runs (id, when_ts, score, gate_threshold, gate_pass, regressions, cost, p50, component_scores_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const run of runs) {
      stmt.run(run.id, run.when, run.score, run.gateThreshold, boolToInt(run.gatePass), run.regressions, run.cost, run.p50, JSON.stringify(run.componentScores));
    }
  }

  /**
   * Fixture data: two `BlastRadius` seeds (`customers`, `products`) and
   * three verified Q-SQL pairs whose `refs` deliberately intersect one seed's
   * downstream set and miss the other's, so `server/impact.ts`'s live join
   * (see that file's doc comment) is actually exercised both ways — not
   * vacuously "always non-empty".
   */
  private seedContext(): void {
    const models: SemanticModel[] = [
      { key: "customers", name: "Customers", position: { x: 0, y: 0 }, columns: [{ name: "id", type: "bigint", key: "pk" }, { name: "name", type: "text" }] },
      {
        key: "orders",
        name: "Orders",
        position: { x: 240, y: 0 },
        columns: [
          { name: "id", type: "bigint", key: "pk" },
          { name: "customer_id", type: "bigint", key: "fk" },
          { name: "amount", type: "numeric" },
        ],
      },
      { key: "products", name: "Products", position: { x: 480, y: 0 }, columns: [{ name: "id", type: "bigint", key: "pk" }, { name: "name", type: "text" }] },
    ];
    const relationships: SemanticRelationship[] = [
      { key: "orders-customers", name: "Orders → Customers", fromModel: "orders", toModel: "customers", type: "many-to-one" },
      { key: "orders-products", name: "Orders → Products", fromModel: "orders", toModel: "products", type: "many-to-many" },
    ];
    const measures: SemanticMeasure[] = [
      { key: "total_revenue", name: "Total Revenue", baseModel: "orders", expression: "SUM(orders.amount)", additivity: "additive" },
      { key: "avg_order_value", name: "Average Order Value", baseModel: "orders", expression: "AVG(orders.amount)", additivity: "non-additive" },
    ];
    const knowledge: KnowledgeStatus = { instructionsPresent: true, verifiedPairCount: 3 };

    const files: ContextFileNode[] = [
      {
        key: "models",
        title: "Models",
        children: [
          { key: "file-customers", title: "customers.yaml", kind: "model", path: "models/customers.yaml", entityKey: "customers", content: "model: customers\ncolumns: [id, name]" },
          { key: "file-orders", title: "orders.yaml", kind: "model", path: "models/orders.yaml", entityKey: "orders", content: "model: orders\ncolumns: [id, customer_id, amount]" },
          { key: "file-products", title: "products.yaml", kind: "model", path: "models/products.yaml", entityKey: "products", content: "model: products\ncolumns: [id, name]" },
        ],
      },
      {
        key: "relationships",
        title: "Relationships",
        children: [
          {
            key: "file-orders-customers",
            title: "orders_customers.yaml",
            kind: "relationship",
            path: "relationships/orders_customers.yaml",
            entityKey: "orders-customers",
            content: "relationship: orders_customers\nfromModel: orders\ntoModel: customers\ntype: many-to-one\njoin:\n  type: inner\n  keys:\n    - from: orders.customer_id\n      to: customers.id\n",
          },
          {
            key: "file-orders-products",
            title: "orders_products.yaml",
            kind: "relationship",
            path: "relationships/orders_products.yaml",
            entityKey: "orders-products",
            content: "relationship: orders_products\nfromModel: orders\ntoModel: products\ntype: many-to-many\njoin:\n  type: inner\n  via: order_items\n  keys:\n    - from: orders.id\n      to: order_items.order_id\n    - from: order_items.product_id\n      to: products.id\n",
          },
        ],
      },
      {
        key: "cubes",
        title: "Cubes",
        children: [
          {
            key: "file-total-revenue",
            title: "total_revenue.yaml",
            kind: "cube",
            path: "cubes/total_revenue.yaml",
            entityKey: "total_revenue",
            content: "cube: total_revenue\nbaseModel: orders\nexpression: SUM(orders.amount)\nadditivity: additive\n",
          },
          {
            key: "file-avg-order-value",
            title: "avg_order_value.yaml",
            kind: "cube",
            path: "cubes/avg_order_value.yaml",
            entityKey: "avg_order_value",
            content: "cube: avg_order_value\nbaseModel: orders\nexpression: AVG(orders.amount)\nadditivity: non-additive\n",
          },
        ],
      },
      { key: "knowledge", title: "Knowledge", kind: "knowledge", path: "knowledge/instructions.md", content: "Always filter cancelled orders unless asked otherwise." },
    ];

    const blastRadius: Record<string, BlastRadius> = {
      customers: {
        seed: { key: "customers", name: "Customers", kind: "model" },
        downstream: [
          { key: "orders", name: "Orders", kind: "model" },
          { key: "total_revenue", name: "Total Revenue", kind: "measure" },
          { key: "orders-customers", name: "Orders → Customers", kind: "relationship" },
        ],
        severity: "structural",
      },
      products: {
        seed: { key: "products", name: "Products", kind: "model" },
        downstream: [{ key: "orders-products", name: "Orders → Products", kind: "relationship" }],
        severity: "compatibility",
      },
    };

    const verifiedPairs = [
      { question: "What is total revenue by customer this quarter?", refs: ["customers", "orders", "total_revenue"] },
      { question: "Which products had no orders last month?", refs: ["products", "orders-products"] },
      { question: "Show average order value trend.", refs: ["orders", "avg_order_value"] },
    ];

    this.setConfigJson("context.models", models);
    this.setConfigJson("context.relationships", relationships);
    this.setConfigJson("context.measures", measures);
    this.setConfigJson("context.knowledge", knowledge);
    this.setConfigJson("context.files", files);
    this.setConfigJson("context.blastRadius", blastRadius);
    this.setConfigJson("context.verifiedPairs", verifiedPairs);
  }
}

function rowToSession(row: Record<string, unknown>): SessionRow {
  return {
    id: str(row, "id"),
    title: str(row, "title"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
    status: str(row, "status") as SessionStatus,
    pendingQuestion: strOrNull(row, "pending_question"),
    pendingDecision: strOrNull(row, "pending_decision"),
  };
}

function rowToNativeSession(row: Record<string, unknown>): NativeSessionRow {
  return {
    id: str(row, "id"), purpose: str(row, "purpose") as NativeSessionPurpose,
    vendor: str(row, "vendor") as NativeSessionVendor, agent: str(row, "agent"),
    scopeKind: str(row, "scope_kind") as NativeSessionScopeKind, scopeId: str(row, "scope_id"),
    projectIdentity: strOrNull(row, "project_identity"),
    bindingGeneration: row["binding_generation"] === null ? null : num(row, "binding_generation"),
    projectRevision: strOrNull(row, "project_revision"),
    dispatchProfile: strOrNull(row, "dispatch_profile"),
    dispatchTarget: strOrNull(row, "dispatch_target"),
    runtimeGeneration: row["runtime_generation"] === null ? null : num(row, "runtime_generation"),
    status: str(row, "status") as NativeSessionStatus,
    createdAt: str(row, "created_at"), updatedAt: str(row, "updated_at"),
    startedAt: strOrNull(row, "started_at"), endedAt: strOrNull(row, "ended_at"),
    exitCode: row["exit_code"] === null ? null : num(row, "exit_code"), failure: strOrNull(row, "failure"),
  };
}

function rowToNativeSetupRecovery(row: Record<string, unknown>): NativeSetupRecoveryRow {
  return {
    sessionId: str(row, "session_id"),
    phase: str(row, "phase") as NativeSetupRecoveryPhase,
    state: str(row, "state") as NativeSetupRecoveryState,
    code: str(row, "code") as NativeSetupRecoveryCode,
    sequence: num(row, "sequence"),
    decision: strOrNull(row, "decision") as NativeSetupRecoveryRow["decision"],
    completionValidated: intToBool(row["completion_validated"]),
    version: num(row, "version"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToNativeStructuredAnswer(row: Record<string, unknown>): NativeStructuredAnswerRow {
  return {
    id: str(row, "id"),
    nativeSessionId: str(row, "native_session_id"),
    idempotencyKey: str(row, "idempotency_key"),
    envelopeJson: str(row, "envelope_json"),
    digest: str(row, "digest"),
    createdAt: str(row, "created_at"),
  };
}

function rowToEvent(row: Record<string, unknown>): StoredEvent {
  return {
    id: str(row, "id"),
    sessionId: str(row, "session_id"),
    seq: num(row, "seq"),
    kind: str(row, "kind") as SessionEvent["kind"],
    payload: JSON.parse(str(row, "payload_json")) as SessionEvent,
    createdAt: str(row, "created_at"),
    turnId: strOrNull(row, "turn_id"),
  };
}

function rowToTurn(row: Record<string, unknown>): TurnRow {
  return {
    id: str(row, "id"),
    sessionId: str(row, "session_id"),
    question: str(row, "question"),
    composedInput: strOrNull(row, "composed_input"),
    backend: strOrNull(row, "backend"),
    resultKind: strOrNull(row, "result_kind") as TurnResultKind | null,
    answerSummary: strOrNull(row, "answer_summary"),
    traceJson: strOrNull(row, "trace_json"),
    errorMessage: strOrNull(row, "error_message"),
    createdAt: str(row, "created_at"),
    agentId: strOrNull(row, "agent_id"),
    setupStepKey: strOrNull(row, "setup_step_key"),
    resumeSessionId: strOrNull(row, "resume_session_id"),
    resumeSessionProvider: strOrNull(row, "resume_session_provider"),
    resumeRunner: strOrNull(row, "resume_runner"),
    contextRecovery: strOrNull(row, "context_recovery"),
    workspaceRoot: strOrNull(row, "workspace_root"),
  };
}

function rowToArtifact(row: Record<string, unknown>): ArtifactRow {
  return {
    id: str(row, "id"),
    sessionId: str(row, "session_id"),
    name: str(row, "name"),
    kind: str(row, "kind") as ArtifactKind,
    location: str(row, "location"),
    verified: intToBool(row["verified"]),
    createdAt: str(row, "created_at"),
    savedAt: strOrNull(row, "saved_at"),
    nativeSessionId: strOrNull(row, "native_session_id"),
    projectIdentity: strOrNull(row, "project_identity"),
    bindingGeneration: row["binding_generation"] === null || row["binding_generation"] === undefined ? null : num(row, "binding_generation"),
    projectRevision: strOrNull(row, "project_revision"),
    nativeVendor: strOrNull(row, "native_vendor") as NativeSessionVendor | null,
    nativeAgent: strOrNull(row, "native_agent"),
    contentDigest: strOrNull(row, "content_digest"),
    idempotencyKey: strOrNull(row, "idempotency_key"),
    sourceAnswerId: strOrNull(row, "source_answer_id"),
  };
}

function rowToEvalRun(row: Record<string, unknown>): EvalRun {
  return {
    id: str(row, "id"),
    when: str(row, "when_ts"),
    score: num(row, "score"),
    gateThreshold: num(row, "gate_threshold"),
    gatePass: intToBool(row["gate_pass"]),
    regressions: num(row, "regressions"),
    cost: str(row, "cost"),
    p50: str(row, "p50"),
  };
}

function rowToEnrichmentRun(row: Record<string, unknown>): EnrichmentRunRow {
  return { id: str(row, "id"), mode: str(row, "mode") as EnrichmentMode, projectPath: str(row, "project_path"), projectIdentity: str(row, "project_identity"), projectRevision: str(row, "project_revision"), proposalId: str(row, "proposal_id"), proposalHash: str(row, "proposal_hash"), status: str(row, "status") as EnrichmentRunStatus, createdAt: str(row, "created_at"), updatedAt: str(row, "updated_at"), validationDigest: strOrNull(row, "validation_digest"), buildDigest: strOrNull(row, "build_digest"), errorMessage: strOrNull(row, "error_message"), bindingGeneration: num(row, "binding_generation"), version: num(row, "version") };
}

function rowToEnrichmentOperation(row: Record<string, unknown>): EnrichmentOperationRow {
  return { id: str(row, "operation_id"), sink: str(row, "sink"), risk: str(row, "risk") as EnrichmentRisk, summary: str(row, "summary"), draft: str(row, "draft"), changeKind: str(row, "change_kind") as import("./enrichment.js").EnrichmentChangeKind, confidence: normalizeEnrichmentConfidence(row["confidence"]), decision: strOrNull(row, "decision") as EnrichmentOperationRow["decision"], completed: str(row, "state") === "applied", state: str(row, "state") as EnrichmentOperationRow["state"], attempt: num(row, "attempt"), leaseToken: strOrNull(row, "lease_token"), leaseExpiresAt: strOrNull(row, "lease_expires_at"), idempotencyKey: str(row, "idempotency_key") };
}

function rowToEnrichmentEvent(row: Record<string, unknown>): EnrichmentEventRow {
  return { id: str(row, "id"), runId: str(row, "run_id"), kind: str(row, "kind"), message: str(row, "message"), createdAt: str(row, "created_at") };
}
