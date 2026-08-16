import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const createSession = vi.fn();
const getSession = vi.fn();
const listSessions = vi.fn();
const postTurn = vi.fn();
const postArtifactPublish = vi.fn();
const postArtifactSave = vi.fn();
const turnStreamUrl = vi.fn(
  (sessionId: string, turnId: string) => `http://bff.test/api/sessions/${sessionId}/stream?turn=${turnId}`,
);

vi.mock('@/bff/client', () => ({
  createSession: (...args: unknown[]) => createSession(...args),
  getSession: (...args: unknown[]) => getSession(...args),
  listSessions: (...args: unknown[]) => listSessions(...args),
  postTurn: (...args: unknown[]) => postTurn(...args),
  postArtifactPublish: (...args: unknown[]) => postArtifactPublish(...args),
  postArtifactSave: (...args: unknown[]) => postArtifactSave(...args),
  turnStreamUrl: (...args: [string, string]) => turnStreamUrl(...args),
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));

import { DRAFT_SESSION_ID, useSessionStore } from '../useSessionStore';

function resetStore() {
  useSessionStore.setState(
    {
      sessionsById: {},
      streaming: {},
      streamError: {},
      backendSessionId: {},
      sessionList: [],
    },
    false,
  );
}

beforeEach(() => {
  createSession.mockReset();
  getSession.mockReset();
  listSessions.mockReset();
  postTurn.mockReset();
  postArtifactPublish.mockReset();
  postArtifactSave.mockReset();
  turnStreamUrl.mockClear();
  resetStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSessionStore (live mode) — draft lazy-create', () => {
  it('creates a persisted structured session before the Sessions workbench opens it', async () => {
    createSession.mockResolvedValueOnce({ id: 'structured-1', title: 'New Structured Ask', createdAt: 'now', updatedAt: 'now' });

    await expect(useSessionStore.getState().startStructuredSession()).resolves.toBe('structured-1');

    expect(createSession).toHaveBeenCalledWith('New Structured Ask');
    expect(useSessionStore.getState().backendSessionId['structured-1']).toBe('structured-1');
    expect(useSessionStore.getState().sessionsById['structured-1']).toMatchObject({ id: 'structured-1', title: 'New Structured Ask', events: [], workLog: [] });
    expect(useSessionStore.getState().sessionList).toEqual([{ id: 'structured-1', title: 'New Structured Ask', updatedAt: 'now' }]);
  });

  it('mounting the draft (getOrCreate) never touches the BFF', () => {
    useSessionStore.getState().getOrCreate(DRAFT_SESSION_ID);

    expect(createSession).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessionsById[DRAFT_SESSION_ID]?.events).toEqual([]);
  });

  it('the first ask on a draft creates exactly one backend session titled from the question, re-keys the thread onto it, and refreshes the sidebar list', async () => {
    createSession.mockResolvedValueOnce({
      id: 'real-1',
      title: 'How much revenue this quarter',
      createdAt: 'now',
      updatedAt: 'now',
    });
    postTurn.mockResolvedValueOnce({ turnId: 't1', clarify: { prompt: 'Which range?', chips: ['This month'] } });
    listSessions.mockResolvedValueOnce([{ id: 'real-1', title: 'How much revenue this quarter', updatedAt: 'now' }]);

    useSessionStore.getState().sendMessage(DRAFT_SESSION_ID, 'How much revenue this quarter');

    await vi.waitFor(() => {
      expect(useSessionStore.getState().backendSessionId[DRAFT_SESSION_ID]).toBe('real-1');
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith('How much revenue this quarter');

    // The just-typed question survived the re-key onto the real id.
    const real = useSessionStore.getState().sessionsById['real-1'];
    expect(real?.events.some((e) => e.kind === 'user' && e.text === 'How much revenue this quarter')).toBe(true);

    // The in-flight stream keeps updating the (now real) id after the re-key.
    await vi.waitFor(() => {
      const clarify = useSessionStore.getState().sessionsById['real-1']?.events;
      expect(clarify?.some((e) => e.kind === 'clarify')).toBe(true);
    });

    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('truncates a long first question to a ~60-char single-line title', async () => {
    createSession.mockResolvedValueOnce({ id: 'real-2', title: 'x', createdAt: 'now', updatedAt: 'now' });
    postTurn.mockResolvedValueOnce({ turnId: 't1', clarify: { prompt: 'p', chips: [] } });
    listSessions.mockResolvedValueOnce([]);

    const longQuestion = `${'a'.repeat(50)}   ${'b'.repeat(50)}`;
    useSessionStore.getState().sendMessage(DRAFT_SESSION_ID, longQuestion);

    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    const [title] = createSession.mock.calls[0] as [string];
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toMatch(/\s{2,}/);
  });

  it('a second message sent before the route replaces reuses the same backend id and never creates twice', async () => {
    createSession.mockResolvedValueOnce({ id: 'real-3', title: 'q1', createdAt: 'now', updatedAt: 'now' });
    postTurn.mockResolvedValue({ turnId: 't1', clarify: { prompt: 'p', chips: [] } });
    listSessions.mockResolvedValue([]);

    useSessionStore.getState().sendMessage(DRAFT_SESSION_ID, 'first question');
    useSessionStore.getState().sendMessage(DRAFT_SESSION_ID, 'second question');

    await vi.waitFor(() => expect(postTurn).toHaveBeenCalledWith('real-3', 'second question'));
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('a follow-up sent after the draft resolves and the route re-mounts on the real id stays a second turn in the SAME session', async () => {
    createSession.mockResolvedValueOnce({ id: 'real-5', title: 'q1', createdAt: 'now', updatedAt: 'now' });
    postTurn.mockResolvedValue({ turnId: 't1', clarify: { prompt: 'p', chips: [] } });
    listSessions.mockResolvedValueOnce([]);

    useSessionStore.getState().sendMessage(DRAFT_SESSION_ID, 'show me the monthly orders data');

    await vi.waitFor(() => {
      expect(useSessionStore.getState().backendSessionId[DRAFT_SESSION_ID]).toBe('real-5');
    });

    // Mirrors `AskSession`'s redirect effect: route replaces onto
    // `/ask/real-5`, a fresh `AskSession` mounts for that id and calls
    // `getOrCreate('real-5')`, then the draft slot is cleared.
    useSessionStore.getState().getOrCreate('real-5');
    useSessionStore.getState().clearDraft();

    // The follow-up is sent against the real id — exactly what the
    // re-mounted `AskSession` does.
    useSessionStore.getState().sendMessage('real-5', 'build a dashboard for the monthly data');

    await vi.waitFor(() => {
      expect(postTurn).toHaveBeenCalledWith('real-5', 'build a dashboard for the monthly data');
    });

    // Exactly one backend session was ever created — the follow-up became a
    // second turn in it, not a new session.
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();

    const events = useSessionStore.getState().sessionsById['real-5']?.events ?? [];
    expect(events.filter((e) => e.kind === 'user').map((e) => (e.kind === 'user' ? e.text : ''))).toEqual([
      'show me the monthly orders data',
      'build a dashboard for the monthly data',
    ]);
  });

  it('clearDraft resets the draft slot so a converted draft does not bounce a later /ask visit back to itself', async () => {
    createSession.mockResolvedValueOnce({ id: 'real-4', title: 'q', createdAt: 'now', updatedAt: 'now' });
    postTurn.mockResolvedValueOnce({ turnId: 't1', clarify: { prompt: 'p', chips: [] } });
    listSessions.mockResolvedValueOnce([]);

    useSessionStore.getState().sendMessage(DRAFT_SESSION_ID, 'first question');

    await vi.waitFor(() => {
      expect(useSessionStore.getState().backendSessionId[DRAFT_SESSION_ID]).toBe('real-4');
    });

    // This is what `AskSession`'s redirect effect does right after issuing
    // the route replace onto the real id.
    useSessionStore.getState().clearDraft();

    const state = useSessionStore.getState();
    expect(state.backendSessionId[DRAFT_SESSION_ID]).toBeUndefined();
    expect(state.sessionsById[DRAFT_SESSION_ID]).toBeUndefined();
    expect(state.streaming[DRAFT_SESSION_ID]).toBeUndefined();
    expect(state.streamError[DRAFT_SESSION_ID]).toBeUndefined();
    // The real session itself is untouched.
    expect(state.sessionsById['real-4']).toBeDefined();

    // A later visit to `/ask` (getOrCreate on the draft id again) now seeds a
    // genuinely fresh, empty draft rather than reusing the stale mapping.
    const fresh = useSessionStore.getState().getOrCreate(DRAFT_SESSION_ID);
    expect(fresh.events).toEqual([]);
    expect(useSessionStore.getState().backendSessionId[DRAFT_SESSION_ID]).toBeUndefined();
  });
});

describe('useSessionStore (live mode) — resuming a real session', () => {
  it('getOrCreate on a real backend id hydrates via getSession and never calls createSession', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-real',
      title: 'Resumed',
      updatedAt: 'now',
      events: [{ id: 'e1', kind: 'user', text: 'hi' }],
      workLog: [],
    });

    useSessionStore.getState().getOrCreate('s-real');

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-real']?.events.length).toBe(1);
    });

    expect(getSession).toHaveBeenCalledWith('s-real');
    expect(createSession).not.toHaveBeenCalled();
    expect(useSessionStore.getState().backendSessionId['s-real']).toBe('s-real');
  });

  it('does not clobber an in-flight optimistic update if the hydrate GET resolves late', async () => {
    let resolveGetSession!: (value: unknown) => void;
    getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGetSession = resolve;
      }),
    );
    postTurn.mockResolvedValueOnce({ turnId: 't1', clarify: { prompt: 'p', chips: [] } });

    useSessionStore.getState().getOrCreate('s-real');
    useSessionStore.getState().sendMessage('s-real', 'a question typed before hydrate landed');

    await vi.waitFor(() => {
      const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
      expect(events.some((e) => e.kind === 'user' && e.text === 'a question typed before hydrate landed')).toBe(
        true,
      );
    });

    // The late-resolving hydrate GET carries stale (empty) events — it must
    // not wipe out the question (and whatever answered it) that already
    // landed locally while it was in flight.
    resolveGetSession({ id: 's-real', title: 'Resumed', updatedAt: 'now', events: [], workLog: [] });
    await Promise.resolve();
    await Promise.resolve();

    const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
    expect(events.some((e) => e.kind === 'user' && e.text === 'a question typed before hydrate landed')).toBe(true);
  });

  it('a fresh visit to a real session id hydrates a previously-published artifact from stored events', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-published',
      title: 'Resumed with a publish',
      updatedAt: 'now',
      events: [
        {
          id: 'a-1',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard.json',
          artifactId: 'artifact-real-1',
        },
        {
          id: 'p-1',
          kind: 'published',
          artifactName: 'Revenue dashboard',
          link: 'https://bff.test/share/artifact-real-1',
          scope: 'workspace',
        },
      ],
      workLog: [],
    });

    useSessionStore.getState().getOrCreate('s-published');

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-published']?.events.length).toBe(2);
    });

    const events = useSessionStore.getState().sessionsById['s-published']?.events ?? [];
    expect(events.some((e) => e.kind === 'published' && e.link === 'https://bff.test/share/artifact-real-1')).toBe(
      true,
    );
  });

  it('a fresh visit to a real session id hydrates a previously-saved artifact from stored events (proves reload/replay state)', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-saved',
      title: 'Resumed with a save',
      updatedAt: 'now',
      events: [
        {
          id: 'a-1',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard.json',
          artifactId: 'artifact-real-1',
        },
        {
          id: 's-1',
          kind: 'saved',
          artifactId: 'artifact-real-1',
          artifactName: 'Revenue dashboard',
          savedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
      workLog: [],
    });

    useSessionStore.getState().getOrCreate('s-saved');

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-saved']?.events.length).toBe(2);
    });

    const events = useSessionStore.getState().sessionsById['s-saved']?.events ?? [];
    expect(events.some((e) => e.kind === 'saved' && e.savedAt === '2026-07-28T00:00:00.000Z')).toBe(true);
  });
});

describe('useSessionStore (live mode) — saveArtifact', () => {
  it('saves via the real BFF route using the artifact event’s real artifactId and the backend session id, and stores the REAL returned savedAt', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-real',
      title: 'Resumed',
      updatedAt: 'now',
      events: [
        {
          id: 'a-1',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard.json',
          artifactId: 'artifact-real-1',
        },
      ],
      workLog: [],
    });
    postArtifactSave.mockResolvedValueOnce({ savedAt: '2026-07-28T00:00:00.000Z' });

    useSessionStore.getState().getOrCreate('s-real');
    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-real']?.events.length).toBe(1);
    });

    useSessionStore.getState().saveArtifact('s-real', 'a-1');

    await vi.waitFor(() => {
      const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
      expect(events.some((e) => e.kind === 'saved')).toBe(true);
    });

    // Called with (backend session id, the artifact's real artifactId) — never the UI event id ('a-1').
    expect(postArtifactSave).toHaveBeenCalledWith('s-real', 'artifact-real-1');

    const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
    const saved = events.find((e) => e.kind === 'saved');
    expect(saved).toMatchObject({
      artifactId: 'artifact-real-1',
      artifactName: 'Revenue dashboard',
      savedAt: '2026-07-28T00:00:00.000Z',
    });
  });

  it('does not crash and leaves the artifact unsaved if postArtifactSave rejects', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-real',
      title: 'Resumed',
      updatedAt: 'now',
      events: [
        {
          id: 'a-1',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard.json',
          artifactId: 'artifact-real-1',
        },
      ],
      workLog: [],
    });
    postArtifactSave.mockRejectedValueOnce(new Error('network down'));

    useSessionStore.getState().getOrCreate('s-real');
    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-real']?.events.length).toBe(1);
    });

    useSessionStore.getState().saveArtifact('s-real', 'a-1');

    await vi.waitFor(() => expect(postArtifactSave).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();

    const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
    expect(events.some((e) => e.kind === 'saved')).toBe(false);
  });

  it('saving one of two same-named artifacts still allows saving the other (dedup guard keys on artifactId, not name)', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-dupe-names',
      title: 'Two runs of the same prompt',
      updatedAt: 'now',
      events: [
        {
          id: 'a-1',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard-1.json',
          artifactId: 'artifact-real-1',
        },
        {
          id: 'a-2',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard-2.json',
          artifactId: 'artifact-real-2',
        },
      ],
      workLog: [],
    });
    postArtifactSave.mockResolvedValueOnce({ savedAt: '2026-07-28T00:00:00.000Z' });

    useSessionStore.getState().getOrCreate('s-dupe-names');
    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-dupe-names']?.events.length).toBe(2);
    });

    // Save only the first artifact.
    useSessionStore.getState().saveArtifact('s-dupe-names', 'a-1');
    await vi.waitFor(() => {
      const events = useSessionStore.getState().sessionsById['s-dupe-names']?.events ?? [];
      expect(events.some((e) => e.kind === 'saved')).toBe(true);
    });

    // The never-saved, same-named sibling must still be saveable: a name-keyed dedup
    // guard would treat it as already saved and never call postArtifactSave for it.
    postArtifactSave.mockResolvedValueOnce({ savedAt: '2026-07-28T00:01:00.000Z' });
    useSessionStore.getState().saveArtifact('s-dupe-names', 'a-2');

    await vi.waitFor(() => {
      const events = useSessionStore.getState().sessionsById['s-dupe-names']?.events ?? [];
      expect(events.filter((e) => e.kind === 'saved')).toHaveLength(2);
    });

    expect(postArtifactSave).toHaveBeenCalledWith('s-dupe-names', 'artifact-real-1');
    expect(postArtifactSave).toHaveBeenCalledWith('s-dupe-names', 'artifact-real-2');
  });
});

describe('useSessionStore (live mode) — publishArtifact', () => {
  it('publishes via the real BFF route using the artifact event’s real artifactId and the backend session id, and stores the REAL returned link', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-real',
      title: 'Resumed',
      updatedAt: 'now',
      events: [
        {
          id: 'a-1',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard.json',
          artifactId: 'artifact-real-1',
        },
      ],
      workLog: [],
    });
    postArtifactPublish.mockResolvedValueOnce({ link: 'https://bff.test/share/artifact-real-1', scope: 'link' });

    useSessionStore.getState().getOrCreate('s-real');
    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-real']?.events.length).toBe(1);
    });

    useSessionStore.getState().publishArtifact('s-real', 'a-1');

    await vi.waitFor(() => {
      const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
      expect(events.some((e) => e.kind === 'published')).toBe(true);
    });

    // Called with (backend session id, the artifact's real artifactId) —
    // never the UI event id ('a-1') and never a fabricated scope.
    expect(postArtifactPublish).toHaveBeenCalledWith('s-real', 'artifact-real-1');

    const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
    const published = events.find((e) => e.kind === 'published');
    expect(published).toMatchObject({ link: 'https://bff.test/share/artifact-real-1', scope: 'link' });
    // Not the offline fake-link shape.
    expect(published?.kind === 'published' ? published.link : undefined).not.toMatch(/share\.genbi\.example/);
  });

  it('does not crash and leaves the artifact unpublished if postArtifactPublish rejects', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-real',
      title: 'Resumed',
      updatedAt: 'now',
      events: [
        {
          id: 'a-1',
          kind: 'artifact',
          name: 'Revenue dashboard',
          artifactKind: 'dashboard',
          location: 'artifacts/revenue-dashboard.json',
          artifactId: 'artifact-real-1',
        },
      ],
      workLog: [],
    });
    postArtifactPublish.mockRejectedValueOnce(new Error('network down'));

    useSessionStore.getState().getOrCreate('s-real');
    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsById['s-real']?.events.length).toBe(1);
    });

    useSessionStore.getState().publishArtifact('s-real', 'a-1');

    await vi.waitFor(() => expect(postArtifactPublish).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();

    const events = useSessionStore.getState().sessionsById['s-real']?.events ?? [];
    expect(events.some((e) => e.kind === 'published')).toBe(false);
  });
});
