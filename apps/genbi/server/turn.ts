/**
 * Orchestrates one turn end-to-end: clarify pre-flight, context
 * composition, invoking `route()`, folding its result/events into the UI's
 * wire types, and persisting everything needed to replay a resolved turn
 * without re-invoking `route()`.
 *
 * `route` and `baseRouteOptions` are injected (`TurnDeps`) so tests can pass
 * a stub `route`/`modeA` without a real LLM or CLI — mirroring the seam
 * `harness/route/route.ts` already uses internally for `modeA`/`modeB`.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentEvent, AuthChoice, Bundle, RouteOptions, RouteResult, SetupStepRunner } from "../harness/index.js";
import {
  BUILD_CONTEXT_AGENT_ID,
  DEFAULT_SETUP_MAX_TURNS,
  ModeBSessionError,
  parseSetupTerminal,
  resolveArtifactsDir,
  WarbleCommandFailedError,
} from "../harness/index.js";
import { newId, type ArtifactRow, type PendingDecisionPayload, type SessionRow, type Store, type TurnRow } from "./db.js";
import { classifyClarify } from "./clarify.js";
import { classifyIntent } from "./route-intent.js";
import { composeClarifyFollowUp, composeInput } from "./compose.js";
import {
  clarifyDecisionStep,
  extractTrace,
  foldTrace,
  gateDecisionStep,
  gateFailureStep,
  LiveWorkLog,
  routeDecisionStep,
  summarizeResult,
  toAnswerOrRefusalEvent,
  toArtifactEvent,
} from "./fold.js";
import type {
  AnswerEvent,
  ArtifactEvent,
  ArtifactKind,
  AskSessionData,
  ClarifyEvent,
  PublishedEvent,
  PublishScope,
  RefusalEvent,
  SavedEvent,
  SessionEvent,
  SetupDecision,
  SetupMode,
  SetupStatusEvent,
  SetupStep,
  SseFrame,
  ToolStep,
  UnsavedEvent,
  UserEvent,
} from "./wire-types.js";

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`session not found: ${sessionId}`);
  }
}

export class TurnNotFoundError extends Error {
  constructor(readonly turnId: string) {
    super(`turn not found: ${turnId}`);
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(readonly artifactId: string) {
    super(`artifact not found: ${artifactId}`);
  }
}

export interface TurnDeps {
  readonly store: Store;
  readonly route: (options: RouteOptions) => Promise<RouteResult>;
  readonly baseRouteOptions: Omit<RouteOptions, "question" | "onEvent">;
  /**
   * GET /api/harness only: compiles+loads the currently-bound profile's
   * bundle for read-only introspection (`server/harness.ts`). Optional so
   * every other route and every existing test's `TurnDeps` literal is
   * unaffected — `server/bin.ts` wires the real `describeBundle` (from
   * `../harness/index.js`); a `TurnDeps` without it simply can't serve
   * `/api/harness` (that route reports a 500 instead of throwing).
   */
  readonly describeBundle?: (options: Omit<RouteOptions, "question" | "onEvent">) => Promise<Bundle>;
  /**
   * Dispatches a setup-wizard turn (`connect` / `connect_resume` — see
   * `TurnRow.setupStepKey`) via `harness/setup/runner.ts`'s `SetupStepRunner`
   * seam, instead of the normal `route()` path. Optional so every existing
   * test's `TurnDeps` literal is unaffected; a setup turn dispatched against
   * a `TurnDeps` without this wired resolves as an error turn with a clear
   * "not configured" message rather than throwing.
   */
  readonly setupRunner?: SetupStepRunner;
  /**
   * Resolves which `SetupStepRunner` a setup turn should dispatch through,
   * given the auth choice actually in effect (Mode B for `subscription`, Mode
   * A otherwise — the same branch `server/bin.ts` uses to construct both
   * runners at boot). Optional so every existing test's `TurnDeps` literal is
   * unaffected: when absent, `resolveSetupRunner` falls back to the fixed
   * `setupRunner` above (the pre-live-auth-choice behavior). Wired by
   * `server/bin.ts` so a setup turn dispatches through the runner matching
   * whatever auth mode is ACTUALLY bound at run time, not the one resolved at
   * boot.
   */
  setupRunnerFor?(choice: AuthChoice): SetupStepRunner;
  /**
   * The workspace root new wren projects are scaffolded under
   * (`WREN_HARNESS_WORKSPACE_ROOT`) — the `root` half of
   * `parseSetupTerminal`'s `{root, name}` context, and `SetupStepRunOptions.workspaceRoot`.
   * Optional for the same reason as `setupRunner` above.
   */
  readonly workspaceRoot?: string;
  /**
   * Binds (or rebinds) the process's single active wren project — the
   * bootstrap mode's mutable project binding (see `server/bin.ts`). Optional:
   * a `TurnDeps` built with a fixed `baseRouteOptions.userProject` (every
   * existing test, and any non-bootstrap boot) simply has no rebinding
   * capability, which is fine — `resolveUserProject` falls back to the fixed
   * `baseRouteOptions.userProject` when this isn't wired.
   */
  bindProject?(dir: string): void;
  /**
   * Reads the process's currently bound project, if any. Optional; when
   * absent, `resolveUserProject` reads `baseRouteOptions.userProject` instead
   * (the pre-bootstrap-mode, single-fixed-project behavior).
   */
  getUserProject?(): string | undefined;
  /**
   * Clears the bootstrap project binding (back to unbound), for the setup
   * wizard's "Reset setup" action. Optional and symmetric with `bindProject`:
   * a fixed-project (non-bootstrap) `TurnDeps` has no binding to clear.
   */
  unbindProject?(): void;
  /**
   * Reads the process's currently bound auth choice, if a live binding is
   * wired — the auth-choice mirror of `getUserProject`. Optional; when
   * absent, `resolveAuthChoice` reads `baseRouteOptions.authChoice` instead
   * (the pre-live-auth-choice, boot-fixed behavior every existing test's
   * `TurnDeps` literal still gets).
   */
  getAuthChoice?(): AuthChoice;
  /**
   * Rebinds the process's live auth choice — the auth-choice mirror of
   * `bindProject`. Wired by `server/bin.ts`; `PUT /api/config/runtime`
   * (`server/app.ts`) calls this once a candidate `AuthChoice` has passed the
   * compliance gate, so every later `route()`/setup dispatch reads the live
   * binding through `resolveAuthChoice`/`effectiveRouteOptions` instead of the
   * boot-fixed `baseRouteOptions.authChoice`.
   */
  setAuthChoice?(choice: AuthChoice): void;
  /**
   * Points every subsequent `wren` CLI subprocess (via `harness/exec/local.ts`'s
   * `execFile` and `server/adopt.ts`'s own `execWren`, both of which inherit
   * `process.env` verbatim) at the right `WREN_HOME` for the wizard's chosen
   * entry path: `"create"` anchors it to `<workspaceRoot>/.wren` so a
   * scaffolded project's `wren profile add` writes into a fresh,
   * workspace-scoped `profiles.yml` instead of the operator's real
   * `~/.wren/profiles.yml`; `"adopt"` (or `undefined`, e.g.
   * after "Reset setup") restores the real baseline `WREN_HOME` the process
   * booted with, since adopt is strictly read-only against global state and
   * must keep resolving the operator's own profiles. Optional so every
   * existing test's `TurnDeps` literal is unaffected — a `TurnDeps` without
   * this wired just leaves `process.env.WREN_HOME` untouched (the
   * pre-isolation behavior). Wired by `server/bin.ts`; called from
   * `server/app.ts`'s `dispatchConnectTurn` (create) and `POST
   * /api/setup/adopt` (adopt) — the two single choke points every actual
   * `wren` invocation for each mode passes through — plus `POST
   * /api/setup/reset` (restores baseline) so a mode change mid-boot (pick
   * create, reset, pick adopt, or the reverse) can never leave a stale
   * `WREN_HOME` from the previous choice in effect.
   */
  setWrenHomeForSetupMode?(mode: SetupMode | undefined): void;
}

/**
 * Thrown by `effectiveRouteOptions` when no wren project is bound yet
 * (bootstrap-mode, before the setup wizard's bind step). Routes that require
 * a bound project (`server/app.ts`'s 409 guard) check `isProjectBound` first
 * and never actually let this escape in normal operation — it exists mainly
 * so a caller that forgets the guard fails loudly instead of silently
 * compiling against `undefined`.
 */
/** Shared 409 message for every route that requires a bound project (`server/app.ts`'s guard) — single source of truth so the guard and `ProjectNotBoundError` never drift apart. */
export const PROJECT_NOT_BOUND_MESSAGE = "no wren project is bound yet — complete the setup wizard's connect/bind steps first";

export class ProjectNotBoundError extends Error {
  constructor() {
    super(PROJECT_NOT_BOUND_MESSAGE);
  }
}

/** Whether a wren project is currently bound (always true for a `TurnDeps` without `getUserProject` wired — the pre-bootstrap-mode case). */
export function isProjectBound(deps: TurnDeps): boolean {
  return resolveUserProject(deps) !== undefined;
}

/** Resolves the currently-bound project directory, preferring the mutable `getUserProject` binding over the fixed `baseRouteOptions.userProject`. */
export function resolveUserProject(deps: TurnDeps): string | undefined {
  return deps.getUserProject ? deps.getUserProject() : deps.baseRouteOptions.userProject;
}

/** Resolves the auth choice actually in effect, preferring the mutable `getAuthChoice` binding over the fixed `baseRouteOptions.authChoice` — the auth-choice mirror of `resolveUserProject`. */
export function resolveAuthChoice(deps: TurnDeps): AuthChoice {
  return deps.getAuthChoice ? deps.getAuthChoice() : deps.baseRouteOptions.authChoice;
}

/** Resolves which `SetupStepRunner` a setup turn should dispatch through, given the auth choice actually in effect. Falls back to the fixed `deps.setupRunner` when `setupRunnerFor` isn't wired (pre-live-auth-choice behavior). */
export function resolveSetupRunner(deps: TurnDeps): SetupStepRunner | undefined {
  return deps.setupRunnerFor ? deps.setupRunnerFor(resolveAuthChoice(deps)) : deps.setupRunner;
}

/** `deps.baseRouteOptions` with `userProject`/`authChoice` re-resolved through their mutable bindings at call time (not captured once at boot). Throws `ProjectNotBoundError` if unbound — callers that can run unbound (setup routes) must not call this. */
export function effectiveRouteOptions(deps: TurnDeps): Omit<RouteOptions, "question" | "onEvent"> {
  const userProject = resolveUserProject(deps);
  if (userProject === undefined) throw new ProjectNotBoundError();
  return { ...deps.baseRouteOptions, userProject, authChoice: resolveAuthChoice(deps) };
}

/** Evicts `deps`'s memoized compiled-bundle-agent-ids entry (see `bundleAgentInfoCache` below) — called by `bindProject` so a turn after a (re)bind recompiles against the newly-bound project instead of replaying a stale/empty cache entry. */
export function invalidateBundleAgentIdsCache(deps: TurnDeps): void {
  bundleAgentInfoCache.delete(deps);
}

export interface PostTurnResult {
  readonly turnId: string;
  readonly clarify?: ClarifyEvent;
}

const RECENT_TURNS_FOR_COMPOSE = 5;

/**
 * The compiled bundle's agent ids, used by `classifyIntent` to
 * validate/fall back its rule-matched id. The bundle doesn't change between
 * turns, so this resolves `deps.describeBundle` (compile-cache-backed, but
 * still a real async compile+load) AT MOST ONCE per `TurnDeps` instance and
 * reuses that same settled promise for every later turn — keyed off the
 * `TurnDeps` object itself (a `WeakMap`, not a module-level singleton) so
 * each test's own `TurnDeps` gets its own cache instead of leaking into
 * others'. Falls back to `[]` — which makes `classifyIntent` always land on
 * its `"answer_query"` default — when no `describeBundle` dependency is
 * wired, or when it throws; intent routing must never crash a turn.
 *
 * Only a SUCCESSFUL resolution is cached. If `describeBundle` rejects (a
 * transient compile-cache hiccup, momentary disk/binary issue, etc.), the
 * failing entry is evicted from the cache so the very next call retries
 * `describeBundle` from scratch instead of being permanently pinned to the
 * `[]`/`answer_query`-only fallback for the rest of the process's life.
 */
/**
 * The compiled bundle's `artifact_write`-capable agent ids, cached
 * alongside `agentIds` off the SAME `describeBundle` resolution (one compile
 * per `TurnDeps`, not two) — used to decide whether a Mode B turn's rich
 * answer should ALSO be persisted as an artifact (see `maybeCreateModeBArtifact`
 * below). `generate_dashboard`/`explain_change` declare this capability in the
 * genbi-default profile (see `bundle/schema.ts`'s `capabilitySchema`);
 * `answer_query`/`explore_model` don't — this is a signal read straight off
 * the bundle rather than a hardcoded agent-id allowlist, so a future
 * artifact-producing component picks it up automatically.
 */
const ARTIFACT_WRITE_CAPABILITY = "artifact_write";

interface BundleAgentInfo {
  readonly agentIds: readonly string[];
  readonly artifactProducerAgentIds: ReadonlySet<string>;
}

const EMPTY_BUNDLE_AGENT_INFO: BundleAgentInfo = { agentIds: [], artifactProducerAgentIds: new Set() };

const bundleAgentInfoCache = new WeakMap<TurnDeps, Promise<BundleAgentInfo>>();

async function getBundleAgentInfo(deps: TurnDeps): Promise<BundleAgentInfo> {
  if (!deps.describeBundle) return EMPTY_BUNDLE_AGENT_INFO;

  const describeBundle = deps.describeBundle;
  let pending = bundleAgentInfoCache.get(deps);
  if (!pending) {
    // Wrapped in an async IIFE so a synchronous throw from
    // `effectiveRouteOptions` (unbound project — bootstrap mode) becomes a
    // rejected promise, caught by the try/catch below exactly like a
    // rejected `describeBundle` call, instead of escaping this function.
    pending = (async () => {
      const bundle = await describeBundle(effectiveRouteOptions(deps));
      const artifactProducerAgentIds = new Set(
        bundle.agents.filter((agent) => agent.capabilities.some((c) => c.capability === ARTIFACT_WRITE_CAPABILITY)).map((agent) => agent.id),
      );
      return { agentIds: bundle.agents.map((agent) => agent.id), artifactProducerAgentIds };
    })();
    bundleAgentInfoCache.set(deps, pending);
  }

  try {
    return await pending;
  } catch {
    // Evict so the next turn re-attempts describeBundle rather than being
    // stuck on this rejected promise forever; this turn falls back to empty.
    bundleAgentInfoCache.delete(deps);
    return EMPTY_BUNDLE_AGENT_INFO;
  }
}

async function getBundleAgentIds(deps: TurnDeps): Promise<readonly string[]> {
  return (await getBundleAgentInfo(deps)).agentIds;
}

/** Whether `agentId`'s compiled bundle agent declares the `artifact_write` capability — see `BundleAgentInfo`. */
async function isArtifactProducerAgent(deps: TurnDeps, agentId: string): Promise<boolean> {
  return (await getBundleAgentInfo(deps)).artifactProducerAgentIds.has(agentId);
}

/** `generate_dashboard` -> `"dashboard"`; every other artifact-producing agent (e.g. `explain_change`) -> `"report"` — mirrors Mode A's `write_artifact` default (`harness/loop/executor.ts`). */
function artifactKindForAgent(agentId: string): ArtifactKind {
  return agentId === "generate_dashboard" ? "dashboard" : "report";
}

/** POST /api/sessions/:id/turns — persists the user event, runs the D1 clarify pre-flight, and either short-circuits with a clarify prompt or prepares a turn for streaming. */
export async function postTurn(deps: TurnDeps, sessionId: string, question: string): Promise<PostTurnResult> {
  const session = deps.store.getSession(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);

  const userEvent: UserEvent = { id: newId("evt"), kind: "user", text: question };
  deps.store.insertEvent({ sessionId, kind: "user", payload: userEvent, turnId: null });

  const clarify = classifyClarify(question);
  const turnId = newId("turn");

  if (clarify) {
    const clarifyEvent: ClarifyEvent = { id: newId("evt"), kind: "clarify", prompt: clarify.prompt, chips: [...clarify.chips] };
    // Classify against the ORIGINAL question — this turn never reaches route(), but
    // the id is still persisted for consistency/debuggability of the turn row.
    const { agentId, reason } = classifyIntent(question, await getBundleAgentIds(deps));
    // Persist the deterministic decisions (Route + Clarify) into the
    // turn's work log so GET /api/sessions/:id and a resumed stream show why the
    // turn routed and what it clarified. No verify-gate entry: a clarify turn
    // short-circuits before route() runs, so there is no verdict to report.
    const decisions = [routeDecisionStep(agentId, reason), clarifyDecisionStep(clarify.prompt)];
    deps.store.createTurn({ id: turnId, sessionId, question, composedInput: null, agentId, traceJson: JSON.stringify(decisions) });
    deps.store.insertEvent({ sessionId, kind: "clarify", payload: clarifyEvent, turnId });
    deps.store.markTurnClarify(turnId);
    // Re-clarify: if a clarify is already pending, keep the ORIGINAL question being
    // clarified rather than overwriting it with this (also-vague) follow-up.
    const pendingQuestion = session.status === "awaiting_clarify" && session.pendingQuestion ? session.pendingQuestion : question;
    deps.store.updateSessionStatus(sessionId, "awaiting_clarify", pendingQuestion);
    return { turnId, clarify: clarifyEvent };
  }

  const effectiveQuestion =
    session.status === "awaiting_clarify" && session.pendingQuestion
      ? composeClarifyFollowUp(session.pendingQuestion, question)
      : question;

  // Classify against the EFFECTIVE question — the one actually sent to route() below
  // (a bare clarify follow-up like "this quarter" carries none of the original intent words).
  const { agentId, reason } = classifyIntent(effectiveQuestion, await getBundleAgentIds(deps));

  const priorTurns = deps.store.listRecentResolvedTurns(sessionId, RECENT_TURNS_FOR_COMPOSE);
  const composedInput = composeInput(priorTurns, effectiveQuestion);

  // Seed the turn's work log with the Route decision so executeTurn can
  // replay it back (reason and all) without re-classifying, and GET /api/sessions/:id
  // shows the routing decision even before the turn has executed.
  const decisions = [routeDecisionStep(agentId, reason)];
  deps.store.createTurn({ id: turnId, sessionId, question, composedInput, agentId, traceJson: JSON.stringify(decisions) });
  deps.store.updateSessionStatus(sessionId, "streaming", null); // clears any pending_question just consumed above
  return { turnId };
}

/** GET (SSE) /api/sessions/:id/stream?turn=:turnId — replays a resolved turn, or executes+streams a pending one. */
export async function streamTurn(deps: TurnDeps, sessionId: string, turnId: string, emit: (frame: SseFrame) => Promise<void>): Promise<void> {
  const session = deps.store.getSession(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  const turn = deps.store.getTurn(turnId);
  if (!turn || turn.sessionId !== sessionId) throw new TurnNotFoundError(turnId);

  if (turn.resultKind === "clarify") {
    const stored = deps.store.listEventsForTurn(turnId).find((e) => e.kind === "clarify");
    if (stored) await emit({ event: "event", data: stored.payload });
    await emit({ event: "done", data: {} });
    return;
  }

  if (turn.resultKind) {
    await replayResolvedTurn(deps.store, turn, emit);
    return;
  }

  await executeTurn(deps, session, turn, emit);
}

async function replayResolvedTurn(store: Store, turn: TurnRow, emit: (frame: SseFrame) => Promise<void>): Promise<void> {
  if (turn.resultKind === "error") {
    await emit({ event: "error", data: { message: turn.errorMessage ?? "unknown error" } });
    return; // spec: on error emit ONLY the error frame, never a trailing done
  }
  const worklog: ToolStep[] = turn.traceJson ? (JSON.parse(turn.traceJson) as ToolStep[]) : [];
  await emit({ event: "worklog", data: worklog });
  const events = store.listEventsForTurn(turn.id).filter((e) => e.kind !== "user" && e.kind !== "clarify");
  for (const stored of events) {
    await emit({ event: "event", data: stored.payload });
  }
  await emit({ event: "done", data: {} });
}

async function executeTurn(deps: TurnDeps, session: SessionRow, turn: TurnRow, emit: (frame: SseFrame) => Promise<void>): Promise<void> {
  if (turn.setupStepKey !== null) {
    await executeSetupTurn(deps, session, turn, emit);
    return;
  }

  const liveLog = new LiveWorkLog();
  // Serializes best-effort live worklog/artifact frames behind route()'s synchronous onEvent callback,
  // so concurrent SSE writes never interleave out of order (see server/fold.ts's doc comment).
  let chain: Promise<void> = Promise.resolve();

  // The turn's pre-execution decision entries (the Route decision,
  // assembled + persisted at postTurn time). Prepended to every emitted work-log
  // snapshot and to the finalized log so the routing decision LEADS the list —
  // it is the first entry in the first content-bearing worklog frame a live
  // client sees, ahead of the agent's own steps. (A dedicated pre-route frame is
  // deliberately avoided: it would leak into the error path, whose contract is to
  // emit ONLY the error frame, and would break resolved-turn replay frame-parity.)
  const preDecisions: ToolStep[] = turn.traceJson ? (JSON.parse(turn.traceJson) as ToolStep[]) : [];

  const onEvent = (event: AgentEvent): void => {
    if (event.kind === "artifact") {
      // No live verification signal exists yet for a freshly-produced artifact — default to unverified.
      const artifactRow = deps.store.createArtifact({ sessionId: session.id, name: event.name, kind: event.artifactKind, location: event.location, verified: false });
      const artifactEvent = toArtifactEvent(newId("evt"), event.name, event.artifactKind, event.location, artifactRow.id);
      deps.store.insertEvent({ sessionId: session.id, kind: "artifact", payload: artifactEvent, turnId: turn.id });
      chain = chain.then(() => emit({ event: "event", data: artifactEvent }));
      return;
    }
    const snapshot = liveLog.ingest(event);
    if (snapshot) {
      const merged = [...preDecisions, ...snapshot];
      chain = chain.then(() => emit({ event: "worklog", data: merged }));
    }
  };

  let result: RouteResult;
  try {
    const routeOptions: RouteOptions = {
      ...effectiveRouteOptions(deps),
      question: turn.composedInput ?? turn.question,
      onEvent,
      // the turn's own persisted agent id (classified once at postTurn time), so a turn
      // always resolves to the same agent whether executed live or (via a future replay path) re-run.
      ...(turn.agentId !== null ? { agentId: turn.agentId } : {}),
    };
    result = await deps.route(routeOptions);
  } catch (err) {
    await chain;
    const message = err instanceof Error ? err.message : String(err);
    // Persist the PARTIAL work log on failure — the Route/Clarify
    // decision(s) seeded at postTurn plus whatever step/tool rows the live log
    // captured before the throw, ended with a failure Verify-gate entry saying
    // why it failed. This is exactly when a user most wants the decision trail,
    // so a failed turn's GET /api/sessions/:id shows it instead of an empty log.
    // The SSE stream stays error-only (no worklog frame emitted here); only the
    // persisted traceJson changes.
    const partialWorklog = [...preDecisions, ...liveLog.snapshot(), gateFailureStep(message)];
    deps.store.resolveTurn(turn.id, { backend: null, resultKind: "error", answerSummary: null, traceJson: JSON.stringify(partialWorklog), errorMessage: message });
    deps.store.updateSessionStatus(session.id, "active", null);
    await emit({ event: "error", data: { message } });
    return; // spec: on error emit ONLY the error frame, never a trailing done
  }
  await chain;

  // Prefer the live worklog snapshot (LLM step rows interleaved
  // with tool calls, each with its own detail) whenever it has content — it's
  // strictly richer than the floor trace's tool-outcomes-only view. Fall back
  // to `foldTrace(trace)` only when the live log is empty (no `onEvent`
  // firings reached it at all, e.g. Mode B, or a caller that never wires
  // live events) — this exactly preserves prior behavior for those cases.
  const trace = extractTrace(result);
  const liveSnapshot = liveLog.snapshot();
  const agentWorklog = liveSnapshot.length > 0 ? liveSnapshot : trace ? foldTrace(trace) : [];
  // Worklog order: [Route (+ any pre-exec decisions), ...agent steps, Verify gate?].
  // The gate is display-only and derived from the resolved result — a verified
  // answer or a refusal produces a verdict; a non-verified answer omits it. The
  // deterministic gate/result itself (terminalEvent below) is unchanged.
  const gate = gateDecisionStep(result);
  const worklog = [...preDecisions, ...agentWorklog, ...(gate ? [gate] : [])];
  const terminalEvent = toAnswerOrRefusalEvent(newId("evt"), result, agentWorklog);

  // Mode B (`backend: "agent-sdk"`) never emits a native `artifact`
  // AgentEvent the way Mode A's `write_artifact` tool does above (via
  // `onEvent`) — its dispatched agent's structured output only reaches the
  // BFF as a recovered rich envelope inside `terminalEvent` (see
  // `toAnswerOrRefusalEvent`'s doc comment). When that answer came from an
  // artifact-producing component (`generate_dashboard`/`explain_change` —
  // NOT a plain `answer_query` table), persist it as a real artifact too, so
  // it's publishable regardless of which backend ran the turn.
  const artifactEvent = await maybeCreateModeBArtifact(deps, session, turn, result, terminalEvent);

  // Persist the turn as fully resolved BEFORE emitting any terminal frames.
  // If a client disconnect makes an emit below throw, the turn is already
  // resolved, so the next stream deterministically REPLAYS these stored frames
  // instead of re-invoking route() (which would duplicate the terminal event).
  deps.store.insertEvent({ sessionId: session.id, kind: terminalEvent.kind, payload: terminalEvent, turnId: turn.id });
  deps.store.resolveTurn(turn.id, {
    backend: result.backend,
    resultKind: terminalEvent.kind,
    answerSummary: summarizeResult(result),
    traceJson: JSON.stringify(worklog),
    errorMessage: null,
  });
  deps.store.updateSessionStatus(session.id, "active", null);

  await emit({ event: "worklog", data: worklog });
  if (artifactEvent) await emit({ event: "event", data: artifactEvent });
  await emit({ event: "event", data: terminalEvent });
  await emit({ event: "done", data: {} });
}

/**
 * Mode B analog of the `onEvent` handler's Mode A `artifact` case
 * in `executeTurn` above: Mode B has no native `artifact` AgentEvent, so this
 * derives one from the turn's own already-resolved rich answer instead.
 * Returns `undefined` (no artifact created/persisted, no frame emitted)
 * unless ALL of:
 *  - Mode B ran this turn (`result.backend === "agent-sdk"`);
 *  - the terminal event is a rich answer (a recovered `RenderEnvelope`, not
 *    the `form: "text"` fallback);
 *  - the turn's routed agent (`turn.agentId`, classified once at `postTurn`
 *    time) declares the `artifact_write` capability in the compiled bundle —
 *    so a plain `answer_query` rich table never creates one.
 *
 * Idempotent by construction: `executeTurn` itself only ever runs for a turn
 * that isn't resolved yet — once `deps.store.resolveTurn` below marks it
 * resolved, a later `streamTurn` call replays the persisted frames instead
 * of re-invoking `executeTurn` (see `replayResolvedTurn`) — so this can never
 * fire twice for the same turn.
 *
 * Persisted representation: the envelope IS the artifact's content, written
 * verbatim as JSON to a session-scoped file under the same artifacts root
 * Mode A's `write_artifact` tool uses (`resolveArtifactsDir`) — self-
 * contained from the envelope, no dependency on the dispatcher's `htmlPath`
 * (never present in the NDJSON stream today). `verified` comes straight from
 * the envelope's own `verified` field, never hardcoded.
 */
async function maybeCreateModeBArtifact(
  deps: TurnDeps,
  session: SessionRow,
  turn: TurnRow,
  result: RouteResult,
  terminalEvent: AnswerEvent | RefusalEvent,
): Promise<ArtifactEvent | undefined> {
  if (result.backend !== "agent-sdk") return undefined;
  if (terminalEvent.kind !== "answer" || terminalEvent.answer.form !== "rich") return undefined;
  if (turn.agentId === null) return undefined;
  if (!(await isArtifactProducerAgent(deps, turn.agentId))) return undefined;

  const envelope = terminalEvent.answer.envelope;
  const artifactKind = artifactKindForAgent(turn.agentId);
  const verified = envelope.verified === true;

  const sessionArtifactsDir = path.join(resolveArtifactsDir(effectiveRouteOptions(deps).outDir), session.id);
  mkdirSync(sessionArtifactsDir, { recursive: true });
  const name = `${artifactKind}-${turn.id}.json`;
  const location = path.join(sessionArtifactsDir, name);
  writeFileSync(location, JSON.stringify(envelope, null, 2), "utf8");

  const artifactRow = deps.store.createArtifact({ sessionId: session.id, name, kind: artifactKind, location, verified });
  const artifactEvent = toArtifactEvent(newId("evt"), name, artifactKind, location, artifactRow.id);
  deps.store.insertEvent({ sessionId: session.id, kind: "artifact", payload: artifactEvent, turnId: turn.id });
  return artifactEvent;
}

/** Whether a caught setup-turn error is the dispatcher's `error_max_turns` exit (Mode B running out of its configured turn budget), vs. any other genuine failure. */
function isMaxTurnsError(message: string): boolean {
  return /error_max_turns/i.test(message);
}

/**
 * Progress signal for a `context`-step `error_max_turns` checkpoint:
 * counts model directories already written under `<projectDir>/models` (one
 * subdirectory per model — confirmed against the driftwood fixture project),
 * so the "continue" decision's label can show real progress instead of a bare
 * "ran out of turns". Returns 0 (never throws) if `models/` doesn't exist yet
 * — a legitimate state if the agent hadn't written any model before the budget ran out.
 */
function countModelDirs(projectDir: string): number {
  try {
    return readdirSync(path.join(projectDir, "models"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

/**
 * Turns a `describeBundle`/`compileProfile` failure into a short,
 * user-facing summary instead of dumping raw `warble` stderr (often many
 * lines of low-level compiler diagnostics) into a `setup_status` message. A
 * `WarbleCommandFailedError` reports its primary diagnostic on the FIRST line
 * of `stderr` (warble puts the actual error there; any remaining lines are
 * supporting detail/context) — falls back to the first line of `err.message`
 * for any other failure shape (e.g. `WarbleBinaryNotFoundError`).
 */
function summarizeCompileHealthcheckFailure(err: unknown): string {
  if (err instanceof WarbleCommandFailedError) {
    const firstStderrLine = err.stderr.trim().split("\n")[0];
    if (firstStderrLine) return firstStderrLine;
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0] ?? message;
}

/**
 * Dispatches a setup-wizard turn (`turn.setupStepKey !== null`) via
 * `deps.setupRunner` instead of `deps.route(...)`, reusing the exact same SSE
 * worklog-streaming machinery (`LiveWorkLog` + the same `onEvent`-to-`emit`
 * chaining pattern as `executeTurn`) so a setup turn's tool/step frames look
 * identical to an Ask turn's on the wire.
 *
 * Terminal handling (see `harness/setup/runner.ts`): the composed
 * prompt's `SETUP_STATUS: ok|needs_input|error` line is parsed via
 * `parseSetupTerminal` (which also independently verifies an on-disk marker
 * for an `ok`, keyed on `stepKey` — `wren_project.yml` for `connect`,
 * `.wren-validated` for `connect_resume`, and `target/mdl.json` with at least
 * one model for `context`). A parsed `error`
 * (including the agent claiming `ok` without the file existing) follows the
 * same "error frame only, never a trailing done" convention as a thrown
 * `route()` error. `ok`/`needs_input` both persist as `resultKind: "answer"`
 * — `TurnResultKind` has no dedicated setup-specific values, and neither
 * outcome is a `clarify` or `refusal` in the existing sense; the real
 * three-way distinction is carried in the `SetupStatusEvent` payload's
 * `status` field, which the frontend inspects (see the wire contract in the
 * final report). Only a parsed `error` persists as `resultKind: "error"`.
 */
async function executeSetupTurn(deps: TurnDeps, session: SessionRow, turn: TurnRow, emit: (frame: SseFrame) => Promise<void>): Promise<void> {
  const failWithError = async (message: string, worklog: readonly ToolStep[]): Promise<void> => {
    deps.store.resolveTurn(turn.id, { backend: null, resultKind: "error", answerSummary: null, traceJson: JSON.stringify(worklog), errorMessage: message });
    deps.store.updateSessionStatus(session.id, "active", null);
    await emit({ event: "error", data: { message } });
  };

  // Adopt-flow turns (context-build against an already-existing project outside the
  // bootstrap workspace root) carry their own `workspaceRoot` on the turn row —
  // `turn.workspaceRoot ?? deps.workspaceRoot` lets every create-flow turn (which never
  // sets it) keep resolving against the configured bootstrap root exactly as before.
  const workspaceRoot = turn.workspaceRoot ?? deps.workspaceRoot;
  // Resolved through the live auth-choice binding, not the boot-fixed `deps.setupRunner`,
  // so a setup turn dispatches through the runner matching whichever auth mode is
  // actually bound right now (see `resolveSetupRunner`).
  const setupRunner = resolveSetupRunner(deps);

  if (!setupRunner || workspaceRoot === undefined) {
    await failWithError("agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)", []);
    return;
  }

  const form = deps.store.getSetupConnectForm();
  if (!form) {
    await failWithError("no setup connect form is on record — cannot resolve which project this setup turn is onboarding", []);
    return;
  }

  const liveLog = new LiveWorkLog();
  let chain: Promise<void> = Promise.resolve();
  const onEvent = (event: AgentEvent): void => {
    const snapshot = liveLog.ingest(event);
    if (snapshot) chain = chain.then(() => emit({ event: "worklog", data: snapshot }));
  };

  let finalText: string;
  let completedSessionId: string | null | undefined;
  try {
    const result = await setupRunner.run({
      prompt: turn.composedInput ?? turn.question,
      workspaceRoot,
      authChoice: resolveAuthChoice(deps),
      // The turn's own persisted agentId (CONNECT_SOURCE_AGENT_ID for connect/connect_resume,
      // BUILD_CONTEXT_AGENT_ID for context — see server/app.ts's setup routes) so the setup
      // runner dispatches the RIGHT warble component instead of always connect_source.
      ...(turn.agentId !== null ? { agentId: turn.agentId } : {}),
      // Plan A session resume: when this turn was created (by `POST /api/setup/decision`'s
      // "continue" branch) with a resumable SDK session id attached, forward it so the
      // dispatcher resumes that SAME agent-sdk conversation instead of starting fresh.
      ...(turn.resumeSessionId !== null ? { resumeSessionId: turn.resumeSessionId } : {}),
      onEvent,
    });
    finalText = result.finalText;
    completedSessionId = result.sessionId;
  } catch (err) {
    // Hang-bug fix: a rejected queued worklog `emit` must never prevent the
    // terminal frame below from being sent — swallow it here (best-effort
    // live streaming; the resolved turn's persisted `traceJson` is still
    // complete via `liveLog.snapshot()` regardless of whether this promise
    // settled).
    await chain.catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    // Plan A: a failed turn (e.g. this very `error_max_turns` exit) can still carry a resumable
    // SDK session id — `ModeBSessionError` mirrors warble's own `DispatchSessionError` for exactly
    // this reason. `undefined` (not a `ModeBSessionError` at all, e.g. a stub runner in tests) is
    // treated the same as "no session id available" below.
    const failedSessionId = err instanceof ModeBSessionError ? err.sessionId : undefined;

    // An `error_max_turns` exit while building context (the only
    // step long/open-ended enough to plausibly exhaust its turn budget
    // mid-way) is not a hard failure — some models may already be written to
    // disk. Offer a resumable checkpoint instead of a terminal error frame.
    if (turn.setupStepKey === "context" && isMaxTurnsError(message)) {
      const modelCount = countModelDirs(path.join(workspaceRoot, form.projectName));
      const worklog = [...liveLog.snapshot(), gateFailureStep(message)];
      if (turn.contextRecovery === "schema_discovery") {
        await failWithError(
          `the one permitted schema-discovery retry ran out of turns before finishing — no further automatic or chained retry was started; inspect the recorded tool history and resolve the discovery issue before trying context again`,
          worklog,
        );
        return;
      }
      // Same budget the resumed turn will actually be dispatched with — see
      // `SetupStepRunner.effectiveMaxTurns`. Falls back to
      // `DEFAULT_SETUP_MAX_TURNS` only for stub runners in tests that don't
      // implement it.
      const continueMaxTurns = setupRunner.effectiveMaxTurns?.(BUILD_CONTEXT_AGENT_ID) ?? DEFAULT_SETUP_MAX_TURNS;
      const decision: SetupDecision = {
        kind: "max_turns_continue",
        options: [
          { id: "continue", label: `Continue (+${continueMaxTurns} turns)` },
          { id: "stop", label: "Stop" },
        ],
        detail: `${modelCount} model${modelCount === 1 ? "" : "s"} written so far before running out of turns`,
      };
      const statusEvent: SetupStatusEvent = {
        id: newId("evt"),
        kind: "setup_status",
        status: "needs_decision",
        message: "ran out of turns while building context — choose how to proceed",
        decision,
      };
      deps.store.insertEvent({ sessionId: session.id, kind: "setup_status", payload: statusEvent, turnId: turn.id });
      deps.store.resolveTurn(turn.id, {
        backend: "agent-sdk",
        resultKind: "answer",
        answerSummary: statusEvent.message,
        traceJson: JSON.stringify(worklog),
        errorMessage: null,
      });
      const pendingDecision: PendingDecisionPayload = {
        kind: "max_turns_continue",
        stepKey: "context",
        ...(failedSessionId !== undefined ? { sessionId: failedSessionId } : {}),
      };
      deps.store.updateSessionDecision(session.id, "awaiting_decision", JSON.stringify(pendingDecision));

      await emit({ event: "worklog", data: worklog });
      await emit({ event: "event", data: statusEvent });
      await emit({ event: "done", data: {} });
      return;
    }

    await failWithError(message, [...liveLog.snapshot(), gateFailureStep(message)]);
    return;
  }
  await chain.catch(() => {});

  const worklog = liveLog.snapshot();
  const terminal = parseSetupTerminal(finalText, {
    root: workspaceRoot,
    name: form.projectName,
    ...(turn.setupStepKey !== null ? { stepKey: turn.setupStepKey } : {}),
    // Only consumed when stepKey is "connect_resume"; harmless to pass
    // unconditionally otherwise. Ground truth from the BFF's own setup form,
    // never from anything an agent turn wrote.
    expectedSourceType: form.sourceType,
    // Only consumed when stepKey is "context" and the agent reported "error" —
    // lets parseSetupTerminal check this turn's own tool-call worklog for a
    // setup_execution call that failed, before trusting an "error" message that
    // blames the connection/data source (see runner.ts's firstFailedExec).
    worklog,
  });

  if (terminal.failureKind === "no_successful_schema_discovery" && turn.contextRecovery !== "schema_discovery") {
    const continueMaxTurns = setupRunner.effectiveMaxTurns?.(BUILD_CONTEXT_AGENT_ID) ?? DEFAULT_SETUP_MAX_TURNS;
    const decision: SetupDecision = {
      kind: "schema_discovery_retry",
      options: [
        { id: "retry", label: `Retry schema discovery once (+${continueMaxTurns} turns)` },
        { id: "stop", label: "Stop" },
      ],
      detail: "the context agent did not complete recognized schema discovery, so build/validate output was not accepted",
    };
    const statusEvent: SetupStatusEvent = {
      id: newId("evt"),
      kind: "setup_status",
      status: "needs_decision",
      message: terminal.message,
      decision,
    };
    deps.store.insertEvent({ sessionId: session.id, kind: "setup_status", payload: statusEvent, turnId: turn.id });
    deps.store.resolveTurn(turn.id, {
      backend: "agent-sdk",
      resultKind: "answer",
      answerSummary: terminal.message,
      traceJson: JSON.stringify(worklog),
      errorMessage: null,
    });
    const pendingDecision: PendingDecisionPayload = {
      kind: "schema_discovery_retry",
      stepKey: "context",
      ...(completedSessionId !== undefined ? { sessionId: completedSessionId } : {}),
      ...(turn.workspaceRoot !== null ? { workspaceRoot } : {}),
    };
    deps.store.updateSessionDecision(session.id, "awaiting_decision", JSON.stringify(pendingDecision));

    await emit({ event: "worklog", data: worklog });
    await emit({ event: "event", data: statusEvent });
    await emit({ event: "done", data: {} });
    return;
  }

  if (terminal.status === "error") {
    await failWithError(terminal.message, worklog);
    return;
  }

  // When the "context" step reports "ok", `parseSetupTerminal` has already verified
  // target/mdl.json exists with >=1 model — but that's silent on whether the bound genbi-default
  // profile actually COMPILES against this project. An incomplete/malformed MDL can clear that
  // check yet still fail `warble compile` (missing calc-column refs, bad relationships, etc.), and
  // until now that failure only surfaced LATER as raw compile stderr on the Harness page, or as a
  // lost Ask turn — with the setup wizard giving no indication anything was wrong. Set below (in
  // the `turn.setupStepKey === "context"` branch) if that healthcheck fails; overrides the
  // `setup_status` emitted at the end of this function with a friendly summary instead of the
  // default "ok" message, WITHOUT touching the step-state/turn-resolution machinery below (context
  // did genuinely finish building the MDL; only the compile-readiness signal changes).
  let compileHealthcheckFailure: string | undefined;

  if (terminal.status === "ok") {
    if (turn.setupStepKey === "context") {
      // The MDL now genuinely exists with >=1 model (parseSetupTerminal already verified
      // target/mdl.json) — advance context -> done, bind -> current. Do NOT call bindProject
      // again here: connect already bound this exact project path, and this step only adds
      // MDL content to it, it doesn't change which project is bound.
      const steps = deps.store.getSetupSteps().map((step) => {
        // Also cover the adopt flow's build_context branch (this same setupStepKey
        // "context" turn — see POST /api/setup/decision's `build_context` handling in
        // server/app.ts) reaching this point means adopt's own verification already succeeded
        // (POST /api/setup/adopt's `needs_decision` path never got here otherwise), so "adopt"
        // is done too, not still "todo". A no-op for the create flow: its steps array only ever
        // carries a "connect" key (already marked done above, on the connect turn), never
        // "adopt" — see `applySetupMode`.
        if (step.key === "adopt") return { ...step, state: "done" as const };
        if (step.key === "context") return { ...step, state: "done" as const };
        if (step.key === "bind") return { ...step, state: "current" as const };
        return step;
      });
      deps.store.setSetupSteps(steps);

      // Adopt flow only: when MDL was missing at adopt time, binding is deferred until
      // context-build actually writes it (see POST /api/setup/adopt's `needs_decision` +
      // the `build_context` branch of POST /api/setup/decision) — this project was never
      // bound by a "connect" turn the way the create flow's is. `isProjectBound` makes this
      // a no-op for the create flow (already bound by the else-branch above, on a PRIOR
      // turn), so no separate mode flag needs threading through this function. Must run
      // BEFORE the describeBundle healthcheck below: `effectiveRouteOptions(deps)` throws
      // `ProjectNotBoundError` if nothing is bound yet.
      if (deps.bindProject && !isProjectBound(deps)) {
        deps.bindProject(path.join(workspaceRoot, form.projectName));
      }

      // Reuses the exact same compile seam GET /api/harness and POST /api/setup/compile-bind
      // use (`deps.describeBundle`, itself backed by `compileProfile`'s filesystem cache) — no
      // healthcheck-specific compile path invented. Skipped (fail-open) when `describeBundle`
      // isn't wired at all, matching every other optional use of it in this file (e.g.
      // `getBundleAgentIds`) — a TurnDeps built without it simply can't run this check, exactly
      // like it can't serve GET /api/harness.
      if (deps.describeBundle) {
        try {
          await deps.describeBundle(effectiveRouteOptions(deps));
          // A fresh, successful compile against the just-written MDL — evict the memoized
          // agent-ids entry so the very next Ask turn recompiles instead of replaying a
          // stale/empty list from before this step added models (mirrors POST
          // /api/setup/compile-bind's identical invalidation after its own recompile).
          invalidateBundleAgentIdsCache(deps);
        } catch (err) {
          compileHealthcheckFailure = summarizeCompileHealthcheckFailure(err);
        }
      }
    } else {
      const steps = deps.store.getSetupSteps().map((step) => {
        // Belt: runtime should already be "done" (PUT /api/config/runtime
        // advances it when its settings are saved), but force it here too so a
        // connect that somehow ran with runtime still "current" can't leave two
        // "current" steps behind.
        if (step.key === "runtime") return { ...step, state: "done" as const };
        if (step.key === "connect") return { ...step, state: "done" as const };
        if (step.key === "context") return { ...step, state: "current" as const };
        return step;
      });
      deps.store.setSetupSteps(steps);
      // The scaffolded project now exists on disk (parseSetupTerminal already verified
      // wren_project.yml) — bind it as THE project so the remaining wizard steps (context,
      // bind, ask) and any Ask turn operate against it instead of staying unbound.
      if (deps.bindProject) deps.bindProject(path.join(workspaceRoot, form.projectName));
    }
  }

  // A failed compile healthcheck overrides the message/status the wizard sees — the
  // step-state advance above already ran (context genuinely finished building the MDL), but the
  // terminal `setup_status` reports the REAL, actionable problem instead of a plain "ok" that
  // would otherwise let the user walk away from an uncompilable project none the wiser. `status:
  // "error"` (not a new decision kind) — there's no extra choice to present here beyond "go fix
  // the project", so this reuses the existing `SetupStatusEvent.status` union as-is rather than
  // inventing a new checkpoint/decision surface.
  const message = compileHealthcheckFailure
    ? `${terminal.message} — but the genbi profile failed to compile against this project: ${compileHealthcheckFailure}`
    : terminal.message;
  const statusEvent: SetupStatusEvent = {
    id: newId("evt"),
    kind: "setup_status",
    status: compileHealthcheckFailure ? "error" : terminal.status,
    message,
  };
  deps.store.insertEvent({ sessionId: session.id, kind: "setup_status", payload: statusEvent, turnId: turn.id });
  deps.store.resolveTurn(turn.id, {
    backend: "agent-sdk",
    resultKind: "answer",
    answerSummary: message,
    traceJson: JSON.stringify(worklog),
    errorMessage: null,
  });
  deps.store.updateSessionStatus(session.id, "active", null);

  await emit({ event: "worklog", data: worklog });
  await emit({ event: "event", data: statusEvent });
  await emit({ event: "done", data: {} });
}

/** GET /api/sessions/:id — the Ask page's session snapshot: full event log + the latest turn's work log. */
export function getAskSessionData(store: Store, sessionId: string): AskSessionData {
  const session = store.getSession(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  const events: SessionEvent[] = store.listEventsForSession(sessionId).map((e) => e.payload);
  const latestTurn = store.getLatestTurn(sessionId);
  const workLog: ToolStep[] = latestTurn?.traceJson ? (JSON.parse(latestTurn.traceJson) as ToolStep[]) : [];
  return { id: session.id, title: session.title, updatedAt: session.updatedAt, events, workLog };
}

const PUBLISH_LINK_BASE = "https://share.genbi.example";

/** POST /api/sessions/:id/artifacts/:artifactId/publish */
export function publishArtifactForSession(store: Store, sessionId: string, artifactId: string, scope: PublishScope): PublishedEvent {
  const session = store.getSession(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  const artifact: ArtifactRow | undefined = store.getArtifact(artifactId);
  if (!artifact || artifact.sessionId !== sessionId) throw new ArtifactNotFoundError(artifactId);

  const link = `${PUBLISH_LINK_BASE}/${artifactId}`;
  store.publishArtifact(artifactId, link, scope);

  const publishedEvent: PublishedEvent = { id: newId("evt"), kind: "published", artifactName: artifact.name, link, scope };
  store.insertEvent({ sessionId, kind: "published", payload: publishedEvent, turnId: null });
  store.touchSession(sessionId);
  return publishedEvent;
}

/**
 * POST /api/sessions/:id/artifacts/:artifactId/save — promotes an
 * auto-created artifact onto the Artifacts page. Idempotent: a repeat call
 * on an already-saved artifact returns the same `savedAt` (via
 * `store.saveArtifact`'s own idempotency) and does NOT insert a second
 * `SavedEvent` into the session's event log — otherwise every no-op re-save
 * would grow the persisted history with duplicate events.
 */
export function saveArtifactForSession(store: Store, sessionId: string, artifactId: string): SavedEvent {
  const session = store.getSession(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  const artifact: ArtifactRow | undefined = store.getArtifact(artifactId);
  if (!artifact || artifact.sessionId !== sessionId) throw new ArtifactNotFoundError(artifactId);

  const alreadySaved = artifact.savedAt !== null;
  const saved = store.saveArtifact(artifactId)!;

  const savedEvent: SavedEvent = {
    id: newId("evt"),
    kind: "saved",
    artifactId: artifact.id,
    artifactName: artifact.name,
    savedAt: saved.savedAt!,
  };
  if (!alreadySaved) {
    store.insertEvent({ sessionId, kind: "saved", payload: savedEvent, turnId: null });
    store.touchSession(sessionId);
  }
  return savedEvent;
}

/**
 * POST /api/sessions/:id/artifacts/:artifactId/unsave — the
 * mirror of `saveArtifactForSession`: unpins an artifact from the Artifacts
 * page. The artifact row and its envelope file are left exactly as they are
 * — only `saved_at` clears — so the artifact remains re-saveable. Idempotent:
 * a repeat call on an already-unsaved artifact does NOT append a second
 * `UnsavedEvent` into the session's event log, for the same reason
 * `saveArtifactForSession` guards its own repeat calls.
 *
 * Appends an `UnsavedEvent` rather than deleting the earlier `SavedEvent` —
 * the event log is append-only/replayed (see `getAskSessionData`), so
 * "unsaved" is recorded as a newer fact, never as erasing an older one.
 */
export function unsaveArtifactForSession(store: Store, sessionId: string, artifactId: string): UnsavedEvent {
  const session = store.getSession(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  const artifact: ArtifactRow | undefined = store.getArtifact(artifactId);
  if (!artifact || artifact.sessionId !== sessionId) throw new ArtifactNotFoundError(artifactId);

  const wasSaved = artifact.savedAt !== null;
  store.unsaveArtifact(artifactId);

  const unsavedEvent: UnsavedEvent = {
    id: newId("evt"),
    kind: "unsaved",
    artifactId: artifact.id,
    artifactName: artifact.name,
    unsavedAt: new Date().toISOString(),
  };
  if (wasSaved) {
    store.insertEvent({ sessionId, kind: "unsaved", payload: unsavedEvent, turnId: null });
    store.touchSession(sessionId);
  }
  return unsavedEvent;
}
