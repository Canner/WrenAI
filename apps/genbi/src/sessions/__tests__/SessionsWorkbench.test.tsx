import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';

const client = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), create: vi.fn(), stop: vi.fn(), readiness: vi.fn(), recovery: vi.fn(), recoveryAction: vi.fn(), listStructured: vi.fn(),
  createStructured: vi.fn(),
  url: vi.fn(() => 'ws://native.test/attach'),
}));
const resizeCallbacks = vi.hoisted(() => [] as Array<() => void>);
const fitCalls = vi.hoisted(() => [] as unknown[]);
const terminals = vi.hoisted(() => [] as Array<{ cols: number; rows: number; focus: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; writeln: ReturnType<typeof vi.fn>; options: { theme?: unknown; fontSize?: number; lineHeight?: number; fontFamily?: string } }>);
const sockets = vi.hoisted(() => [] as MockWebSocket[]);

class MockWebSocket {
  static readonly OPEN = 1;
  readonly readyState = MockWebSocket.OPEN;
  onopen: (() => void) | undefined;
  onmessage: ((event: { data: string }) => void) | undefined;
  onerror: (() => void) | undefined;
  onclose: (() => void) | undefined;
  constructor(_url: string) { sockets.push(this); }
  send = vi.fn();
  close = vi.fn();
}

const ready = {
  runtime: { configured: true, generation: 3, provider: 'claude' as const, target: 'claude-code:interactive' as const, targetLabel: 'Claude CLI' as const },
  mcp: { server: 'GenBI MCP' as const, tool: 'save_dashboard' as const, destination: 'GenBI Artifacts' as const, available: true },
  purposes: {
    analysis: { scopeKind: 'bound_project' as const, profile: 'genbi-default', target: 'claude-code:interactive' as const, targetLabel: 'Claude CLI' as const, available: true },
    setup: { scopeKind: 'bootstrap' as const, profile: 'genbi-setup', target: 'claude-code:interactive' as const, targetLabel: 'Claude CLI' as const, available: true },
    context_enrichment: { scopeKind: 'bound_project' as const, profile: 'genbi-enrich-context', target: 'claude-code:interactive' as const, targetLabel: 'Claude CLI' as const, available: true },
  },
};

vi.mock('@/bff/env', () => ({ isBffEnabled: () => true }));
vi.mock('@/bff/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/bff/client')>()),
  listNativeSessions: client.list,
  getNativeSession: client.get,
  createNativeSession: client.create,
  stopNativeSession: client.stop,
  getNativeSessionReadiness: client.readiness,
  getNativeSetupRecovery: client.recovery,
  postNativeSetupRecoveryAction: client.recoveryAction,
  nativeSessionWebSocketUrl: client.url,
  createSession: client.createStructured,
  listSessions: client.listStructured,
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 100;
  rows = 30;
  focus = vi.fn();
  write = vi.fn();
  writeln = vi.fn();
  options: { theme?: unknown; fontSize?: number; lineHeight?: number; fontFamily?: string };
  constructor(options: { theme?: unknown; fontSize?: number; lineHeight?: number; fontFamily?: string }) { this.options = options; terminals.push(this); }
  loadAddon() {}
  open() {}
  dispose() {}
  onData() { return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() { fitCalls.push(this); } } }));

import { AppShell } from '@/app/shell/AppShell';
import { SessionsPage } from '../SessionsPage';
import { PurposeSessionLaunch } from '../PurposeSessionLaunch';
import { useNativeSessions } from '../useNativeSessions';
import { useUiStore } from '@/stores/useUiStore';
import { useSessionStore } from '@/session/useSessionStore';
import { nativeTerminalThemes } from '@/app/theme/tokens';
import { nativeTerminalTypography } from '../terminalTypography';
import { BffRequestError, NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE, type NativeSession } from '@/bff/client';

const now = '2026-08-10T08:00:00.000Z';
function native(id: string, status: 'running' | 'detached' | 'exited' | 'failed' | 'interrupted' | 'stopped' = 'running') {
  return {
    id, purpose: 'analysis' as const, vendor: 'claude' as const, agent: 'answer_query', scopeKind: 'bound_project' as const,
    scopeId: 'scope', projectIdentity: 'project', bindingGeneration: 1, projectRevision: 'sha256:one', status,
    createdAt: now, updatedAt: now, startedAt: status === 'running' || status === 'detached' ? now : null,
    endedAt: status === 'running' || status === 'detached' ? null : now, exitCode: status === 'exited' ? 0 : null,
    failure: status === 'failed' ? 'launch failed' : status === 'interrupted' ? 'native session interrupted by BFF restart' : null,
  };
}

/** Uses the real AppShell, its contextual sidebar, and a nested route. */
function Surface() {
  return <Routes><Route element={<AppShell />}><Route path="/sessions" element={<SessionsPage />} /><Route path="/sessions/ask/:sessionId" element={<div>Structured Ask canvas</div>} /><Route path="/sessions/:id" element={<SessionsPage />} /><Route path="/setup" element={<div />} /><Route path="/context" element={<div />} /></Route></Routes>;
}
function Location() { return <div data-testid="location">{useLocation().pathname}</div>; }

beforeEach(() => {
  client.list.mockReset();
  client.get.mockReset();
  client.create.mockReset();
  client.createStructured.mockReset().mockResolvedValue({ id: 'structured-one', title: 'New Structured Ask', createdAt: now, updatedAt: now });
  client.listStructured.mockReset().mockResolvedValue([]);
  client.stop.mockReset();
  client.recovery.mockReset();
  client.recoveryAction.mockReset();
  client.readiness.mockReset().mockResolvedValue(ready);
  client.url.mockReset().mockReturnValue('ws://native.test/attach');
  sockets.splice(0);
  terminals.splice(0);
  resizeCallbacks.splice(0);
  fitCalls.splice(0);
  sessionStorage.clear();
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  useNativeSessions.setState({ sessions: [], loading: false, error: undefined, readiness: undefined, readinessLoading: false, readinessError: undefined }, false);
  useSessionStore.setState({ sessionsById: {}, streaming: {}, streamError: {}, backendSessionId: {}, sessionList: [] }, false);
  useUiStore.setState({ sidebarCollapsed: false, themeMode: 'light' }, false);
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Sessions workbench', () => {
  it('creates only the Runtime-bound target and retains the browser-scoped capability', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    client.create.mockResolvedValue({ session: native('new-one'), capability: 'capability-one' });
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint8Array<ArrayBuffer>) => {
        values.set(Array.from({ length: 16 }, (_, index) => index));
        return values;
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions' });

    expect(await screen.findByText(/No native sessions yet/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /new session/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /new session/i }));
    expect(screen.getByRole('radio', { name: 'Analyze data' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Start separate native terminal' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/new-one'));
    expect(client.create).toHaveBeenCalledWith('analysis', expect.objectContaining({ intent: 'start_separate', idempotencyKey: expect.any(String) }));
    expect((client.create.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:new-one')).toBe('capability-one');
  });

  it('coalesces duplicate new-session clicks, retains an ambiguous action for retry, and refreshes it after success', async () => {
    let deliver!: (value: { session: ReturnType<typeof native>; capability: string }) => void;
    const inFlight = new Promise<{ session: ReturnType<typeof native>; capability: string }>((resolve) => { deliver = resolve; });
    client.create
      .mockReturnValueOnce(inFlight)
      .mockRejectedValueOnce(new Error('connection closed after response loss'))
      .mockResolvedValueOnce({ session: native('retry-created'), capability: 'retry-capability' })
      .mockResolvedValueOnce({ session: native('later-created'), capability: 'later-capability' });

    const first = useNativeSessions.getState().createSession('analysis', undefined, 'sessions-new');
    const duplicate = useNativeSessions.getState().createSession('analysis', undefined, 'sessions-new');
    expect(duplicate).toBe(first);
    expect(client.create).toHaveBeenCalledTimes(1);

    deliver({ session: native('first-created'), capability: 'first-capability' });
    await expect(first).resolves.toMatchObject({ id: 'first-created' });
    const firstKey = (client.create.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey;

    await expect(useNativeSessions.getState().createSession('analysis', undefined, 'sessions-new')).rejects.toThrow('response loss');
    await expect(useNativeSessions.getState().createSession('analysis', undefined, 'sessions-new')).resolves.toMatchObject({ id: 'retry-created' });
    expect((client.create.mock.calls[2]?.[1] as { idempotencyKey: string }).idempotencyKey).toBe((client.create.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey);

    await expect(useNativeSessions.getState().createSession('analysis', undefined, 'sessions-new')).resolves.toMatchObject({ id: 'later-created' });
    expect((client.create.mock.calls[3]?.[1] as { idempotencyKey: string }).idempotencyKey).not.toBe(firstKey);
    expect((client.create.mock.calls[3]?.[1] as { idempotencyKey: string }).idempotencyKey).not.toBe((client.create.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey);
  });

  it('keeps simultaneous starts from distinct entry surfaces separate', async () => {
    let deliverContext!: (value: { session: NativeSession; capability: string }) => void;
    let deliverSessions!: (value: { session: NativeSession; capability: string }) => void;
    const contextInFlight = new Promise<{ session: NativeSession; capability: string }>((resolve) => { deliverContext = resolve; });
    const sessionsInFlight = new Promise<{ session: NativeSession; capability: string }>((resolve) => { deliverSessions = resolve; });
    client.create.mockReturnValueOnce(contextInFlight).mockReturnValueOnce(sessionsInFlight);

    const contextLaunch = useNativeSessions.getState().createSession('context_enrichment', 'context', 'context');
    const sessionsLaunch = useNativeSessions.getState().createSession('context_enrichment', undefined, 'sessions-new');

    expect(sessionsLaunch).not.toBe(contextLaunch);
    expect(client.create).toHaveBeenCalledTimes(2);
    expect((client.create.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey)
      .not.toBe((client.create.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey);

    deliverContext({ session: { ...native('context-created'), purpose: 'context_enrichment' }, capability: 'context-capability' });
    deliverSessions({ session: { ...native('sessions-created'), purpose: 'context_enrichment' }, capability: 'sessions-capability' });
    await expect(contextLaunch).resolves.toMatchObject({ id: 'context-created' });
    await expect(sessionsLaunch).resolves.toMatchObject({ id: 'sessions-created' });
    expect(sessionStorage.getItem('wren-genbi-native-session-return-source:context-created')).toBe('context');
    expect(sessionStorage.getItem('wren-genbi-native-session-return-source:sessions-created')).toBeNull();
  });

  it('lists matching live sessions as open-existing choices while a separate launch creates a new session', async () => {
    client.list.mockResolvedValue({ sessions: [native('existing-one'), native('existing-two')] });
    client.create.mockResolvedValueOnce({ session: native('existing-two'), capability: 'fresh-tab-capability' });
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions' });

    await user.click(await screen.findByRole('button', { name: /new session/i }));
    const menu = screen.getByLabelText('New session options');
    const existingChoices = screen.getAllByRole('button', { name: /Open existing Analyze data session/ });
    expect(menu).toHaveClass('sessions-new-menu');
    expect(existingChoices).toHaveLength(2);
    expect(existingChoices[1]).toHaveAttribute('title', 'Open existing Analyze data session ting-two');
    await user.click(existingChoices[1]!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/existing-two'));
    expect(client.create).toHaveBeenCalledWith('analysis', { intent: 'open_existing', sessionId: 'existing-two' });
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:existing-two')).toBe('fresh-tab-capability');

  });

  it('does not render a cached live row as open-existing while the popover refresh removes an expired session', async () => {
    let resolveRefresh!: (value: { sessions: ReturnType<typeof native>[] }) => void;
    const stale = native('expired-in-sidebar', 'detached');
    client.list
      .mockResolvedValueOnce({ sessions: [stale] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions' });
    await screen.findByRole('button', { name: /Analyze data.*Detached/i });

    await user.click(screen.getByRole('button', { name: /new session/i }));
    expect(screen.queryByRole('button', { name: /Open existing Analyze data session/ })).not.toBeInTheDocument();
    resolveRefresh({ sessions: [] });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Open existing Analyze data session/ })).not.toBeInTheDocument());
  });

  it('does not let an older initial list restore Open existing after a newer popover refresh', async () => {
    let resolveInitial!: (value: { sessions: ReturnType<typeof native>[] }) => void;
    const stale = native('late-detached', 'detached');
    client.list
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce({ sessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions' });
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /new session/i }));
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /Open existing Analyze data session/ })).not.toBeInTheDocument();

    await act(async () => { resolveInitial({ sessions: [stale] }); });
    expect(screen.queryByRole('button', { name: /Open existing Analyze data session/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Analyze data.*Detached/i })).not.toBeInTheDocument();
  });

  it('opens Structured Ask without creating a native terminal session', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions' });

    await user.click(await screen.findByRole('button', { name: /new session/i }));
    expect(screen.getByRole('region', { name: 'Structured Ask session' })).toHaveTextContent('Chart-first answers, dashboards, and follow-up questions.');
    expect(screen.getByRole('region', { name: 'Native terminal session' })).toHaveTextContent('Open a running terminal or start a separate CLI session for analysis or context enrichment.');
    await user.click(screen.getByRole('button', { name: 'Start Structured Ask' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/ask/structured-one'));
    expect(screen.getByText('Structured Ask canvas')).toBeInTheDocument();
    expect(client.create).not.toHaveBeenCalled();
  });

  it('lists persisted Structured Ask and native terminal sessions together with truthful type labels', async () => {
    client.list.mockResolvedValue({ sessions: [native('native-one')] });
    client.listStructured.mockResolvedValue([{ id: 'structured-existing', title: 'Revenue review', updatedAt: now }]);
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions' });

    const sidebar = screen.getByRole('navigation', { name: 'Sessions' });
    await waitFor(() => expect(within(sidebar).getByRole('region', { name: 'Structured Ask sessions' })).toBeInTheDocument());
    expect(within(sidebar).getByText('Revenue review')).toBeInTheDocument();
    expect(within(sidebar).getByText('Analyze data')).toBeInTheDocument();
    await user.click(within(sidebar).getByText('Revenue review'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/ask/structured-existing'));
    expect(client.create).not.toHaveBeenCalled();
  });

  it('keeps long structured session purposes and native identity/metadata distinguishable in the sidebar', async () => {
    const longEnglish = 'Quarterly revenue retention analysis for enterprise expansion opportunities across every regional sales team';
    const longCjk = '跨區域客戶留存與產品採用趨勢分析報告，協助辨識下一季的成長機會';
    const selectedNative = native('native-session-8b7e2a19');
    client.list.mockResolvedValue({ sessions: [selectedNative, native('native-session-1234abcd', 'exited')] });
    client.get.mockResolvedValue({ session: selectedNative });
    client.listStructured.mockResolvedValue([
      { id: 'structured-long-en', title: longEnglish, updatedAt: now },
      { id: 'structured-long-cjk', title: longCjk, updatedAt: now },
    ]);
    renderWithProviders(<Surface />, { route: `/sessions/${selectedNative.id}` });

    const sidebar = screen.getByRole('navigation', { name: 'Sessions' });
    const nativeRow = await within(sidebar).findByRole('button', { name: /Analyze data.*Session ID native-session-8b7e2a19.*Native terminal.*Claude.*Running/ });
    const cjkTitle = within(sidebar).getByText(longCjk);
    expect(cjkTitle).toHaveClass('sessions-sidebar-purpose');
    expect(cjkTitle).toHaveAttribute('title', longCjk);
    expect(within(nativeRow).getByText('8b7e2a19')).toHaveClass('sessions-sidebar-id');
    expect(within(nativeRow).getByText('Claude')).toBeInTheDocument();
    expect(within(nativeRow).getByText('Running')).toBeInTheDocument();
    expect(nativeRow).toHaveAttribute('aria-current', 'page');
    nativeRow.focus();
    expect(nativeRow).toHaveFocus();
  });

  it('keeps internal MCP implementation details out of the New Session surface', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions' });
    await user.click(await screen.findByRole('button', { name: /new session/i }));
    expect(screen.queryByLabelText('GenBI MCP health')).not.toBeInTheDocument();
    expect(screen.queryByText(/save_dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/vendor CLI artifacts remain/i)).not.toBeInTheDocument();
  });

  it('selects context enrichment in the Sessions sidebar and submits only its fixed purpose', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    client.create.mockResolvedValue({
      session: { ...native('enrich-one'), purpose: 'context_enrichment' as const, agent: 'inspect_context' },
      capability: 'enrich-capability',
    });
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions' });

    await user.click(await screen.findByRole('button', { name: /new session/i }));
    await user.click(screen.getByRole('radio', { name: 'Enrich context' }));
    expect(screen.getByRole('radio', { name: 'Enrich context' })).toBeChecked();
    expect(screen.getByText('Runtime target: Claude CLI · genbi-enrich-context')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start separate native terminal' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/enrich-one'));
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create).toHaveBeenCalledWith('context_enrichment', expect.objectContaining({ intent: 'start_separate', idempotencyKey: expect.any(String) }));
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:enrich-one')).toBe('enrich-capability');
  });

  it('projects a Runtime target switch into the mounted Sessions and Context launch surfaces', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /><PurposeSessionLaunch purpose="context_enrichment" title="Context enrichment" lead="lead" returnSource="context" /></>, { route: '/sessions' });

    await user.click(await screen.findByRole('button', { name: /new session/i }));
    expect(screen.getByText('Runtime target: Claude CLI · genbi-default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start separate Claude CLI session' })).toBeEnabled();

    const codexReady = {
      ...ready,
      runtime: { configured: true, generation: 4, provider: 'codex' as const, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
      purposes: {
        analysis: { ...ready.purposes.analysis, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
        setup: { ...ready.purposes.setup, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
        context_enrichment: { ...ready.purposes.context_enrichment, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
      },
    };
    client.readiness.mockResolvedValue(codexReady);
    await act(async () => { await useNativeSessions.getState().refreshReadiness(); });

    expect(screen.getByText('Runtime target: Codex CLI · genbi-default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start separate Codex CLI session' })).toBeEnabled();
  });

  it('keeps the newest Runtime generation when an older readiness response finishes late', async () => {
    let releaseOlder!: (value: typeof ready) => void;
    const older = new Promise<typeof ready>((resolve) => { releaseOlder = resolve; });
    const newer = {
      ...ready,
      runtime: { configured: true, generation: 4, provider: 'codex' as const, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
      purposes: {
        analysis: { ...ready.purposes.analysis, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
        setup: { ...ready.purposes.setup, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
        context_enrichment: { ...ready.purposes.context_enrichment, target: 'codex:interactive' as const, targetLabel: 'Codex CLI' as const },
      },
    };
    client.readiness.mockImplementationOnce(() => older).mockResolvedValueOnce(newer);
    const first = useNativeSessions.getState().refreshReadiness();
    const second = useNativeSessions.getState().refreshReadiness();
    await second;
    releaseOlder(ready);
    await first;
    expect(useNativeSessions.getState().readiness).toMatchObject({ runtime: { generation: 4, target: 'codex:interactive' } });
  });

  it('prevents creation when the Runtime-bound native target is unavailable', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    client.readiness.mockResolvedValue({
      ...ready,
      purposes: { ...ready.purposes, analysis: { ...ready.purposes.analysis, available: false, reason: 'the claude interactive CLI is not available on this machine' } },
    });
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions' });
    await waitFor(() => expect(screen.getByRole('button', { name: /new session/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /new session/i }));
    expect(screen.getByText('the claude interactive CLI is not available on this machine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start separate native terminal' })).toBeDisabled();

    client.readiness.mockRejectedValueOnce(new Error('native terminal host cannot spawn local processes'));
    client.list.mockResolvedValue({ sessions: [] });
    const unavailable = renderWithProviders(<Surface />, { route: '/sessions' });
    expect((await screen.findAllByText(/Native host is unavailable/)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /new session/i }).at(-1)).toBeEnabled();
    expect(client.create).not.toHaveBeenCalled();
    unavailable.unmount();
  });

  it('reports a concise browser compatibility error instead of a raw JavaScript launch error', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions' });
    await user.click(await screen.findByRole('button', { name: /new session/i }));
    vi.stubGlobal('crypto', undefined);

    await user.click(screen.getByRole('button', { name: 'Start separate native terminal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This browser cannot create a secure session action. Reload in a supported browser and try again.');
    expect(client.create).not.toHaveBeenCalled();
  });

  it('keeps bootstrap Setup out of New Session choices even when it is the only available native purpose', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    client.readiness.mockResolvedValue({
      runtime: { configured: true, generation: 4, provider: 'codex', target: 'codex:interactive', targetLabel: 'Codex CLI' },
      purposes: {
        analysis: { scopeKind: 'bound_project', profile: 'genbi-default', target: 'codex:interactive', targetLabel: 'Codex CLI', available: false, reason: 'native sessions require a current bound project' },
        setup: { scopeKind: 'bootstrap', profile: 'genbi-setup', target: 'codex:interactive', targetLabel: 'Codex CLI', available: true },
        context_enrichment: { scopeKind: 'bound_project', profile: 'genbi-enrich-context', target: 'codex:interactive', targetLabel: 'Codex CLI', available: false, reason: 'native sessions require a current bound project' },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions' });
    await user.click(await screen.findByRole('button', { name: /new session/i }));
    expect(screen.getByRole('button', { name: 'Start Structured Ask' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start separate native terminal' })).toBeDisabled();
    expect(screen.queryByRole('radio', { name: 'Set up a project' })).not.toBeInTheDocument();
    expect(client.create).not.toHaveBeenCalled();
  });

  it('restores a redacted Setup recovery snapshot after reload and rotates both browser capabilities on retry', async () => {
    const row = { ...native('setup-retry', 'exited'), purpose: 'setup' as const, scopeKind: 'bootstrap' as const, projectIdentity: null, bindingGeneration: null, projectRevision: null };
    const next = { ...native('setup-next'), purpose: 'setup' as const, scopeKind: 'bootstrap' as const, projectIdentity: null, bindingGeneration: null, projectRevision: null };
    client.list.mockResolvedValue({ sessions: [row] });
    client.recovery.mockResolvedValue({ session: row, recovery: { sessionId: row.id, phase: 'connect', state: 'retryable_failure', code: 'retryable', sequence: 3, decision: null, completionValidated: false, version: 4, createdAt: now, updatedAt: now } });
    client.recoveryAction.mockResolvedValue({ session: next, capability: 'next-terminal', recoveryCapability: 'next-recovery' });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:setup-retry', 'old-terminal');
    sessionStorage.setItem('wren-genbi-native-session-recovery-capability:setup-retry', 'old-recovery');
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions/setup-retry' });
    const user = userEvent.setup();
    expect((await screen.findAllByText('Set up a project')).length).toBeGreaterThan(0);
    expect(screen.getByText('Setup recovery: retryable failure')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Retry in a new session' }));
    expect(client.recoveryAction).toHaveBeenCalledWith('setup-retry', 'old-recovery', 4, 'retry');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/setup-next'));
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:setup-retry')).toBeNull();
    expect(sessionStorage.getItem('wren-genbi-native-session-recovery-capability:setup-retry')).toBeNull();
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:setup-next')).toBe('next-terminal');
    expect(sessionStorage.getItem('wren-genbi-native-session-recovery-capability:setup-next')).toBe('next-recovery');
  });

  it('retries an initial failed Setup launch at version zero without storing a terminal capability', async () => {
    const row = { ...native('setup-launch-failed', 'failed'), purpose: 'setup' as const, scopeKind: 'bootstrap' as const, projectIdentity: null, bindingGeneration: null, projectRevision: null };
    const next = { ...native('setup-retried'), purpose: 'setup' as const, scopeKind: 'bootstrap' as const, projectIdentity: null, bindingGeneration: null, projectRevision: null };
    client.list.mockResolvedValue({ sessions: [row] });
    client.recovery.mockResolvedValue({ session: row, recovery: undefined });
    client.recoveryAction.mockResolvedValue({ session: next, capability: 'next-terminal', recoveryCapability: 'next-recovery' });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-recovery-capability:setup-launch-failed', 'launch-recovery');
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions/setup-launch-failed' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Retry in a new session' }));
    expect(client.recoveryAction).toHaveBeenCalledWith('setup-launch-failed', 'launch-recovery', 0, 'retry');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/setup-retried'));
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:setup-launch-failed')).toBeNull();
    expect(sessionStorage.getItem('wren-genbi-native-session-recovery-capability:setup-retried')).toBe('next-recovery');
  });

  it('clears Setup recovery capability and hides actions for a stopped session', async () => {
    const row = { ...native('setup-stopped', 'stopped'), purpose: 'setup' as const, scopeKind: 'bootstrap' as const, projectIdentity: null, bindingGeneration: null, projectRevision: null };
    client.list.mockResolvedValue({ sessions: [row] });
    client.recovery.mockResolvedValue({ session: row, recovery: { sessionId: row.id, phase: 'connect', state: 'retryable_failure', code: 'retryable', sequence: 1, decision: null, completionValidated: false, version: 1, createdAt: now, updatedAt: now } });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-recovery-capability:setup-stopped', 'stopped-recovery');
    renderWithProviders(<Surface />, { route: '/sessions/setup-stopped' });
    await screen.findByLabelText('Setup recovery');
    expect(screen.queryByRole('button', { name: 'Retry in a new session' })).not.toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('wren-genbi-native-session-recovery-capability:setup-stopped')).toBeNull());
  });

  it('does not expose retired Setup when project-bound native purposes are fenced', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    client.readiness.mockResolvedValue({
      ...ready,
      purposes: {
        ...ready.purposes,
        analysis: { ...ready.purposes.analysis, available: false, reason: 'native sessions require a current bound project' },
        setup: { ...ready.purposes.setup, available: true },
        context_enrichment: { ...ready.purposes.context_enrichment, available: false, reason: 'native sessions require a current bound project' },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions' });
    await user.click(await screen.findByRole('button', { name: /new session/i }));
    await user.click(screen.getByRole('radio', { name: 'Analyze data' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start separate native terminal' })).toBeDisabled());
    expect(screen.getByText('native sessions require a current bound project')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Enrich context' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start separate native terminal' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Start Structured Ask' })).toBeEnabled();
    expect(screen.queryByRole('radio', { name: 'Set up a project' })).not.toBeInTheDocument();
    expect(client.create).not.toHaveBeenCalled();
  });

  it('groups running and recent sessions and selects exited and failed rows truthfully', async () => {
    const rows = [native('run'), native('done', 'exited'), native('failed', 'failed')];
    client.list.mockResolvedValue({ sessions: rows });
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions' });

    expect(await screen.findByRole('region', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Analyze data.*Claude.*Exited/i }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/done'));
    expect(screen.getByText('Session exited')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconnect$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Analyze data.*Claude.*Failed/i }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/failed'));
    expect(screen.getByText('Session failed')).toBeInTheDocument();
    expect(screen.getByText(/cannot be resumed/i)).toBeInTheDocument();
  });

  it('offers Restart, never Resume, after a BFF-restarted terminal and rotates the browser capability through a fresh launch', async () => {
    const interrupted = native('bff-restarted', 'interrupted');
    const restarted = native('fresh-after-restart');
    client.list.mockResolvedValue({ sessions: [interrupted] });
    client.create.mockResolvedValue({ session: restarted, capability: 'fresh-capability' });
    useNativeSessions.setState({ sessions: [interrupted] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:bff-restarted', 'stale-capability');
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions/bff-restarted' });

    expect(await screen.findByText(/cannot be resumed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resume$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restart in a new session' }));

    expect(client.create).toHaveBeenCalledWith('analysis', expect.objectContaining({ intent: 'start_separate', idempotencyKey: expect.any(String) }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/fresh-after-restart'));
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:bff-restarted')).toBeNull();
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:fresh-after-restart')).toBe('fresh-capability');
  });

  it.each(['claude', 'codex'] as const)('labels %s Resume and Restart distinctly and sends no provider handle from the browser', async (vendor) => {
    const interrupted = {
      ...native('claude-resume', 'interrupted'),
      vendor,
      lifecycle: { liveAction: 'resume' as const, resumeAvailable: true, reason: `Resume continues the retained ${vendor === 'claude' ? 'Claude' : 'Codex'} conversation in a new isolated terminal.` },
    };
    const resumed = { ...native('claude-resumed'), vendor };
    client.list.mockResolvedValue({ sessions: [interrupted] });
    client.create.mockResolvedValue({ session: resumed, capability: 'resumed-capability' });
    useNativeSessions.setState({ sessions: [interrupted] }, false);
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions/claude-resume' });

    expect(await screen.findByRole('button', { name: 'Resume conversation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart in a new session' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Restart starts a separate ${vendor === 'claude' ? 'Claude' : 'Codex'} conversation`))).toBeInTheDocument();
    expect(screen.queryByText(/no sealed provider resume handle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot be resumed/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume conversation' }));

    expect(client.create).toHaveBeenCalledWith('analysis', {
      intent: 'resume', sessionId: 'claude-resume', idempotencyKey: expect.any(String),
    });
    expect(JSON.stringify(client.create.mock.calls[0])).not.toMatch(/handle|--resume|session-id/i);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/claude-resumed'));
  });

  it('reuses a dead source restart UUID after a lost response, keeps separate sources distinct, and clears it after success', async () => {
    const firstSource = native('restart-source-one', 'interrupted');
    const secondSource = native('restart-source-two', 'interrupted');
    const replacement = native('replacement-after-retry');
    const afterSuccess = native('replacement-after-success');
    client.create
      // The BFF completed this launch, but the browser never received its response.
      .mockRejectedValueOnce(new Error('connection closed after response loss'))
      .mockResolvedValueOnce({ session: replacement, capability: 'recovered-capability' })
      .mockRejectedValueOnce(new Error('connection closed after response loss'))
      .mockResolvedValueOnce({ session: afterSuccess, capability: 'new-action-capability' });

    await expect(useNativeSessions.getState().restartSession(firstSource)).rejects.toThrow('response loss');
    await expect(useNativeSessions.getState().restartSession(firstSource)).resolves.toEqual(replacement);
    await expect(useNativeSessions.getState().restartSession(secondSource)).rejects.toThrow('response loss');
    await expect(useNativeSessions.getState().restartSession(firstSource)).resolves.toEqual(afterSuccess);

    const firstRetryKey = (client.create.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey;
    expect(firstRetryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((client.create.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey).toBe(firstRetryKey);
    expect((client.create.mock.calls[2]?.[1] as { idempotencyKey: string }).idempotencyKey).not.toBe(firstRetryKey);
    expect((client.create.mock.calls[3]?.[1] as { idempotencyKey: string }).idempotencyKey).not.toBe(firstRetryKey);
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:replacement-after-retry')).toBe('recovered-capability');
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:replacement-after-success')).toBe('new-action-capability');
  });

  it('drops a retained restart action when its source scope changes and preserves AbortSignal forwarding', async () => {
    const source = native('restart-scope-change', 'interrupted');
    const changedScope = { ...source, bindingGeneration: 2, projectRevision: 'sha256:two' };
    const controller = new AbortController();
    client.create
      .mockRejectedValueOnce(new Error('response unavailable'))
      .mockResolvedValueOnce({ session: native('replacement-after-scope-change'), capability: 'scope-capability' });

    await expect(useNativeSessions.getState().restartSession(source)).rejects.toThrow('response unavailable');
    await expect(useNativeSessions.getState().restartSession(changedScope, undefined, controller.signal)).resolves.toMatchObject({ id: 'replacement-after-scope-change' });

    expect((client.create.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey)
      .not.toBe((client.create.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey);
    expect(client.create.mock.calls[1]?.[2]).toBe(controller.signal);
  });

  it('reuses a captured restart UUID after AbortError, forwards the signal, and clears it after the recovered response', async () => {
    const source = native('restart-abort-retry', 'interrupted');
    const controller = new AbortController();
    const aborted = new DOMException('request aborted', 'AbortError');
    client.create
      .mockRejectedValueOnce(aborted)
      .mockResolvedValueOnce({ session: native('replacement-after-abort'), capability: 'abort-recovered-capability' })
      .mockResolvedValueOnce({ session: native('replacement-after-abort-success'), capability: 'post-abort-success-capability' });

    await expect(useNativeSessions.getState().restartSession(source, undefined, controller.signal)).rejects.toBe(aborted);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create.mock.calls[0]?.[2]).toBe(controller.signal);

    await expect(useNativeSessions.getState().restartSession(source)).resolves.toMatchObject({ id: 'replacement-after-abort' });
    expect(client.create).toHaveBeenCalledTimes(2);
    const abortedKey = (client.create.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey;
    expect((client.create.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey).toBe(abortedKey);
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:replacement-after-abort')).toBe('abort-recovered-capability');

    await expect(useNativeSessions.getState().restartSession(source)).resolves.toMatchObject({ id: 'replacement-after-abort-success' });
    expect((client.create.mock.calls[2]?.[1] as { idempotencyKey: string }).idempotencyKey).not.toBe(abortedKey);
  });

  it('clears only a typed stale action after BFF scope rotation, while ordinary lost responses retain their UUID', async () => {
    const source = native('restart-unchanged-historical-source', 'interrupted');
    const stale = new BffRequestError('native session launch failed', 409, NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE);
    client.create
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce({ session: native('replacement-after-bff-scope-rotation'), capability: 'rotated-scope-capability' });

    await expect(useNativeSessions.getState().restartSession(source)).rejects.toBe(stale);
    await expect(useNativeSessions.getState().restartSession(source)).resolves.toMatchObject({ id: 'replacement-after-bff-scope-rotation' });

    expect((client.create.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey)
      .not.toBe((client.create.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey);
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:replacement-after-bff-scope-rotation')).toBe('rotated-scope-capability');
  });

  it('uses the real AppShell canvas, collapses its contextual rail, and enters compact layout on a narrow viewport', async () => {
    const row = native('live');
    client.list.mockResolvedValue({ sessions: [row] });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:live', 'capability-live');
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions/live' });

    await waitFor(() => expect(sockets.length).toBe(1));
    const content = screen.getByTestId('app-content');
    const workbench = screen.getByTestId('sessions-workbench');
    expect(content).toHaveStyle({ overflow: 'hidden' });
    expect(workbench.parentElement).toBe(content);
    expect(workbench.querySelector('.ant-card')).toBeNull();
    expect(workbench.querySelector('[role="dialog"]')).toBeNull();
    expect(workbench.querySelector('.sessions-terminal-wrap')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByTestId('contextual-sidebar')).toHaveClass('ant-layout-sider-collapsed');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    act(() => window.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(workbench).toHaveClass('is-compact'));
  });

  it('focuses and resizes xterm once, then restores its capability after a reload', async () => {
    const row = native('live');
    client.list.mockResolvedValue({ sessions: [row] });
    client.get.mockResolvedValue({ session: row });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:live', 'capability-live');
    const first = renderWithProviders(<Surface />, { route: '/sessions/live' });
    await waitFor(() => expect(sockets.length).toBe(1));
    act(() => sockets[0].onopen?.());
    expect(terminals[0].focus).toHaveBeenCalled();
    expect(sockets[0].send).toHaveBeenCalledTimes(1);
    act(() => { resizeCallbacks[0](); resizeCallbacks[0](); });
    expect(sockets[0].send).toHaveBeenCalledTimes(1);
    expect(terminals[0].options.theme).toEqual(nativeTerminalThemes.light);
    expect(terminals[0].options).toMatchObject(nativeTerminalTypography);
    const sgr = '\u001b[31mred\u001b[0m \u001b[94mbright-blue\u001b[0m';
    act(() => sockets[0].onmessage?.({ data: JSON.stringify({ type: 'replay', truncated: true, retainedBytes: 65_536, retentionLimitBytes: 65_536 }) }));
    expect(terminals[0].writeln).toHaveBeenCalledWith('\r\n[Earlier terminal output was truncated; showing the retained tail.]\r\n');
    act(() => sockets[0].onmessage?.({ data: JSON.stringify({ type: 'data', data: sgr }) }));
    expect(terminals[0].write).toHaveBeenCalledWith(sgr);
    const fitsBeforeThemeChange = fitCalls.length;
    act(() => useUiStore.getState().setThemeMode('dark'));
    await waitFor(() => expect(fitCalls.length).toBeGreaterThan(fitsBeforeThemeChange));
    expect(terminals[0].options.theme).toEqual(nativeTerminalThemes.dark);
    expect(sockets[0].send).toHaveBeenCalledTimes(1);

    first.unmount();
    expect(sockets[0].close).toHaveBeenCalledOnce();
    renderWithProviders(<Surface />, { route: '/sessions/live' });
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:live')).toBe('capability-live');
  });

  it('recreates xterm when switching browser sessions and renders each replay without dropping bytes', async () => {
    const first = native('first'); const second = native('second');
    client.list.mockResolvedValue({ sessions: [first, second] });
    useNativeSessions.setState({ sessions: [first, second] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:first', 'capability-first');
    sessionStorage.setItem('wren-genbi-native-session-capability:second', 'capability-second');
    const user = userEvent.setup();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions/first' });
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].onmessage?.({ data: JSON.stringify({ type: 'data', data: 'first-live' }) }));
    await user.click(screen.getAllByRole('button', { name: /Analyze data.*Claude.*Running/i })[1]!);
    await waitFor(() => expect(sockets).toHaveLength(2));
    expect(sockets[0].close).toHaveBeenCalledOnce();
    act(() => sockets[1].onmessage?.({ data: JSON.stringify({ type: 'replay', truncated: false, retainedBytes: 25, retentionLimitBytes: 65_536 }) }));
    act(() => sockets[1].onmessage?.({ data: JSON.stringify({ type: 'data', data: 'before-switchduring-switchafter-switch' }) }));
    expect(terminals[1].writeln).not.toHaveBeenCalled();
    expect(terminals[1].write).toHaveBeenCalledWith('before-switchduring-switchafter-switch');
  });

  it('keeps an allowlisted return intent across a session reload, then clears it after returning from an exited session', async () => {
    const row = native('return', 'exited');
    client.list.mockResolvedValue({ sessions: [row] });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-return-source:return', 'setup');
    const first = renderWithProviders(<><Surface /><Location /></>, { route: '/sessions/return' });
    expect(await screen.findByRole('button', { name: 'Return to Setup' })).toBeInTheDocument();
    first.unmount();
    renderWithProviders(<><Surface /><Location /></>, { route: '/sessions/return' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Return to Setup' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/setup');
    expect(sessionStorage.getItem('wren-genbi-native-session-return-source:return')).toBeNull();
  });

  it('shows Reconnect after a real socket close and opens a fresh terminal when clicked', async () => {
    const row = native('reconnect');
    client.list.mockResolvedValue({ sessions: [row] });
    client.get.mockResolvedValue({ session: row });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:reconnect', 'capability-reconnect');
    renderWithProviders(<Surface />, { route: '/sessions/reconnect' });
    await waitFor(() => expect(sockets.length).toBe(1));
    expect(screen.getByRole('button', { name: /Reconnect$/ })).toBeInTheDocument();
    act(() => sockets[0].onclose?.());
    await waitFor(() => expect(screen.queryByText(/capability unavailable in this browser session/i)).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /Reconnect$/ })).toBeInTheDocument();
    const user = userEvent.setup();
    const reconnect = screen.getByRole('button', { name: /Reconnect$/ });
    await user.click(reconnect);
    await user.click(reconnect);
    await waitFor(() => expect(sockets.length).toBe(2));
    expect(screen.getByRole('button', { name: /Reconnect$/ })).toBeDisabled();
    act(() => sockets[1].onopen?.());
    await waitFor(() => expect(screen.getByRole('button', { name: /Reconnect$/ })).toBeEnabled());
  });

  it('reconciles an expired detached session once, clears its stale capability, and offers Restart instead of Reconnect', async () => {
    const detached = native('expired', 'detached');
    const stopped = { ...native('expired', 'stopped'), failure: 'native session idle TTL expired' };
    client.list.mockResolvedValue({ sessions: [detached] });
    client.get.mockResolvedValue({ session: stopped });
    useNativeSessions.setState({ sessions: [detached] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:expired', 'expired-capability');
    renderWithProviders(<Surface />, { route: '/sessions/expired' });
    await waitFor(() => expect(sockets).toHaveLength(1));

    // Browsers can surface both error and close for one rejected attachment.
    // The store must coalesce those callbacks into one authoritative refresh.
    act(() => { sockets[0].onerror?.(); sockets[0].onclose?.(); });

    expect(await screen.findByText('Session stopped')).toBeInTheDocument();
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:expired')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reconnect$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart in a new session' })).toBeInTheDocument();
    expect(screen.getByText(/native session idle TTL expired/i)).toBeInTheDocument();
  });

  it('keeps reconnect locked through coalesced error and close reconciliation', async () => {
    let resolveLifecycle!: (value: { session: ReturnType<typeof native> }) => void;
    const detached = native('reconnect-expired', 'detached');
    const stopped = { ...native('reconnect-expired', 'stopped'), failure: 'native session idle TTL expired' };
    client.list.mockResolvedValue({ sessions: [detached] });
    client.get.mockImplementationOnce(() => new Promise((resolve) => { resolveLifecycle = resolve; }));
    useNativeSessions.setState({ sessions: [detached] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:reconnect-expired', 'expired-capability');
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions/reconnect-expired' });
    await waitFor(() => expect(sockets).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /Reconnect$/ }));
    await waitFor(() => expect(sockets).toHaveLength(2));
    act(() => { sockets[1].onerror?.(); sockets[1].onclose?.(); });
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1));
    const reconnect = screen.getByRole('button', { name: /Reconnect$/ });
    expect(reconnect).toBeDisabled();
    await user.click(reconnect);
    expect(sockets).toHaveLength(2);

    await act(async () => { resolveLifecycle({ session: stopped }); });
    expect(await screen.findByText('Session stopped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconnect$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart in a new session' })).toBeInTheDocument();
  });

  it('stops a running session with this tab capability and reports a stale-capability stop failure', async () => {
    const row = native('stop');
    client.list.mockResolvedValue({ sessions: [row] });
    useNativeSessions.setState({ sessions: [row] }, false);
    sessionStorage.setItem('wren-genbi-native-session-capability:stop', 'capability-stop');
    client.stop.mockRejectedValueOnce(new Error('native session unavailable'));
    const user = userEvent.setup();
    renderWithProviders(<Surface />, { route: '/sessions/stop' });

    await user.click(screen.getByRole('button', { name: /Stop$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to stop this session.*native session unavailable/);
    expect(sessionStorage.getItem('wren-genbi-native-session-capability:stop')).toBe('capability-stop');
    expect(client.stop).toHaveBeenCalledWith('stop', 'capability-stop');
  });

  it('renders the host-unavailable fallback without attempting a native session creation', async () => {
    client.list.mockResolvedValue({ sessions: [] });
    client.readiness.mockRejectedValue(new Error('native sessions are not configured'));
    renderWithProviders(<Surface />, { route: '/sessions' });
    expect(await screen.findByText(/Native host is unavailable.*native sessions are not configured/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new session/i })).toBeEnabled();
    expect(client.create).not.toHaveBeenCalled();
  });
});
