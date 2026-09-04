import { appendFileSync, chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import { resolveEnrichmentBinding } from "../server/enrichment.js";
import { InteractiveTerminalManager } from "../server/interactive-terminal.js";
import { initializeNativeSessionStateBase } from "../server/native-session-workspace.js";
import { NativeArtifactService } from "../server/native-artifacts.js";
import { NativeSessionService, probeNativeSessionProducer } from "../server/native-sessions.js";
import type { PtyFactory } from "../server/interactive-terminal.js";

const dirs: string[] = [];
const HELP = ["dispatch", "--target", "--purpose", "--native-scope", "--native-mcp", "--out"].join("\n");
const SERVER_WREN_SOURCE_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "core", "wren", "src"));

function fixtureDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "genbi-native-preflight-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "target"));
  writeFileSync(path.join(dir, "wren_project.yml"), "name: preflight\n");
  writeFileSync(path.join(dir, "target", "mdl.json"), '{"models":[]}');
  for (const name of ["analysis", "setup", "context"]) writeFileSync(path.join(dir, `${name}.json`), "{}");
  return dir;
}

function runtimeFixture(dir: string): string {
  const root = realpathSync(dir);
  const toolRoot = path.join(root, "tool");
  const toolBin = path.join(toolRoot, "bin");
  const interpreterRoot = path.join(root, "python");
  const interpreter = path.join(interpreterRoot, "bin", "python3.11");
  const sitePackages = path.join(toolRoot, "lib", "python3.11", "site-packages");
  const sourceRoot = SERVER_WREN_SOURCE_ROOT;
  const shim = path.join(root, "shim", "wren");
  mkdirSync(path.dirname(interpreter), { recursive: true }); mkdirSync(toolBin, { recursive: true }); mkdirSync(path.join(interpreterRoot, "lib"), { recursive: true });
  mkdirSync(sitePackages, { recursive: true }); mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(path.join(toolRoot, "pyvenv.cfg"), "home = test\n"); writeFileSync(interpreter, "#!/bin/sh\nexit 0\n"); chmodSync(interpreter, 0o755);
  symlinkSync(interpreter, path.join(toolBin, "python")); writeFileSync(path.join(toolBin, "wren"), `#!${path.join(toolBin, "python")}\n`); chmodSync(path.join(toolBin, "wren"), 0o755);
  symlinkSync(path.join(toolBin, "wren"), shim); writeFileSync(path.join(sitePackages, "_editable_impl_wrenai.pth"), `${sourceRoot}\n`);
  return shim;
}

function fakeProducer(dir: string, mode: "compatible" | "stale" | "partial", options: { name?: string; finalAction?: string } = {}): string {
  const name = options.name ?? mode;
  const executable = path.join(dir, `producer-${name}.mjs`);
  const help = mode === "stale" ? "dispatch\n--target\n--out\ntoken=never-log-this" : HELP;
  const version = mode === "partial" ? "2" : "4";
  const mcp = mode === "partial" ? "scope: { kind: 'bootstrap', scope_id: 'wrong', binding: null }," : "mcp: { server_name: 'genbi_session', credential_env_var: 'WARBLE_MCP_CONNECTION_CREDENTIAL' },";
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(${JSON.stringify(help)}); process.exit(0); }
const value = (flag) => { const i = args.indexOf(flag); if (i < 0 || !args[i + 1]) process.exit(90); return args[i + 1]; };
const out = value('--out'); const target = value('--target'); const purpose = value('--purpose');
const scope = JSON.parse(readFileSync(value('--native-scope'), 'utf8'));
const runtimeKeys = ['version','shim','launcher','venv_python','tool_root','site_packages','source_root','interpreter','interpreter_root'];
if (target === 'codex:interactive' && (!scope.wren_runtime || JSON.stringify(Object.keys(scope.wren_runtime).sort()) !== JSON.stringify(runtimeKeys.slice().sort()))) process.exit(91);
if (target === 'claude-code:interactive' && Object.hasOwn(scope, 'wren_runtime')) process.exit(92);
const agent = purpose === 'analysis' ? 'answer_query' : purpose === 'setup' ? 'connect_source' : 'draft_enrichment';
const profile = purpose === 'analysis' ? 'genbi-default' : purpose === 'setup' ? 'genbi-setup' : 'genbi-enrich-context';
const scopeEntry = target === 'claude-code:interactive' && purpose === 'analysis';
const welcome = purpose === 'setup'
  ? 'Help me set up this GenBI project. Start by explaining the next setup step and ask what data source I want to connect.'
  : purpose === 'analysis'
    ? 'Help me analyze this data. Ask me what question I want to answer about the server-bound project.'
    : "Help me inspect this project's context and draft a read-only enrichment proposal. Do not apply changes; ask what context I want to review.";
if (scope.version !== '3' || scope.cwd !== out) process.exit(96);
const entryKeys = scopeEntry ? ['kind', 'prompt'] : ['prompt', 'verb'];
if (!scope.entry || JSON.stringify(Object.keys(scope.entry).sort()) !== JSON.stringify(entryKeys) || scope.entry.prompt !== welcome) process.exit(96);
if (scopeEntry ? scope.entry.kind !== 'scope' : scope.entry.verb !== agent) process.exit(96);
if (purpose !== 'setup' && (!scope.binding || !scope.binding.project_identity || !scope.binding.generation || !scope.binding.revision)) process.exit(93);
if (purpose !== 'setup' && scope.scope_id.startsWith('preflight-') && (scope.binding?.project_identity !== 'native-preflight-project' || scope.binding?.generation !== '1' || scope.binding?.revision !== 'native-preflight-revision')) process.exit(95);
if (purpose === 'setup' && (Object.hasOwn(scope, 'binding') || typeof scope.bootstrap_root !== 'string' || scope.bootstrap_root === out)) process.exit(94);
appendFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'producer-${name}.calls'), target + ':' + purpose + '\\n');
mkdirSync(path.join(out, '.warble'), { recursive: true });
writeFileSync(path.join(out, 'RUN.md'), 'handoff');
writeFileSync(path.join(out, '.warble', 'interactive-launch.json'), JSON.stringify({
  version: '${version}', target, purpose, executable: target === 'claude-code:interactive' ? 'claude' : 'codex',
  argv: scopeEntry ? [welcome] : target === 'claude-code:interactive' ? ['--agent', agent, welcome] : [welcome],
  agent: scopeEntry ? { kind: 'claude_scope', name: profile } : target === 'claude-code:interactive' ? { kind: 'claude_agent', name: agent } : { kind: 'codex_skill', name: 'genbi-' + (purpose === 'context_enrichment' ? 'enrich-context' : purpose) },
  ${mcp}
  ...(purpose === 'setup' ? { bootstrap_root: scope.bootstrap_root } : {}),
  cwd: out, artifact_root: out, handoff_path: path.join(out, 'RUN.md'),
}));
if (target === 'codex:interactive') {
  mkdirSync(path.join(out, '.codex'), { recursive: true });
  writeFileSync(path.join(out, '.codex', 'config.toml'), 'default_permissions = "warble_native_wren"\\n\\n[permissions.warble_native_wren.filesystem]\\n":minimal" = "read"\\n\\n[permissions.warble_native_wren.filesystem.":workspace_roots"]\\n"." = "write"\\n');
}
${options.finalAction ?? ""}
`);
  chmodSync(executable, 0o700);
  return executable;
}

function irPaths(dir: string) {
  return { analysis: path.join(dir, "analysis.json"), setup: path.join(dir, "setup.json"), context_enrichment: path.join(dir, "context.json") } as const;
}

function productionService(dir: string, producer: string, wrenShim: string, terminalManager?: () => Promise<InteractiveTerminalManager>, subscriptionProvider: "claude" | "codex" = "codex") {
  const store = new Store(":memory:");
  store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider, subscriptionDriverModel: "driver", tierModels: subscriptionProvider === "claude" ? [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] : [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
  const binding = store.activateEnrichmentBinding(resolveEnrichmentBinding(dir));
  const stateParent = mkdtempSync(path.join(tmpdir(), "genbi-native-preflight-state-"));
  dirs.push(stateParent);
  const state = initializeNativeSessionStateBase(path.join(stateParent, "state.sqlite"));
  const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: "http://127.0.0.1:4787/api/native-sessions/mcp", mcpUrl: "http://127.0.0.1:4787/api/native-sessions/mcp", getBinding: () => binding });
  const pty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) };
  const codexRoot = mkdtempSync(path.join(tmpdir(), "genbi-native-preflight-codex-")); dirs.push(codexRoot);
  const codexBinDirectory = path.join(codexRoot, "bin"); mkdirSync(codexBinDirectory);
  const codexBin = path.join(codexBinDirectory, "codex");
  writeFileSync(codexBin, "#!/bin/sh\necho codex-cli 0.146.0\n"); chmodSync(codexBin, 0o700);
  writeFileSync(path.join(codexRoot, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.146.0" }));
  const codexClosure = createHash("sha256");
  const visitCodex = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visitCodex(candidate);
      else if (entry.isFile()) { codexClosure.update(path.relative(codexRoot, candidate)); codexClosure.update("\0"); codexClosure.update(readFileSync(candidate)); }
    }
  };
  visitCodex(codexRoot);
  return {
    store,
    service: new NativeSessionService({
      store,
      terminalManager: terminalManager ?? (async () => new InteractiveTerminalManager(pty)),
      getBinding: () => binding,
      workspaceRoot: dir,
      materializationState: state,
      irPaths: irPaths(dir),
      warbleBin: producer,
      wrenShim,
      terminalHostAvailable: async () => true,
      executableAvailable: () => true,
      artifactService: artifacts,
      prepareCodexWrenHome: ({ cwd }) => {
        const home = path.join(cwd, ".wren");
        mkdirSync(home);
        writeFileSync(path.join(home, "profiles.yml"), "active: fixture\nprofiles:\n  fixture:\n    datasource: duckdb\n");
        return { home, dataRoots: [] };
      },
    }),
  };
}

afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("native producer compatibility preflight", () => {
  it("uses the configured executable for a deterministic six-way v4 materialization probe", async () => {
    const dir = fixtureDir();
    const wrenShim = runtimeFixture(dir);
    const producer = fakeProducer(dir, "compatible");
    const result = await probeNativeSessionProducer({ warbleBin: producer, irPaths: irPaths(dir), wrenShim });
    expect(result).toMatchObject({ available: true, diagnostic: expect.stringMatching(/^identity=sha256:[a-f0-9]{64} phase=complete result=compatible_claude\+codex$/) });
    expect(result.vendors).toMatchObject({ claude: { available: true }, codex: { available: true } });
    expect(readFileSync(path.join(dir, "producer-compatible.calls"), "utf8").trim().split("\n").sort()).toEqual([
      "claude-code:interactive:analysis",
      "claude-code:interactive:context_enrichment",
      "claude-code:interactive:setup",
      "codex:interactive:analysis",
      "codex:interactive:context_enrichment",
      "codex:interactive:setup",
    ]);

    const { service, store } = productionService(dir, producer, wrenShim);
    const readiness = await service.readiness();
    for (const purpose of ["setup", "analysis", "context_enrichment"] as const) {
      expect(readiness.purposes[purpose]).toMatchObject({ available: true, producer: { available: true } });
    }
    await expect(service.openOrCreate({ purpose: "analysis" })).resolves.toMatchObject({ row: { status: "running", purpose: "analysis" } });
    store.close();
  });

  it("keeps the preflight-resolved executable when the configured symlink retargets before launch", async () => {
    const dir = fixtureDir();
    const wrenShim = runtimeFixture(dir);
    const configured = path.join(dir, "producer-link");
    const replacement = fakeProducer(dir, "compatible", { name: "replacement" });
    const stable = fakeProducer(dir, "compatible", {
      name: "stable",
      finalAction: `if (purpose === 'context_enrichment' && target === 'codex:interactive') { rmSync(${JSON.stringify(configured)}); symlinkSync(${JSON.stringify(replacement)}, ${JSON.stringify(configured)}); }`,
    });
    symlinkSync(stable, configured);
    const { service, store } = productionService(dir, configured, wrenShim);

    await expect(service.openOrCreate({ purpose: "analysis" })).resolves.toMatchObject({ row: { status: "running", purpose: "analysis" } });

    expect(realpathSync(configured)).toBe(realpathSync(replacement));
    expect(readFileSync(path.join(dir, "producer-stable.calls"), "utf8").trim().split("\n")).toHaveLength(7);
    expect(existsSync(path.join(dir, "producer-replacement.calls"))).toBe(false);
    store.close();
  });

  it("fails closed before row or process creation when the preflight executable identity rotates", async () => {
    const dir = fixtureDir();
    const wrenShim = runtimeFixture(dir);
    const executable = path.join(dir, "producer-rotated.mjs");
    const producer = fakeProducer(dir, "compatible", {
      name: "rotated",
      finalAction: `if (purpose === 'context_enrichment' && target === 'codex:interactive') writeFileSync(${JSON.stringify(executable)}, '#!/usr/bin/env node\\nprocess.exit(1)');`,
    });
    const terminalManager = vi.fn(async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }));
    const { service, store } = productionService(dir, producer, wrenShim, terminalManager);

    await expect(service.openOrCreate({ purpose: "analysis" })).rejects.toThrow("native session producer is incompatible");

    expect(store.listNativeSessions()).toEqual([]);
    expect(terminalManager).not.toHaveBeenCalled();
    expect(readFileSync(path.join(dir, "producer-rotated.calls"), "utf8").trim().split("\n")).toHaveLength(6);
    store.close();
  });

  it("rejects stale help and partially compatible launch output before a session exists, while redacting browser diagnostics", async () => {
    const dir = fixtureDir();
    const wrenShim = runtimeFixture(dir);
    const stale = fakeProducer(dir, "stale");
    await expect(probeNativeSessionProducer({ warbleBin: stale, irPaths: irPaths(dir), wrenShim })).resolves.toMatchObject({ available: false, category: "native_session_producer_incompatible", diagnostic: expect.stringContaining("missing_markers") });
    await expect(probeNativeSessionProducer({ warbleBin: fakeProducer(dir, "partial"), irPaths: irPaths(dir), wrenShim })).resolves.toMatchObject({ available: false, category: "native_session_producer_incompatible", diagnostic: expect.stringContaining("launch_spec_incompatible") });

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { service, store } = productionService(dir, stale, wrenShim);
    const readiness = await service.readiness();
    expect(readiness.purposes.analysis).toEqual(expect.objectContaining({
      available: false,
      reason: "the Warble binary does not support the native session flags this build requires",
      producer: { available: false, category: "native_session_producer_incompatible", diagnostic: expect.stringContaining("missing_markers") },
    }));
    await expect(service.openOrCreate({ purpose: "setup" })).rejects.toThrow("the Warble binary does not support the native session flags this build requires");
    expect(store.listNativeSessions()).toEqual([]);
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/identity=sha256:[a-f0-9]{64} phase=dispatch_help result=missing_markers_/));
    expect(warning.mock.calls.flat().join(" ")).not.toMatch(/never-log-this|producer-stale|\/private|credential/i);

    const app = createApp({
      store,
      baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: dir },
      route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      nativeSessions: service,
    });
    const response = await app.request("/api/native-sessions/readiness");
    expect(response.status).toBe(200);
    const body = await response.json() as { purposes: { analysis: { producer?: { category?: string; diagnostic?: string } } } };
    expect(body.purposes.analysis.producer?.category).toBe("native_session_producer_incompatible");
    // The diagnostic is now sent, so the redaction guard below is what keeps it
    // honest: it may carry fixed phase/result tokens and a content digest, and
    // still no path, process output, or credential.
    expect(body.purposes.analysis.producer?.diagnostic).toMatch(/^identity=sha256:[a-f0-9]{64} phase=dispatch_help result=missing_markers_/);
    expect(JSON.stringify(body)).not.toMatch(/never-log-this|producer-stale|\/private|credential/i);
    const launch = await app.request("/api/native-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "setup" }) });
    expect(launch.status).toBe(409);
    expect(await launch.json()).toEqual({ error: "the Warble binary does not support the native session flags this build requires" });
    expect(store.listNativeSessions()).toEqual([]);
    warning.mockRestore();
    store.close();
  });

  it("blocks Codex when the server-owned Wren chain rotates, and says which link broke", async () => {
    const dir = fixtureDir();
    const wrenShim = runtimeFixture(dir);
    rmSync(wrenShim);
    writeFileSync(wrenShim, "not a server-owned shim\n");
    const producer = fakeProducer(dir, "compatible");
    const probe = await probeNativeSessionProducer({ warbleBin: producer, irPaths: irPaths(dir), wrenShim });
    // Only the Codex leg consumes the Wren runtime, so only the Codex leg falls.
    expect(probe.vendors.codex).toMatchObject({ available: false, reason: expect.stringContaining("native Wren runtime is unavailable") });
    expect(probe.vendors.claude.available).toBe(true);

    const { service, store } = productionService(dir, producer, wrenShim);
    await expect(service.readiness()).resolves.toMatchObject({
      purposes: {
        analysis: {
          available: false,
          reason: expect.stringContaining("native Wren runtime is unavailable"),
          producer: { available: false, category: "native_session_producer_incompatible", diagnostic: expect.stringContaining("wren_runtime_unavailable") },
        },
      },
    });
    await expect(service.openOrCreate({ purpose: "analysis" })).rejects.toThrow("native Wren runtime is unavailable");
    expect(store.listNativeSessions()).toEqual([]);
    store.close();
  });

  /**
   * The shape an installed package produces: the Codex leg cannot resolve a
   * Wren runtime it can trace to the server's own repository, and there is no
   * repository to trace to. Claude needs none of that, and must not inherit the
   * refusal — a single boolean over both vendors is what made it inherit it.
   */
  it("leaves Claude usable when only the Codex leg cannot resolve a Wren runtime", async () => {
    const dir = fixtureDir();
    const wrenShim = runtimeFixture(dir);
    rmSync(wrenShim);
    writeFileSync(wrenShim, "not a server-owned shim\n");
    const producer = fakeProducer(dir, "compatible");

    const { service, store } = productionService(dir, producer, wrenShim, undefined, "claude");
    const readiness = await service.readiness();
    expect(readiness.purposes.analysis.available).toBe(true);
    expect(readiness.purposes.analysis.reason).toBeUndefined();
    expect(readiness.purposes.analysis.producer).toMatchObject({ available: true });
    // The unusable vendor is still reported, with its own cause, rather than
    // being hidden because the configured one happens to work.
    expect(readiness.purposes.analysis.vendors.codex).toMatchObject({ available: false, reason: expect.stringContaining("native Wren runtime is unavailable") });
    expect(readiness.purposes.analysis.vendors.claude).toMatchObject({ available: true });
    store.close();
  });
});
