import type { Artifact, ArtifactKind, ArtifactPublish, ArtifactSummary, PublishScope } from '@/artifacts/types';
import type { ContextFileNode, ContextOverviewData, ImpactData } from '@/context/types';
import type { RenderEnvelope } from '@/envelope/types';
import type { ComponentScore, EvalRun } from '@/eval/types';
import { deriveRealizationLabel } from '@/harness/realization';
import type {
  AgentProfileRow,
  Component,
  ConnectionStatus,
  HarnessView,
  RuntimeBackendKind,
  RuntimeDispatcherKind,
  Step,
  TierModelBinding,
} from '@/harness/types';
import type { AskSessionData } from '@/session/types';
import type { AdapterEnvStatus, RuntimeSettings, RuntimeSettingsPutResponse, SetupStep } from '@/setup/types';
import { bffBaseUrl } from './env';

/**
 * Typed fetch wrappers for the live BFF, one per REST endpoint the app
 * actually wires (see each store for which). Every function returns the
 * app's own existing types — never a private-repo type — so nothing about
 * the BFF's own naming leaks past this module.
 */

interface ApiError {
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${bffBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body: ApiError | undefined = await res.json().catch(() => undefined);
    throw new Error(body?.error ?? `Request to ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Ask page: sessions + turns
// ---------------------------------------------------------------------------

export interface CreatedSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export function createSession(title?: string): Promise<CreatedSession> {
  return request<CreatedSession>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function getSession(sessionId: string): Promise<AskSessionData> {
  return request<AskSessionData>(`/api/sessions/${sessionId}`);
}

/** One row of the sidebar's session list — never the full hydrated thread. */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export function listSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('/api/sessions');
}

export interface PostTurnResult {
  turnId: string;
  clarify?: { prompt: string; chips: string[] };
}

export function postTurn(sessionId: string, question: string): Promise<PostTurnResult> {
  return request<PostTurnResult>(`/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

/** URL for the SSE stream of one turn — opened directly via `EventSource`, not through `request`. */
export function turnStreamUrl(sessionId: string, turnId: string): string {
  return `${bffBaseUrl()}/api/sessions/${sessionId}/stream?turn=${encodeURIComponent(turnId)}`;
}

// ---------------------------------------------------------------------------
// Context page
// ---------------------------------------------------------------------------

export function getContextImpact(entityKey: string): Promise<ImpactData> {
  return request<ImpactData>(`/api/context/impact/${encodeURIComponent(entityKey)}`);
}

/**
 * The BFF's `GET /api/context/overview` response already matches
 * `ContextOverviewData` field-for-field (projectName/projectPath/models/
 * relationships/measures/knowledge), so no intermediate DTO mapping is needed —
 * same as `listEvalRuns`/`getSetupSteps` below.
 */
export function getContextOverview(): Promise<ContextOverviewData> {
  return request<ContextOverviewData>('/api/context/overview');
}

/**
 * The BFF's `GET /api/context/files` response is a `ContextFileNode[]` tree
 * already (top-level nodes are the category folders, no wrapping project-name
 * node like the fixture tree has — see `ContextSidebar`).
 */
export function getContextFiles(): Promise<ContextFileNode[]> {
  return request<ContextFileNode[]>('/api/context/files');
}

// ---------------------------------------------------------------------------
// Eval page
// ---------------------------------------------------------------------------

export function listEvalRuns(): Promise<EvalRun[]> {
  return request<EvalRun[]>('/api/eval/runs');
}

export function getEvalRun(runId: string): Promise<{ run: EvalRun; componentScores: ComponentScore[] }> {
  return request<{ run: EvalRun; componentScores: ComponentScore[] }>(`/api/eval/runs/${runId}`);
}

// ---------------------------------------------------------------------------
// Artifacts page
// ---------------------------------------------------------------------------

/**
 * The BFF's actual wire shape for an artifact (`ArtifactDto` in the harness's
 * `server/wire-types.ts`) — flat, and metadata-only: the harness persists
 * artifact metadata only, never the produced tiles/envelope/preview. Kept
 * private to this module; every function below maps it onto the app's own
 * `ArtifactSummary`/`Artifact` types, same as every other endpoint here.
 */
interface ArtifactDto {
  id: string;
  sessionId: string;
  name: string;
  artifactKind: ArtifactKind;
  location: string;
  verified: boolean;
  createdAt: string;
  published?: { link: string; scope: PublishScope };
}

function fromArtifactDto(dto: ArtifactDto): ArtifactSummary {
  return {
    key: dto.id,
    sessionId: dto.sessionId,
    name: dto.name,
    kind: dto.artifactKind,
    location: dto.location,
    verified: dto.verified,
    createdAt: dto.createdAt,
    ...(dto.published ? { publish: dto.published } : {}),
  };
}

export function listArtifacts(): Promise<ArtifactSummary[]> {
  return request<ArtifactDto[]>('/api/artifacts').then((dtos) => dtos.map(fromArtifactDto));
}

/**
 * The server's response for `GET /api/artifacts/:id/content` — mirrors the
 * harness's own `ArtifactContentDto` (`server/wire-types.ts`, never imported
 * directly, same as every other DTO in this module). `'unavailable'` covers
 * every way a persisted location can fail to be honestly servable — missing,
 * unreadable, drifted outside the artifacts root, or over the read-size cap
 * — and is handled identically here: leave the artifact metadata-only.
 */
type ArtifactContentDto =
  | { form: 'envelope'; envelope: RenderEnvelope }
  | { form: 'text'; text: string; truncated: boolean }
  | { form: 'unavailable'; reason: 'missing' | 'unreadable' | 'outside_root' | 'too_large' };

/**
 * Fetches an artifact's persisted content. Failure here (network error,
 * non-2xx, a malformed body — anything `request()` throws) is caught and
 * folded into the same `'unavailable'` shape the content route itself
 * returns for a file it can't serve, rather than rejecting: `getArtifact`
 * must still resolve with the metadata it already has even if this endpoint
 * is unreachable.
 */
async function fetchArtifactContent(key: string): Promise<ArtifactContentDto> {
  try {
    return await request<ArtifactContentDto>(`/api/artifacts/${encodeURIComponent(key)}/content`);
  } catch {
    return { form: 'unavailable', reason: 'unreadable' };
  }
}

/**
 * Merges a content-route response into a metadata-only `Artifact`, per kind
 * — never fabricating. A dashboard's persisted content is one flat `blocks`
 * envelope with no per-tile title/source, so it's kept as a single
 * `envelope`, never split into invented tiles (`tiles` stays fixture-only;
 * see `DashboardView`). A report's content becomes its `preview`, in
 * whichever of the two `ReportPreview` shapes the content actually took. Any
 * `'unavailable'` result, or a content form that doesn't apply to the
 * artifact's kind, leaves the artifact exactly as it was.
 */
function withContent(artifact: Artifact, content: ArtifactContentDto): Artifact {
  if (content.form === 'unavailable') return artifact;
  switch (artifact.kind) {
    case 'dashboard':
    case 'chart':
      return content.form === 'envelope' ? { ...artifact, envelope: content.envelope } : artifact;
    case 'report':
      return {
        ...artifact,
        preview:
          content.form === 'envelope' ? { kind: 'envelope', envelope: content.envelope } : { kind: 'html', html: content.text },
      };
  }
}

/**
 * Maps the flat metadata DTO onto the app's `Artifact` union, then merges in
 * whatever the content route can honestly serve for it (see `withContent`).
 * Every per-kind view treats its rich fields (tiles/source/preview/envelope)
 * as optional and renders a graceful fallback when they're absent — see
 * `DashboardView`/`ReportView`/`ChartView` — so this value is always safe to
 * render whether or not the content merge added anything.
 */
export function getArtifact(key: string): Promise<Artifact> {
  return Promise.all([
    request<ArtifactDto>(`/api/artifacts/${encodeURIComponent(key)}`).then((dto) => fromArtifactDto(dto) as Artifact),
    fetchArtifactContent(key),
  ]).then(([artifact, content]) => withContent(artifact, content));
}

/**
 * Marks an artifact as saved to the Artifacts page. Route is session-scoped,
 * same shape as `postArtifactPublish` below: `POST
 * /api/sessions/:sessionId/artifacts/:artifactId/save` (see the harness's
 * `server/app.ts`). The response is a `SavedEvent`
 * (`{ id, kind: 'saved', artifactId, artifactName, savedAt }`); idempotent —
 * resaving an already-saved artifact 200s without moving its `savedAt`.
 */
export function postArtifactSave(sessionId: string, key: string): Promise<{ savedAt: string }> {
  return request<{ savedAt: string }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(key)}/save`,
    { method: 'POST' },
  ).then(({ savedAt }) => ({ savedAt }));
}

/**
 * Unpins an artifact from the Artifacts page — the mirror of `postArtifactSave`.
 * Same route shape: `POST /api/sessions/:sessionId/artifacts/:artifactId/unsave`
 * (see the harness's `server/app.ts`). The response is an `UnsavedEvent`
 * (`{ id, kind: 'unsaved', artifactId, artifactName, unsavedAt }`); idempotent —
 * unsaving an already-unsaved (or never-saved) artifact 200s without error.
 */
export function postArtifactUnsave(sessionId: string, key: string): Promise<{ unsavedAt: string }> {
  return request<{ unsavedAt: string }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(key)}/unsave`,
    { method: 'POST' },
  ).then(({ unsavedAt }) => ({ unsavedAt }));
}

/**
 * Real route is session-scoped: `POST /api/sessions/:sessionId/artifacts/:artifactId/publish`
 * (see the harness's `server/app.ts`), not a flat `/api/artifacts/:id/publish`.
 * The response is a `PublishedEvent` (`{ id, kind: 'published', artifactName,
 * link, scope }`), not a `{ publish }` wrapper — extract just the link/scope
 * the app cares about.
 */
export function postArtifactPublish(
  sessionId: string,
  key: string,
  scope: PublishScope = 'workspace',
): Promise<ArtifactPublish> {
  return request<{ link: string; scope: PublishScope }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(key)}/publish`,
    { method: 'POST', body: JSON.stringify({ scope }) },
  ).then(({ link, scope: respScope }) => ({ link, scope: respScope }));
}

// ---------------------------------------------------------------------------
// Setup page
// ---------------------------------------------------------------------------

export function getSetupSteps(): Promise<SetupStep[]> {
  return request<SetupStep[]>('/api/setup/steps');
}

export function getRuntimeSettings(): Promise<RuntimeSettings> {
  return request<RuntimeSettings>('/api/config/runtime');
}

export function putRuntimeSettings(patch: Partial<RuntimeSettings>): Promise<RuntimeSettingsPutResponse> {
  return request<RuntimeSettingsPutResponse>('/api/config/runtime', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

/**
 * Whether each api-key adapter's required credential env var is present on the BFF
 * process — booleans only, never the key value/prefix/suffix/length.
 */
export function getAdapterEnvStatus(): Promise<AdapterEnvStatus> {
  return request<AdapterEnvStatus>('/api/config/env-detect');
}

/**
 * The setup wizard's two entry paths, chosen once at wizard start: `'create'`
 * scaffolds a brand-new project (the pre-existing connect → context → bind
 * flow, unchanged); `'adopt'` points the wizard at an existing wren project
 * directory instead. `GET /api/setup/mode` returns `{ mode: undefined }`
 * before the user has picked either — the cue to render the choice screen.
 */
export type SetupMode = 'create' | 'adopt';

export function getSetupMode(): Promise<{ mode?: SetupMode }> {
  return request<{ mode?: SetupMode }>('/api/setup/mode');
}

/** Records the chosen mode and returns the steps array with `connect`/`adopt` swapped to match (see `StepKey`'s doc comment). */
export function postSetupMode(mode: SetupMode): Promise<{ mode: SetupMode; steps: SetupStep[] }> {
  return request<{ mode: SetupMode; steps: SetupStep[] }>('/api/setup/mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

/**
 * One resumable choice a setup turn is blocked on (`SetupStatusEvent.decision`,
 * status `'needs_decision'`) — e.g. an `error_max_turns` checkpoint (continue
 * vs stop, surfaced mid-turn on the context step) or a same-name project
 * conflict (rename/clean/cancel, surfaced as a 409 from `POST /api/setup/connect`
 * before any turn starts). `kind` is a bare string (not a closed union) so a
 * future checkpoint kind never requires a wire-type change; the UI only ever
 * renders `detail` + one button per `options` entry, generically.
 */
export interface SetupDecision {
  kind: string;
  options: { id: string; label: string }[];
  detail?: string;
}

/** Terminal SSE frame for a setup turn (`event` frame, `kind: 'setup_status'`). */
export interface SetupStatusEvent {
  id: string;
  kind: 'setup_status';
  status: 'ok' | 'needs_input' | 'error' | 'needs_decision';
  message: string;
  /** Present iff `status === 'needs_decision'`. */
  decision?: SetupDecision;
}

export interface SetupConnectTurn {
  sessionId: string;
  turnId: string;
}

/**
 * Thrown by `postSetupConnectTurn` when the BFF responds 409 with a
 * `name_conflict` decision (the requested project name collides with an
 * existing one) — dispatched *before* any turn/stream starts, so there is no
 * `SetupStatusEvent` to route through the normal stream-handler path. Carries
 * the `sessionId` the decision is scoped to (needed by `postSetupDecision`)
 * and the `decision` itself for the connect step's decision card.
 */
export class SetupDecisionRequiredError extends Error {
  readonly sessionId: string;
  readonly decision: SetupDecision;

  constructor(sessionId: string, decision: SetupDecision, message?: string) {
    super(message ?? decision.detail ?? 'Setup requires a decision.');
    this.name = 'SetupDecisionRequiredError';
    this.sessionId = sessionId;
    this.decision = decision;
  }
}

/**
 * Starts a real agentic connect turn. Does NOT advance any setup step itself
 * — the step only advances once the turn's stream reaches an `ok`
 * `SetupStatusEvent` terminal (see `useSetupStore.connectDataSource`). On a
 * same-name project conflict the BFF responds 409 with a `name_conflict`
 * decision instead of starting a turn; that case is surfaced as a
 * `SetupDecisionRequiredError` rather than a generic request failure, so the
 * caller can render a decision card instead of a plain error message.
 */
export function postSetupConnectTurn(projectName: string, sourceType: string): Promise<SetupConnectTurn> {
  return fetch(`${bffBaseUrl()}/api/setup/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectName, sourceType }),
  }).then(async (res) => {
    const body: (ApiError & Partial<SetupConnectTurn> & { status?: string; decision?: SetupDecision }) | undefined =
      await res.json().catch(() => undefined);
    if (res.status === 409 && body?.status === 'needs_decision' && body.decision) {
      throw new SetupDecisionRequiredError(body.sessionId ?? '', body.decision, body?.error);
    }
    if (!res.ok) {
      throw new Error(body?.error ?? `Request to /api/setup/connect failed: ${res.status} ${res.statusText}`);
    }
    return body as SetupConnectTurn;
  });
}

/**
 * Starts a fresh turn on the same setup session after the user has filled in
 * `.env` credentials out-of-band (following a `needs_input` terminal).
 */
export function postSetupResume(): Promise<SetupConnectTurn> {
  return request<SetupConnectTurn>('/api/setup/connect/resume', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** One field key discovered in the scaffolded project's `.env` template — never a value. */
export interface SetupEnvField {
  key: string;
  secret: boolean;
}

/**
 * Reads the scaffolded project's `.env` template (written by the connect
 * turn when it pauses with `needs_input`) and returns just the field KEYS —
 * never values, since none have been filled in yet at this point. The
 * credential FORM (`ConnectStepCard`) renders one input per field.
 */
export function getSetupEnvFields(): Promise<{ fields: SetupEnvField[] }> {
  return request<{ fields: SetupEnvField[] }>('/api/setup/connect/env-fields');
}

/**
 * Submits the filled-in credential values to be merged into the scaffolded
 * `.env` file server-side. Values travel FE form -> this POST -> disk `.env`
 * only — they must never be logged, stored in app state beyond the form, or
 * routed into any agent turn/prompt/SSE stream. Callers must follow this with
 * `postSetupResume()` to continue the paused connect turn.
 */
export function postSetupEnvValues(values: Record<string, string>): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/setup/connect/env', {
    method: 'POST',
    body: JSON.stringify({ values }),
  });
}

/**
 * Starts a real agentic context-build turn. The project, workspace, and
 * connect form are already on record from the connect step, so this takes no
 * body. Does NOT advance any setup step itself — the step only advances once
 * the turn's stream reaches an `ok` `SetupStatusEvent` terminal (see
 * `useSetupStore.buildContext`).
 */
export function postSetupContextTurn(): Promise<SetupConnectTurn> {
  return request<SetupConnectTurn>('/api/setup/context', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * `POST /api/setup/adopt`'s synchronous response — verification runs inline
 * (no SSE turn), so the outcome comes back as a plain JSON body:
 * - `'ok'`: the project verified and already has a built context — bound
 *   immediately, wizard lands on "bind".
 * - `'needs_decision'`: verified but needs one more input before it can
 *   proceed. Two distinct checkpoints share this status, told apart by
 *   `decision.kind`:
 *   - `'build_context'` (HTTP 200; options `'build'` | `'cancel'`) — no
 *     built context yet. Resolved via the existing `postSetupDecision`;
 *     `sessionId` is the decision's scope.
 *   - `'select_profile'` (HTTP 409; one option per candidate profile,
 *     `option.id` = profile name) — the project has no `profile:` pin, but
 *     at least one compatible profile exists to choose from. Resolved by
 *     re-calling `postSetupAdopt(projectPath, chosenProfileName)`, NOT
 *     `postSetupDecision` — there is no session-scoped checkpoint to resolve
 *     server-side, just a durable pin to write before re-verifying. The 409
 *     is why this function parses the body itself instead of using the
 *     generic `request()` helper (which treats any non-2xx as a thrown
 *     error) — same reason `postSetupConnectTurn` above does its own status
 *     handling for its `name_conflict` 409.
 * - `'error'`: verification failed — nothing was bound, `message` says why.
 */
export interface SetupAdoptResponse {
  sessionId?: string;
  status: 'ok' | 'needs_decision' | 'error';
  message: string;
  decision?: SetupDecision;
}

/**
 * Verifies and (usually) binds an existing wren project directory. Always
 * resolves — never throws on a verification failure, that's the `'error'`
 * status. Pass `profile` on the re-POST that follows a `select_profile`
 * checkpoint (see `SetupAdoptResponse`'s doc comment): the server writes that
 * profile as the project's durable `profile:` pin (via `wren context
 * set-profile`) before re-running verification.
 */
export function postSetupAdopt(projectPath: string, profile?: string): Promise<SetupAdoptResponse> {
  return fetch(`${bffBaseUrl()}/api/setup/adopt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile ? { projectPath, profile } : { projectPath }),
  }).then(async (res) => {
    const body: (SetupAdoptResponse & ApiError) | undefined = await res.json().catch(() => undefined);
    // A `select_profile` checkpoint is a valid (if non-2xx) response, not a
    // failure — parse it the same as a 200 rather than falling into the
    // throw-on-!ok branch below.
    if (res.status === 409 && body?.status === 'needs_decision') {
      return body;
    }
    if (!res.ok) {
      throw new Error(body?.error ?? `Request to /api/setup/adopt failed: ${res.status} ${res.statusText}`);
    }
    return body as SetupAdoptResponse;
  });
}

/** `max_turns_continue` + `choiceId: 'stop'` — the turn does not resume; `event` is a `needs_input` terminal to route through the normal stream-handler path. */
export interface SetupDecisionStopped {
  sessionId: string;
  status: 'stopped';
  event: SetupStatusEvent;
}

/** `name_conflict` + `choiceId: 'rename' | 'cancel'` — no turn is dispatched; the caller decides what to do locally (re-open name entry / abort). */
export interface SetupDecisionAction {
  sessionId: string;
  action: string;
}

/**
 * `POST /api/setup/decision` resolves a pending `SetupDecision` and returns
 * one of three shapes depending on the decision's `kind`/`choiceId`:
 * - `max_turns_continue` + `'continue'`, or `name_conflict` + `'clean'` → a
 *   fresh/resumed turn to stream (`SetupConnectTurn`, same shape as connect/
 *   context turns — reuse `setupStream`).
 * - `max_turns_continue` + `'stop'` → `SetupDecisionStopped` (no turn).
 * - `name_conflict` + `'rename' | 'cancel'` → `SetupDecisionAction` (no turn).
 */
export type SetupDecisionResult = SetupConnectTurn | SetupDecisionStopped | SetupDecisionAction;

export function postSetupDecision(sessionId: string, choiceId: string): Promise<SetupDecisionResult> {
  return request<SetupDecisionResult>('/api/setup/decision', {
    method: 'POST',
    body: JSON.stringify({ sessionId, choiceId }),
  });
}

export function postSetupCompileBind(): Promise<{ steps: SetupStep[]; verifyGatePassed: boolean }> {
  return request<{ steps: SetupStep[]; verifyGatePassed: boolean }>('/api/setup/compile-bind', {
    method: 'POST',
  });
}

/**
 * Resets the setup wizard to first-run state server-side (steps → step 1,
 * runtime settings → defaults, connect form/session cleared, project unbound).
 * Non-destructive: scaffolded project files on disk are left untouched. The
 * caller then resets local store state to match.
 */
export function postSetupReset(): Promise<{ ok: boolean; steps: SetupStep[]; runtimeSettings: RuntimeSettings }> {
  return request<{ ok: boolean; steps: SetupStep[]; runtimeSettings: RuntimeSettings }>('/api/setup/reset', {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Harness page
// ---------------------------------------------------------------------------

/**
 * The BFF's wire shape for the harness (`GET /api/harness`): one compiled
 * bundle profile plus its declared components — there is no orchestrator/
 * sub-agent split on the wire (that vocabulary is a frontend-only profile-
 * level concept; see `HarnessView`/`AgentProfileRow` in `@/harness/types`).
 * Kept private to this module; field names are mirrored 1:1 from the
 * harness's own `server/wire-types.ts` (never imported directly). `getHarness`
 * maps this straight into `HarnessView` — each component keeps its own
 * capabilities/guardrails; the aggregated capability-resolution and
 * guardrails VIEWS are derived later, in the page/component layer, not here.
 */
interface HarnessCapabilityDto {
  capability: string;
  outcome: 'native' | 'realize-via';
  providedBy: string;
  criticality?: string;
}

interface HarnessGuardrailDto {
  name: string;
  enforcement: string;
  locked: boolean;
  threshold?: number;
}

interface HarnessStepDto {
  name: string;
  tier: string;
  consumes: string[];
  produces: string;
  realization: string;
  guard?: string;
  foldInto?: string;
  maxAttempts?: number;
}

interface HarnessComponentDto {
  id: string;
  name: string;
  componentType: string;
  realizationKind: string;
  trigger: string;
  outcome: string;
  callableAs: string;
  model: string;
  tiers: TierModelBinding[];
  capabilities: HarnessCapabilityDto[];
  guardrails: HarnessGuardrailDto[];
  tools: { name: string; source: string }[];
  outputBlocks: string[];
  steps: HarnessStepDto[];
  status: string;
}

interface HarnessDto {
  profile: {
    id: string;
    name: string;
    boundContext: string;
    verifyGate: boolean;
    bundleId: string;
    bundleVersion: string;
    irVersion: string;
    dispatchTarget: string;
    bundleHash: string;
    status: string;
  };
  runtime: {
    backend: RuntimeBackendKind;
    label: string;
    tierModels: TierModelBinding[];
    dispatcher?: RuntimeDispatcherKind;
  };
  connection: ConnectionStatus;
  components: HarnessComponentDto[];
}

function fromComponentDto(dto: HarnessComponentDto): Component {
  const steps: Step[] = dto.steps.map((step) => ({
    name: step.name,
    tier: step.tier,
    consumes: step.consumes,
    produces: step.produces,
    realization: step.realization,
    ...(step.guard !== undefined ? { guard: step.guard } : {}),
    ...(step.foldInto !== undefined ? { foldInto: step.foldInto } : {}),
    ...(step.maxAttempts !== undefined ? { maxAttempts: step.maxAttempts } : {}),
  }));

  return {
    id: dto.id,
    name: dto.name,
    componentType: dto.componentType,
    realizationKind: dto.realizationKind,
    realizationLabel: deriveRealizationLabel(dto.realizationKind, steps, dto.trigger),
    trigger: dto.trigger,
    outcome: dto.outcome,
    callableAs: dto.callableAs,
    model: dto.model,
    tiers: dto.tiers,
    capabilities: dto.capabilities.map((cap) => ({
      capability: cap.capability,
      outcome: cap.outcome,
      providedBy: cap.providedBy,
      ...(cap.criticality !== undefined ? { criticality: cap.criticality } : {}),
    })),
    guardrails: dto.guardrails.map((guardrail) => ({
      name: guardrail.name,
      enforcement: guardrail.enforcement,
      locked: guardrail.locked,
      ...(guardrail.threshold !== undefined ? { threshold: guardrail.threshold } : {}),
    })),
    tools: dto.tools,
    outputBlocks: dto.outputBlocks,
    steps,
    status: dto.status,
  };
}

/**
 * Live mode only ever has one bound profile — the orchestrator row — derived
 * from `profile` + `runtime` + the capabilities declared across all
 * components (deduped by capability id). Phase-3 spawnable sub-agent
 * profiles have no live source yet, so this always returns exactly one row;
 * see `fixtures.ts` for a Phase-3 placeholder row example.
 */
function toOrchestratorAgentProfileRow(dto: HarnessDto, components: Component[]): AgentProfileRow {
  const capabilityById = new Map<string, Component['capabilities'][number]>();
  for (const component of components) {
    for (const cap of component.capabilities) {
      if (!capabilityById.has(cap.capability)) capabilityById.set(cap.capability, cap);
    }
  }
  const strongTier = dto.runtime.tierModels.find((tm) => tm.tier === 'strong');
  const tierModel = strongTier?.model ?? dto.runtime.tierModels[0]?.model ?? '';

  return {
    name: dto.profile.name,
    role: 'orchestrator',
    tierModel,
    capabilities: Array.from(capabilityById.values()),
    status: dto.profile.status,
  };
}

export function getHarness(): Promise<HarnessView> {
  return request<HarnessDto>('/api/harness').then((dto) => {
    const components = dto.components.map(fromComponentDto);
    return {
      profile: {
        id: dto.profile.id,
        name: dto.profile.name,
        boundContext: dto.profile.boundContext,
        verifyGate: dto.profile.verifyGate,
        bundleId: dto.profile.bundleId,
        bundleVersion: dto.profile.bundleVersion,
        irVersion: dto.profile.irVersion,
        dispatchTarget: dto.profile.dispatchTarget,
        bundleHash: dto.profile.bundleHash,
        status: dto.profile.status,
      },
      runtime: {
        backend: dto.runtime.backend,
        label: dto.runtime.label,
        tierModels: dto.runtime.tierModels,
        ...(dto.runtime.dispatcher !== undefined ? { dispatcher: dto.runtime.dispatcher } : {}),
      },
      connection: dto.connection,
      components,
      agentProfiles: [toOrchestratorAgentProfileRow(dto, components)],
    };
  });
}
