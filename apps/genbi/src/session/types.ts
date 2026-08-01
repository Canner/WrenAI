import type { RenderEnvelope } from '@/envelope/types';

/**
 * Ask-session event model.
 *
 * A session is an ordered list of `SessionEvent`s covering the full answer
 * spectrum the harness can produce: a plain question, a narrowing question
 * back to the user, a verified answer (plain text or a full render envelope),
 * an honest refusal, an offer to save an artifact, and the result of
 * publishing one. Phase 1a seeds these entirely from fixtures (see
 * `./fixtures.ts`); a live BFF/SSE client fills the same shape later.
 */
export type SessionEventKind =
  | 'user'
  | 'clarify'
  | 'answer'
  | 'refusal'
  | 'artifact'
  | 'published'
  | 'saved'
  | 'unsaved';

interface BaseSessionEvent {
  id: string;
  kind: SessionEventKind;
}

/** The question as typed, or a clarify chip echoed back as the next turn. */
export interface UserEvent extends BaseSessionEvent {
  kind: 'user';
  text: string;
}

/** The agent asks a narrowing question with quick-pick options. */
export interface ClarifyEvent extends BaseSessionEvent {
  kind: 'clarify';
  prompt: string;
  chips: string[];
}

/** A short prose answer with no blocks — still verified-first. */
export interface TextAnswerPayload {
  form: 'text';
  text: string;
  verified: boolean;
  /**
   * Whether this turn attempted a data task (ran a query or assembled a
   * dashboard), including one that failed or was refused, as opposed to a
   * pure conversational/capability reply that made no data claim. The
   * Verified/Unverified badge is shown only when this is `true` — a
   * conversational answer (`false`) hides the badge instead of showing a
   * misleading "Unverified".
   */
  dataAnswer: boolean;
}

/** A full render envelope (table / chart / kpi / definition / narrative blocks). */
export interface RichAnswerPayload {
  form: 'rich';
  envelope: RenderEnvelope;
}

export interface AnswerEvent extends BaseSessionEvent {
  kind: 'answer';
  answer: TextAnswerPayload | RichAnswerPayload;
  /**
   * This turn's completed tool trace (the "Route → answer_query" tree),
   * snapshotted from the session's live `workLog` at the moment the answer
   * landed — so it's carried in history rather than living only in that
   * single mutable slot. Rendered as a collapsed-by-default disclosure (see
   * `EventList`/`WorkLog`'s `title` prop). `undefined`/empty when the turn
   * produced no trace (e.g. a hand-authored fixture, or a short-circuited
   * answer with no tool calls).
   */
  trace?: ToolStep[];
}

/** The agent declines rather than fabricate — a reason plus how to unblock it. */
export interface RefusalEvent extends BaseSessionEvent {
  kind: 'refusal';
  reason: string;
  fix: string;
}

export type ArtifactKind = 'dashboard' | 'report' | 'chart';

/** A saved output the agent offers to publish. */
export interface ArtifactEvent extends BaseSessionEvent {
  kind: 'artifact';
  name: string;
  artifactKind: ArtifactKind;
  /** File path / location within the project (fixture-only; no real storage). */
  location: string;
  /**
   * The real, persisted artifact row id (distinct from `id`, this event's own
   * UI event id) — live mode only carries a genuine one, minted by the BFF
   * when it saves the artifact. `publishArtifact` sends this to
   * `POST /api/sessions/:sessionId/artifacts/:artifactId/publish`; fixture
   * mode fills a placeholder since there is no real backend row.
   */
  artifactId: string;
}

export type PublishScope = 'workspace' | 'link' | 'public';

/** The result of publishing an artifact: a shareable link plus its access scope. */
export interface PublishedEvent extends BaseSessionEvent {
  kind: 'published';
  artifactName: string;
  link: string;
  scope: PublishScope;
}

/**
 * The result of saving an artifact to the Artifacts page. Bookkeeping-only —
 * `EventList` never renders a card for it; it exists so a later reload/replay
 * of `events` can recompute the "Saved" state (see the same pattern for
 * `PublishedEvent`), rather than baking it into the original `ArtifactEvent`.
 *
 * Matched by `artifactId`, NOT `artifactName`: two artifacts in the same
 * session can share a name (e.g. re-running the same prompt twice), and
 * matching by name would render an unsaved, same-named artifact's card as
 * already "Saved" too — with no way left to save it. `artifactName` is kept
 * for display only.
 */
export interface SavedEvent extends BaseSessionEvent {
  kind: 'saved';
  artifactId: string;
  artifactName: string;
  savedAt: string;
}

/**
 * The mirror of `SavedEvent`: records that a previously-saved artifact was
 * un-saved ("unpinned") from the Artifacts page. Appended rather than
 * deleting the earlier `SavedEvent` — the session's `events` are a persisted,
 * replayed history, and this event's own existence is what lets a later
 * reload recompute "is this artifact currently saved" correctly (see
 * `isArtifactSaved` below). Keyed on `artifactId`, not `artifactName`, for
 * the same reason as `SavedEvent`.
 */
export interface UnsavedEvent extends BaseSessionEvent {
  kind: 'unsaved';
  artifactId: string;
  artifactName: string;
  unsavedAt: string;
}

export type SessionEvent =
  | UserEvent
  | ClarifyEvent
  | AnswerEvent
  | RefusalEvent
  | ArtifactEvent
  | PublishedEvent
  | SavedEvent
  | UnsavedEvent;

/**
 * Whether `artifactId` is currently saved, per the latest-wins rule: scan
 * for whichever of its `saved`/`unsaved` events comes last in the (already
 * chronological) event list. A lone `SavedEvent` with no later `UnsavedEvent`
 * means saved; an `UnsavedEvent` after it means unsaved again; no event at
 * all means never saved.
 */
export function isArtifactSaved(events: SessionEvent[], artifactId: string): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === 'saved' && event.artifactId === artifactId) return true;
    if (event.kind === 'unsaved' && event.artifactId === artifactId) return false;
  }
  return false;
}

/**
 * A single row in the WorkLog — a tool call or a delegated sub-agent step.
 * Sub-agent delegation is modeled by `kind: 'subagent'` plus child steps that
 * reference it via `parent`; `depth` is carried explicitly (rather than
 * derived) so renderers stay a pure function of the step list.
 */
export interface ToolStep {
  id: string;
  label: string;
  state: 'running' | 'done' | 'error';
  /**
   * What produced this row:
   * - `'tool'` — a tool call (e.g. `query`); its `input`/`detail` are the
   *   call's execution record.
   * - `'subagent'` — a delegated sub-agent step (nested via `parent`/`depth`).
   * - `'step'` — an LLM reasoning step (e.g. `resolve_intent`, `generate_sql`);
   *   its `detail`, when present, is that step's reasoning/output text.
   * - `'decision'` — a turn control-flow decision (routing / clarify /
   *   verify-gate) whose `detail` is the decision plus its reasoning. Unlike
   *   tool/step rows, a decision's `detail` is shown INLINE in the row (never
   *   hidden behind a click), so the control-flow of the turn reads at a glance.
   */
  kind: 'tool' | 'subagent' | 'step' | 'decision';
  /** id of the parent step this one is nested under. */
  parent?: string;
  /** Indent level; 0 = top-level. */
  depth?: number;
  /**
   * The tool call's execution input (e.g. `{ sql: "..." }` for a `query`
   * step). Tool-call rows carry this; LLM reasoning rows (`kind: 'step'`)
   * carry only `detail` (their output), and rows with neither `input` nor
   * `detail` stay non-expandable in the WorkLog UI.
   */
  input?: unknown;
  /**
   * Result summary on a done tool step, the error message on an errored step,
   * or — for `kind: 'step'` — that reasoning step's output text.
   */
  detail?: string;
}

/**
 * One conversational thread. A "resumed" session is just one whose `events`
 * were loaded from fixtures instead of started empty.
 */
export interface AskSessionData {
  id: string;
  title: string;
  updatedAt: string;
  events: SessionEvent[];
  /**
   * The CURRENTLY STREAMING turn's live tool trace only — reset to `[]` at
   * the start of every new turn, and only meaningful while that turn is in
   * flight. Once a turn completes, its trace is copied onto the terminal
   * `AnswerEvent.trace` (see above) so it survives this reset and persists in
   * history; this slot itself is never read again after that point.
   */
  workLog: ToolStep[];
}
