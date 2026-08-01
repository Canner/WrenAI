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
import { randomUUID } from "node:crypto";
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
} from "./wire-types.js";

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export type SessionStatus = "active" | "awaiting_clarify" | "streaming" | "awaiting_decision";
export type TurnResultKind = "clarify" | "answer" | "refusal" | "error";

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
    }
  | {
      /** One explicit recovery from a terminal context turn with no successful schema discovery. */
      readonly kind: "schema_discovery_retry";
      readonly stepKey: "context";
      /** Captured from the completed Mode-B turn when available, so retry can continue the same conversation. */
      readonly sessionId?: string | null;
      /** Carries an adopted project's dirname across the decision, when this was not the bootstrap workspace root. */
      readonly workspaceRoot?: string;
    }
  | { readonly kind: "name_conflict"; readonly projectName: string; readonly sourceType: string }
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
  /**
   * A bounded setup workflow recovery already consumed by this turn. NULL for
   * ordinary setup/Ask turns; "schema_discovery" prevents a recovery turn
   * from offering the same retry or a chained max-turn continuation again.
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
  saved_at TEXT
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
`;

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

/**
 * The setup wizard's initial config, seeded on first init and restored by
 * `resetSetup()`. Kept as module consts so "seed" and "reset" can never drift.
 */
const SEED_RUNTIME_SETTINGS: RuntimeSettings = {
  authMode: "subscription",
  tierModels: [
    { tier: "cheap", model: "claude-haiku" },
    { tier: "strong", model: "claude-sonnet" },
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

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA_SQL);
    this.migrateSchema();
    this.seedIfEmpty();
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
    this.addColumnIfMissing("turns", "workspace_root", "TEXT");
    this.addColumnIfMissing("turns", "context_recovery", "TEXT");
    this.addColumnIfMissing("sessions", "pending_decision", "TEXT");
    this.addColumnIfMissing("artifacts", "saved_at", "TEXT");
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
    const now = new Date().toISOString();
    const row: SessionRow = { id: newId("session"), title, createdAt: now, updatedAt: now, status: "active", pendingQuestion: null, pendingDecision: null };
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, created_at, updated_at, status, pending_question, pending_decision) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.title, row.createdAt, row.updatedAt, row.status, row.pendingQuestion, row.pendingDecision);
    return row;
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
    /** Bounded context workflow recovery marker; only schema_discovery is currently valid. */
    contextRecovery?: "schema_discovery" | null;
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
      contextRecovery: params.contextRecovery ?? null,
      workspaceRoot: params.workspaceRoot ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO turns (id, session_id, question, composed_input, backend, result_kind, answer_summary, trace_json, created_at, error_message, agent_id, setup_step_key, resume_session_id, context_recovery, workspace_root)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.contextRecovery,
        row.workspaceRoot,
      );
    return row;
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

  markTurnClarify(id: string): void {
    this.db.prepare(`UPDATE turns SET result_kind = 'clarify' WHERE id = ?`).run(id);
  }

  /** Most recent turn (any result kind) for a session — drives the Ask page's current work log. */
  getLatestTurn(sessionId: string): TurnRow | undefined {
    const row = this.db.prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`).get(sessionId);
    return row ? rowToTurn(row) : undefined;
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
    };
    this.db
      .prepare(`INSERT INTO artifacts (id, session_id, name, kind, location, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.sessionId, row.name, row.kind, row.location, boolToInt(row.verified), row.createdAt);
    return row;
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
    return settings;
  }

  setRuntimeSettings(settings: RuntimeSettings): void {
    this.setConfigJson("runtime.settings", settings);
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
  getSetupConnectForm(): { projectName: string; sourceType: string } | undefined {
    return this.getConfigJson<{ projectName: string; sourceType: string }>("setup.connectForm");
  }

  setSetupConnectForm(form: { projectName: string; sourceType: string }): void {
    this.setConfigJson("setup.connectForm", form);
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
  // seed data (first init only — a fresh :memory: or file DB has no sessions row)
  // ---------------------------------------------------------------------

  private seedIfEmpty(): void {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM eval_runs`).get();
    if (row && num(row, "n") > 0) return; // already seeded

    this.seedEvalRuns();
    this.setRuntimeSettings(SEED_RUNTIME_SETTINGS);
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
  resetSetup(): void {
    const staleSetupSessionId = this.getSetupSessionId();
    if (staleSetupSessionId !== undefined) this.deleteSession(staleSetupSessionId);

    this.setSetupSteps(SEED_SETUP_STEPS);
    this.setRuntimeSettings(SEED_RUNTIME_SETTINGS);
    this.setVerifyGatePassed(false);
    this.deleteConfig("setup.connectForm");
    this.deleteConfig("setup.sessionId");
    this.deleteConfig("setup.mode");
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
