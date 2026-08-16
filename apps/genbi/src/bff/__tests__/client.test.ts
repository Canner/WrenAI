import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `client.ts` computes every request URL through `bffBaseUrl()` — stub it to
// a fixed origin so these tests assert on method/path/body shape rather than
// the dev-vs-prod base URL logic (covered separately by `env.ts`'s own use).
vi.mock('../env', () => ({
  bffBaseUrl: () => 'http://bff.test',
}));

import {
  createSession,
  getArtifact,
  getContextImpact,
  getContextOverview,
  getEvalRun,
  getHarness,
  getRuntimeSettings,
  getSession,
  getSetupSteps,
  listArtifacts,
  listEvalRuns,
  listSessions,
  listNativeSessions,
  getNativeSessionReadiness,
  createNativeSession,
  BffRequestError,
  NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE,
  getNativeSetupRecovery,
  postNativeSetupRecoveryAction,
  stopNativeSession,
  nativeSessionWebSocketUrl,
  postArtifactPublish,
  postSetupAdopt,
  postSetupCompileBind,
  postSetupConnectTurn,
  postSetupResume,
  postTurn,
  putRuntimeSettings,
  turnStreamUrl,
} from '../client';

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: () => Promise.resolve(body),
  } as Response;
}

describe('bff/client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createSession POSTs /api/sessions with an optional title and returns the parsed body', async () => {
    const created = { id: 's1', title: 'Q3 revenue', createdAt: 'now', updatedAt: 'now' };
    fetchMock.mockResolvedValueOnce(jsonResponse(created));

    const result = await createSession('Q3 revenue');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/sessions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'Q3 revenue' }) }),
    );
    expect(result).toEqual(created);
  });

  it('createSession sends an empty body when no title is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 's1', title: '', createdAt: 'now', updatedAt: 'now' }));

    await createSession();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/sessions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
  });

  it('listSessions GETs /api/sessions and returns the summaries, most-recent first', async () => {
    const summaries = [
      { id: 's2', title: 'Monthly signups trend', updatedAt: '2026-07-17T09:20:00Z' },
      { id: 's1', title: 'What does MRR mean?', updatedAt: '2026-07-14T16:05:00Z' },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(summaries));

    const result = await listSessions();

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/sessions', expect.objectContaining({}));
    expect(result).toEqual(summaries);
  });

  it('getSession GETs /api/sessions/:id', async () => {
    const session = { id: 's1', title: 'x', updatedAt: 'now', events: [], workLog: [] };
    fetchMock.mockResolvedValueOnce(jsonResponse(session));

    const result = await getSession('s1');

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/sessions/s1', expect.objectContaining({}));
    expect(result).toEqual(session);
  });

  it('postTurn POSTs the question and returns turnId + optional clarify', async () => {
    const turn = { turnId: 't1', clarify: { prompt: 'Which range?', chips: ['This month'] } };
    fetchMock.mockResolvedValueOnce(jsonResponse(turn));

    const result = await postTurn('s1', 'how much revenue?');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/sessions/s1/turns',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ question: 'how much revenue?' }) }),
    );
    expect(result).toEqual(turn);
  });

  it('turnStreamUrl builds the SSE URL without going through fetch', () => {
    expect(turnStreamUrl('s1', 't1')).toBe('http://bff.test/api/sessions/s1/stream?turn=t1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turnStreamUrl encodes the turn id', () => {
    expect(turnStreamUrl('s1', 't/1')).toBe('http://bff.test/api/sessions/s1/stream?turn=t%2F1');
  });

  it('uses the separate native-session namespace for list, creation, recovery actions, stop and WebSocket attach', async () => {
    const row = { id: 'native-1', purpose: 'analysis', vendor: 'codex', status: 'running' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ sessions: [row] }));
    expect(await listNativeSessions()).toEqual({ sessions: [row] });
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions', expect.objectContaining({}));

    const readiness = { setup: { scopeKind: 'bootstrap', available: true, vendors: { claude: { available: true }, codex: { available: true } } } };
    fetchMock.mockResolvedValueOnce(jsonResponse(readiness));
    expect(await getNativeSessionReadiness()).toEqual(readiness);
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions/readiness', expect.objectContaining({}));

    fetchMock.mockResolvedValueOnce(jsonResponse({ session: row, capability: 'capability' }));
    await createNativeSession('analysis');
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ purpose: 'analysis', intent: 'open_existing' }) }));

    for (const vendor of ['claude', 'codex'] as const) {
      const controller = new AbortController();
      fetchMock.mockResolvedValueOnce(jsonResponse({ session: row, capability: `${vendor}-capability` }));
      await createNativeSession('analysis', vendor, controller.signal);
      expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ purpose: 'analysis', intent: 'open_existing' }),
        signal: controller.signal,
      }));
    }

    fetchMock.mockResolvedValueOnce(jsonResponse({ session: row, capability: 'separate-capability' }));
    await createNativeSession('analysis', { intent: 'start_separate', idempotencyKey: '00000000-0000-4000-8000-000000000001' });
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ purpose: 'analysis', intent: 'start_separate', idempotencyKey: '00000000-0000-4000-8000-000000000001' }) }));

    fetchMock.mockResolvedValueOnce(jsonResponse({ session: row, capability: 'opened-capability' }));
    await createNativeSession('analysis', { intent: 'open_existing', sessionId: 'native-session-00000000-0000-4000-8000-000000000001' });
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ purpose: 'analysis', intent: 'open_existing', sessionId: 'native-session-00000000-0000-4000-8000-000000000001' }) }));

    fetchMock.mockResolvedValueOnce(jsonResponse({ session: row, recovery: { version: 2 } }));
    await getNativeSetupRecovery('native/1');
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions/native%2F1/recovery', expect.objectContaining({}));

    fetchMock.mockResolvedValueOnce(jsonResponse({ session: row, capability: 'fresh', recoveryCapability: 'recovery-fresh' }));
    await postNativeSetupRecoveryAction('native/1', 'recovery-capability', 2, 'retry');
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions/native%2F1/recovery-action', expect.objectContaining({ method: 'POST', body: JSON.stringify({ capability: 'recovery-capability', expectedVersion: 2, action: 'retry' }) }));

    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content', json: () => Promise.resolve(undefined) } as Response);
    await expect(stopNativeSession('native/1', 'capability')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/native-sessions/native%2F1/stop', expect.objectContaining({ method: 'POST', body: JSON.stringify({ capability: 'capability' }) }));
    expect(nativeSessionWebSocketUrl('native/1', 'cap ability')).toBe('ws://bff.test/api/native-sessions/native%2F1/attach?cap=cap%20ability');
  });

  it('getContextOverview GETs /api/context/overview and maps projectPath through to ContextOverviewData', async () => {
    const overview = {
      projectName: 'acme-genbi',
      projectPath: '/Users/you/wren-projects/acme-genbi',
      models: [],
      relationships: [],
      measures: [],
      knowledge: { instructionsPresent: false, verifiedPairCount: 0 },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(overview));

    const result = await getContextOverview();

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/context/overview', expect.objectContaining({}));
    expect(result.projectPath).toBe('/Users/you/wren-projects/acme-genbi');
    expect(result).toEqual(overview);
  });

  it('getContextImpact GETs the encoded entity key and returns blastRadius', async () => {
    const blastRadius = { seed: { key: 'orders', name: 'Orders', kind: 'model' }, downstream: [], severity: 'none' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ blastRadius }));

    const result = await getContextImpact('orders/x');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/context/impact/orders%2Fx',
      expect.objectContaining({}),
    );
    expect(result).toEqual({ blastRadius });
  });

  it('listEvalRuns GETs /api/eval/runs', async () => {
    const runs = [{ id: 'run-1' }];
    fetchMock.mockResolvedValueOnce(jsonResponse(runs));

    const result = await listEvalRuns();

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/eval/runs', expect.objectContaining({}));
    expect(result).toEqual(runs);
  });

  it('getEvalRun GETs /api/eval/runs/:id and returns run + componentScores', async () => {
    const body = { run: { id: 'run-1' }, componentScores: [{ name: 'Schema retrieval', score: 0.9 }] };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    const result = await getEvalRun('run-1');

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/eval/runs/run-1', expect.objectContaining({}));
    expect(result).toEqual(body);
  });

  it('getSetupSteps GETs /api/setup/steps', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ key: 'runtime', state: 'current' }]));
    await getSetupSteps();
    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/setup/steps', expect.objectContaining({}));
  });

  it('getRuntimeSettings GETs and putRuntimeSettings PUTs /api/config/runtime', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authMode: 'byo', tierModels: [], hybrid: false, deployment: 'hosted' }));
    await getRuntimeSettings();
    expect(fetchMock).toHaveBeenLastCalledWith('http://bff.test/api/config/runtime', expect.objectContaining({}));

    fetchMock.mockResolvedValueOnce(jsonResponse({ authMode: 'byo', tierModels: [], hybrid: true, deployment: 'hosted' }));
    const result = await putRuntimeSettings({ hybrid: true });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://bff.test/api/config/runtime',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ hybrid: true }) }),
    );
    expect(result).toEqual({ authMode: 'byo', tierModels: [], hybrid: true, deployment: 'hosted' });
  });

  it('postSetupConnectTurn POSTs projectName + sourceType and returns sessionId + turnId', async () => {
    const turn = { sessionId: 's1', turnId: 't1' };
    fetchMock.mockResolvedValueOnce(jsonResponse(turn));

    const result = await postSetupConnectTurn('my-project', 'postgres');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/setup/connect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectName: 'my-project', sourceType: 'postgres' }),
      }),
    );
    expect(result).toEqual(turn);
  });

  it('postSetupAdopt POSTs just projectPath when no profile is given, and returns an "ok" body as-is', async () => {
    const body = { status: 'ok', message: 'adopted' };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    const result = await postSetupAdopt('/existing/project');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/setup/adopt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectPath: '/existing/project' }),
      }),
    );
    expect(result).toEqual(body);
  });

  it('postSetupAdopt includes profile in the body when re-POSTing after a select_profile choice', async () => {
    const body = { status: 'needs_decision', message: 'context not built yet', decision: { kind: 'build_context', options: [] } };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    const result = await postSetupAdopt('/existing/project', 'demo');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/setup/adopt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectPath: '/existing/project', profile: 'demo' }),
      }),
    );
    expect(result).toEqual(body);
  });

  it('postSetupAdopt returns a 409 select_profile decision as a normal resolved value, not a thrown error', async () => {
    const body = {
      status: 'needs_decision',
      message: 'no profile pinned',
      decision: { kind: 'select_profile', options: [{ id: 'demo', label: 'demo' }] },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(body, { ok: false, status: 409 }));

    const result = await postSetupAdopt('/existing/project');

    expect(result).toEqual(body);
  });

  it('postSetupAdopt still throws on a genuine non-2xx, non-select_profile failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { ok: false, status: 500, statusText: 'Internal Server Error' }));

    await expect(postSetupAdopt('/existing/project')).rejects.toThrow('boom');
  });

  it('postSetupResume POSTs an empty body and returns a fresh sessionId + turnId', async () => {
    const turn = { sessionId: 's1', turnId: 't2' };
    fetchMock.mockResolvedValueOnce(jsonResponse(turn));

    const result = await postSetupResume();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/setup/connect/resume',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
    expect(result).toEqual(turn);
  });

  it('postSetupCompileBind POSTs with no body and returns steps + verifyGatePassed', async () => {
    const body = { steps: [{ key: 'bind', state: 'done' }], verifyGatePassed: true };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));

    const result = await postSetupCompileBind();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/setup/compile-bind',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual(body);
  });

  it('listArtifacts GETs /api/artifacts and maps the flat ArtifactDto onto ArtifactSummary', async () => {
    // Shape is the harness's actual `ArtifactDto` (server/wire-types.ts): flat,
    // id/artifactKind/published — not the app's own key/kind/publish naming.
    const dtos = [
      {
        id: 'a1',
        sessionId: 's1',
        name: 'Revenue dashboard',
        artifactKind: 'dashboard',
        location: 'artifacts/revenue-dashboard.json',
        verified: true,
        createdAt: '2026-07-17T09:20:00Z',
        published: { link: 'https://share.genbi.example/revenue-dashboard', scope: 'workspace' },
      },
      {
        id: 'a2',
        sessionId: 's1',
        name: 'Q3 business review',
        artifactKind: 'report',
        location: 'artifacts/q3-business-review.html',
        verified: true,
        createdAt: '2026-07-14T16:05:00Z',
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(dtos));

    const result = await listArtifacts();

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/artifacts', expect.objectContaining({}));
    expect(result).toEqual([
      {
        key: 'a1',
        sessionId: 's1',
        name: 'Revenue dashboard',
        kind: 'dashboard',
        location: 'artifacts/revenue-dashboard.json',
        verified: true,
        createdAt: '2026-07-17T09:20:00Z',
        publish: { link: 'https://share.genbi.example/revenue-dashboard', scope: 'workspace' },
      },
      {
        key: 'a2',
        sessionId: 's1',
        name: 'Q3 business review',
        kind: 'report',
        location: 'artifacts/q3-business-review.html',
        verified: true,
        createdAt: '2026-07-14T16:05:00Z',
      },
    ]);
  });

  it('getArtifact GETs /api/artifacts/:key and maps the metadata-only ArtifactDto', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'a3',
        sessionId: 's2',
        name: 'Monthly signups trend',
        artifactKind: 'chart',
        location: 'artifacts/monthly-signups-trend.json',
        verified: true,
        createdAt: '2026-07-16T11:40:00Z',
      }),
    );

    const result = await getArtifact('a3');

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/artifacts/a3', expect.objectContaining({}));
    // No tiles/envelope/preview/source — the BFF stores metadata only.
    expect(result).toEqual({
      key: 'a3',
      sessionId: 's2',
      name: 'Monthly signups trend',
      kind: 'chart',
      location: 'artifacts/monthly-signups-trend.json',
      verified: true,
      createdAt: '2026-07-16T11:40:00Z',
    });
  });

  it('maps native-session provenance to a Sessions source link without treating it as Share state', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'native-a1',
        sessionId: 'native-session-1',
        nativeSessionId: 'native-session-1',
        name: 'Verified dashboard',
        artifactKind: 'dashboard',
        location: 'native/native-a1.json',
        verified: true,
        createdAt: '2026-08-10T12:00:00Z',
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ form: 'envelope', envelope: { blocks: [], verified: true } }));

    const artifact = await getArtifact('native-a1');
    expect(artifact).toMatchObject({
      nativeSessionId: 'native-session-1',
      source: { label: 'Session', href: '/sessions/native-session-1' },
    });
    expect(artifact).not.toHaveProperty('publish');
  });

  it('getArtifact also fetches /api/artifacts/:key/content and merges an envelope into a chart/dashboard artifact', async () => {
    const envelope = { blocks: [{ type: 'kpi_card', label: 'Revenue', value: 42000 }] };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'a4',
        sessionId: 's2',
        name: 'Monthly signups trend',
        artifactKind: 'chart',
        location: 'artifacts/monthly-signups-trend.json',
        verified: true,
        createdAt: '2026-07-16T11:40:00Z',
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ form: 'envelope', envelope }));

    const result = await getArtifact('a4');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/artifacts/a4/content',
      expect.objectContaining({}),
    );
    expect(result).toEqual({
      key: 'a4',
      sessionId: 's2',
      name: 'Monthly signups trend',
      kind: 'chart',
      location: 'artifacts/monthly-signups-trend.json',
      verified: true,
      createdAt: '2026-07-16T11:40:00Z',
      envelope,
    });
  });

  it("getArtifact merges an envelope-form content response into a report's preview as { kind: 'envelope' }", async () => {
    const envelope = { blocks: [{ type: 'table', columns: ['a'], rows: [] }] };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'a5',
        sessionId: 's2',
        name: 'Q3 report',
        artifactKind: 'report',
        location: 'artifacts/q3-report.json',
        verified: true,
        createdAt: '2026-07-16T11:40:00Z',
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ form: 'envelope', envelope }));

    const result = await getArtifact('a5');

    expect(result).toMatchObject({ preview: { kind: 'envelope', envelope } });
  });

  it("getArtifact merges a text-form content response into a report's preview as { kind: 'html' }", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'a6',
        sessionId: 's2',
        name: 'Q3 report',
        artifactKind: 'report',
        location: 'artifacts/q3-report.html',
        verified: true,
        createdAt: '2026-07-16T11:40:00Z',
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ form: 'text', text: '<h1>Report</h1>', truncated: false }));

    const result = await getArtifact('a6');

    expect(result).toMatchObject({ preview: { kind: 'html', html: '<h1>Report</h1>' } });
  });

  it("getArtifact leaves the artifact metadata-only when the content route resolves 'unavailable'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'a7',
        sessionId: 's2',
        name: 'Deleted chart',
        artifactKind: 'chart',
        location: 'artifacts/deleted-chart.json',
        verified: false,
        createdAt: '2026-07-16T11:40:00Z',
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ form: 'unavailable', reason: 'missing' }));

    const result = await getArtifact('a7');

    expect(result).toEqual({
      key: 'a7',
      sessionId: 's2',
      name: 'Deleted chart',
      kind: 'chart',
      location: 'artifacts/deleted-chart.json',
      verified: false,
      createdAt: '2026-07-16T11:40:00Z',
    });
  });

  it('getArtifact leaves the artifact metadata-only when the content fetch itself fails (never rejects)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'a8',
        sessionId: 's2',
        name: 'Unreachable content',
        artifactKind: 'dashboard',
        location: 'artifacts/unreachable.json',
        verified: false,
        createdAt: '2026-07-16T11:40:00Z',
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { ok: false, status: 500 }));

    const result = await getArtifact('a8');

    expect(result).toEqual({
      key: 'a8',
      sessionId: 's2',
      name: 'Unreachable content',
      kind: 'dashboard',
      location: 'artifacts/unreachable.json',
      verified: false,
      createdAt: '2026-07-16T11:40:00Z',
    });
  });

  it('postArtifactPublish POSTs the session-scoped route and unwraps the PublishedEvent response', async () => {
    // Real response shape is a `PublishedEvent` (`{ id, kind: 'published', artifactName, link, scope }`),
    // not a `{ publish }` wrapper.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'evt-1',
        kind: 'published',
        artifactName: 'Revenue dashboard',
        link: 'https://share.genbi.example/a1',
        scope: 'workspace',
      }),
    );

    const result = await postArtifactPublish('s1', 'a1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://bff.test/api/sessions/s1/artifacts/a1/publish',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ scope: 'workspace' }) }),
    );
    expect(result).toEqual({ link: 'https://share.genbi.example/a1', scope: 'workspace' });
  });

  it('throws with the server-provided error message on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'session not found' }, { ok: false, status: 404 }));

    await expect(getSession('missing')).rejects.toThrow('session not found');
  });

  it('keeps a typed, redacted native launch stale fence distinct from ambiguous transport failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { error: 'native session launch failed', code: NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE },
      { ok: false, status: 409, statusText: 'Conflict' },
    ));

    await expect(createNativeSession('analysis', { intent: 'start_separate', idempotencyKey: '00000000-0000-4000-8000-000000000099' }))
      .rejects.toMatchObject({ name: 'BffRequestError', message: 'native session launch failed', status: 409, code: NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE } satisfies Partial<BffRequestError>);
  });

  it('falls back to a status-based message when the error body cannot be parsed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);

    await expect(getSession('s1')).rejects.toThrow('500 Internal Server Error');
  });

  it('getHarness GETs /api/harness and maps the wire HarnessDto onto HarnessView', async () => {
    // Shape is the harness's actual `HarnessDto` (server/wire-types.ts): one
    // compiled profile + its declared components — no orchestrator/sub-agent
    // split on the wire (that's a frontend-only profile-level concept).
    const dto = {
      purpose: { purpose: 'analysis', profile: 'genbi-default', scopeKind: 'bound_project', target: 'claude-code:interactive', targetLabel: 'Claude CLI', available: true },
      profile: {
        id: 'genbi-default',
        name: 'Genbi Default',
        boundContext: 'acme-wren',
        verifyGate: true,
        bundleId: 'genbi-default@vercel:headless',
        bundleVersion: '0.1',
        irVersion: '0.4',
        dispatchTarget: 'vercel:headless',
        bundleHash: '9c31a02',
        status: 'Bound',
      },
      runtime: {
        backend: 'api-key',
        label: 'API key (anthropic)',
        tierModels: [
          { tier: 'cheap', model: 'claude-haiku' },
          { tier: 'strong', model: 'claude-sonnet' },
        ],
      },
      connection: {
        type: 'PostgreSQL',
        location: 'analytics-prod',
        via: 'query engine',
        tablesSynced: 14,
        lastSync: '5m ago',
        health: 'healthy',
      },
      components: [
        {
          id: 'explore_model',
          name: 'Explore Model',
          componentType: 'analytical',
          realizationKind: 'skill',
          trigger: 'one_shot',
          outcome: 'none',
          callableAs: 'explore_model',
          model: 'claude-haiku',
          tiers: [{ tier: 'cheap', model: 'claude-haiku' }],
          capabilities: [
            { capability: 'semantic_introspection', outcome: 'realize-via', providedBy: 'runtime' },
          ],
          guardrails: [{ name: 'read_only_execution', enforcement: 'read_only', locked: true }],
          tools: [{ name: 'semantic_introspect', source: 'mcp:sample/semantic_introspect' }],
          outputBlocks: [],
          // Single tier across all steps — no "· split" suffix.
          steps: [
            { name: 'summarize_semantics', tier: 'cheap', consumes: ['raw_introspect_result'], produces: 'semantic_summary', realization: 'independent' },
          ],
          status: 'ready',
        },
        {
          id: 'answer_query',
          name: 'Answer Query',
          componentType: 'analytical',
          realizationKind: 'skill',
          trigger: 'one_shot',
          outcome: 'none',
          callableAs: 'answer_query',
          model: 'claude-sonnet',
          tiers: [
            { tier: 'cheap', model: 'claude-haiku' },
            { tier: 'strong', model: 'claude-sonnet' },
          ],
          capabilities: [
            { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
            // Same id as `explore_model`'s capability list would collide, but
            // this one is distinct — dedup is exercised via the shared id below.
            { capability: 'semantic_introspection', outcome: 'realize-via', providedBy: 'runtime' },
          ],
          guardrails: [
            { name: 'read_only_execution', enforcement: 'read_only', locked: true },
            { name: 'row_limit', enforcement: 'threshold_limit', locked: false, threshold: 1000 },
          ],
          tools: [{ name: 'query', source: 'mcp:sample/query' }],
          outputBlocks: ['table'],
          // Two distinct tiers across steps — "· split" suffix expected.
          steps: [
            { name: 'resolve_intent', tier: 'cheap', consumes: [], produces: 'query_intent', realization: 'independent' },
            {
              name: 'repair_sql',
              tier: 'strong',
              consumes: ['query_intent'],
              produces: 'repaired_result',
              realization: 'repair_fold',
              guard: 'on_failure',
              foldInto: 'generate_sql',
              maxAttempts: 1,
            },
          ],
          status: 'ready',
        },
        {
          id: 'monitor_freshness',
          name: 'Monitor Freshness',
          componentType: 'assertive',
          realizationKind: 'tool',
          trigger: 'scheduled',
          outcome: 'assertion',
          callableAs: 'monitor_freshness',
          model: 'claude-haiku',
          tiers: [{ tier: 'cheap', model: 'claude-haiku' }],
          capabilities: [{ capability: 'scheduler', outcome: 'realize-via', providedBy: 'runtime', criticality: 'required' }],
          guardrails: [{ name: 'read_only_execution', enforcement: 'read_only', locked: true }],
          tools: [{ name: 'check_freshness', source: 'mcp:sample/check_freshness' }],
          outputBlocks: ['status'],
          // Single tier, but a scheduled trigger — "· scheduled" suffix expected.
          steps: [
            { name: 'assess_severity', tier: 'cheap', consumes: ['freshness_reading'], produces: 'severity_verdict', realization: 'independent', guard: 'on_flag' },
          ],
          status: 'ready',
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(dto));

    const result = await getHarness('analysis');

    expect(fetchMock).toHaveBeenCalledWith('http://bff.test/api/harness?purpose=analysis', expect.objectContaining({}));

    // Profile / runtime / connection pass through field-for-field.
    expect(result.purpose).toEqual(dto.purpose);
    expect(result.profile).toEqual(dto.profile);
    expect(result.runtime).toEqual(dto.runtime);
    expect(result.connection).toEqual(dto.connection);

    // realizationLabel is derived, not on the wire: single-tier component stays
    // plain, multi-tier component gets the "· split" suffix.
    expect(result.components[0].realizationLabel).toBe('skill');
    expect(result.components[1].realizationLabel).toBe('skill · split');
    // Single tier, but a scheduled trigger — proves `trigger` threads through
    // the live BFF mapping (not just the fixture path).
    expect(result.components[2].realizationLabel).toBe('tool · scheduled');

    // Optional step/capability/guardrail fields are only present when the DTO sent them.
    expect(result.components[0].steps[0]).not.toHaveProperty('guard');
    expect(result.components[1].steps[1]).toMatchObject({
      guard: 'on_failure',
      foldInto: 'generate_sql',
      maxAttempts: 1,
    });
    expect(result.components[1].capabilities[0]).toMatchObject({
      capability: 'sql_execution:read_only',
      criticality: 'required',
    });
    expect(result.components[1].guardrails[1]).toMatchObject({ name: 'row_limit', threshold: 1000 });

    // Live mode derives exactly one agent-profile row (the orchestrator), with
    // capabilities deduped across all components by capability id (first-seen wins)
    // and the tier→model binding taken from the "strong" tier.
    expect(result.agentProfiles).toHaveLength(1);
    expect(result.agentProfiles[0]).toEqual({
      name: 'Genbi Default',
      role: 'orchestrator',
      tierModel: 'claude-sonnet',
      capabilities: [
        { capability: 'semantic_introspection', outcome: 'realize-via', providedBy: 'runtime' },
        { capability: 'sql_execution:read_only', outcome: 'native', providedBy: 'runtime', criticality: 'required' },
        { capability: 'scheduler', outcome: 'realize-via', providedBy: 'runtime', criticality: 'required' },
      ],
      status: 'Bound',
    });
  });
});
