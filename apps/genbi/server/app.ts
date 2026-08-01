/**
 * Hono app factory wiring the BFF's REST + SSE
 * endpoints. `createApp(deps)` takes an injected `TurnDeps` (store + route
 * function + base route options) so tests can pass a `":memory:"` store and
 * a stub `route`, with no real LLM/CLI involved. `server/bin.ts` is the only
 * place that wires real production values.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { BUILD_CONTEXT_AGENT_ID, ComplianceError, CONNECT_SOURCE_AGENT_ID, enforceCompliance, findLockedGatedCheck, resolveArtifactContent, resolveArtifactsDir } from "../harness/index.js";
import type { Bundle } from "../harness/index.js";
import { adoptWithChosenProfile, verifyAdoptProject } from "./adopt.js";
import { toAuthChoiceFromRuntimeSettings } from "./auth-choice.js";
import { composeSetupPrompt } from "./compose.js";
import { mapContextShowToOverview } from "./context-map.js";
import { buildContextFileTree, computeKnowledgeStatus } from "./context-files.js";
import { loadContextShow, WrenBinaryNotFoundError, WrenContextShowError } from "./context-source.js";
import { newId, type ArtifactRow, type PendingDecisionPayload, type Store } from "./db.js";
import { detectAdapterEnv } from "./env-detect.js";
import { buildHarnessDto } from "./harness.js";
import { computeImpact, EntityKeyNotFoundError } from "./impact.js";
import {
  ArtifactNotFoundError,
  effectiveRouteOptions,
  getAskSessionData,
  invalidateBundleAgentIdsCache,
  isProjectBound,
  postTurn,
  PROJECT_NOT_BOUND_MESSAGE,
  publishArtifactForSession,
  resolveAuthChoice,
  resolveSetupRunner,
  resolveUserProject,
  saveArtifactForSession,
  SessionNotFoundError,
  streamTurn,
  unsaveArtifactForSession,
} from "./turn.js";
import type { TurnDeps } from "./turn.js";
import type {
  AdapterEnvStatus,
  ArtifactDto,
  ContextOverview,
  PublishScope,
  RuntimeSettings,
  RuntimeSettingsPutResponse,
  SetupAdoptRequest,
  SetupAdoptResponse,
  SetupDecision,
  SetupEnvField,
  SetupMode,
  SetupStatusEvent,
  SetupStep,
} from "./wire-types.js";

/**
 * `projectName` flows unvalidated into `path.join(workspaceRoot, projectName)`
 * (`server/turn.ts`, `harness/setup/runner.ts`) and verbatim into the composed
 * setup prompt, so it must be constrained to a single safe path segment
 * before anything persists it. The allowlist below already rules out `.`,
 * `/`, and `\`, so it can never produce a `..`-style traversal or an absolute
 * path when joined — equivalent in effect to the
 * `relative.startsWith("..") || path.isAbsolute(relative)` idiom used in
 * `harness/compile/compose-profile.ts` / `harness/exec/local.ts`, just expressed as a
 * positive allowlist instead of a post-hoc check.
 */
const SAFE_PROJECT_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * `sourceType` is interpolated verbatim into the composed setup prompt (see
 * `composeSetupPrompt`), so it's restricted to a fixed set of connector types
 * wren actually supports rather than accepting arbitrary free text. No
 * canonical connector-type list is currently exported anywhere in this repo
 * (or in warble) to import instead — extend this list as wren gains
 * connectors.
 */
const SUPPORTED_SOURCE_TYPES = new Set([
  "duckdb",
  "postgres",
  "mysql",
  "bigquery",
  "snowflake",
  "clickhouse",
  "mssql",
  "trino",
]);

/**
 * Resolves `<workspaceRoot>/<projectName>` and re-verifies it lands inside
 * `workspaceRoot`, mirroring the `relative.startsWith("..") ||
 * path.isAbsolute(relative)` guard used by `harness/exec/local.ts` /
 * `harness/compile/compose-profile.ts`. Defense in depth: `projectName` is
 * already constrained by `SAFE_PROJECT_NAME` at `POST /api/setup/connect`
 * time before it's ever persisted to `setSetupConnectForm`, so a stored form
 * should never fail this — but the credential-writing routes below re-check
 * anyway rather than trusting a value read back out of the store.
 */
function resolveProjectDir(workspaceRoot: string, projectName: string): string | undefined {
  const projectDir = path.join(workspaceRoot, projectName);
  const relative = path.relative(workspaceRoot, projectDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return projectDir;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isOptionalSessionId(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * Validates the persisted half of a setup decision before acting on it. This
 * value lives in SQLite across process versions and can therefore be malformed
 * or stale; never let it turn a user action into an uncaught JSON/type error.
 */
function parsePendingDecisionPayload(raw: string): PendingDecisionPayload | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;

  switch (value.kind) {
    case "max_turns_continue":
      return value.stepKey === "context" && isOptionalSessionId(value.sessionId) && hasOnlyKeys(value, ["kind", "stepKey", "sessionId"])
        ? (value as PendingDecisionPayload)
        : undefined;
    case "schema_discovery_retry":
      return value.stepKey === "context" && isOptionalSessionId(value.sessionId) && (value.workspaceRoot === undefined || typeof value.workspaceRoot === "string") && hasOnlyKeys(value, ["kind", "stepKey", "sessionId", "workspaceRoot"])
        ? (value as PendingDecisionPayload)
        : undefined;
    case "build_context":
      return typeof value.projectPath === "string" && typeof value.sourceType === "string" && hasOnlyKeys(value, ["kind", "projectPath", "sourceType"])
        ? (value as PendingDecisionPayload)
        : undefined;
    case "name_conflict":
      return typeof value.projectName === "string" && typeof value.sourceType === "string" && hasOnlyKeys(value, ["kind", "projectName", "sourceType"])
        ? (value as PendingDecisionPayload)
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Heuristic for masking a `.env` field as a secret in the frontend's
 * credential form — matches PASSWORD/SECRET/TOKEN/
 * CREDENTIAL by substring, or a key ending in `_KEY`, or API key spellings
 * (`APIKEY`/`API_KEY`, already covered by the `_KEY$` alternative and the
 * explicit `APIKEY` alternative for the no-underscore spelling).
 */
const SECRET_ENV_KEY_HINT = /PASSWORD|SECRET|TOKEN|CREDENTIAL|_KEY$|APIKEY|API_KEY/i;

/** Matches a `.env` template's `KEY=` lines (see `composeSetupPrompt`'s "empty .env template" instruction) — never captures whatever follows `=`. */
const ENV_KEY_LINE = /^([A-Z0-9_]+)=/;

/**
 * True iff `value` parses as an absolute `http:`/`https:` URL. Used by the
 * runtime-settings save gate below to catch both a malformed base URL and
 * the model/base-URL transposition bug (a model name that is itself a URL).
 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Parses just the field KEYS (never values) out of a `.env` file's contents, tagged with the secret-masking heuristic. */
function parseEnvFieldKeys(content: string): SetupEnvField[] {
  const fields: SetupEnvField[] = [];
  for (const line of content.split("\n")) {
    const match = ENV_KEY_LINE.exec(line);
    if (match) fields.push({ key: match[1]!, secret: SECRET_ENV_KEY_HINT.test(match[1]!) });
  }
  return fields;
}

/**
 * Rewrites only the VALUE half of each `KEY=` line already present in the
 * `.env` template with the submitted value for that key, preserving every
 * other line (comments, blank lines, key order) verbatim. Keys in `values`
 * that aren't already present as a template line are silently ignored — the
 * form is driven by the template's own keys (see `GET
 * .../env-fields`), so an unknown key here means the caller is stale, not
 * that a new variable should be invented.
 */
function mergeEnvValues(content: string, values: Readonly<Record<string, string>>): string {
  const lines = content.split("\n");
  const merged = lines.map((line) => {
    const match = ENV_KEY_LINE.exec(line);
    if (!match) return line;
    const key = match[1]!;
    if (!Object.prototype.hasOwnProperty.call(values, key)) return line;
    return `${key}=${values[key] ?? ""}`;
  });
  return merged.join("\n");
}

/**
 * Shared connect turn-dispatch tail: both `POST /api/setup/connect`'s
 * happy path and `POST /api/setup/decision`'s `name_conflict` → `clean` action
 * need to persist the connect form, get-or-create the setup session, and
 * create the composed `connect` turn identically — kept as one function so
 * they can never drift apart.
 */
function dispatchConnectTurn(deps: TurnDeps, projectName: string, sourceType: string, workspaceRoot: string): { sessionId: string; turnId: string } {
  // Anchor WREN_HOME to this workspace before any wren CLI subprocess runs for this turn (see
  // TurnDeps.setWrenHomeForSetupMode's doc comment) — this is the single choke
  // point both `POST /api/setup/connect` and the `name_conflict` -> "clean" decision path share,
  // so create-mode's `wren profile add` can never write into the operator's real
  // ~/.wren/profiles.yml regardless of which caller reached here.
  deps.setWrenHomeForSetupMode?.("create");
  deps.store.setSetupConnectForm({ projectName, sourceType });

  let sessionId = deps.store.getSetupSessionId();
  if (!sessionId) {
    sessionId = deps.store.createSession(`Setup: ${projectName}`).id;
    deps.store.setSetupSessionId(sessionId);
  }

  const composedInput = composeSetupPrompt("connect", { projectName, sourceType, workspaceRoot });
  const turnId = newId("turn");
  deps.store.createTurn({
    id: turnId,
    sessionId,
    question: composedInput,
    composedInput,
    agentId: CONNECT_SOURCE_AGENT_ID,
    setupStepKey: "connect",
  });

  return { sessionId, turnId };
}

/**
 * Rewrites `setup.steps`' `"connect"`/`"adopt"` entry to match the chosen
 * `SetupMode` (see `StepKey`'s doc comment in `wire-types.ts`) — the array
 * always carries exactly one of the two keys, never both. Every other step
 * (and that step's own `state`) is left untouched; only `key`/`title` swap.
 * Shared by `POST /api/setup/mode` so the mode config value and the steps
 * array can never drift apart.
 */
function applySetupMode(deps: TurnDeps, mode: SetupMode): SetupStep[] {
  const steps = deps.store.getSetupSteps().map((step): SetupStep => {
    if (step.key === "connect" || step.key === "adopt") {
      return mode === "adopt" ? { ...step, key: "adopt", title: "Adopt an existing project" } : { ...step, key: "connect", title: "Connect a warehouse" };
    }
    return step;
  });
  deps.store.setSetupSteps(steps);
  deps.store.setSetupMode(mode);
  return steps;
}

function toArtifactDto(store: Store, row: ArtifactRow): ArtifactDto {
  const pub = store.getPublication(row.id);
  return {
    id: row.id,
    sessionId: row.sessionId,
    name: row.name,
    artifactKind: row.kind,
    location: row.location,
    verified: row.verified,
    createdAt: row.createdAt,
    ...(pub ? { published: { link: pub.link, scope: pub.scope } } : {}),
    ...(row.savedAt ? { savedAt: row.savedAt } : {}),
  };
}

/** Common non-2xx surfacing for the two error types `loadContextShow` throws — never a fabricated fallback, always the honest cause. */
function contextShowErrorResponse(err: unknown): { message: string; status: 404 | 500 } | undefined {
  if (err instanceof WrenBinaryNotFoundError) return { message: err.message, status: 500 };
  if (err instanceof WrenContextShowError) return { message: err.message, status: 500 };
  return undefined;
}

export function createApp(deps: TurnDeps) {
  const app = new Hono();

  // ---------------------------------------------------------------------
  // Ask page: sessions + turns
  // ---------------------------------------------------------------------

  app.get("/api/sessions", (c) => {
    // The setup session (tracked via getSetupSessionId) holds only setup_step turns + setup_status
    // events, no conversational content — it renders blank if opened from the Ask sidebar. The
    // Setup page addresses it directly by id (GET /api/sessions/:id, /stream), so only this list
    // needs to exclude it.
    const setupSessionId = deps.store.getSetupSessionId();
    const sessions = deps.store
      .listSessions()
      .filter((s) => s.id !== setupSessionId)
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }));
    return c.json(sessions);
  });

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}) as { title?: string });
    const title = typeof body.title === "string" && body.title.trim().length > 0 ? body.title : "New session";
    const session = deps.store.createSession(title);
    return c.json({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, status: session.status }, 201);
  });

  app.get("/api/sessions/:id", (c) => {
    try {
      return c.json(getAskSessionData(deps.store, c.req.param("id")));
    } catch (err) {
      if (err instanceof SessionNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.post("/api/sessions/:id/turns", async (c) => {
    if (!isProjectBound(deps)) return c.json({ error: PROJECT_NOT_BOUND_MESSAGE }, 409);
    const sessionId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}) as { question?: string });
    const question = typeof body.question === "string" ? body.question : "";
    try {
      const result = await postTurn(deps, sessionId, question);
      return c.json(result.clarify ? { turnId: result.turnId, clarify: result.clarify } : { turnId: result.turnId });
    } catch (err) {
      if (err instanceof SessionNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.get("/api/sessions/:id/stream", (c) => {
    const sessionId = c.req.param("id");
    const turnId = c.req.query("turn");
    if (!turnId) return c.json({ error: "missing required query parameter: turn" }, 400);

    // Validate up front so an unknown session/turn returns a plain JSON 404 instead of opening an SSE stream.
    const session = deps.store.getSession(sessionId);
    if (!session) return c.json({ error: `session not found: ${sessionId}` }, 404);
    const turn = deps.store.getTurn(turnId);
    if (!turn || turn.sessionId !== sessionId) return c.json({ error: `turn not found: ${turnId}` }, 404);
    // Setup turns (turn.setupStepKey !== null) are deliberately streamable while unbound —
    // that is the entire point of the connect flow, which runs before any project is bound.
    // Only a genuine Ask turn requires a bound project.
    if (turn.setupStepKey === null && !isProjectBound(deps)) return c.json({ error: PROJECT_NOT_BOUND_MESSAGE }, 409);

    return streamSSE(c, async (stream) => {
      // No onError passed here deliberately: streamTurn/executeTurn already catch route() failures
      // and emit exactly one 'error' frame themselves. Passing onError would make Hono append a
      // second, redundant 'error' frame on top of whatever this callback already wrote.
      await streamTurn(deps, sessionId, turnId, async (frame) => {
        await stream.writeSSE({ event: frame.event, data: JSON.stringify(frame.data) });
      });
    });
  });

  app.post("/api/sessions/:id/artifacts/:artifactId/publish", async (c) => {
    const sessionId = c.req.param("id");
    const artifactId = c.req.param("artifactId");
    const body = await c.req.json().catch(() => ({}) as { scope?: PublishScope });
    const scope: PublishScope = body.scope ?? "workspace";
    try {
      return c.json(publishArtifactForSession(deps.store, sessionId, artifactId, scope));
    } catch (err) {
      if (err instanceof SessionNotFoundError || err instanceof ArtifactNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  // Promotes an auto-created artifact onto the Artifacts page (see
  // `listArtifacts`'s saved_at filter). Idempotent — see `saveArtifactForSession`.
  app.post("/api/sessions/:id/artifacts/:artifactId/save", async (c) => {
    const sessionId = c.req.param("id");
    const artifactId = c.req.param("artifactId");
    try {
      return c.json(saveArtifactForSession(deps.store, sessionId, artifactId));
    } catch (err) {
      if (err instanceof SessionNotFoundError || err instanceof ArtifactNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  // Mirror of /save — unpins an artifact from the Artifacts page
  // while keeping its row and envelope file. Idempotent — see
  // `unsaveArtifactForSession`.
  app.post("/api/sessions/:id/artifacts/:artifactId/unsave", async (c) => {
    const sessionId = c.req.param("id");
    const artifactId = c.req.param("artifactId");
    try {
      return c.json(unsaveArtifactForSession(deps.store, sessionId, artifactId));
    } catch (err) {
      if (err instanceof SessionNotFoundError || err instanceof ArtifactNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // Artifacts page
  // ---------------------------------------------------------------------

  app.get("/api/artifacts", (c) => c.json(deps.store.listArtifacts().map((row) => toArtifactDto(deps.store, row))));

  app.get("/api/artifacts/:id", (c) => {
    const row = deps.store.getArtifact(c.req.param("id"));
    if (!row) return c.json({ error: "artifact not found" }, 404);
    return c.json(toArtifactDto(deps.store, row));
  });

  // Reads back an artifact's persisted content (Mode B's saved
  // render envelope, or Mode A's arbitrary `write_artifact` output),
  // resolved against the same root Mode A/B write to (`resolveArtifactsDir`)
  // and refused as `outside_root` if `row.location` doesn't actually resolve
  // there. Never throws for an unreadable/missing/oversized artifact — those
  // are `form: "unavailable"` responses, not route errors.
  app.get("/api/artifacts/:id/content", (c) => {
    const row = deps.store.getArtifact(c.req.param("id"));
    if (!row) return c.json({ error: "artifact not found" }, 404);
    const artifactsRoot = resolveArtifactsDir(deps.baseRouteOptions.outDir);
    return c.json(resolveArtifactContent(artifactsRoot, row.location));
  });

  // ---------------------------------------------------------------------
  // Eval page
  // ---------------------------------------------------------------------

  app.get("/api/eval/runs", (c) => c.json(deps.store.listEvalRuns()));

  app.get("/api/eval/runs/:id", (c) => {
    const run = deps.store.getEvalRun(c.req.param("id"));
    if (!run) return c.json({ error: "eval run not found" }, 404);
    const { componentScores, ...rest } = run;
    return c.json({ run: rest, componentScores });
  });

  // ---------------------------------------------------------------------
  // Context page
  // ---------------------------------------------------------------------

  // Not 409-gated: unbound degrades to an honest empty overview ("" projectName/projectPath,
  // no models/relationships/measures) rather than erroring — there is simply no project to read
  // yet. Once a project IS bound, `wren context show` is the live source; a failure there
  // (binary missing, project not built, bad output) surfaces as an honest error response — it
  // never falls back to fabricated/seeded data.
  app.get("/api/context/overview", async (c) => {
    const userProject = resolveUserProject(deps);
    if (userProject === undefined) {
      const empty: ContextOverview = {
        models: [],
        relationships: [],
        measures: [],
        knowledge: { instructionsPresent: false, verifiedPairCount: 0 },
        projectName: "",
        projectPath: "",
      };
      return c.json(empty);
    }
    try {
      const contextShow = await loadContextShow(userProject);
      const knowledge = computeKnowledgeStatus(userProject);
      return c.json(mapContextShowToOverview(contextShow, path.basename(userProject), userProject, knowledge));
    } catch (err) {
      const mapped = contextShowErrorResponse(err);
      if (mapped) return c.json({ error: mapped.message }, mapped.status);
      throw err;
    }
  });

  app.get("/api/context/files", async (c) => {
    const userProject = resolveUserProject(deps);
    if (userProject === undefined) return c.json([]);
    try {
      const contextShow = await loadContextShow(userProject);
      return c.json(buildContextFileTree(userProject, contextShow));
    } catch (err) {
      const mapped = contextShowErrorResponse(err);
      if (mapped) return c.json({ error: mapped.message }, mapped.status);
      throw err;
    }
  });

  app.get("/api/context/impact/:entityKey", async (c) => {
    const userProject = resolveUserProject(deps);
    if (userProject === undefined) return c.json({ error: PROJECT_NOT_BOUND_MESSAGE }, 409);
    try {
      const contextShow = await loadContextShow(userProject);
      return c.json(computeImpact(contextShow, c.req.param("entityKey")));
    } catch (err) {
      if (err instanceof EntityKeyNotFoundError) return c.json({ error: err.message }, 404);
      const mapped = contextShowErrorResponse(err);
      if (mapped) return c.json({ error: mapped.message }, mapped.status);
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // Harness introspection
  // ---------------------------------------------------------------------

  app.get("/api/harness", async (c) => {
    if (!isProjectBound(deps)) return c.json({ error: PROJECT_NOT_BOUND_MESSAGE }, 409);
    if (!deps.describeBundle) return c.json({ error: "harness introspection is not configured" }, 500);
    try {
      const routeOptions = effectiveRouteOptions(deps);
      const bundle = await deps.describeBundle(routeOptions);
      return c.json(buildHarnessDto(bundle, deps.store, routeOptions));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // ---------------------------------------------------------------------
  // Config / setup pages
  // ---------------------------------------------------------------------

  app.get("/api/config/runtime", (c) => c.json(deps.store.getRuntimeSettings()));

  /** Adapter env-var presence only (booleans) — never the key value itself. See `detectAdapterEnv`. */
  app.get("/api/config/env-detect", (c) => c.json<AdapterEnvStatus>(detectAdapterEnv()));

  app.put("/api/config/runtime", async (c) => {
    const patch = await c.req.json().catch(() => ({}) as Partial<RuntimeSettings>);
    const updated: RuntimeSettings = { ...deps.store.getRuntimeSettings(), ...patch };

    // Derive the candidate live AuthChoice from the merged (not-yet-persisted)
    // settings and validate it BEFORE any mutation — a rejected save must leave
    // both the persisted settings and the live auth binding untouched.
    const candidateAuthChoice = toAuthChoiceFromRuntimeSettings(updated);

    if (candidateAuthChoice.mode === "api-key") {
      const envStatus = detectAdapterEnv();
      const hasEnv = candidateAuthChoice.adapter === "openai-compatible" ? envStatus.openaiCompatible : envStatus.anthropic;
      if (!hasEnv) {
        const envVar = candidateAuthChoice.adapter === "openai-compatible" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
        return c.json({ error: `${envVar} is not set on the server — cannot switch to this api-key adapter` }, 400);
      }
      // Both adapters require an explicit model — neither has a default, so a
      // blank value here would only surface later as a real-SDK failure with
      // no signal pointing at the cause. Reject it the same way the env-var
      // gate above does, rather than trusting the UI's own disabled-Save
      // check (an API caller could otherwise bypass it).
      if (!updated.apiKeyModel?.trim()) {
        return c.json({ error: "A model is required for the api-key adapter — there is no default." }, 400);
      }
      // A model value that itself parses as an absolute URL is never valid —
      // real model identifiers (e.g. "gpt-4.1", "claude-sonnet-4-5-…") are not
      // URLs. This is the shape the Model/Base URL transposition bug takes, so
      // name that possibility in the message rather than leaving it as a bare
      // rejection (same rationale as the checks around it — an API caller can
      // bypass the UI's own gate).
      if (isAbsoluteHttpUrl(updated.apiKeyModel.trim())) {
        return c.json(
          {
            error: `Model must be a model name, not a URL — got "${updated.apiKeyModel}". Check that Model and Base URL weren't swapped.`,
          },
          400,
        );
      }
      // Only the openai-compatible adapter reads apiKeyBaseURL (see
      // toAuthChoiceFromRuntimeSettings) — validate its shape here, for the
      // same reason as the model checks above: a malformed value would
      // otherwise only surface much later as a bare "Invalid URL" error from a
      // downstream setup turn, with nothing pointing back at runtime settings
      // as the cause.
      if (candidateAuthChoice.adapter === "openai-compatible") {
        const baseUrl = updated.apiKeyBaseURL?.trim();
        // `openai-compatible.ts`'s adapter config declares `baseURL` as
        // required with no default, so a missing value is not a harmless
        // omission — it produces a broken client. The UI's own Save gate
        // already treats this as required (see `baseUrlMissing`), but this is
        // exactly the case the model-required check above exists for: an API
        // caller can bypass the UI's gate, so the same requirement needs a
        // server-side floor too.
        if (!baseUrl) {
          return c.json({ error: "A Base URL is required for the openai-compatible adapter — there is no default." }, 400);
        }
        if (!isAbsoluteHttpUrl(baseUrl)) {
          return c.json(
            {
              error: `Base URL must be an absolute http(s) URL — got "${updated.apiKeyBaseURL}". Check that Model and Base URL weren't swapped.`,
            },
            400,
          );
        }
      }
    }

    let warnings: readonly string[];
    try {
      warnings = enforceCompliance(candidateAuthChoice, { deployment: updated.deployment }).warnings;
    } catch (err) {
      if (err instanceof ComplianceError) return c.json({ error: err.message }, 400);
      throw err;
    }

    deps.store.setRuntimeSettings(updated);
    deps.setAuthChoice?.(candidateAuthChoice);
    // describeBundle branches its target on authChoice.mode, so a cached
    // agent-ids entry from before this switch could outlive it — evict it the
    // same way bindProject/the context step do after their own state changes.
    invalidateBundleAgentIdsCache(deps);

    // The setup wizard completes its first step ("runtime & auth") by saving
    // runtime settings — there is no dedicated per-step endpoint for it. Since
    // that's the only place runtime completion is signalled, advance the step
    // here: runtime -> done, connect -> current. Gated on runtime still being
    // "current" so a later settings change (once the wizard is past step 1, or
    // from the Harness settings page) never resurrects the wizard or clobbers
    // connect's own state. Without this, `setup.steps` keeps runtime "current"
    // forever, leaving two "current" steps and snapping a reloaded wizard back
    // to step 1 (the front-end resumes on the current step).
    const steps = deps.store.getSetupSteps();
    if (steps.find((s) => s.key === "runtime")?.state === "current") {
      deps.store.setSetupSteps(
        steps.map((s) => {
          if (s.key === "runtime") return { ...s, state: "done" as const };
          if (s.key === "connect") return { ...s, state: "current" as const };
          return s;
        }),
      );
    }

    return c.json<RuntimeSettingsPutResponse>({ ...updated, warnings });
  });

  app.get("/api/setup/steps", (c) => c.json(deps.store.getSetupSteps()));

  // `{ mode: undefined }` before the user has picked create vs adopt — the frontend's cue to
  // render the entry-path choice screen (see `SetupMode`'s doc comment). Never gated by
  // setupRunner/workspaceRoot (matches GET /api/setup/steps just above): a plain read of
  // whatever's in the store, harmless even on a fixed-project boot with no wizard.
  app.get("/api/setup/mode", (c) => c.json({ mode: deps.store.getSetupMode() }));

  // Records which of the wizard's two entry paths the user picked and swaps `setup.steps`'
  // connect/adopt entry to match (see `applySetupMode`). Idempotent — choosing the same mode
  // twice just re-applies it. Doesn't itself dispatch anything: "create" continues into the
  // existing POST /api/setup/connect flow, "adopt" into POST /api/setup/adopt.
  app.post("/api/setup/mode", async (c) => {
    if (!resolveSetupRunner(deps) || deps.workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    const body = await c.req.json().catch(() => ({}) as { mode?: string });
    const mode = body.mode;
    if (mode !== "create" && mode !== "adopt") {
      return c.json({ error: `mode must be "create" or "adopt" — got ${JSON.stringify(body.mode)}` }, 400);
    }
    const steps = applySetupMode(deps, mode);
    return c.json({ mode, steps });
  });

  // "Reset setup": restore the wizard to first-run state (steps -> step 1, runtime settings ->
  // defaults, verify gate off, connect form + setup session cleared) AND unbind the bootstrap
  // project so the next connect starts fresh. NON-DESTRUCTIVE: it never deletes scaffolded
  // project files on disk (the user keeps their filled `.env` and generated MDL) — only wizard
  // state is cleared. Gated to bootstrap/agentic-setup mode (setupRunner + workspaceRoot), the
  // same as the other setup routes: a fixed-project boot has no wizard to reset.
  app.post("/api/setup/reset", (c) => {
    if (!resolveSetupRunner(deps) || deps.workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    deps.store.resetSetup();
    deps.unbindProject?.();
    // Restore WREN_HOME to this process's real baseline: a reset clears `setup.mode` too, so the
    // next pick (create or adopt, possibly the opposite of what was chosen before) must not
    // inherit whatever WREN_HOME a prior create/adopt choice left in place.
    deps.setWrenHomeForSetupMode?.(undefined);
    return c.json({ ok: true, steps: deps.store.getSetupSteps(), runtimeSettings: deps.store.getRuntimeSettings() });
  });

  // Dispatches a REAL agentic setup turn (Mode B, `connect_source`) rather than optimistically
  // flipping step state: the caller gets back a {sessionId, turnId} to open
  // `GET /api/sessions/:id/stream?turn=<turnId>` on, exactly like an Ask turn. The turn only
  // resolves — and only advances connect/context step state — once its SETUP_STATUS terminal
  // line is parsed (see `parseSetupTerminal` / `executeSetupTurn` in server/turn.ts). Never
  // gated by isProjectBound: this is the route that BINDS the project in the first place.
  app.post("/api/setup/connect", async (c) => {
    const workspaceRoot = deps.workspaceRoot;
    if (!resolveSetupRunner(deps) || workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    const body = await c.req.json().catch(() => ({}) as { projectName?: string; sourceType?: string });
    const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
    const sourceType = typeof body.sourceType === "string" ? body.sourceType.trim() : "";
    if (!projectName || !sourceType) return c.json({ error: "projectName and sourceType are both required" }, 400);
    if (!SAFE_PROJECT_NAME.test(projectName)) {
      return c.json({ error: `projectName must be a single path segment matching ${SAFE_PROJECT_NAME} — got "${projectName}"` }, 400);
    }
    if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) {
      return c.json({ error: `sourceType "${sourceType}" is not a supported connector — expected one of: ${[...SUPPORTED_SOURCE_TYPES].join(", ")}` }, 400);
    }

    // Pre-flight for a same-name project conflict. Checked BEFORE any turn is
    // dispatched — an existing non-empty project directory means scaffolding would either
    // silently mix into it or the agent would refuse, neither of which is a clean outcome. Offer
    // a resumable decision (rename/clean/cancel) instead. An existing but EMPTY directory (e.g. a
    // prior run that never got past `mkdir`) is not treated as a conflict — there's nothing to lose.
    const projectDir = resolveProjectDir(workspaceRoot, projectName);
    if (projectDir === undefined) {
      return c.json({ error: `projectName "${projectName}" resolves outside the workspace root` }, 400);
    }
    if (existsSync(projectDir) && readdirSync(projectDir).length > 0) {
      let sessionId = deps.store.getSetupSessionId();
      if (!sessionId) {
        sessionId = deps.store.createSession(`Setup: ${projectName}`).id;
        deps.store.setSetupSessionId(sessionId);
      }
      // Persist the form now (not just on a later `clean`): `rename`/`cancel` still need it on
      // record for the decision endpoint's response bookkeeping, and `clean` reuses it verbatim.
      deps.store.setSetupConnectForm({ projectName, sourceType });
      const decision: SetupDecision = {
        kind: "name_conflict",
        options: [
          { id: "rename", label: "Use a different name" },
          { id: "clean", label: "Clean & rebuild" },
          { id: "cancel", label: "Cancel" },
        ],
        detail: `a project named "${projectName}" already exists on disk`,
      };
      const pendingDecision: PendingDecisionPayload = { kind: "name_conflict", projectName, sourceType };
      deps.store.updateSessionDecision(sessionId, "awaiting_decision", JSON.stringify(pendingDecision));
      return c.json({ sessionId, status: "needs_decision", message: decision.detail, decision }, 409);
    }

    const { sessionId, turnId } = dispatchConnectTurn(deps, projectName, sourceType, workspaceRoot);
    return c.json({ sessionId, turnId });
  });

  // Adopt-flow entry point: verifies an existing wren project directory (see
  // `verifyAdoptProject`) and, on success, either binds it immediately (already has a built
  // `target/mdl.json`) or reports a `needs_decision(build_context)` checkpoint so the caller can
  // drive the same context-build turn the create flow's "context" step uses. Synchronous — no
  // SSE turn — because verification is a fast local check plus one `wren context validate`
  // invocation, not a long-running agent turn (see `SetupAdoptResponse`'s doc comment). Never
  // gated by isProjectBound: like /connect, this route performs the bind itself for this path.
  //
  // A project with no `profile:` pin doesn't hard-error anymore: if
  // `verifyAdoptProject` finds one or more compatible profiles in `~/.wren/profiles.yml`, it
  // reports `needs_profile` and this handler surfaces a `needs_decision(select_profile)`
  // checkpoint (HTTP 409) instead. That checkpoint is stateless — no session/pendingDecision
  // bookkeeping — the caller resolves it by re-POSTing this same route with `profile` set to
  // the chosen candidate's name, which runs `wren context set-profile` (`runSetProfile`) to
  // write the pin durably before falling through to the same verify-and-branch logic below.
  app.post("/api/setup/adopt", async (c) => {
    const workspaceRoot = deps.workspaceRoot;
    if (!resolveSetupRunner(deps) || workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    // Restore the real baseline WREN_HOME before any wren CLI subprocess runs for this route —
    // adopt is strictly read-only against global state and must keep resolving
    // the operator's own ~/.wren/profiles.yml, never a workspace-anchored one a prior "create"
    // pick (or a stale process.env from before this handler ran) might have left in place. This
    // is the single choke point every adopt-mode `wren` invocation (verifyAdoptProject,
    // runSetProfile, adoptWithChosenProfile — all in server/adopt.ts) passes through.
    deps.setWrenHomeForSetupMode?.("adopt");
    const body = await c.req.json().catch(() => ({}) as SetupAdoptRequest);
    const projectPath = typeof body.projectPath === "string" ? body.projectPath.trim() : "";
    if (!projectPath) return c.json({ error: "projectPath is required" }, 400);
    const chosenProfile = typeof body.profile === "string" ? body.profile.trim() : "";

    // `adoptWithChosenProfile` re-checks `chosenProfile` against the candidate list
    // before writing anything, and rolls the manifest back to its pre-call bytes if
    // the pin passes that check but still fails the live connection probe — see its
    // doc comment in adopt.ts. Never call `runSetProfile` directly from this route.
    const result = chosenProfile
      ? await adoptWithChosenProfile(projectPath, chosenProfile, { supportedSourceTypes: SUPPORTED_SOURCE_TYPES })
      : await verifyAdoptProject(projectPath, { supportedSourceTypes: SUPPORTED_SOURCE_TYPES });

    if (result.status === "needs_profile") {
      const decision: SetupDecision = {
        kind: "select_profile",
        options: result.candidates.map((candidate) => ({ id: candidate.name, label: candidate.name })),
        detail: `"${path.resolve(projectPath)}" has no profile: pinned — choose a connection profile to use (data_source: ${result.sourceType})`,
      };
      const response: SetupAdoptResponse = { status: "needs_decision", message: decision.detail ?? "", decision };
      return c.json(response, 409);
    }

    if (result.status === "error") {
      const response: SetupAdoptResponse = { status: "error", message: result.message };
      return c.json(response);
    }

    const resolved = path.resolve(projectPath);

    if (result.hasMdl) {
      deps.bindProject?.(resolved);
      // This is the adopt flow's ONLY bind path for an already-built project — unlike
      // the create flow, no connect/context turn ever runs to mark those steps done (see
      // server/turn.ts's `executeSetupTurn`). Without this, `adopt`/`context` are stuck at
      // "todo" forever even after `POST /api/setup/compile-bind` later marks `bind` done and
      // `ask` current, leaving the sidebar showing a done LATER step above two un-started
      // earlier ones. MDL already existing on disk means there's nothing left for "adopt" or
      // "context" to do, so both are complete, not merely skipped.
      const steps = deps.store.getSetupSteps().map((step) => {
        if (step.key === "adopt") return { ...step, state: "done" as const };
        if (step.key === "context") return { ...step, state: "done" as const };
        return step;
      });
      deps.store.setSetupSteps(steps);
      const response: SetupAdoptResponse = { status: "ok", message: `"${resolved}" verified and bound` };
      return c.json(response);
    }

    // MDL missing — offer to build context before binding. The bind itself happens inside
    // executeSetupTurn's "context" branch once that build succeeds (server/turn.ts), not here.
    let sessionId = deps.store.getSetupSessionId();
    if (!sessionId) {
      sessionId = deps.store.createSession(`Setup: ${path.basename(resolved)}`).id;
      deps.store.setSetupSessionId(sessionId);
    }
    const decision: SetupDecision = {
      kind: "build_context",
      options: [
        { id: "build", label: "Build context now" },
        { id: "cancel", label: "Cancel" },
      ],
      detail: `"${resolved}" is connected but has no built context yet (missing target/mdl.json)`,
    };
    const pendingDecision: PendingDecisionPayload = { kind: "build_context", projectPath: resolved, sourceType: result.sourceType };
    deps.store.updateSessionDecision(sessionId, "awaiting_decision", JSON.stringify(pendingDecision));
    const response: SetupAdoptResponse = { sessionId, status: "needs_decision", message: decision.detail ?? "", decision };
    return c.json(response);
  });

  // Resolves a pending decision-checkpoint (`session.status === "awaiting_decision"`, see
  // `SessionRow.pendingDecision`) — `max_turns_continue` (context step ran out of
  // turns: continue resuming from disk, or stop) and `name_conflict` (same-name
  // project on disk: clean & rebuild, rename, or cancel). Mirrors the clarify-resume pattern:
  // same endpoint gated by session state, no separate client-held token.
  app.post("/api/setup/decision", async (c) => {
    const workspaceRoot = deps.workspaceRoot;
    if (!resolveSetupRunner(deps) || workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }

    const body = await c.req.json().catch(() => ({}) as { sessionId?: string; choiceId?: string });
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const choiceId = typeof body.choiceId === "string" ? body.choiceId : "";
    if (!sessionId || !choiceId) return c.json({ error: "sessionId and choiceId are both required" }, 400);

    const session = deps.store.getSession(sessionId);
    if (!session) return c.json({ error: `session not found: ${sessionId}` }, 404);
    if (session.status !== "awaiting_decision" || !session.pendingDecision) {
      return c.json({ error: "no pending decision to resume for this session" }, 409);
    }
    const pending = parsePendingDecisionPayload(session.pendingDecision);
    if (pending === undefined) {
      return c.json({ error: "stored pending decision is malformed or no longer supported; it was not resolved" }, 409);
    }

    if (pending.kind === "max_turns_continue") {
      if (choiceId === "stop") {
        deps.store.updateSessionDecision(sessionId, "active", null);
        // Design note (flagged in the delivery report): reuses the existing `"needs_input"`
        // status rather than adding a dedicated "stopped" value to `SetupStatusEvent.status` —
        // the ticket only called for adding `"needs_decision"` to that union, and this outcome
        // fits the same "not an error, but the flow needs a human's next move" shape.
        const statusEvent: SetupStatusEvent = {
          id: newId("evt"),
          kind: "setup_status",
          status: "needs_input",
          message: "setup stopped by user after running out of turns while building context",
        };
        deps.store.insertEvent({ sessionId, kind: "setup_status", payload: statusEvent, turnId: null });
        return c.json({ sessionId, status: "stopped", event: statusEvent });
      }
      if (choiceId !== "continue") {
        return c.json({ error: `unknown choiceId "${choiceId}" for a max_turns_continue decision — expected "continue" or "stop"` }, 400);
      }

      const form = deps.store.getSetupConnectForm();
      if (!form) {
        return c.json({ error: "no setup connect form is on record — cannot resume the context step" }, 409);
      }
      // Plan A vs Plan B: if the failed turn reported a resumable SDK session id (see
      // `server/turn.ts`'s `ModeBSessionError` handling), resume that SAME agent-sdk
      // conversation with a short continuation nudge instead of recomposing the long
      // disk-inventory prompt — the agent's own context already has everything
      // `resumeFromDisk` would otherwise have to restate. Falls back to the pre-existing
      // Plan B behavior when no session id was captured (older dispatcher build, or a
      // failure mode that never produced one).
      const resumeSessionId = pending.sessionId ?? undefined;
      const composedInput = composeSetupPrompt(
        "context",
        { projectName: form.projectName, sourceType: form.sourceType, workspaceRoot },
        resumeSessionId !== undefined ? { resumeSession: true } : { resumeFromDisk: true },
      );
      const turnId = newId("turn");
      deps.store.createTurn({
        id: turnId,
        sessionId,
        question: composedInput,
        composedInput,
        agentId: BUILD_CONTEXT_AGENT_ID,
        setupStepKey: "context",
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
      });
      deps.store.updateSessionDecision(sessionId, "active", null);
      return c.json({ sessionId, turnId });
    }

    if (pending.kind === "schema_discovery_retry") {
      if (choiceId === "stop") {
        deps.store.updateSessionDecision(sessionId, "active", null);
        const statusEvent: SetupStatusEvent = {
          id: newId("evt"),
          kind: "setup_status",
          status: "needs_input",
          message: "schema-discovery retry stopped by user before context was built",
        };
        deps.store.insertEvent({ sessionId, kind: "setup_status", payload: statusEvent, turnId: null });
        return c.json({ sessionId, status: "stopped", event: statusEvent });
      }
      if (choiceId !== "retry") {
        return c.json({ error: `unknown choiceId "${choiceId}" for a schema_discovery_retry decision — expected "retry" or "stop"` }, 400);
      }

      const form = deps.store.getSetupConnectForm();
      if (!form) {
        return c.json({ error: "no setup connect form is on record — cannot retry schema discovery" }, 409);
      }
      const recoveryWorkspaceRoot = pending.workspaceRoot ?? workspaceRoot;
      // A captured SDK id can only resume the subscription dispatcher that
      // created it. If the user changed runtime meanwhile, honor that live
      // choice and start this bounded corrective turn fresh instead.
      const resumeSessionId = resolveAuthChoice(deps).mode === "subscription" ? pending.sessionId ?? undefined : undefined;
      const composedInput = composeSetupPrompt(
        "context",
        { projectName: form.projectName, sourceType: form.sourceType, workspaceRoot: recoveryWorkspaceRoot },
        { schemaDiscoveryRecovery: true, ...(resumeSessionId !== undefined ? { resumeSession: true } : {}) },
      );
      const turnId = newId("turn");
      deps.store.createTurn({
        id: turnId,
        sessionId,
        question: composedInput,
        composedInput,
        agentId: BUILD_CONTEXT_AGENT_ID,
        setupStepKey: "context",
        contextRecovery: "schema_discovery",
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        ...(pending.workspaceRoot !== undefined ? { workspaceRoot: recoveryWorkspaceRoot } : {}),
      });
      deps.store.updateSessionDecision(sessionId, "active", null);
      return c.json({ sessionId, turnId });
    }

    if (pending.kind === "build_context") {
      if (choiceId === "cancel") {
        deps.store.updateSessionDecision(sessionId, "active", null);
        return c.json({ sessionId, action: "cancel" });
      }
      if (choiceId !== "build") {
        return c.json({ error: `unknown choiceId "${choiceId}" for a build_context decision — expected "build" or "cancel"` }, 400);
      }

      // The adopted project can live anywhere on disk — reconstruct {workspaceRoot, projectName}
      // from the stored absolute path (mirrors `parseSetupTerminal`'s SetupTerminalContext) rather
      // than assuming it's under `deps.workspaceRoot`, and carry that root on the turn row itself
      // (TurnRow.workspaceRoot) so executeSetupTurn resolves against it instead of the bootstrap
      // configured root.
      const adoptedWorkspaceRoot = path.dirname(pending.projectPath);
      const projectName = path.basename(pending.projectPath);
      // executeSetupTurn (server/turn.ts) resolves `form.projectName` from
      // `deps.store.getSetupConnectForm()` for every setup turn, including this one — the create
      // flow populates it via POST /api/setup/connect, but adopt never goes through that route, so
      // it must be set here or the turn would fail immediately with "no setup connect form is on
      // record" once streamed.
      deps.store.setSetupConnectForm({ projectName, sourceType: pending.sourceType });
      const composedInput = composeSetupPrompt("context", { projectName, sourceType: pending.sourceType, workspaceRoot: adoptedWorkspaceRoot });
      const turnId = newId("turn");
      deps.store.createTurn({
        id: turnId,
        sessionId,
        question: composedInput,
        composedInput,
        agentId: BUILD_CONTEXT_AGENT_ID,
        setupStepKey: "context",
        workspaceRoot: adoptedWorkspaceRoot,
      });
      deps.store.updateSessionDecision(sessionId, "active", null);
      return c.json({ sessionId, turnId });
    }

    // pending.kind === "name_conflict"
    if (choiceId === "rename" || choiceId === "cancel") {
      deps.store.updateSessionDecision(sessionId, "active", null);
      return c.json({ sessionId, action: choiceId });
    }
    if (choiceId !== "clean") {
      return c.json({ error: `unknown choiceId "${choiceId}" for a name_conflict decision — expected "clean", "rename", or "cancel"` }, 400);
    }

    const projectDir = resolveProjectDir(workspaceRoot, pending.projectName);
    if (projectDir === undefined) {
      return c.json({ error: `projectName "${pending.projectName}" resolves outside the workspace root` }, 400);
    }
    rmSync(projectDir, { recursive: true, force: true });
    deps.store.updateSessionDecision(sessionId, "active", null);
    const { turnId } = dispatchConnectTurn(deps, pending.projectName, pending.sourceType, workspaceRoot);
    return c.json({ sessionId, turnId });
  });

  // Resumes the connect flow after the user has filled in `.env` out-of-band: reads the
  // connect form + setup session persisted by POST /api/setup/connect (no body required) and
  // dispatches a FRESH Mode B turn (no SDK session resume — see harness/setup/runner.ts's doc
  // comment) whose prompt asks the agent to validate the now-filled-in connection.
  app.post("/api/setup/connect/resume", async (c) => {
    const workspaceRoot = deps.workspaceRoot;
    if (!resolveSetupRunner(deps) || workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    const form = deps.store.getSetupConnectForm();
    const sessionId = deps.store.getSetupSessionId();
    if (!form || !sessionId) {
      return c.json({ error: "no connect turn is on record to resume — call POST /api/setup/connect first" }, 409);
    }

    const composedInput = composeSetupPrompt("connect_resume", {
      projectName: form.projectName,
      sourceType: form.sourceType,
      workspaceRoot,
    });
    const turnId = newId("turn");
    deps.store.createTurn({
      id: turnId,
      sessionId,
      question: composedInput,
      composedInput,
      agentId: CONNECT_SOURCE_AGENT_ID,
      setupStepKey: "connect_resume",
    });

    return c.json({ sessionId, turnId });
  });

  // Reads the field KEYS (never values) out of the scaffolded project's `.env` template, for
  // the frontend's inline credential form (replacing the old "open .env in your editor"
  // handoff). The template itself was written EMPTY by the connect turn (see
  // `composeSetupPrompt`'s "connect" branch) — this route only ever reads that file, never the
  // agent/turn store, so it can't leak a credential value even if one somehow ended up on disk.
  app.get("/api/setup/connect/env-fields", (c) => {
    const workspaceRoot = deps.workspaceRoot;
    if (!resolveSetupRunner(deps) || workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    const form = deps.store.getSetupConnectForm();
    if (!form) {
      return c.json({ error: "no connect turn is on record — call POST /api/setup/connect first" }, 409);
    }
    const projectDir = resolveProjectDir(workspaceRoot, form.projectName);
    if (projectDir === undefined) {
      return c.json({ error: `projectName "${form.projectName}" resolves outside the workspace root` }, 400);
    }

    let content: string;
    try {
      content = readFileSync(path.join(projectDir, ".env"), "utf-8");
    } catch {
      // No .env template on disk yet (connect turn hasn't scaffolded it, or already fully
      // filled/removed) — the frontend's graceful-fallback path handles an empty field list.
      return c.json({ fields: [] });
    }

    return c.json({ fields: parseEnvFieldKeys(content) });
  });

  // Writes submitted credential values into the scaffolded project's `.env` template
  // SERVER-SIDE — the load-bearing credential boundary this whole endpoint exists for: values
  // travel frontend form -> this HTTP handler -> disk `.env` ONLY. They are never logged, never
  // persisted into `deps.store` (turn/session rows, worklog, SSE), and never touch
  // `composeSetupPrompt`/any agent prompt — the agent only ever runs `wren`, which reads `.env`
  // at its own runtime, same as the original file-handoff design.
  app.post("/api/setup/connect/env", async (c) => {
    const workspaceRoot = deps.workspaceRoot;
    if (!resolveSetupRunner(deps) || workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    const form = deps.store.getSetupConnectForm();
    if (!form) {
      return c.json({ error: "no connect turn is on record — call POST /api/setup/connect first" }, 409);
    }
    const projectDir = resolveProjectDir(workspaceRoot, form.projectName);
    if (projectDir === undefined) {
      return c.json({ error: `projectName "${form.projectName}" resolves outside the workspace root` }, 400);
    }

    const body = await c.req.json().catch(() => ({}) as { values?: unknown });
    const values: Record<string, string> = {};
    if (body.values && typeof body.values === "object") {
      for (const [key, value] of Object.entries(body.values as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        // A `.env` template is strictly line-oriented (one KEY=value per line), so a value
        // carrying CR/LF would splice extra KEY=… lines into the file when merged, silently
        // defeating mergeEnvValues' "only rewrite known keys" guarantee. Reject rather than
        // corrupt the template — no valid credential for the supported sources needs a newline.
        if (/[\r\n]/.test(value)) {
          return c.json({ error: `value for "${key}" must not contain line breaks` }, 400);
        }
        values[key] = value;
      }
    }

    const envPath = path.join(projectDir, ".env");
    let content: string;
    try {
      content = readFileSync(envPath, "utf-8");
    } catch {
      return c.json({ error: `no .env template found at ${envPath} — the connect step must scaffold it first` }, 409);
    }

    writeFileSync(envPath, mergeEnvValues(content, values), "utf-8");
    return c.json({ ok: true });
  });

  // Dispatches the CONTEXT step's setup turn (`build_context`), which agentically generates
  // the MDL for the project connect already bound (scaffold + validated connection, no MDL
  // yet). Mirrors POST /api/setup/connect's shape but takes an EMPTY body — the project name
  // and workspace root are already on record from the connect step's persisted form/session,
  // so the caller never resends them. Gated by isProjectBound (unlike /connect, which is the
  // route that performs the FIRST bind): this step requires a project connect already bound.
  app.post("/api/setup/context", async (c) => {
    const workspaceRoot = deps.workspaceRoot;
    if (!resolveSetupRunner(deps) || workspaceRoot === undefined) {
      return c.json({ error: "agentic setup is not configured on this BFF instance (missing setupRunner/workspaceRoot)" }, 500);
    }
    if (!isProjectBound(deps)) return c.json({ error: PROJECT_NOT_BOUND_MESSAGE }, 409);

    const form = deps.store.getSetupConnectForm();
    const sessionId = deps.store.getSetupSessionId();
    if (!form || !sessionId) {
      return c.json({ error: "no connect turn is on record to build context for — call POST /api/setup/connect first" }, 409);
    }
    const session = deps.store.getSession(sessionId);
    if (!session) {
      return c.json({ error: "tracked setup session no longer exists — restart setup before building context" }, 409);
    }
    if (session.pendingDecision !== null) {
      return c.json({ error: "the setup session has a pending decision; resolve it before starting another context turn" }, 409);
    }

    const composedInput = composeSetupPrompt("context", { projectName: form.projectName, sourceType: form.sourceType, workspaceRoot });
    const turnId = newId("turn");
    deps.store.createTurn({
      id: turnId,
      sessionId,
      question: composedInput,
      composedInput,
      agentId: BUILD_CONTEXT_AGENT_ID,
      setupStepKey: "context",
    });

    return c.json({ sessionId, turnId });
  });

  app.post("/api/setup/compile-bind", async (c) => {
    // Real compile+bind: reuses the same describeBundle seam GET /api/harness uses (compile
    // cache makes repeat calls fast). On failure (precondition/compile/dispatch error), don't
    // touch the setup steps or the gate — leave "bind" in whatever state it was in, and report
    // the real error instead of pretending the bind succeeded.
    if (!isProjectBound(deps)) return c.json({ error: PROJECT_NOT_BOUND_MESSAGE }, 409);
    if (!deps.describeBundle) return c.json({ error: "compile/bind is not configured" }, 500);

    let bundle: Bundle;
    try {
      bundle = await deps.describeBundle(effectiveRouteOptions(deps));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }

    const verifyGatePassed = bundle.agents.some((agent) => findLockedGatedCheck(agent) !== undefined);
    const steps: SetupStep[] = deps.store.getSetupSteps().map((step) => {
      if (step.key === "bind") return { ...step, state: "done" };
      if (step.key === "ask") return { ...step, state: "current" };
      return step;
    });
    deps.store.setSetupSteps(steps);
    deps.store.setVerifyGatePassed(verifyGatePassed);
    // The bundle just (re)compiled successfully — likely against a project whose MDL didn't
    // exist (or was empty) the last time an Ask turn ran describeBundle. Evict the memoized
    // agent-ids entry so the very next Ask turn recompiles instead of replaying a stale/empty
    // list from before the context step added models.
    invalidateBundleAgentIdsCache(deps);
    return c.json({ steps, verifyGatePassed });
  });

  return app;
}
