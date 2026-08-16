import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { WebSocket, WebSocketServer } from 'ws';
import { applyInteractiveTerminalFrame, createApp } from '../server/app.js';
import { Store } from '../server/db.js';
import { resolveEnrichmentBinding } from '../server/enrichment.js';
import type { TurnDeps } from '../server/turn.js';

const dirs: string[] = [];
function project(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'genbi-terminal-app-')); dirs.push(dir);
  mkdirSync(path.join(dir, 'target')); writeFileSync(path.join(dir, 'wren_project.yml'), 'name: demo\n'); writeFileSync(path.join(dir, 'target', 'mdl.json'), '{"models":[]}');
  return dir;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function terminalApp() {
  const userProject = project(); const store = new Store(':memory:'); store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
  store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: 'codex', subscriptionDriverModel: 'driver', tierModels: [{ tier: 'cheap', model: 'cheap' }, { tier: 'strong', model: 'strong' }] });
  const start = vi.fn(); const prepare = vi.fn().mockResolvedValue({ target: 'codex:interactive', fallbackCommand: `cd -- '${userProject}' && codex` });
  const revokeInteractiveTerminals = vi.fn();
  const readiness = vi.fn().mockResolvedValue({
    'claude-code:interactive': { copyAvailable: true, embeddedTerminalAvailable: false, embeddedTerminalReason: 'interactive terminal host is unavailable on this machine' },
    'codex:interactive': { copyAvailable: false, embeddedTerminalAvailable: false, copyReason: 'the codex interactive CLI is not available on this machine', embeddedTerminalReason: 'the codex interactive CLI is not available on this machine' },
  });
  const deps: TurnDeps = {
    store,
    baseRouteOptions: { authChoice: { mode: 'api-key', adapter: 'mock' }, profileSource: 'fixture', userProject },
    route: async () => ({ backend: 'agent', warnings: [], kind: 'answer', envelope: { blocks: [], summary: 'ok' }, trace: { steps: [] } }),
    startInteractiveTerminal: start,
    revokeInteractiveTerminals,
    prepareInteractiveTerminal: prepare,
    interactiveTerminalReadiness: readiness,
    getRuntimeTierNames: async () => ['cheap', 'strong'],
    setupRunner: {} as never,
    workspaceRoot: userProject,
  };
  return { app: createApp(deps), start, prepare, readiness, revokeInteractiveTerminals, store };
}

describe('interactive terminal BFF endpoints', () => {
  it('keeps native Sessions under their own typed namespace', async () => {
    const created = vi.fn().mockResolvedValue({ row: { id: 'native-1', purpose: 'analysis', vendor: 'codex', status: 'running' }, capability: 'native-cap' });
    const separate = vi.fn().mockResolvedValue({ row: { id: 'native-separate', purpose: 'analysis', vendor: 'codex', status: 'running' }, capability: 'separate-cap' });
    const resumed = vi.fn().mockResolvedValue({ row: { id: 'native-resumed', purpose: 'analysis', vendor: 'claude', status: 'running' }, capability: 'resumed-cap' });
    const opened = vi.fn().mockResolvedValue({ row: { id: 'native-opened', purpose: 'analysis', vendor: 'codex', status: 'running' }, capability: 'opened-cap' });
    const listed = vi.fn().mockReturnValue([{ id: 'native-1', status: 'running' }]);
    const stopped = vi.fn().mockReturnValue(true);
    const nativeReadiness = vi.fn().mockResolvedValue({ setup: { scopeKind: 'bootstrap', available: true, vendors: { claude: { available: true }, codex: { available: true } } } });
    const userProject = project(); const store = new Store(':memory:');
    const app = createApp({ store, baseRouteOptions: { authChoice: { mode: 'api-key', adapter: 'mock' }, profileSource: 'fixture', userProject }, route: async () => ({ backend: 'agent', warnings: [], kind: 'answer', envelope: { blocks: [], summary: 'ok' }, trace: { steps: [] } }), nativeSessions: { openOrCreate: created, openExisting: opened, startSeparate: separate, resume: resumed, list: listed, readiness: nativeReadiness, get: () => undefined, stop: stopped } as never });
    const create = await app.request('/api/native-sessions', { method: 'POST', body: JSON.stringify({ purpose: 'analysis', intent: 'open_existing' }) });
    expect(create.status).toBe(201); expect(created).toHaveBeenCalledWith({ purpose: 'analysis' });
    const startSeparate = await app.request('/api/native-sessions', { method: 'POST', body: JSON.stringify({ purpose: 'analysis', intent: 'start_separate', idempotencyKey: '00000000-0000-4000-8000-000000000001' }) });
    expect(startSeparate.status).toBe(201); expect(separate).toHaveBeenCalledWith({ purpose: 'analysis', idempotencyKey: '00000000-0000-4000-8000-000000000001' });
    expect(await startSeparate.json()).toEqual({ session: { id: 'native-separate', purpose: 'analysis', vendor: 'codex', status: 'running', lifecycle: { liveAction: 'reattach', resumeAvailable: false } }, capability: 'separate-cap' });
    const resume = await app.request('/api/native-sessions', { method: 'POST', body: JSON.stringify({ purpose: 'analysis', intent: 'resume', sessionId: 'native-session-00000000-0000-4000-8000-000000000002', idempotencyKey: '00000000-0000-4000-8000-000000000003' }) });
    expect(resume.status).toBe(201); expect(resumed).toHaveBeenCalledWith({ id: 'native-session-00000000-0000-4000-8000-000000000002', idempotencyKey: '00000000-0000-4000-8000-000000000003' });
    const openExact = await app.request('/api/native-sessions', { method: 'POST', body: JSON.stringify({ purpose: 'analysis', intent: 'open_existing', sessionId: 'native-session-00000000-0000-4000-8000-000000000001' }) });
    expect(openExact.status).toBe(201); expect(opened).toHaveBeenCalledWith({ purpose: 'analysis', id: 'native-session-00000000-0000-4000-8000-000000000001' });
    expect((await app.request('/api/native-sessions')).status).toBe(200);
    const readiness = await app.request('/api/native-sessions/readiness');
    expect(readiness.status).toBe(200); expect(await readiness.json()).toMatchObject({ setup: { scopeKind: 'bootstrap', available: true } }); expect(nativeReadiness).toHaveBeenCalledOnce();
    const stop = await app.request('/api/native-sessions/native-1/stop', { method: 'POST', body: JSON.stringify({ capability: 'native-cap' }) });
    expect(stop.status).toBe(204); expect(stopped).toHaveBeenCalledWith('native-1', 'native-cap');
    expect((await app.request('/api/sessions')).status).toBe(200);
  });

  it('returns an initial failed Setup launch with only its recovery capability', async () => {
    const failed = { row: { id: 'setup-failed', purpose: 'setup', vendor: 'codex', status: 'failed', failure: 'native session launch failed' }, recoveryCapability: 'recovery-only' };
    const created = vi.fn().mockResolvedValue(failed);
    const userProject = project(); const store = new Store(':memory:');
    const app = createApp({ store, baseRouteOptions: { authChoice: { mode: 'api-key', adapter: 'mock' }, profileSource: 'fixture', userProject }, route: async () => ({ backend: 'agent', warnings: [], kind: 'answer', envelope: { blocks: [], summary: 'ok' }, trace: { steps: [] } }), nativeSessions: { openOrCreate: created } as never });
    const response = await app.request('/api/native-sessions', { method: 'POST', body: JSON.stringify({ purpose: 'setup' }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ session: { ...failed.row, lifecycle: { liveAction: 'restart', resumeAvailable: false, reason: 'The current Codex native launch contract has no sealed provider resume handle. Restart creates a new isolated session.' } }, recoveryCapability: 'recovery-only' });
  });

  it('ignores malformed WebSocket frames without reaching the PTY', () => {
    const write = vi.fn(); const resize = vi.fn(); const close = vi.fn(); const session = { write, resize, close };
    for (const malformed of ['', '{', 'null', '[]', '{"type":"input","data":7}', `{"type":"input","data":"${'x'.repeat(16_385)}"}`, '{"type":"resize","columns":1,"rows":20}', '{"type":"resize","columns":100.5,"rows":20}']) {
      applyInteractiveTerminalFrame(session, malformed);
    }
    expect(write).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('does not consume a native attachment claim until the WebSocket opens', async () => {
    const terminal = { onData: () => () => {}, onExit: () => () => {}, write() {}, resize() {}, close() {} };
    const attach = vi.fn(() => terminal);
    const app = createApp({
      store: new Store(':memory:'),
      baseRouteOptions: { authChoice: { mode: 'api-key', adapter: 'mock' }, profileSource: 'fixture', userProject: project() },
      route: async () => ({ backend: 'agent', warnings: [], kind: 'answer', envelope: { blocks: [], summary: 'ok' }, trace: { steps: [] } }),
      nativeSessions: { attach } as never,
    });
    const websocket = new WebSocketServer({ noServer: true });
    let port = 0;
    const server = serve({ fetch: app.fetch, websocket: { server: websocket as never }, hostname: '127.0.0.1', port: 0 }, (info) => { port = info.port; });
    await once(server, 'listening');
    try {
      // This reaches the BFF's upgrade route but fails the WebSocket handshake
      // before `onOpen`. Before this regression, that evaluation consumed the
      // one-shot claim and cancelled the first-attachment lease.
      const response = await new Promise<string>((resolve, reject) => {
        const client = createConnection({ host: '127.0.0.1', port });
        let received = '';
        const timer = setTimeout(() => { client.destroy(); reject(new Error('invalid WebSocket handshake timed out')); }, 5_000);
        client.setEncoding('utf8');
        client.once('connect', () => client.write([
          'GET /api/native-sessions/native-1/attach?cap=capability HTTP/1.1',
          'Host: 127.0.0.1',
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n')));
        client.on('data', (data) => { received += data; });
        client.once('error', (error) => { clearTimeout(timer); reject(error); });
        client.once('close', () => { clearTimeout(timer); resolve(received); });
      });
      expect(response).toMatch(/^HTTP\/1\.1 400/);
      expect(attach).not.toHaveBeenCalled();
    } finally {
      server.close(); websocket.close();
    }
  });

  it('sends replay metadata before retained terminal bytes over the native-session WebSocket', async () => {
    const store = new Store(':memory:'); const detached = vi.fn(); const attach = vi.fn();
    const terminal = {
      onData: (listener: (data: string) => void, onReplay?: (metadata: { truncated: boolean; retainedBytes: number; retentionLimitBytes: number }) => void) => {
        onReplay?.({ truncated: true, retainedBytes: 65_536, retentionLimitBytes: 65_536 });
        listener('retained-terminal-tail');
        return () => {};
      },
      onExit: () => () => {}, write() {}, resize() {}, close() {},
    };
    const app = createApp({
      store,
      baseRouteOptions: { authChoice: { mode: 'api-key', adapter: 'mock' }, profileSource: 'fixture', userProject: project() },
      route: async () => ({ backend: 'agent', warnings: [], kind: 'answer', envelope: { blocks: [], summary: 'ok' }, trace: { steps: [] } }),
      nativeSessions: { attach: attach.mockReturnValue(terminal), detach: detached } as never,
    });
    const websocket = new WebSocketServer({ noServer: true });
    let port = 0;
    const server = serve({ fetch: app.fetch, websocket: { server: websocket as never }, hostname: '127.0.0.1', port: 0 }, (info) => { port = info.port; });
    await once(server, 'listening');
    try {
      const frames = await new Promise<unknown[]>((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${port}/api/native-sessions/native-1/attach?cap=capability`);
        const received: unknown[] = [];
        client.on('message', (raw) => {
          received.push(JSON.parse(raw.toString()));
          if (received.length === 2) { client.close(); resolve(received); }
        });
        client.once('error', reject);
      });
      expect(frames).toEqual([
        { type: 'replay', truncated: true, retainedBytes: 65_536, retentionLimitBytes: 65_536 },
        { type: 'data', data: 'retained-terminal-tail' },
      ]);
      expect(attach).toHaveBeenCalledOnce();
      expect(attach).toHaveBeenCalledWith('native-1', 'capability');
      await vi.waitFor(() => expect(detached).toHaveBeenCalledWith('native-1'));
    } finally {
      server.close(); websocket.close(); store.close();
    }
  });

  it('prepares only the Runtime-bound target and current binding without spawning a PTY', async () => {
    const { app, prepare, start } = terminalApp();
    const response = await app.request('/api/context/terminal/prepare', { method: 'POST', body: JSON.stringify({ target: 'codex:interactive' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ target: 'codex:interactive', fallbackCommand: expect.stringContaining('codex') });
    expect(prepare).toHaveBeenCalledWith({ target: 'codex:interactive', binding: expect.objectContaining({ generation: 1, revision: expect.stringMatching(/^sha256:/) }) });
    expect(start).not.toHaveBeenCalled();
  });

  it('returns separately bounded copy and embedded-terminal capability', async () => {
    const { app, readiness } = terminalApp();
    const response = await app.request('/api/context/terminal/readiness');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      target: 'codex:interactive', copyAvailable: false, embeddedTerminalAvailable: false, copyReason: 'the codex interactive CLI is not available on this machine',
    });
    expect(readiness).toHaveBeenCalledOnce();
  });

  it('rejects malformed targets before either prepare or a PTY launch', async () => {
    const { app, prepare, start } = terminalApp();
    const response = await app.request('/api/context/terminal/prepare', { method: 'POST', body: JSON.stringify({ target: 'sh' }) });
    expect(response.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('fails closed when a browser tries to use a target other than the saved Runtime target', async () => {
    const { app, prepare, start } = terminalApp();
    const response = await app.request('/api/context/terminal/prepare', { method: 'POST', body: JSON.stringify({ target: 'claude-code:interactive' }) });
    expect(response.status).toBe(409);
    expect(prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('does not return an old-target readiness result after Runtime switches', async () => {
    const { app, readiness } = terminalApp();
    let release!: (value: unknown) => void;
    readiness.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = app.request('/api/context/terminal/readiness');
    await vi.waitFor(() => expect(readiness).toHaveBeenCalledOnce());
    const switched = await app.request('/api/config/runtime', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscriptionProvider: 'claude', tierModels: [{ tier: 'cheap', model: 'haiku' }, { tier: 'strong', model: 'sonnet' }] }) });
    expect(switched.status).toBe(200);
    release({ 'codex:interactive': { copyAvailable: true, embeddedTerminalAvailable: true } });
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('stale') });
  });

  it('does not return a readiness result after Setup reset clears Runtime', async () => {
    const { app, readiness } = terminalApp();
    let release!: (value: unknown) => void;
    readiness.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = app.request('/api/context/terminal/readiness');
    await vi.waitFor(() => expect(readiness).toHaveBeenCalledOnce());
    const reset = await app.request('/api/setup/reset', { method: 'POST' });
    expect(reset.status).toBe(200);
    release({ 'codex:interactive': { copyAvailable: true, embeddedTerminalAvailable: true } });
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('stale') });
  });

  it('does not hand stale preparation commands back after Runtime switches', async () => {
    const { app, prepare } = terminalApp();
    let release!: (value: unknown) => void;
    prepare.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = app.request('/api/context/terminal/prepare', { method: 'POST', body: JSON.stringify({ target: 'codex:interactive' }) });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    const switched = await app.request('/api/config/runtime', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscriptionProvider: 'claude', tierModels: [{ tier: 'cheap', model: 'haiku' }, { tier: 'strong', model: 'sonnet' }] }) });
    expect(switched.status).toBe(200);
    release({ target: 'codex:interactive', fallbackCommand: 'stale-command' });
    const response = await pending;
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain('stale-command');
  });

  it('does not hand stale preparation commands back after Setup reset', async () => {
    const { app, prepare } = terminalApp();
    let release!: (value: unknown) => void;
    prepare.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = app.request('/api/context/terminal/prepare', { method: 'POST', body: JSON.stringify({ target: 'codex:interactive' }) });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    const reset = await app.request('/api/setup/reset', { method: 'POST' });
    expect(reset.status).toBe(200);
    release({ target: 'codex:interactive', fallbackCommand: 'stale-command' });
    const response = await pending;
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain('stale-command');
  });

  it('closes an in-flight legacy terminal when Runtime switches before its PTY result returns', async () => {
    const { app, start, revokeInteractiveTerminals } = terminalApp();
    let release!: (session: unknown) => void;
    start.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = app.request('/api/context/terminal/sessions', { method: 'POST', body: JSON.stringify({ target: 'codex:interactive' }) });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    const switched = await app.request('/api/config/runtime', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscriptionProvider: 'claude', tierModels: [{ tier: 'cheap', model: 'haiku' }, { tier: 'strong', model: 'sonnet' }] }) });
    expect(switched.status).toBe(200);
    const close = vi.fn();
    release({ id: 'legacy-switch', capability: 'cap', target: 'codex:interactive', fallbackCommand: 'codex', close });
    const response = await pending;
    expect(response.status).toBe(409);
    expect(close).toHaveBeenCalledOnce();
    expect(revokeInteractiveTerminals).toHaveBeenCalledOnce();
  });

  it('closes an in-flight legacy terminal when Setup reset clears Runtime before its PTY result returns', async () => {
    const { app, start, revokeInteractiveTerminals } = terminalApp();
    let release!: (session: unknown) => void;
    start.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = app.request('/api/context/terminal/sessions', { method: 'POST', body: JSON.stringify({ target: 'codex:interactive' }) });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    const reset = await app.request('/api/setup/reset', { method: 'POST' });
    expect(reset.status).toBe(200);
    const close = vi.fn();
    release({ id: 'legacy-reset', capability: 'cap', target: 'codex:interactive', fallbackCommand: 'codex', close });
    const response = await pending;
    expect(response.status).toBe(409);
    expect(close).toHaveBeenCalledOnce();
    expect(revokeInteractiveTerminals).toHaveBeenCalledOnce();
  });

  it('does not let a mismatched capability close a terminal session', async () => {
    const close = vi.fn();
    const session = { id: 'terminal-1', capability: 'capability-1', close };
    // Rebuild only the injected lookup seam; the route must reject before it
    // ever reaches close when the capability is not the owner token.
    const userProject = project(); const store = new Store(':memory:'); store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: 'codex', subscriptionDriverModel: 'driver', tierModels: [{ tier: 'cheap', model: 'cheap' }, { tier: 'strong', model: 'strong' }] });
    const protectedApp = createApp({ store, baseRouteOptions: { authChoice: { mode: 'api-key', adapter: 'mock' }, profileSource: 'fixture', userProject }, route: async () => ({ backend: 'agent', warnings: [], kind: 'answer', envelope: { blocks: [], summary: 'ok' }, trace: { steps: [] } }), getInteractiveTerminal: () => session as never });
    const response = await protectedApp.request('/api/context/terminal/sessions/terminal-1/close', { method: 'POST', body: JSON.stringify({ capability: 'forged' }) });
    expect(response.status).toBe(404);
    expect(close).not.toHaveBeenCalled();
  });
});
