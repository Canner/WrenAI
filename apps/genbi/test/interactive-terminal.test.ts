import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInteractiveTerminalReadiness, InteractiveLaunchError, InteractiveTerminalManager, interactiveExecutableAvailable, legacyInteractiveWorkspace, nativeTerminalEnvironment, prepareInteractiveHandoff, readInteractiveLaunchSpec, TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES, type PtyFactory } from '../server/interactive-terminal.js';
import { initializeNativeSessionStateBase } from '../server/native-session-workspace.js';
import type { EnrichmentBinding } from '../server/enrichment.js';

const dirs: string[] = [];
function fixture(target: 'claude-code:interactive' | 'codex:interactive' = 'claude-code:interactive') {
  const project = mkdtempSync(path.join(tmpdir(), 'genbi-terminal-')); dirs.push(project);
  mkdirSync(path.join(project, '.warble')); writeFileSync(path.join(project, 'RUN.md'), 'handoff');
  writeSpec(project, target);
  return project;
}
function unmaterializedFixture() {
  const project = mkdtempSync(path.join(tmpdir(), 'genbi-terminal-')); dirs.push(project);
  writeFileSync(path.join(project, 'RUN.md'), 'handoff');
  return project;
}
function writeSpec(project: string, target: 'claude-code:interactive' | 'codex:interactive') {
  writeFileSync(path.join(project, '.warble', 'interactive-launch.json'), JSON.stringify({ version: '1', target, executable: target.startsWith('claude') ? 'claude' : 'codex', argv: [], cwd: project, artifact_root: project, handoff_path: path.join(project, 'RUN.md') }));
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function managedFixture() {
  const project = fixture(); const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
  let data = (_value: string) => {}; let exit = (_event: { exitCode: number }) => {}; const kill = vi.fn();
  const pty: PtyFactory = { spawn: () => ({ onData: (listener) => { data = listener; return { dispose() {} }; }, onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill }) };
  return { binding, spec: readInteractiveLaunchSpec(project, 'claude-code:interactive'), kill, emitData: (value: string) => data(value), emitExit: (code: number) => exit({ exitCode: code }), manager: new InteractiveTerminalManager(pty) };
}

describe('interactive launch specification', () => {
  it('accepts only the v1 fixed-target contract in the canonical bound project', () => {
    const project = fixture();
    expect(readInteractiveLaunchSpec(project, 'claude-code:interactive')).toMatchObject({ executable: 'claude', argv: [], cwd: realpathSync(project) });
  });

  it('uses a server-owned legacy descendant without changing bound-project files', async () => {
    const project = unmaterializedFixture();
    const stateParent = mkdtempSync(path.join(tmpdir(), 'genbi-terminal-state-')); dirs.push(stateParent);
    const state = initializeNativeSessionStateBase(path.join(stateParent, 'bff.sqlite'));
    writeFileSync(path.join(project, 'AGENTS.md'), 'project-owned instructions');
    const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const artifactRoot = legacyInteractiveWorkspace(state, project, 'codex:interactive');
    expect(artifactRoot).toBe(path.join(state.root, 'legacy', 'codex'));
    const { spec } = await prepareInteractiveHandoff({
      target: 'codex:interactive', binding, artifactRoot, materializationState: state,
      materialize: async () => { mkdirSync(path.join(artifactRoot, '.warble'), { recursive: true }); writeFileSync(path.join(artifactRoot, 'RUN.md'), 'handoff'); writeSpec(artifactRoot, 'codex:interactive'); },
    }, { getCurrentBinding: () => binding, executableAvailable: () => true });
    expect(spec).toMatchObject({ cwd: artifactRoot, artifact_root: artifactRoot });
    expect(readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toBe('project-owned instructions');
  });

  it('rejects target/executable/argv and path substitution rather than launching browser-controlled values', () => {
    const project = fixture();
    const spec = path.join(project, '.warble', 'interactive-launch.json');
    writeFileSync(spec, JSON.stringify({ version: '1', target: 'claude-code:interactive', executable: 'sh', argv: ['-c', 'bad'], cwd: project, artifact_root: project, handoff_path: path.join(project, 'RUN.md') }));
    expect(() => readInteractiveLaunchSpec(project, 'claude-code:interactive')).toThrow(/incompatible/);
  });

  it('starts a structured empty-argv PTY only after the binding fence survives materialization', async () => {
    const project = fixture('codex:interactive');
    const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const spawned: unknown[][] = [];
    const pty: PtyFactory = { spawn: (file, args, options) => {
      spawned.push([file, args, options]);
      return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} };
    } };
    const manager = new InteractiveTerminalManager(pty);
    const { spec } = await prepareInteractiveHandoff({ target: 'codex:interactive', binding, materialize: async () => {} }, { getCurrentBinding: () => binding, executableAvailable: () => true });
    manager.start(spec);
    expect(spawned).toEqual([['codex', [], { cwd: binding.path, cols: 100, rows: 30, env: nativeTerminalEnvironment() }]]);
  });

  it('preserves ANSI SGR PTY output while enforcing the color environment against caller values', () => {
    const project = fixture();
    const spec = readInteractiveLaunchSpec(project, 'claude-code:interactive');
    let emit = (_data: string) => {};
    const spawn = vi.fn((_file: string, _args: readonly string[], _options: unknown) => ({
      onData: (listener: (data: string) => void) => { emit = listener; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {},
    }));
    const session = new InteractiveTerminalManager({ spawn }).start(spec, undefined, {
      PATH: '/fixed/bin', TERM: 'dumb', COLORTERM: 'false', NO_COLOR: '1', WREN_PROJECT_HOME: project,
    });
    const received = vi.fn();
    session.onData(received);
    const sgr = '\u001b[31mred\u001b[0m \u001b[94mbright-blue\u001b[0m';
    emit(sgr);

    expect(received).toHaveBeenCalledWith(sgr);
    expect(spawn).toHaveBeenCalledWith('claude', [], {
      cwd: realpathSync(project),
      cols: 100,
      rows: 30,
      env: { PATH: '/fixed/bin', TERM: 'xterm-256color', COLORTERM: 'truecolor', WREN_PROJECT_HOME: project },
    });
  });

  it('refuses an unavailable executable during shared prepare before any PTY can spawn', async () => {
    const project = fixture();
    const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const spawn = vi.fn();
    await expect(prepareInteractiveHandoff({ target: 'claude-code:interactive', binding, materialize: async () => {} }, { getCurrentBinding: () => binding, executableAvailable: () => false })).rejects.toThrow(/claude interactive CLI is not available/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('uses only an executable file from PATH for the preflight shared by readiness and launch', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'genbi-terminal-bin-')); dirs.push(bin);
    const executable = path.join(bin, 'claude'); writeFileSync(executable, '#!/bin/sh\n'); chmodSync(executable, 0o755);
    expect(interactiveExecutableAvailable('claude', bin)).toBe(true);
    chmodSync(executable, 0o644);
    expect(interactiveExecutableAvailable('claude', bin)).toBe(false);
  });

  it('does not spawn when Warble materialization fails or reports an output collision', async () => {
    const project = fixture();
    const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const spawn = vi.fn();
    for (const failure of ['interactive enrichment materialization failed', 'interactive enrichment output collision']) {
      await expect(prepareInteractiveHandoff({ target: 'claude-code:interactive', binding, materialize: async () => { throw new InteractiveLaunchError(failure); } }, { getCurrentBinding: () => binding, executableAvailable: () => true })).rejects.toThrow(failure);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects a generation or revision change observed after materialization before PTY spawn', async () => {
    const project = fixture();
    const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const spawn = vi.fn();
    for (const changed of [{ ...binding, generation: 4 }, { ...binding, revision: 'sha256:changed' }]) {
      await expect(prepareInteractiveHandoff({ target: 'claude-code:interactive', binding, materialize: async () => {} }, { getCurrentBinding: () => changed, executableAvailable: () => true })).rejects.toThrow(/bound project changed/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps copy available when the optional PTY host is unavailable', async () => {
    const project = fixture(); const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const readiness = await getInteractiveTerminalReadiness({
      getCurrentBinding: () => binding,
      terminalHostAvailable: async () => false,
      executableAvailable: () => true,
    });
    for (const target of ['claude-code:interactive', 'codex:interactive'] as const) {
      expect(readiness[target]).toEqual({ copyAvailable: true, embeddedTerminalAvailable: false, embeddedTerminalReason: 'interactive terminal host cannot spawn local processes on this machine' });
    }
  });

  it('fails readiness closed when the already-initialized external BFF state base is replaced', async () => {
    const project = fixture(); const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const stateParent = mkdtempSync(path.join(tmpdir(), 'genbi-terminal-state-')); dirs.push(stateParent);
    const state = initializeNativeSessionStateBase(path.join(stateParent, 'bff.sqlite'));
    chmodSync(state.root, 0o755);
    const terminalHostAvailable = vi.fn(async () => true);
    const readiness = await getInteractiveTerminalReadiness({ getCurrentBinding: () => binding, materializationState: state, terminalHostAvailable, executableAvailable: () => true });
    expect(readiness).toEqual({
      'claude-code:interactive': { copyAvailable: false, embeddedTerminalAvailable: false, copyReason: 'interactive enrichment workspace is unavailable', embeddedTerminalReason: 'interactive enrichment workspace is unavailable' },
      'codex:interactive': { copyAvailable: false, embeddedTerminalAvailable: false, copyReason: 'interactive enrichment workspace is unavailable', embeddedTerminalReason: 'interactive enrichment workspace is unavailable' },
    });
    expect(terminalHostAvailable).not.toHaveBeenCalled();
    chmodSync(state.root, 0o700);
  });

  it('is a non-mutating target-independent probe despite producer ownership collisions', async () => {
    const project = unmaterializedFixture(); const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    let owner: 'claude-code:interactive' | 'codex:interactive' | undefined;
    const materialize = vi.fn(async (target: 'claude-code:interactive' | 'codex:interactive') => {
      if (owner && owner !== target) throw new InteractiveLaunchError('interactive enrichment output collision');
      owner = target;
      mkdirSync(path.join(project, '.warble'), { recursive: true });
      writeSpec(project, target);
    });
    const readiness = await getInteractiveTerminalReadiness({
      getCurrentBinding: () => binding,
      terminalHostAvailable: async () => true,
      executableAvailable: () => true,
    });
    expect(readiness).toEqual({
      'claude-code:interactive': { copyAvailable: true, embeddedTerminalAvailable: true },
      'codex:interactive': { copyAvailable: true, embeddedTerminalAvailable: true },
    });
    expect(materialize).not.toHaveBeenCalled();
    expect(owner).toBeUndefined();
    expect(existsSync(path.join(project, '.warble', 'interactive-launch.json'))).toBe(false);

    await prepareInteractiveHandoff({ target: 'claude-code:interactive', binding, materialize: () => materialize('claude-code:interactive') }, { getCurrentBinding: () => binding, executableAvailable: () => true });
    await expect(prepareInteractiveHandoff({ target: 'codex:interactive', binding, materialize: () => materialize('codex:interactive') }, { getCurrentBinding: () => binding, executableAvailable: () => true })).rejects.toThrow('interactive enrichment output collision');
  });

  it('disables copy and embedded terminal for an unbuilt or unavailable target', async () => {
    const unbuilt = await getInteractiveTerminalReadiness({ getCurrentBinding: () => undefined, terminalHostAvailable: async () => false, executableAvailable: () => true });
    const project = fixture(); const binding: EnrichmentBinding = { path: realpathSync(project), identity: 'dev:1:ino:1', generation: 3, revision: 'sha256:fixture' };
    const targetUnavailable = await getInteractiveTerminalReadiness({ getCurrentBinding: () => binding, terminalHostAvailable: async () => true, executableAvailable: (executable) => executable === 'codex' });
    for (const target of ['claude-code:interactive', 'codex:interactive'] as const) {
      expect(unbuilt[target]).toMatchObject({ copyAvailable: false, embeddedTerminalAvailable: false, copyReason: 'interactive enrichment requires a current bound project' });
    }
    expect(targetUnavailable['claude-code:interactive']).toMatchObject({ copyAvailable: false, embeddedTerminalAvailable: false, copyReason: 'the claude interactive CLI is not available on this machine' });
    expect(targetUnavailable['codex:interactive']).toEqual({ copyAvailable: true, embeddedTerminalAvailable: true });
  });
});

describe('interactive terminal lease lifecycle', () => {
  it('rejects token misuse and a second attachment while allowing one safe reconnect after detach', async () => {
    const harness = managedFixture(); const session = harness.manager.start(harness.spec);
    expect(session.claim('forged')).toBe(false); expect(session.claim(session.capability)).toBe(true); expect(session.claim(session.capability)).toBe(false);
    session.detach(); expect(session.claim(session.capability)).toBe(true);
  });

  it('replays bounded output and an exit observed before the sole attachment', async () => {
    const harness = managedFixture(); const session = harness.manager.start(harness.spec);
    harness.emitData('before-attach'); harness.emitExit(0); expect(session.claim(session.capability)).toBe(true);
    const output = vi.fn(); const exited = vi.fn(); session.onData(output); session.onExit(exited);
    expect(output).toHaveBeenCalledWith('before-attach'); expect(exited).toHaveBeenCalledWith(0);
  });

  it('drains re-entrant output FIFO before delivering post-attachment bytes', () => {
    const harness = managedFixture(); const session = harness.manager.start(harness.spec);
    harness.emitData('before');
    expect(session.claim(session.capability)).toBe(true);
    const output: string[] = [];
    session.onData((data) => {
      output.push(data);
      if (data === 'before') { harness.emitData('during1'); harness.emitData('during2'); }
      if (data === 'during1') harness.emitData('after');
    });
    expect(output).toEqual(['before', 'during1', 'during2', 'after']);
  });

  it('replays the current retained state once to a reconnect, then streams new output once', () => {
    const harness = managedFixture(); const session = harness.manager.start(harness.spec);
    harness.emitData('before-first-attach');
    expect(session.claim(session.capability)).toBe(true);
    const first: string[] = [];
    const remove = session.onData((data) => first.push(data));
    harness.emitData('during-first-attach');
    remove(); session.detach();
    expect(session.claim(session.capability)).toBe(true);
    const reconnect: string[] = [];
    session.onData((data) => reconnect.push(data));
    harness.emitData('after-reconnect');
    expect(first).toEqual(['before-first-attach', 'during-first-attach']);
    expect(reconnect).toEqual(['before-first-attachduring-first-attach', 'after-reconnect']);
  });

  it('bounds retained output and exposes truncation metadata to the WebSocket transport', () => {
    const harness = managedFixture(); const session = harness.manager.start(harness.spec);
    harness.emitData(`omitted${'x'.repeat(TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES)}`);
    expect(session.claim(session.capability)).toBe(true);
    const metadata = vi.fn(); const output = vi.fn();
    session.onData(output, metadata);
    expect(metadata).toHaveBeenCalledWith({
      truncated: true,
      retainedBytes: TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES,
      retentionLimitBytes: TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES,
    });
    expect(output).toHaveBeenCalledWith('x'.repeat(TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES));
  });

  it('kills and removes a detached or explicitly closed PTY without leaving an orphan', async () => {
    vi.useFakeTimers(); const harness = managedFixture(); const session = harness.manager.start(harness.spec);
    expect(session.claim(session.capability)).toBe(true); session.detach(); vi.advanceTimersByTime(15_000); expect(harness.kill).toHaveBeenCalledOnce(); expect(harness.manager.get(session.id)).toBeUndefined();
    const next = harness.manager.start(harness.spec); next.close(); expect(harness.kill).toHaveBeenCalledTimes(2); expect(harness.manager.get(next.id)).toBeUndefined(); vi.useRealTimers();
  });

  it('kills and removes a session that never reaches a WebSocket claim', async () => {
    vi.useFakeTimers(); const harness = managedFixture(); const session = harness.manager.start(harness.spec);
    vi.advanceTimersByTime(15_000); expect(harness.kill).toHaveBeenCalledOnce(); expect(harness.manager.get(session.id)).toBeUndefined(); vi.useRealTimers();
  });
});
