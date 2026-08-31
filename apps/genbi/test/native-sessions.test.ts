import { buildNativeLaunchSpec } from "./native-launch-spec.js";
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../server/db.js";
import { createApp } from "../server/app.js";
import { NATIVE_SESSION_IDLE_TTL_MS, NATIVE_SESSION_INITIAL_ATTACHMENT_GRACE_MS, NATIVE_SESSION_POST_CLAIM_DETACH_GRACE_MS, NATIVE_SETUP_BOOTSTRAP_ROOT_ENV_VAR, NativeSessionService, nativeSessionLaunchFailure, nativeSessionLifecycle, readNativeLaunchSpec, resolvePinnedCodexExecutable } from "../server/native-sessions.js";
import { createNativeSessionWorkspace, initializeNativeSessionStateBase } from "../server/native-session-workspace.js";
import { sealNativeClaudeResumeHandle, sealNativeResumeHandle, unsealNativeClaudeResumeHandle, unsealNativeResumeHandle } from "../server/native-session-resume.js";
import type { NativeSessionServiceOptions } from "../server/native-sessions.js";
import { NativeArtifactService, NATIVE_MCP_CREDENTIAL_ENV_VAR, NATIVE_MCP_TOOL_NAME } from "../server/native-artifacts.js";
import { InteractiveTerminalManager } from "../server/interactive-terminal.js";
import type { PtyFactory } from "../server/interactive-terminal.js";

const dirs: string[] = [];
const NATIVE_MCP_URL = "http://127.0.0.1:4787/api/native-sessions/mcp";
function welcomeFor(purpose: "analysis" | "setup" | "context_enrichment") {
  return purpose === "setup"
    ? "Help me set up this GenBI project. Start by explaining the next setup step and ask what data source I want to connect."
    : purpose === "analysis"
      ? "Help me analyze this data. Ask me what question I want to answer about the server-bound project."
      : "Help me inspect this project's context and draft a read-only enrichment proposal. Do not apply changes; ask what context I want to review.";
}
// Independent fixture copy of which purposes pin one component. Do not derive this from production
// `claudeScopeEntry`: it is a second key, so a production edit alone cannot quietly re-point every
// fixture in this file at whatever the validator now happens to accept. Changing an entry form is
// meant to require editing both, and to fail loudly here until it does.
const PINNED_CLAUDE_PURPOSES: readonly ("analysis" | "setup" | "context_enrichment")[] = ["setup", "context_enrichment"];
function claudeScopeEntry(purpose: "analysis" | "setup" | "context_enrichment", vendor: "claude" | "codex") {
  return vendor === "claude" && !PINNED_CLAUDE_PURPOSES.includes(purpose);
}
// Mirrors `NATIVE_DISPATCH_REGISTRY[purpose].profile` (native-dispatch-registry.ts): the profile
// name a scope-entry session's `agent` descriptor names, once it stops pinning one component.
function profileFor(purpose: "analysis" | "setup" | "context_enrichment") {
  return purpose === "analysis" ? "genbi-default" : purpose === "setup" ? "genbi-setup" : "genbi-enrich-context";
}
function fixture(purpose: "analysis" | "setup" | "context_enrichment", vendor: "claude" | "codex") {
  const dir = mkdtempSync(path.join(tmpdir(), "genbi-native-session-")); dirs.push(dir);
  mkdirSync(path.join(dir, ".warble")); writeFileSync(path.join(dir, "RUN.md"), "handoff");
  const binding = purpose === "setup" ? undefined : { identity: "fixture-project", generation: 7, revision: "sha256:fixture", path: dir };
  const scope = { kind: purpose === "setup" ? "bootstrap" : "bound_project", scope_id: "fixture-scope", bootstrap_root: purpose === "setup" ? realpathSync(path.dirname(dir)) : null, binding: binding ? { project_identity: binding.identity, generation: String(binding.generation), revision: binding.revision } : null };
  const agent = purpose === "analysis" ? "answer_query" : purpose === "setup" ? "connect_source" : "draft_enrichment";
  const target = vendor === "claude" ? "claude-code:interactive" : "codex:interactive";
  const scopeEntry = claudeScopeEntry(purpose, vendor);
  writeFileSync(path.join(dir, ".warble", "interactive-launch.json"), JSON.stringify(buildNativeLaunchSpec({
    version: "2", target, purpose, out: dir, scope, entryVerb: agent, scopeEntry, profile: profileFor(purpose),
  })));
  return { dir, binding };
}

function materializationState() {
  const stateParent = mkdtempSync(path.join(tmpdir(), "genbi-native-bff-state-")); dirs.push(stateParent);
  return initializeNativeSessionStateBase(path.join(stateParent, "bff.sqlite"));
}

function writeNativeLaunchSpec(cwd: string, purpose: "analysis" | "setup" | "context_enrichment", vendor: "claude" | "codex", scope: Record<string, unknown>, v4 = false) {
  const agent = purpose === "analysis" ? "answer_query" : purpose === "setup" ? "connect_source" : "draft_enrichment";
  const target = vendor === "claude" ? "claude-code:interactive" : "codex:interactive";
  const scopeEntry = claudeScopeEntry(purpose, vendor);
  // Warble's launch_value() echoes only these four fields, so the fixture must too. This used to
  // strip by omission, which meant every new scope field leaked into the echoed spec and failed the
  // host's exact-key check somewhere unrelated — name what is echoed instead.
  const launchScope = {
    kind: scope.kind,
    scope_id: scope.scope_id,
    bootstrap_root: scope.bootstrap_root,
    binding: scope.binding,
  };
  mkdirSync(path.join(cwd, ".warble"), { recursive: true });
  writeFileSync(path.join(cwd, "RUN.md"), "handoff");
  writeFileSync(path.join(cwd, ".warble", "interactive-launch.json"), JSON.stringify(buildNativeLaunchSpec({
    version: v4 ? "4" : "2", target, purpose, out: cwd, entryVerb: agent, welcome: welcomeFor(purpose),
    scopeEntry, profile: profileFor(purpose),
    scope: v4
      ? scope
      : { ...launchScope, bootstrap_root: launchScope.bootstrap_root ?? null, binding: launchScope.binding ?? null },
  })));
  if (v4 && vendor === "codex") {
    mkdirSync(path.join(cwd, ".codex"), { recursive: true });
    writeFileSync(path.join(cwd, ".codex", "config.toml"), [
      'default_permissions = "warble_native_wren"',
      "",
      "[permissions.warble_native_wren.filesystem]",
      '":minimal" = "read"',
      "",
      '[permissions.warble_native_wren.filesystem.":workspace_roots"]',
      '"." = "write"',
      "",
    ].join("\n"));
  }
}

/**
 * Offline process seam for the public CLI boundary. It verifies the
 * separate v2/v4 descriptor files while they exist, emits a minimal v4 launch
 * spec plus vendor discovery marker, and never retains the credential itself.
 */
function fakeV4Producer(dir: string): string {
  const executable = path.join(dir, "fake-warble.mjs");
  writeFileSync(executable, `#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("dispatch --target --purpose --native-scope --native-mcp --out");
  process.exit(0);
}
const value = (flag) => { const index = args.indexOf(flag); if (index < 0 || !args[index + 1]) process.exit(91); return args[index + 1]; };
const scopePath = value("--native-scope");
const mcpPath = value("--native-mcp");
const out = value("--out");
const target = value("--target");
const purpose = value("--purpose");
const scope = JSON.parse(readFileSync(scopePath, "utf8"));
const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
const sorted = (value) => Object.keys(value).sort();
const scopeKeys = sorted(scope);
const mcpKeys = sorted(mcp);
const preflightBound = String(scope.scope_id).startsWith("preflight-") && purpose !== "setup";
const expectedScopeKeys = target === "codex:interactive"
  ? (String(scope.scope_id).startsWith("preflight-") && !preflightBound ? ["cwd", "entry", "kind", "scope_id", "version", "wren_runtime"] : ["binding", "cwd", "entry", "kind", "scope_id", "version", "wren_runtime"])
  : (String(scope.scope_id).startsWith("preflight-") && !preflightBound ? ["cwd", "entry", "kind", "scope_id", "version"] : ["binding", "cwd", "entry", "kind", "scope_id", "version"]);
const scopeExact = JSON.stringify(scopeKeys) === JSON.stringify(expectedScopeKeys);
const mcpExact = JSON.stringify(mcpKeys) === JSON.stringify(["credential", "url", "version"]);
const scopeMode = statSync(scopePath).mode & 0o777;
const mcpMode = statSync(mcpPath).mode & 0o777;
const descriptorExact = mcp.version === "1" && typeof mcp.url === "string" && mcp.url.startsWith("http") && typeof mcp.credential === "string";
if (!scopeExact || !mcpExact || !descriptorExact || scopeMode !== 0o600 || mcpMode !== 0o600 || Object.hasOwn(scope, "mcp")) process.exit(92);
const agent = purpose === "analysis" ? "answer_query" : purpose === "setup" ? "connect_source" : "draft_enrichment";
const profile = purpose === "analysis" ? "genbi-default" : purpose === "setup" ? "genbi-setup" : "genbi-enrich-context";
const scopeEntry = target === "claude-code:interactive" && purpose === "analysis";
const welcome = purpose === "setup"
  ? "Help me set up this GenBI project. Start by explaining the next setup step and ask what data source I want to connect."
  : purpose === "analysis"
    ? "Help me analyze this data. Ask me what question I want to answer about the server-bound project."
    : "Help me inspect this project's context and draft a read-only enrichment proposal. Do not apply changes; ask what context I want to review.";
mkdirSync(path.join(out, ".warble"), { recursive: true });
writeFileSync(path.join(out, "RUN.md"), "handoff");
// This is a standalone subprocess written to disk: it cannot import buildNativeLaunchSpec, so
// this copy stays inline. native-launch-spec-contract.test.ts is what keeps the shape honest.
writeFileSync(path.join(out, ".warble", "interactive-launch.json"), JSON.stringify({
  version: "4", target, purpose, executable: target === "claude-code:interactive" ? "claude" : "codex",
  argv: scopeEntry ? [welcome] : target === "claude-code:interactive" ? ["--agent", agent, welcome] : [welcome],
  agent: scopeEntry ? { kind: "claude_scope", name: profile } : target === "claude-code:interactive" ? { kind: "claude_agent", name: agent } : { kind: "codex_skill", name: "genbi-" + (purpose === "context_enrichment" ? "enrich-context" : purpose) },
  mcp: { server_name: "genbi_session", credential_env_var: "WARBLE_MCP_CONNECTION_CREDENTIAL" },
  cwd: out, artifact_root: out, handoff_path: path.join(out, "RUN.md"),
}));
const discovery = target === "claude-code:interactive" ? path.join(out, ".mcp.json") : path.join(out, ".codex", "config.toml");
mkdirSync(path.dirname(discovery), { recursive: true });
writeFileSync(discovery, target === "codex:interactive"
  ? 'default_permissions = "warble_native_wren"\\n\\n[permissions.warble_native_wren.filesystem]\\n":minimal" = "read"\\n\\n[permissions.warble_native_wren.filesystem.":workspace_roots"]\\n"." = "write"\\n'
  : "producer-owned discovery");
writeFileSync(path.join(out, ".warble", "fake-producer-observation.json"), JSON.stringify({
  scopePath, mcpPath, scopeKeys, mcpKeys, scopeMode, mcpMode, descriptorExact, hasNativeMcp: args.includes("--native-mcp"),
  argvContainsCredential: args.includes(mcp.credential), credentialMatches: typeof mcp.credential === "string" && mcp.credential.length > 0,
  discovery, purpose,
}));
if (purpose === "context_enrichment" && !String(scope.scope_id).startsWith("preflight-")) process.exit(1);
`);
  chmodSync(executable, 0o700);
  return executable;
}

function fakeCodexAttestation(): Pick<NativeSessionServiceOptions, "codexBin" | "codexBinSha256" | "codexSource" | "codexSourceClosureSha256" | "codexVersion"> {
  const root = mkdtempSync(path.join(tmpdir(), "genbi-native-codex-source-")); dirs.push(root);
  const binDirectory = path.join(root, "bin"); mkdirSync(binDirectory);
  const codexBin = path.join(binDirectory, "codex");
  writeFileSync(codexBin, "#!/bin/sh\necho codex-cli 0.146.0\n"); chmodSync(codexBin, 0o700);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.146.0" }));
  const closure = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) { closure.update(path.relative(root, candidate)); closure.update("\0"); closure.update(readFileSync(candidate)); }
    }
  };
  visit(root);
  return {
    codexBin,
    codexBinSha256: createHash("sha256").update(readFileSync(codexBin)).digest("hex"),
    codexSource: "npm:@openai/codex",
    codexSourceClosureSha256: closure.digest("hex"),
    codexVersion: "0.146.0",
  };
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("native session persistence", () => {
  it("re-hashes the host-attested Codex executable and rejects same-path substitution", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "genbi-codex-pin-")); dirs.push(dir);
    const bin = path.join(dir, "codex"); writeFileSync(bin, "#!/bin/sh\necho codex-cli 0.146.0\n"); chmodSync(bin, 0o700);
    const digest = createHash("sha256").update(readFileSync(bin)).digest("hex");
    expect(resolvePinnedCodexExecutable(bin, digest)).toBe(realpathSync(bin));
    writeFileSync(bin, "#!/bin/sh\necho substituted\n"); chmodSync(bin, 0o700);
    expect(() => resolvePinnedCodexExecutable(bin, digest)).toThrow("attested Codex executable is unavailable or has changed");
    expect(() => resolvePinnedCodexExecutable("codex", digest)).toThrow("attested Codex executable is unavailable or has changed");
  });

  it("re-hashes the npm Codex source closure immediately before native launch", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-codex-npm-pin-")); dirs.push(root);
    const binDirectory = path.join(root, "bin"); mkdirSync(binDirectory);
    const bin = path.join(binDirectory, "codex"); writeFileSync(bin, "#!/bin/sh\necho codex-cli 0.146.0\n"); chmodSync(bin, 0o700);
    const packageFile = path.join(root, "package.json"); writeFileSync(packageFile, JSON.stringify({ name: "@openai/codex", version: "0.146.0" }));
    const executableSha256 = createHash("sha256").update(readFileSync(bin)).digest("hex");
    const closure = createHash("sha256");
    for (const file of [bin, packageFile]) {
      closure.update(path.relative(root, file)); closure.update("\0"); closure.update(readFileSync(file));
    }
    const sourcePin = { source: "npm:@openai/codex" as const, closureSha256: closure.digest("hex"), version: "0.146.0" };
    expect(resolvePinnedCodexExecutable(bin, executableSha256, sourcePin)).toBe(realpathSync(bin));
    writeFileSync(packageFile, JSON.stringify({ name: "@openai/codex", version: "0.146.0", substituted: true }));
    expect(() => resolvePinnedCodexExecutable(bin, executableSha256, sourcePin)).toThrow("attested Codex executable is unavailable or has changed");
  });

  it.each([
    ["setup", "claude"], ["setup", "codex"],
    ["analysis", "claude"], ["analysis", "codex"],
    ["context_enrichment", "claude"], ["context_enrichment", "codex"],
  ] as const)("validates and materializes the loopback MCP launch contract for %s/%s", async (purpose, vendor) => {
    const { dir, binding } = fixture(purpose, vendor);
    const state = materializationState();
    const store = new Store(":memory:");
    const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
    const spawned: Array<{ file: string; args: readonly string[] }> = [];
    const spawnEnvs: NodeJS.ProcessEnv[] = [];
    const writes = vi.fn();
    const pty: PtyFactory = { spawn: (file, args, options) => {
      spawned.push({ file, args });
      spawnEnvs.push(options.env ?? {});
      return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write: writes, resize() {}, kill() {} };
    } };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => binding,
      workspaceRoot: purpose === "setup" ? dir : undefined,
      materializationState: state,
      irPaths: { analysis: purpose === "analysis" ? path.join(dir, "analysis.json") : undefined, setup: purpose === "setup" ? path.join(dir, "setup.json") : undefined, context_enrichment: purpose === "context_enrichment" ? path.join(dir, "enrich.json") : undefined },
      warbleBin: "unused", producerAvailable: () => true, executableAvailable: () => true, artifactService: artifacts,
      dispatch: async ({ cwd, scope }) => {
        writeNativeLaunchSpec(cwd, purpose, vendor, scope, true);
        // The version is deliberately not asserted here: this file writes it, so restating it
        // proves nothing. Warble's preflight rejects an unsupported scope version, and
        // native-launch-spec-contract.test.ts checks the shape against the real binary.
        expect(scope).toMatchObject({ cwd: expect.stringContaining(`${path.sep}.genbi-native-state-`), entry: claudeScopeEntry(purpose, vendor)
          ? { kind: "scope", prompt: expect.any(String) }
          : { verb: expect.any(String), prompt: expect.any(String) }, ...(purpose === "setup" ? { bootstrap_root: realpathSync(dir) } : {}) });
      },
    });
    const readiness = await service.readiness();
    expect(readiness[purpose].vendors[vendor]).toEqual({ available: true });
    const created = await service.create({ purpose, vendor });
    expect(created.row.status).toBe("running");
    const materializationRoot = path.join(state.root, "native", created.row.id);
    expect(materializationRoot).not.toBe(dir);
    const launch = readNativeLaunchSpec(materializationRoot, purpose, vendor, created.row.scopeId, binding, { version: "1", url: "http://127.0.0.1:4787/api/native-sessions/mcp", credential: "credential" }, state, purpose === "setup" ? dir : undefined);
    expect(launch.version).toBe("4");
    const agent = purpose === "analysis" ? "answer_query" : purpose === "setup" ? "connect_source" : "draft_enrichment";
    const scopeEntry = claudeScopeEntry(purpose, vendor);
    expect(spawned).toEqual([{ file: vendor, args: vendor === "claude"
      ? [...(scopeEntry ? [] : ["--agent", agent]), "--session-id", expect.stringMatching(/^[0-9a-f-]{36}$/), welcomeFor(purpose)]
      : ["--dangerously-bypass-hook-trust", welcomeFor(purpose)] }]);
    expect(spawnEnvs[0]).toMatchObject({ TERM: "xterm-256color", COLORTERM: "truecolor" });
    expect(spawnEnvs[0]?.NO_COLOR).toBeUndefined();
    expect(spawnEnvs[0]?.[NATIVE_SETUP_BOOTSTRAP_ROOT_ENV_VAR]).toBe(purpose === "setup" ? realpathSync(dir) : undefined);
    if (vendor === "codex" && binding) {
      expect(readFileSync(path.join(materializationRoot, ".codex", "config.toml"), "utf8")).toContain(`${JSON.stringify(realpathSync(binding.path))} = "read"`);
    }
    expect(writes).not.toHaveBeenCalled();
    store.close();
  });

  it("blocks a legacy invalid Claude Runtime before native dispatch and exposes the same correction in readiness", async () => {
    const { dir } = fixture("setup", "claude");
    const store = new Store(":memory:");
    store.setRuntimeSettings({
      ...store.getRuntimeSettings(),
      subscriptionProvider: "claude",
      subscriptionDriverModel: "default",
      tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "default" }],
    });
    const dispatch = vi.fn();
    const service = new NativeSessionService({
      store,
      terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }),
      getBinding: () => undefined,
      workspaceRoot: dir,
      irPaths: { analysis: undefined, setup: path.join(dir, "setup.json"), context_enrichment: undefined },
      warbleBin: "unused",
      dispatch,
    });

    const readiness = await service.readiness();
    expect(readiness.purposes.setup).toMatchObject({ available: false, reason: expect.stringContaining("Runtime needs correction in Setup") });
    await expect(service.openOrCreate({ purpose: "setup" })).rejects.toThrow(/Runtime needs correction in Setup/);
    expect(dispatch).not.toHaveBeenCalled();
    store.close();
  });

  it("materializes repeated and recovery Setup launches in isolated roots while retaining the bootstrap scope", async () => {
    const { dir } = fixture("setup", "codex");
    const state = materializationState();
    const store = new Store(":memory:");
    const roots: string[] = [];
    const scopeCwds: string[] = [];
    let exitFirst: ((event: { exitCode: number }) => void) | undefined;
    const pty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { exitFirst ??= listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) };
    writeFileSync(path.join(dir, "AGENTS.md"), "bootstrap-owned instructions");
    writeFileSync(path.join(dir, ".warble", "interactive-ownership.json"), "prior bootstrap marker");
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => undefined,
      workspaceRoot: dir, materializationState: state,
      irPaths: { analysis: undefined, setup: path.join(dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused",
      executableAvailable: () => true,
      dispatch: async ({ cwd, scope }) => { roots.push(cwd); scopeCwds.push(String(scope.cwd)); writeNativeLaunchSpec(cwd, "setup", "codex", scope); },
    });
    const first = await service.openOrCreate({ purpose: "setup", vendor: "codex" });
    exitFirst?.({ exitCode: 0 });
    const recovery = await service.actOnSetupRecovery({ id: first.row.id, capability: first.recoveryCapability!, expectedVersion: 0, action: "retry" });
    expect(recovery?.row).toMatchObject({ purpose: "setup", status: "running" });
    expect(roots).toEqual([path.join(state.root, "native", first.row.id), path.join(state.root, "native", recovery!.row.id)]);
    expect(scopeCwds).toEqual(roots.map((root) => realpathSync(root)));
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("bootstrap-owned instructions");
    expect(readFileSync(path.join(dir, ".warble", "interactive-ownership.json"), "utf8")).toBe("prior bootstrap marker");
    store.close();
  });

  it("rejects a DB-derived state root inside Setup or bound workspaces before dispatch, while an external root launches", async () => {
    for (const purpose of ["setup", "analysis"] as const) {
      const nested = fixture(purpose, "codex");
      const store = new Store(":memory:");
      const dispatch = vi.fn(async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => {
        writeNativeLaunchSpec(cwd, purpose, "codex", scope);
      });
      const service = new NativeSessionService({
        store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => nested.binding,
        workspaceRoot: purpose === "setup" ? nested.dir : undefined,
        materializationState: initializeNativeSessionStateBase(path.join(nested.dir, "bff.sqlite")),
        irPaths: { analysis: purpose === "analysis" ? path.join(nested.dir, "analysis.json") : undefined, setup: purpose === "setup" ? path.join(nested.dir, "setup.json") : undefined, context_enrichment: undefined },
        warbleBin: "unused", executableAvailable: () => true, dispatch,
      });

      const readiness = await service.readiness();
      expect(readiness[purpose].vendors.codex).toEqual({ available: false, reason: "native session workspace is unavailable" });
      if (purpose === "setup") {
        await expect(service.create({ purpose, vendor: "codex" })).resolves.toMatchObject({ row: { status: "failed", failure: "native session workspace is unavailable" } });
      } else {
        await expect(service.create({ purpose, vendor: "codex" })).rejects.toThrow(/workspace is unavailable/);
      }
      expect(dispatch).not.toHaveBeenCalled();
      store.close();
    }

    const external = fixture("setup", "codex");
    const externalStateParent = mkdtempSync(path.join(tmpdir(), "genbi-native-external-state-")); dirs.push(externalStateParent);
    const store = new Store(":memory:");
    const dispatch = vi.fn(async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => {
      writeNativeLaunchSpec(cwd, "setup", "codex", scope);
    });
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => undefined,
      workspaceRoot: external.dir, materializationState: initializeNativeSessionStateBase(path.join(externalStateParent, "bff.sqlite")),
      irPaths: { analysis: undefined, setup: path.join(external.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", executableAvailable: () => true, dispatch,
    });

    expect((await service.readiness()).setup.vendors.codex).toEqual({ available: true });
    await expect(service.create({ purpose: "setup", vendor: "codex" })).resolves.toMatchObject({ row: { status: "running" } });
    expect(dispatch).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("isolates sequential and overlapping bound-purpose emissions without touching project-owned discovery files", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState();
    mkdirSync(path.join(dir, ".codex"), { recursive: true });
    writeFileSync(path.join(dir, "AGENTS.md"), "project-owned instructions");
    writeFileSync(path.join(dir, ".codex", "config.toml"), "project-owned config");
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const roots: string[] = [];
    const spawned: Array<{ cwd: string; env?: NodeJS.ProcessEnv }> = [];
    const pty: PtyFactory = { spawn: (_file, _args, options) => {
      spawned.push(options);
      return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} };
    } };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => binding,
      workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: path.join(dir, "enrich.json") }, warbleBin: "unused",
      materializationState: state,
      dispatch: async ({ cwd, purpose, scope }) => { roots.push(cwd); writeNativeLaunchSpec(cwd, purpose, "codex", scope); },
    });
    const [analysis, context] = await Promise.all([
      service.openOrCreate({ purpose: "analysis" }),
      service.openOrCreate({ purpose: "context_enrichment" }),
    ]);
    expect(roots).toHaveLength(2);
    expect(new Set(roots).size).toBe(2);
    expect(new Set(roots)).toEqual(new Set([
      path.join(state.root, "native", analysis.row.id),
      path.join(state.root, "native", context.row.id),
    ]));
    for (const root of roots) {
      expect(lstatSync(root).mode & 0o777).toBe(0o700);
    }
    expect(spawned.map((entry) => entry.cwd)).toEqual(expect.arrayContaining(roots));
    expect(spawned.every((entry) => entry.env?.WREN_PROJECT_HOME === binding!.path)).toBe(true);
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("project-owned instructions");
    expect(readFileSync(path.join(dir, ".codex", "config.toml"), "utf8")).toBe("project-owned config");

    expect(service.stop(analysis.row.id, analysis.capability!)).toBe(true);
    const nextAnalysis = await service.openOrCreate({ purpose: "analysis" });
    expect(nextAnalysis.row.id).not.toBe(analysis.row.id);
    expect(roots[2]).toBe(path.join(state.root, "native", nextAnalysis.row.id));
    expect(new Set(roots).size).toBe(3);
    store.close();
  });

  it("starts intentionally separate bound sessions in distinct roots with isolated capabilities", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState();
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const roots: string[] = [];
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => binding,
      workspaceRoot: undefined, materializationState: state,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => { roots.push(cwd); writeNativeLaunchSpec(cwd, "analysis", "codex", scope); },
    });
    const first = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000001" });
    const second = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000002" });

    expect(second.row.id).not.toBe(first.row.id);
    expect(second.capability).not.toBe(first.capability);
    expect(roots).toEqual([path.join(state.root, "native", first.row.id), path.join(state.root, "native", second.row.id)]);
    expect(new Set(roots).size).toBe(2);
    expect(first.row).toMatchObject({ projectIdentity: binding!.identity, bindingGeneration: binding!.generation, projectRevision: binding!.revision, runtimeGeneration: expect.any(Number) });
    expect(second.row).toMatchObject({ projectIdentity: binding!.identity, bindingGeneration: binding!.generation, projectRevision: binding!.revision, runtimeGeneration: first.row.runtimeGeneration });
    store.close();
  });

  it("keeps a read-only bound project out of native materialization while preserving its canonical WREN_PROJECT_HOME", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState();
    const projectWarbleTarget = mkdtempSync(path.join(tmpdir(), "genbi-project-warble-target-")); dirs.push(projectWarbleTarget);
    rmSync(path.join(dir, ".warble"), { recursive: true }); symlinkSync(projectWarbleTarget, path.join(dir, ".warble"));
    writeFileSync(path.join(dir, "AGENTS.md"), "project-owned instructions");
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const spawned: Array<{ cwd: string; env?: NodeJS.ProcessEnv }> = [];
    const pty: PtyFactory = { spawn: (_file, _args, options) => {
      spawned.push(options);
      return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} };
    } };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => binding,
      workspaceRoot: undefined, materializationState: state,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", executableAvailable: () => true,
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
    });
    chmodSync(dir, 0o500);
    try {
      await expect(service.readiness()).resolves.toMatchObject({ purposes: { analysis: { available: true } } });
      const created = await service.openOrCreate({ purpose: "analysis" });
      expect(spawned).toEqual([expect.objectContaining({ cwd: path.join(state.root, "native", created.row.id), env: expect.objectContaining({ WREN_PROJECT_HOME: binding!.path }) })]);
      expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("project-owned instructions");
      expect(existsSync(path.join(projectWarbleTarget, "interactive-launch.json"))).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
      store.close();
    }
  });

  it("rejects a materialization root replaced before PTY spawn", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState();
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    let workspace = "";
    let releaseManager!: (manager: InteractiveTerminalManager) => void;
    const managerGate = new Promise<InteractiveTerminalManager>((resolve) => { releaseManager = resolve; });
    const spawn = vi.fn();
    const service = new NativeSessionService({
      store, terminalManager: async () => managerGate, getBinding: () => binding,
      workspaceRoot: undefined, materializationState: state,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => { workspace = cwd; writeNativeLaunchSpec(cwd, "analysis", "codex", scope); },
    });
    const pending = service.openOrCreate({ purpose: "analysis" });
    await vi.waitFor(() => expect(workspace).not.toBe(""));
    const replacement = mkdtempSync(path.join(tmpdir(), "genbi-native-race-replacement-")); dirs.push(replacement);
    rmSync(workspace, { recursive: true }); symlinkSync(replacement, workspace);
    releaseManager(new InteractiveTerminalManager({ spawn }));
    await expect(pending).rejects.toThrow(/workspace is unavailable/);
    expect(spawn).not.toHaveBeenCalled();
    expect(store.getNativeSession(service.list()[0]!.id)).toMatchObject({ status: "failed", failure: "native session workspace is unavailable" });
    store.close();
  });

  it("fails closed for traversal, symlink, and session-ID collision in native materialization roots", () => {
    const project = mkdtempSync(path.join(tmpdir(), "genbi-native-root-")); dirs.push(project);
    const state = materializationState();
    const first = createNativeSessionWorkspace(state, project, "native-session-safe");
    expect(first).toBe(path.join(state.root, "native", "native-session-safe"));
    expect(() => createNativeSessionWorkspace(state, project, "native-session-safe")).toThrow(/workspace is unavailable/);
    expect(() => createNativeSessionWorkspace(state, project, "../escape")).toThrow(/workspace is unavailable/);

    const hostile = materializationState();
    const outside = mkdtempSync(path.join(tmpdir(), "genbi-native-outside-")); dirs.push(outside);
    rmSync(path.join(hostile.root, "native"), { recursive: true }); symlinkSync(outside, path.join(hostile.root, "native"));
    expect(() => createNativeSessionWorkspace(hostile, project, "native-session-safe")).toThrow(/workspace is unavailable/);
    expect(existsSync(path.join(outside, "native-session-safe"))).toBe(false);
  });

  it("fails closed for an invalid MCP URL without exposing configuration detail", async () => {
    const { dir } = fixture("setup", "codex");
    writeFileSync(path.join(dir, "setup.json"), "{}");
    const store = new Store(":memory:");
    const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: "https://example.invalid/secret", getBinding: () => undefined });
    const service = new NativeSessionService({
      store, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => undefined,
      workspaceRoot: dir, irPaths: { analysis: undefined, setup: path.join(dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", producerAvailable: () => true, artifactService: artifacts,
    });
    await expect(service.readiness()).resolves.toMatchObject({ setup: { available: false, vendors: { claude: { available: false, reason: "native MCP URL is invalid" }, codex: { available: false, reason: "native MCP URL is invalid" } } } });
    await expect(service.openOrCreate({ purpose: "setup", vendor: "codex" })).resolves.toMatchObject({ row: { status: "failed", failure: "native MCP URL is invalid" } });
    store.close();
  });

  it("creates a missing bootstrap workspace inside durable launch handling", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "genbi-native-missing-workspace-")); dirs.push(parent);
    const workspace = path.join(parent, "created-on-launch");
    const template = fixture("setup", "claude");
    const store = new Store(":memory:");
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => undefined,
      workspaceRoot: workspace, irPaths: { analysis: undefined, setup: path.join(template.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", producerAvailable: () => true, executableAvailable: () => true,
      dispatch: async ({ cwd, scope }) => {
        mkdirSync(path.join(cwd, ".warble"), { recursive: true }); writeFileSync(path.join(cwd, "RUN.md"), "handoff");
        // Warble's launch_value() echoes only these four fields. Stripping by omission let every
        // new scope field leak into the echoed spec and fail the host's exact-key check.
        const launchScope = { kind: scope.kind, scope_id: scope.scope_id, bootstrap_root: scope.bootstrap_root, binding: scope.binding };
        writeFileSync(path.join(cwd, ".warble", "interactive-launch.json"), JSON.stringify(buildNativeLaunchSpec({ version: "2", target: "claude-code:interactive", purpose: "setup", out: cwd, entryVerb: "connect_source", scope: { ...launchScope, binding: null } })));
      },
    });
    await expect(service.readiness()).resolves.toMatchObject({ setup: { available: true, vendors: { claude: { available: true }, codex: { available: true } } } });
    await expect(service.openOrCreate({ purpose: "setup", vendor: "claude" })).resolves.toMatchObject({ row: { status: "running" } });
    expect(statSync(workspace).isDirectory()).toBe(true);
    store.close();
  });

  it("fails closed for an unusable bootstrap workspace while terminalizing its row", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "genbi-native-unusable-workspace-")); dirs.push(parent);
    const workspace = path.join(parent, "not-a-directory"); writeFileSync(workspace, "file");
    const template = fixture("setup", "codex");
    const store = new Store(":memory:");
    const service = new NativeSessionService({
      store, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => undefined,
      workspaceRoot: workspace, irPaths: { analysis: undefined, setup: path.join(template.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", producerAvailable: () => true,
      dispatch: async () => { throw new Error("not reached"); },
    });
    await expect(service.readiness()).resolves.toMatchObject({ setup: { available: false, reason: "native session workspace is unavailable" } });
    await expect(service.openOrCreate({ purpose: "setup", vendor: "codex" })).resolves.toMatchObject({ row: { status: "failed", failure: "native session workspace is unavailable" } });
    expect(service.list().some((row) => row.status === "creating")).toBe(false);
    store.close();
  });

  it.each(["claude", "codex"] as const)("records a terminal failed row when the %s producer is unavailable", async (vendor) => {
    const { dir } = fixture("setup", vendor);
    const store = new Store(":memory:");
    const service = new NativeSessionService({
      store, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => undefined,
      workspaceRoot: dir, irPaths: { analysis: undefined, setup: path.join(dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", producerAvailable: () => false,
    });
    await expect(service.readiness()).resolves.toMatchObject({ setup: { available: false, vendors: { [vendor]: { available: false, reason: "native session materialization prerequisites are unavailable" } } } });
    await expect(service.openOrCreate({ purpose: "setup", vendor })).resolves.toMatchObject({ row: { status: "failed", failure: "native session materialization prerequisites are unavailable" } });
    expect(service.list().some((row) => row.status === "creating")).toBe(false);
    store.close();
  });

  it("sanitizes unexpected launch failures", () => {
    expect(nativeSessionLaunchFailure(new Error("spawn /private/secret --token=abc"))).toBe("native session launch failed");
  });

  it("logs only the server-side launch phase when an unexpected boundary fails", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const store = new Store(":memory:");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new NativeSessionService({
      store,
      terminalManager: async () => { throw new Error("spawn /private/secret --token=abc"); },
      getBinding: () => binding,
      workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined },
      warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
    });

    await expect(service.create({ purpose: "analysis", vendor: "codex" })).rejects.toThrow("spawn /private/secret --token=abc");
    expect(log).toHaveBeenCalledWith("[native-sessions] launch failed purpose=analysis vendor=codex phase=terminal_manager category=unexpected");
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/private|secret|token|abc/);
    expect(store.listNativeSessions()).toEqual([expect.objectContaining({ status: "failed", failure: "native session launch failed" })]);

    log.mockRestore();
    store.close();
  });

  it("persists only a closed Setup recovery projection and fences restart actions", async () => {
    const setup = fixture("setup", "codex");
    const store = new Store(":memory:");
    let exit!: (event: { exitCode: number }) => void;
    const pty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) };
    const dispatch = async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => {
      writeNativeLaunchSpec(cwd, "setup", "codex", scope);
    };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => undefined,
      workspaceRoot: setup.dir, irPaths: { analysis: undefined, setup: path.join(setup.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch,
    });
    const first = await service.openOrCreate({ purpose: "setup", vendor: "codex" });
    expect(first.recoveryCapability).toEqual(expect.any(String));
    expect(await service.openOrCreate({ purpose: "setup", vendor: "codex" })).toMatchObject({ row: { id: first.row.id }, recoveryCapability: first.recoveryCapability });
    expect(() => service.reportSetupRecovery(first.row.id, { version: "1", sequence: 1, phase: "connect", state: "retryable_failure", code: "retryable", transcript: "forbidden" }, false)).toThrow(/invalid report_setup_recovery/);
    const recovery = service.reportSetupRecovery(first.row.id, { version: "1", sequence: 1, phase: "connect", state: "retryable_failure", code: "retryable" }, false);
    expect(recovery).toMatchObject({ phase: "connect", state: "retryable_failure", code: "retryable", sequence: 1, version: 1, completionValidated: false });
    expect(JSON.stringify(recovery)).not.toMatch(/transcript|prompt|credential|capability|tool|path/i);
    expect(service.reportSetupRecovery(first.row.id, { version: "1", sequence: 1, phase: "connect", state: "retryable_failure", code: "retryable" }, true)).toEqual(recovery);
    expect(() => service.reportSetupRecovery(first.row.id, { version: "1", sequence: 0, phase: "connect", state: "retryable_failure", code: "retryable" }, false)).toThrow(/invalid report_setup_recovery/);
    exit({ exitCode: 1 });
    await expect(service.actOnSetupRecovery({ id: first.row.id, capability: "forged", expectedVersion: recovery.version, action: "retry" })).rejects.toThrow(/unauthorized or stale/);
    await expect(service.actOnSetupRecovery({ id: first.row.id, capability: first.recoveryCapability!, expectedVersion: recovery.version + 1, action: "retry" })).rejects.toThrow(/unavailable/);
    const attempts = await Promise.allSettled([
      service.actOnSetupRecovery({ id: first.row.id, capability: first.recoveryCapability!, expectedVersion: recovery.version, action: "retry" }),
      service.actOnSetupRecovery({ id: first.row.id, capability: first.recoveryCapability!, expectedVersion: recovery.version, action: "retry" }),
    ]);
    const succeeded = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof service.actOnSetupRecovery>>> => attempt.status === "fulfilled");
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]?.value).toMatchObject({ row: { purpose: "setup", scopeKind: "bootstrap", projectIdentity: null }, recoveryCapability: expect.any(String) });
    expect(succeeded[0]?.value?.row.id).not.toBe(first.row.id);
    expect(succeeded[0]?.value?.recoveryCapability).not.toBe(first.recoveryCapability);
    await expect(service.actOnSetupRecovery({ id: first.row.id, capability: first.recoveryCapability!, expectedVersion: recovery.version, action: "retry" })).rejects.toThrow(/unauthorized or stale/);
    store.close();
  });

  it("acknowledges only identical producer recovery replays and atomically revokes a stopped session verifier", () => {
    const store = new Store(":memory:");
    store.createNativeSession({ id: "setup-store", purpose: "setup", vendor: "codex", agent: "connect_source", scopeKind: "bootstrap", scopeId: "scope-store" });
    const initial = { sessionId: "setup-store", phase: "connect" as const, state: "retryable_failure" as const, code: "retryable" as const, sequence: 7, decision: null, completionValidated: false };
    const first = store.recordNativeSetupRecovery(initial)!;
    expect(store.recordNativeSetupRecovery({ ...initial, completionValidated: true })).toEqual(first);
    expect(store.recordNativeSetupRecovery({ ...initial, state: "working", code: "in_progress" })).toBeUndefined();
    expect(store.recordNativeSetupRecovery({ ...initial, sequence: 6 })).toBeUndefined();
    store.issueNativeSetupRecoveryAction("setup-store", "recovery-secret");
    expect(store.stopNativeSessionAndRevokeRecoveryAction("setup-store")).toMatchObject({ status: "stopped" });
    expect(store.claimNativeSetupRecoveryAction("setup-store", "recovery-secret", first.version)).toBe(false);
    store.close();
  });

  it("rejects v4 launch artifacts that attempt to reintroduce server-held scope", () => {
    const { dir, binding } = fixture("analysis", "claude");
    const specPath = path.join(dir, ".warble", "interactive-launch.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
    spec.version = "4";
    spec.mcp = { server_name: "genbi_session", credential_env_var: NATIVE_MCP_CREDENTIAL_ENV_VAR };
    expect(() => readNativeLaunchSpec(dir, "analysis", "claude", "fixture-scope", binding, { version: "1", url: "http://127.0.0.1:4787/api/native-sessions/mcp", credential: "credential" })).toThrow(/incompatible/);
  });

  it("revokes issued artifact credentials on PTY exit, initial attachment lease expiry, and creation failure", async () => {
    const materializeV4 = (purpose: "analysis" | "setup" | "context_enrichment", vendor: "claude" | "codex") => async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => writeNativeLaunchSpec(cwd, purpose, vendor, scope, true);
    const exited = fixture("analysis", "codex");
    const exitStore = new Store(":memory:");
    const exitArtifacts = new NativeArtifactService({ store: exitStore, artifactsRoot: path.join(exited.dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => exited.binding });
    const exitIssue = vi.spyOn(exitArtifacts, "issue");
    let exit!: (event: { exitCode: number }) => void;
    const exitPty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) };
    const exitService = new NativeSessionService({ store: exitStore, terminalManager: async () => new InteractiveTerminalManager(exitPty), getBinding: () => exited.binding, workspaceRoot: undefined, irPaths: { analysis: path.join(exited.dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: exitArtifacts, dispatch: materializeV4("analysis", "codex") });
    await exitService.create({ purpose: "analysis", vendor: "codex" });
    const exitCredential = exitIssue.mock.results[0]?.value as { credential: string };
    exit({ exitCode: 1 });
    expect(exitArtifacts.hasCredential(exitCredential.credential)).toBe(false);
    exitStore.close();

    vi.useFakeTimers();
    try {
      const leased = fixture("analysis", "claude");
      const leaseStore = new Store(":memory:");
      const leaseArtifacts = new NativeArtifactService({ store: leaseStore, artifactsRoot: path.join(leased.dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => leased.binding });
      const leaseIssue = vi.spyOn(leaseArtifacts, "issue");
      const idle: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) };
      const leaseService = new NativeSessionService({ store: leaseStore, terminalManager: async () => new InteractiveTerminalManager(idle), getBinding: () => leased.binding, workspaceRoot: undefined, irPaths: { analysis: path.join(leased.dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: leaseArtifacts, dispatch: materializeV4("analysis", "claude") });
      const created = await leaseService.create({ purpose: "analysis", vendor: "claude" });
      const leaseCredential = leaseIssue.mock.results[0]?.value as { credential: string };
      vi.advanceTimersByTime(NATIVE_SESSION_INITIAL_ATTACHMENT_GRACE_MS);
      expect(leaseArtifacts.hasCredential(leaseCredential.credential)).toBe(false);
      leaseStore.close();
    } finally { vi.useRealTimers(); }

    const failed = fixture("analysis", "codex");
    const failedStore = new Store(":memory:");
    const failedArtifacts = new NativeArtifactService({ store: failedStore, artifactsRoot: path.join(failed.dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => failed.binding });
    const failedIssue = vi.spyOn(failedArtifacts, "issue");
    const failedService = new NativeSessionService({ store: failedStore, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => failed.binding, workspaceRoot: undefined, irPaths: { analysis: path.join(failed.dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: failedArtifacts, dispatch: async () => { throw new Error("dispatch failed"); } });
    await expect(failedService.create({ purpose: "analysis", vendor: "codex" })).rejects.toThrow("dispatch failed");
    const failedCredential = failedIssue.mock.results[0]?.value as { credential: string };
    expect(failedArtifacts.hasCredential(failedCredential.credential)).toBe(false);
    failedStore.close();
  });

  it("uses the product idle TTL for navigation detaches and keeps the short never-attached cleanup", async () => {
    vi.useFakeTimers();
    try {
      const initial = fixture("analysis", "codex");
      const initialStore = new Store(":memory:");
      const initialKill = vi.fn();
      const initialService = new NativeSessionService({
        store: initialStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill: initialKill }) }), getBinding: () => initial.binding,
        workspaceRoot: undefined, irPaths: { analysis: path.join(initial.dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
      });
      const neverAttached = await initialService.create({ purpose: "analysis", vendor: "codex" });
      vi.advanceTimersByTime(NATIVE_SESSION_INITIAL_ATTACHMENT_GRACE_MS - 1);
      expect(initialStore.getNativeSession(neverAttached.row.id)).toMatchObject({ status: "running" });
      vi.advanceTimersByTime(1);
      expect(initialStore.getNativeSession(neverAttached.row.id)).toMatchObject({ status: "stopped", failure: "native session attachment timed out" });
      expect(initialKill).toHaveBeenCalledOnce();
      initialStore.close();

      const attached = fixture("analysis", "codex");
      const attachedStore = new Store(":memory:");
      attachedStore.setRuntimeSettings({ ...attachedStore.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
      const attachedKill = vi.fn();
      const attachedService = new NativeSessionService({
        store: attachedStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill: attachedKill }) }), getBinding: () => attached.binding,
        workspaceRoot: undefined, irPaths: { analysis: path.join(attached.dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
      });
      const created = await attachedService.create({ purpose: "analysis", vendor: "codex" });
      expect(attachedService.attach(created.row.id, created.capability!)).toBeDefined();
      attachedService.detach(created.row.id);
      expect(NATIVE_SESSION_IDLE_TTL_MS).toBe(30 * 60_000);
      vi.advanceTimersByTime(NATIVE_SESSION_IDLE_TTL_MS - 1);
      expect(attachedStore.getNativeSession(created.row.id)).toMatchObject({ status: "detached" });
      expect(attachedKill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(attachedStore.getNativeSession(created.row.id)).toMatchObject({ status: "stopped", failure: "native session idle TTL expired" });
      expect(attachedKill).toHaveBeenCalledOnce();
      attachedStore.close();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    ["initial attachment", NATIVE_SESSION_INITIAL_ATTACHMENT_GRACE_MS],
    ["detached attachment", NATIVE_SESSION_POST_CLAIM_DETACH_GRACE_MS],
  ] as const)("failure-safely revokes %s lease capabilities when PTY close throws", async (mode, timeoutMs) => {
    vi.useFakeTimers();
    try {
      const { dir, binding } = fixture("analysis", "codex");
      if (!binding) throw new Error("analysis fixture must be bound");
      const store = new Store(":memory:");
      store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
      const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
      const issue = vi.spyOn(artifacts, "issue");
      const service = new NativeSessionService({
        store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill: () => { throw new Error("kill failed"); } }) }), getBinding: () => binding,
        workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: artifacts,
        dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope, true),
      });
      const created = await service.create({ purpose: "analysis", vendor: "codex" });
      const credential = (issue.mock.results[0]?.value as { credential: string }).credential;
      if (mode === "detached attachment") {
        expect(service.attach(created.row.id, created.capability!)).toBeDefined();
        service.detach(created.row.id);
      }
      const app = createApp({
        store, nativeArtifacts: artifacts,
        route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [] }, trace: { steps: [] } }),
        baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "/fixture/profile", userProject: "/fixture/project", outDir: dir },
      });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        vi.advanceTimersByTime(timeoutMs);
        expect(warning).toHaveBeenCalledWith("[native-sessions] terminal close failed during capability revocation");
      } finally {
        warning.mockRestore();
      }

      expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "stopped" });
      expect(service.runtime(created.row.id)).toBeUndefined();
      expect(service.attach(created.row.id, created.capability!)).toBeUndefined();
      expect(artifacts.hasCredential(credential)).toBe(false);
      for (const body of [
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: NATIVE_MCP_TOOL_NAME, arguments: { version: "1" } } },
      ]) {
        const response = await app.request("/api/native-sessions/mcp", { method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        expect(response.status).toBe(401);
        expect(JSON.stringify(await response.json())).not.toContain(credential);
      }
      store.close();
    } finally { vi.useRealTimers(); }
  });

  it("cancels the post-claim detach grace when the owning browser reattaches", async () => {
    vi.useFakeTimers();
    try {
      const { dir, binding } = fixture("analysis", "claude");
      const store = new Store(":memory:");
      store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
      const kill = vi.fn();
      const service = new NativeSessionService({
        store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill }) }), getBinding: () => binding,
        workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
      });
      const created = await service.create({ purpose: "analysis", vendor: "claude" });
      expect(service.attach(created.row.id, created.capability!)).toBeDefined();
      service.detach(created.row.id);
      vi.advanceTimersByTime(NATIVE_SESSION_POST_CLAIM_DETACH_GRACE_MS - 1);
      expect(service.attach(created.row.id, created.capability!)).toBeDefined();
      vi.advanceTimersByTime(NATIVE_SESSION_POST_CLAIM_DETACH_GRACE_MS + 1);
      expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "running" });
      expect(kill).not.toHaveBeenCalled();
      store.close();
    } finally { vi.useRealTimers(); }
  });

  it("uses a caller-configured idle TTL without changing the short orphan cleanup", async () => {
    vi.useFakeTimers();
    try {
      const { dir, binding } = fixture("analysis", "claude");
      const store = new Store(":memory:");
      store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
      const kill = vi.fn();
      const service = new NativeSessionService({
        store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill }) }), getBinding: () => binding,
        workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", idleTtlMs: 25,
        dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
      });
      const created = await service.create({ purpose: "analysis", vendor: "claude" });
      expect(service.attach(created.row.id, created.capability!)).toBeDefined();
      service.detach(created.row.id);
      vi.advanceTimersByTime(24);
      expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "detached" });
      vi.advanceTimersByTime(1);
      expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "stopped", failure: "native session idle TTL expired" });
      expect(kill).toHaveBeenCalledOnce();
      store.close();
    } finally { vi.useRealTimers(); }
  });

  it("reconciles a stale live row without a process-local PTY before listing or reopening it", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    if (!binding) throw new Error("analysis fixture must be bound");
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => binding,
      workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    const created = await service.create({ purpose: "analysis", vendor: "claude" });

    // A replacement BFF owns the durable DB but not the original process-local
    // PTY/capability. Browser reads must turn this stale "running" row into a
    // restartable stopped row rather than repeatedly offering attach.
    const restartedBff = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => binding,
      workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });

    expect(restartedBff.list()).toEqual([expect.objectContaining({ id: created.row.id, status: "stopped", failure: "native terminal is no longer available for attachment" })]);
    expect(restartedBff.get(created.row.id)).toMatchObject({ status: "stopped" });
    expect(restartedBff.attach(created.row.id, created.capability!)).toBeUndefined();
    await expect(restartedBff.openExisting({ purpose: "analysis", id: created.row.id, vendor: "claude" })).rejects.toThrow("native session is unavailable");
    store.close();
  });

  it("keeps a genuinely detached process-local PTY reconnectable with its retained capability", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    if (!binding) throw new Error("analysis fixture must be bound");
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => binding,
      workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
    });
    const created = await service.create({ purpose: "analysis", vendor: "codex" });
    expect(service.attach(created.row.id, created.capability!)).toBeDefined();
    service.detach(created.row.id);

    expect(service.list()).toEqual([expect.objectContaining({ id: created.row.id, status: "detached" })]);
    expect(service.attach(created.row.id, created.capability!)).toBeDefined();
    expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "running" });
    store.close();
  });

  it.each(["claude", "codex"] as const)("keeps a BFF-restarted %s session restart-only because no sealed resume contract exists", (vendor) => {
    const lifecycle = nativeSessionLifecycle({ status: "interrupted", vendor });
    expect(lifecycle).toEqual({
      liveAction: "restart",
      resumeAvailable: false,
      reason: expect.stringMatching(new RegExp(`${vendor === "claude" ? "Claude" : "Codex"} native launch contract has no sealed provider resume handle`)),
    });
    expect(JSON.stringify(lifecycle)).not.toMatch(/credential|transcript|handle[^ ]*:[^,}]+/i);
  });

  it("resumes an exited Claude conversation through a fresh PTY with exact retained-context argv", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    const state = materializationState(); const store = new Store(":memory:");
    let exit!: (event: { exitCode: number }) => void;
    const spawned: readonly string[][] = [];
    const pty: PtyFactory = { spawn: (_file, args) => {
      (spawned as string[][]).push([...args]);
      return { onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} };
    } };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => binding,
      materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    const first = await service.create({ purpose: "analysis", vendor: "claude" });
    const sessionId = spawned[0]![spawned[0]!.indexOf("--session-id") + 1]!;
    expect(spawned[0]).toEqual(["--session-id", expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    exit({ exitCode: 0 });
    expect(nativeSessionLifecycle(store.getNativeSession(first.row.id)!, service.resumeAvailability(store.getNativeSession(first.row.id)!))).toMatchObject({ liveAction: "resume", resumeAvailable: true });

    const resumed = await service.resume({ id: first.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000120" });
    expect(resumed.row.id).not.toBe(first.row.id);
    expect(spawned[1]).toEqual(["--resume", sessionId]);
    expect(store.hasAvailableNativeSessionResume(first.row.id, "claude")).toBe(false);
    expect(store.hasAvailableNativeSessionResume(resumed.row.id, "claude")).toBe(true);
    expect(JSON.stringify(store.listNativeSessions())).not.toContain(sessionId);
    store.close();
  });

  it("captures only the isolated Codex thread id and resumes that exact conversation", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState(); const store = new Store(":memory:");
    let exit!: (event: { exitCode: number }) => void;
    const spawned: string[][] = [];
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: (_file, args) => {
        spawned.push([...args]);
        return { onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} };
      } }),
      getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
    });
    const first = await service.create({ purpose: "analysis", vendor: "codex" });
    const threadId = "019ff602-3d80-7de2-bd41-8cc46545595d";
    const capture = path.join(state.root, "native", first.row.id, ".warble", "codex-thread-id");
    writeFileSync(capture, `${threadId}\n`, { mode: 0o600 });
    exit({ exitCode: 0 });
    expect(service.resumeAvailable(store.getNativeSession(first.row.id)!)).toBe(true);
    expect(JSON.stringify(store.getNativeSessionResumeHandle(first.row.id))).not.toContain(threadId);

    const resumed = await service.resume({ id: first.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000220" });
    expect(resumed.row.id).not.toBe(first.row.id);
    expect(spawned[1]).toEqual(["--dangerously-bypass-hook-trust", "-c", 'tui.resume_cwd="current"', "resume", threadId]);
    expect(store.hasAvailableNativeSessionResume(first.row.id, "codex")).toBe(false);
    expect(store.hasAvailableNativeSessionResume(resumed.row.id, "codex")).toBe(true);
    store.close();
  });

  it("binds sealed native handles to both the session row and provider", () => {
    const state = materializationState();
    const sourceId = "native-session-00000000-0000-4000-8000-000000000221";
    const otherId = "native-session-00000000-0000-4000-8000-000000000222";
    const handle = "019ff602-3d80-4de2-bd41-8cc46545595d";
    const sealed = sealNativeResumeHandle(state, sourceId, "codex", handle);
    expect(unsealNativeResumeHandle(state, sourceId, "codex", sealed)).toBe(handle);
    expect(() => unsealNativeResumeHandle(state, sourceId, "claude", sealed)).toThrow(/unavailable/);
    expect(() => unsealNativeResumeHandle(state, otherId, "codex", sealed)).toThrow(/unavailable/);
  });

  it("retains a sealed Claude continuation across BFF restart without retaining a PTY or plaintext handle", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    const stateParent = mkdtempSync(path.join(tmpdir(), "genbi-native-resume-restart-")); dirs.push(stateParent);
    const dbPath = path.join(stateParent, "bff.sqlite"); const state = initializeNativeSessionStateBase(dbPath);
    const firstStore = new Store(dbPath);
    const firstService = new NativeSessionService({
      store: firstStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }),
      getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    const created = await firstService.create({ purpose: "analysis", vendor: "claude" });
    expect(JSON.stringify(firstStore.getNativeSessionResumeHandle(created.row.id))).not.toMatch(/^[^{]*[0-9a-f]{8}-/i);
    firstStore.close();

    const restartedStore = new Store(dbPath);
    expect(restartedStore.getNativeSession(created.row.id)).toMatchObject({ status: "interrupted" });
    expect(restartedStore.hasAvailableNativeSessionResume(created.row.id, "claude")).toBe(true);
    const resumedArgs: string[][] = [];
    const resumedService = new NativeSessionService({
      store: restartedStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: (_file, args) => { resumedArgs.push([...args]); return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }; } }),
      getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    await resumedService.resume({ id: created.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000124" });
    expect(resumedArgs[0]).toEqual(["--resume", expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    restartedStore.close();
  });

  it("recovers a reservation-only Claude resume after BFF restart without forking its child", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    const stateParent = mkdtempSync(path.join(tmpdir(), "genbi-native-resume-reservation-")); dirs.push(stateParent);
    const dbPath = path.join(stateParent, "bff.sqlite"); const state = initializeNativeSessionStateBase(dbPath);
    const firstStore = new Store(dbPath);
    const firstArtifacts = new NativeArtifactService({ store: firstStore, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
    const firstIssue = vi.spyOn(firstArtifacts, "issue");
    const firstService = new NativeSessionService({
      store: firstStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }),
      getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      artifactService: firstArtifacts, dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope, true),
    });
    const source = (await firstService.create({ purpose: "analysis", vendor: "claude" })).row;
    const sourceCredential = (firstIssue.mock.results[0]?.value as { credential: string }).credential;
    expect(firstArtifacts.hasCredential(sourceCredential)).toBe(true);
    const sourceHandle = firstStore.getNativeSessionResumeHandle(source.id)!;
    const plaintextHandle = unsealNativeClaudeResumeHandle(state, source.id, sourceHandle.sealedHandle);
    const childId = "native-session-00000000-0000-4000-8000-000000000199";
    const scopeFingerprint = createHash("sha256").update(JSON.stringify([
      source.id, source.purpose, source.vendor, source.scopeKind, source.projectIdentity,
      source.bindingGeneration, source.projectRevision, source.dispatchProfile,
      source.dispatchTarget, source.runtimeGeneration,
    ])).digest("hex");
    const reserved = firstStore.reserveNativeSessionResume({
      sourceSessionId: source.id, idempotencyKey: "00000000-0000-4000-8000-000000000199", scopeFingerprint,
      sealedHandle: sealNativeClaudeResumeHandle(state, childId, plaintextHandle),
      child: {
        id: childId, purpose: source.purpose, vendor: "claude", agent: source.agent, scopeKind: source.scopeKind, scopeId: "native-scope-00000000-0000-4000-8000-000000000199",
        ...(source.dispatchProfile !== null ? { dispatchProfile: source.dispatchProfile } : {}),
        ...(source.dispatchTarget !== null ? { dispatchTarget: source.dispatchTarget } : {}),
        ...(source.runtimeGeneration !== null ? { runtimeGeneration: source.runtimeGeneration } : {}),
        ...(source.projectIdentity !== null ? { projectIdentity: source.projectIdentity } : {}),
        ...(source.bindingGeneration !== null ? { bindingGeneration: source.bindingGeneration } : {}),
        ...(source.projectRevision !== null ? { projectRevision: source.projectRevision } : {}),
      },
    });
    expect(reserved).toMatchObject({ row: { id: childId, status: "creating" }, created: true });
    // A BFF crash loses all process-local MCP authority. Make that boundary
    // explicit instead of allowing this test's old service object to retain it.
    firstArtifacts.dispose();
    expect(firstArtifacts.hasCredential(sourceCredential)).toBe(false);
    firstStore.close();

    const restartedStore = new Store(dbPath);
    const resumedArgs: string[][] = [];
    const resumedArtifacts = new NativeArtifactService({ store: restartedStore, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
    const resumedIssue = vi.spyOn(resumedArtifacts, "issue");
    const resumedService = new NativeSessionService({
      store: restartedStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: (_file, args) => { resumedArgs.push([...args]); return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }; } }),
      getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      artifactService: resumedArtifacts, dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope, true),
    });
    const recoveredLaunch = resumedService.resume({ id: source.id, idempotencyKey: "00000000-0000-4000-8000-000000000199" });
    const replayLaunch = resumedService.resume({ id: source.id, idempotencyKey: "00000000-0000-4000-8000-000000000199" });
    const [recovered, replayed] = await Promise.all([recoveredLaunch, replayLaunch]);
    expect(recovered).toMatchObject({ row: { id: childId, status: "running" }, capability: expect.any(String) });
    expect(replayed).toEqual(recovered);
    expect(resumedArgs).toEqual([["--resume", plaintextHandle, welcomeFor("analysis")]]);
    const resumedCredential = (resumedIssue.mock.results[0]?.value as { credential: string }).credential;
    expect(resumedCredential).not.toBe(sourceCredential);
    expect(resumedArtifacts.hasCredential(sourceCredential)).toBe(false);
    expect(resumedArtifacts.hasCredential(resumedCredential)).toBe(true);
    expect(restartedStore.listNativeSessions()).toHaveLength(2);
    await expect(resumedService.resume({ id: source.id, idempotencyKey: "00000000-0000-4000-8000-000000000199" })).resolves.toMatchObject({ row: { id: childId } });
    expect(resumedArgs).toHaveLength(1);
    expect(resumedService.stop(childId, recovered.capability!)).toBe(true);
    expect(resumedArtifacts.hasCredential(resumedCredential)).toBe(false);
    restartedStore.close();
  });

  it("keeps the exact Claude continuation available after attachment, idle-TTL stop, and resume", async () => {
    vi.useFakeTimers();
    try {
      const { dir, binding } = fixture("analysis", "claude");
      const state = materializationState(); const store = new Store(":memory:");
      store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
      let exit!: (event: { exitCode: number }) => void;
      const spawned: string[][] = [];
      const service = new NativeSessionService({
        store, terminalManager: async () => new InteractiveTerminalManager({ spawn: (_file, args) => { spawned.push([...args]); return { onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }; } }),
        getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
        irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
        dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
      });
      const first = await service.create({ purpose: "analysis", vendor: "claude" });
      const providerId = spawned[0]![spawned[0]!.indexOf("--session-id") + 1]!;
      expect(service.attach(first.row.id, first.capability!)).toBeDefined();
      service.detach(first.row.id);
      vi.advanceTimersByTime(NATIVE_SESSION_IDLE_TTL_MS);
      expect(store.getNativeSession(first.row.id)).toMatchObject({ status: "stopped", failure: "native session idle TTL expired" });
      const resumed = await service.resume({ id: first.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000198" });
      expect(resumed.capability).toEqual(expect.any(String));
      expect(spawned[1]).toEqual(["--resume", providerId]);
      expect(exit).toEqual(expect.any(Function));
      store.close();
    } finally { vi.useRealTimers(); }
  });

  it("projects Resume as Restart on lifecycle GET after Runtime or project-binding drift", async () => {
    const responseLifecycle = async (app: ReturnType<typeof createApp>, id: string) =>
      (await (await app.request(`/api/native-sessions/${id}`)).json() as { session: { lifecycle: { liveAction: string; resumeAvailable: boolean; reason?: string } } }).session.lifecycle;
    const appFor = (store: Store, nativeSessions: NativeSessionService, dir: string) => createApp({
      store,
      route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [] }, trace: { steps: [] } }),
      baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: dir, outDir: dir },
      nativeSessions,
    });
    const runtimeFixture = fixture("analysis", "claude");
    const runtimeState = materializationState(); const runtimeStore = new Store(":memory:");
    let runtimeExit!: (event: { exitCode: number }) => void;
    const runtimeService = new NativeSessionService({
      store: runtimeStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { runtimeExit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) }),
      getBinding: () => runtimeFixture.binding, materializationState: runtimeState, workspaceRoot: undefined,
      irPaths: { analysis: path.join(runtimeFixture.dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    const runtimeSource = await runtimeService.create({ purpose: "analysis", vendor: "claude" });
    runtimeExit({ exitCode: 0 });
    const runtimeApp = appFor(runtimeStore, runtimeService, runtimeFixture.dir);
    await expect(responseLifecycle(runtimeApp, runtimeSource.row.id)).resolves.toMatchObject({ liveAction: "resume", resumeAvailable: true });
    runtimeStore.setRuntimeSettings({ ...runtimeStore.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const runtimeDrifted = await responseLifecycle(runtimeApp, runtimeSource.row.id);
    expect(runtimeDrifted).toMatchObject({ liveAction: "restart", resumeAvailable: false });
    expect(runtimeDrifted.reason).toMatch(/project this session was bound to has changed/i);
    expect(runtimeDrifted.reason).not.toMatch(/handle/i);
    runtimeStore.close();

    const bindingFixture = fixture("analysis", "claude");
    const bindingState = materializationState(); const bindingStore = new Store(":memory:");
    bindingStore.setRuntimeSettings({ ...bindingStore.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
    let currentBinding = bindingFixture.binding;
    let bindingExit!: (event: { exitCode: number }) => void;
    const bindingService = new NativeSessionService({
      store: bindingStore, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { bindingExit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) }),
      getBinding: () => currentBinding, materializationState: bindingState, workspaceRoot: undefined,
      irPaths: { analysis: path.join(bindingFixture.dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    const bindingSource = await bindingService.create({ purpose: "analysis" });
    bindingExit({ exitCode: 0 });
    const bindingApp = appFor(bindingStore, bindingService, bindingFixture.dir);
    await expect(responseLifecycle(bindingApp, bindingSource.row.id)).resolves.toMatchObject({ liveAction: "resume", resumeAvailable: true });
    // The fixture that actually distinguishes scope_stale from no_resume_handle: the
    // sealed handle stays present through the drift below, so a reason blaming a
    // missing handle would be false. Only the bound project changing is true here.
    expect(bindingStore.hasAvailableNativeSessionResume(bindingSource.row.id, "claude")).toBe(true);
    currentBinding = { ...currentBinding!, generation: currentBinding!.generation + 1, revision: "sha256:drifted" };
    expect(bindingStore.hasAvailableNativeSessionResume(bindingSource.row.id, "claude")).toBe(true);
    const bindingDrifted = await responseLifecycle(bindingApp, bindingSource.row.id);
    expect(bindingDrifted).toMatchObject({ liveAction: "restart", resumeAvailable: false });
    expect(bindingDrifted.reason).toMatch(/project this session was bound to has changed/i);
    expect(bindingDrifted.reason).not.toMatch(/handle/i);
    bindingStore.close();
  });

  it("distinguishes a Runtime settings correction from a missing resume handle", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    const state = materializationState(); const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "default", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
    let exit!: (event: { exitCode: number }) => void;
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) }),
      getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    const created = await service.create({ purpose: "analysis", vendor: "claude" });
    exit({ exitCode: 0 });
    const row = store.getNativeSession(created.row.id)!;
    expect(service.resumeAvailability(row)).toMatchObject({ available: true });

    // Same provider (claude) as launch, so this is a Runtime *settings* correction,
    // not a project/provider drift: only the tier alias becomes invalid.
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "default" }] });
    expect(store.hasAvailableNativeSessionResume(row.id, "claude")).toBe(true);
    const availability = service.resumeAvailability(row);
    expect(availability).toMatchObject({ available: false, cause: "runtime_settings_correction" });
    const lifecycle = nativeSessionLifecycle(row, availability);
    expect(lifecycle.reason).toMatch(/runtime settings need a correction in setup/i);
    expect(lifecycle.reason).not.toMatch(/handle/i);
    store.close();
  });

  it("distinguishes an unavailable workspace from a missing resume handle", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    const state = materializationState(); const store = new Store(":memory:");
    let exit!: (event: { exitCode: number }) => void;
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) }),
      getBinding: () => binding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "claude", scope),
    });
    const created = await service.create({ purpose: "analysis", vendor: "claude" });
    exit({ exitCode: 0 });
    const row = store.getNativeSession(created.row.id)!;
    expect(service.resumeAvailability(row)).toMatchObject({ available: true });

    // Delete the bound project directory itself, leaving the scope fence (identity/
    // generation/revision) untouched and the sealed handle still present.
    rmSync(dir, { recursive: true, force: true });
    expect(store.hasAvailableNativeSessionResume(row.id, "claude")).toBe(true);
    const availability = service.resumeAvailability(row);
    expect(availability).toMatchObject({ available: false, cause: "workspace_unavailable" });
    const lifecycle = nativeSessionLifecycle(row, availability);
    expect(lifecycle.reason).toMatch(/workspace this claude session used is no longer available/i);
    expect(lifecycle.reason).not.toMatch(/handle/i);
    expect(lifecycle.reason).not.toContain(dir);
    store.close();
  });

  it("fails closed on a swapped sealed Claude handle, concurrent resume, and a failed child launch", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    const state = materializationState(); const store = new Store(":memory:");
    let exits: Array<(event: { exitCode: number }) => void> = [];
    let launches = 0;
    let currentBinding = binding;
    const pty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { exits.push(listener); return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => currentBinding, materializationState: state, workspaceRoot: undefined,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => { launches += 1; if (launches === 4) throw new Error("child launch failed"); writeNativeLaunchSpec(cwd, "analysis", "claude", scope); },
    });
    const first = await service.create({ purpose: "analysis", vendor: "claude" });
    const second = await service.create({ purpose: "analysis", vendor: "claude" });
    exits[0]!({ exitCode: 0 }); exits[1]!({ exitCode: 0 });
    const firstHandle = store.getNativeSessionResumeHandle(first.row.id)!;
    store.saveNativeSessionResumeHandle(second.row.id, "claude", firstHandle.sealedHandle);
    await expect(service.resume({ id: second.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000121" })).rejects.toThrow(/resume handle is unavailable/);
    expect(store.hasAvailableNativeSessionResume(second.row.id, "claude")).toBe(false);

    const changed = await service.create({ purpose: "analysis", vendor: "claude" });
    exits[2]!({ exitCode: 0 });
    currentBinding = { ...binding!, revision: "sha256:changed" };
    await expect(service.resume({ id: changed.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000125" })).rejects.toThrow(/Runtime or project binding changed/);
    expect(store.hasAvailableNativeSessionResume(changed.row.id, "claude")).toBe(false);
    currentBinding = binding;

    const one = service.resume({ id: first.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000122" });
    const two = service.resume({ id: first.row.id, idempotencyKey: "00000000-0000-4000-8000-000000000123" });
    await expect(one).rejects.toThrow(/child launch failed/);
    await expect(two).rejects.toThrow(/resume is unavailable/);
    const child = store.listNativeSessions().find((row) => row.id !== first.row.id && row.id !== second.row.id)!;
    expect(store.hasAvailableNativeSessionResume(child.id, "claude")).toBe(false);
    store.close();
  });

  it("restarts with a new isolated launch and rotates the in-memory MCP credential", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    if (!binding) throw new Error("analysis fixture must be bound");
    const state = materializationState();
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
    const issued = vi.spyOn(artifacts, "issue");
    const spawn = vi.fn(() => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }));
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn }), getBinding: () => binding,
      workspaceRoot: undefined, materializationState: state, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: artifacts,
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope, true),
    });
    const first = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000101" });
    expect(service.stop(first.row.id, first.capability!)).toBe(true);
    const restarted = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000102" });
    // Models a BFF-success/browser-response-loss retry: the same client action
    // must recover the original replacement, not create another PTY/root/MCP credential.
    const retried = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000102" });
    const firstCredential = (issued.mock.results[0]?.value as { credential: string }).credential;
    const restartedCredential = (issued.mock.results[1]?.value as { credential: string }).credential;
    expect(restarted.row.id).not.toBe(first.row.id);
    expect(retried).toEqual(restarted);
    expect(restartedCredential).not.toBe(firstCredential);
    expect(store.listNativeSessions()).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(issued).toHaveBeenCalledTimes(2);
    expect(readdirSync(path.join(state.root, "native")).sort()).toEqual([first.row.id, restarted.row.id].sort());
    expect(service.attach(retried.row.id, retried.capability!)).toBeDefined();
    expect(artifacts.hasCredential(restartedCredential)).toBe(true);
    expect(JSON.stringify(store.listNativeSessions())).not.toContain(firstCredential);
    expect(JSON.stringify(store.listNativeSessions())).not.toContain(restartedCredential);
    expect(service.stop(restarted.row.id, restarted.capability!)).toBe(true);
    expect(artifacts.hasCredential(firstCredential)).toBe(false);
    expect(artifacts.hasCredential(restartedCredential)).toBe(false);
    store.close();
  });

  it("redacts a stale lost-response action after binding rotation, then launches exactly one current-scope replacement with a fresh UUID", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    if (!binding) throw new Error("analysis fixture must be bound");
    const state = materializationState();
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    let currentBinding = store.activateEnrichmentBinding(binding);
    const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => currentBinding });
    const issued = vi.spyOn(artifacts, "issue");
    const spawn = vi.fn(() => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }));
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn }), getBinding: () => currentBinding,
      workspaceRoot: undefined, materializationState: state, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: artifacts,
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope, true),
    });
    const app = createApp({
      store,
      route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [] }, trace: { steps: [] } }),
      baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: dir, outDir: dir },
      nativeSessions: service,
    });
    const staleKey = "00000000-0000-4000-8000-000000000111";
    const firstResponse = await app.request("/api/native-sessions", { method: "POST", body: JSON.stringify({ purpose: "analysis", intent: "start_separate", idempotencyKey: staleKey }) });
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json() as { session: { id: string } }).session;
    const firstCredential = (issued.mock.results[0]?.value as { credential: string }).credential;

    // The durable row is now historical while the BFF still retains the
    // completed response for the old action key. This is the response-loss /
    // binding-rotation seam the browser must recover from without auto-looping.
    const rotated = store.activateEnrichmentBindingAndRevokeBoundNativeSessions({ path: dir, identity: binding.identity, revision: `${currentBinding.revision}-next` });
    currentBinding = rotated.binding;
    expect(store.getNativeSession(first.id)).toMatchObject({ status: "stopped", bindingGeneration: 1, projectRevision: binding.revision });

    const staleResponse = await app.request("/api/native-sessions", { method: "POST", body: JSON.stringify({ purpose: "analysis", intent: "start_separate", idempotencyKey: staleKey }) });
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toEqual({ error: "native session launch failed", code: "native_session_launch_action_stale" });

    service.revokeBindingCapabilities(rotated.revokedNativeSessionIds);
    const freshResponse = await app.request("/api/native-sessions", { method: "POST", body: JSON.stringify({ purpose: "analysis", intent: "start_separate", idempotencyKey: "00000000-0000-4000-8000-000000000112" }) });
    expect(freshResponse.status).toBe(201);
    const freshBody = await freshResponse.json() as { session: { id: string }; capability: string };
    const fresh = freshBody.session;
    const freshCredential = (issued.mock.results[1]?.value as { credential: string }).credential;

    expect(fresh.id).not.toBe(first.id);
    expect(store.listNativeSessions()).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(issued).toHaveBeenCalledTimes(2);
    expect(readdirSync(path.join(state.root, "native")).sort()).toEqual([first.id, fresh.id].sort());
    expect(artifacts.hasCredential(firstCredential)).toBe(false);
    expect(artifacts.hasCredential(freshCredential)).toBe(true);
    expect(service.attach(fresh.id, freshBody.capability)).toBeDefined();
    expect(JSON.stringify(store.listNativeSessions())).not.toContain(firstCredential);
    expect(JSON.stringify(store.listNativeSessions())).not.toContain(freshCredential);
    store.close();
  });

  it("preserves the runtime-switch stop state when the revoked PTY later exits", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    let exit = (_event: { exitCode: number }) => {};
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { exit = listener; return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) }), getBinding: () => binding,
      workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
    });
    const created = await service.openOrCreate({ purpose: "analysis" });
    const revoked = store.setRuntimeSettingsAndRevokeIncompatibleNativeSessions({ ...store.getRuntimeSettings(), subscriptionProvider: "claude" });
    service.revokeRuntimeCapabilities(revoked);
    exit({ exitCode: 9 });
    expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "stopped", failure: "native runtime binding changed" });
    store.close();
  });

  it.each(["claude", "codex"] as const)("uses the producer-owned v4 discovery seam for %s and revokes its credential on stop", async (vendor) => {
    const { dir, binding } = fixture("analysis", vendor);
    const state = materializationState();
    const store = new Store(":memory:");
    const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
    const spawn = vi.fn((_file: "claude" | "codex", _args: readonly string[], _options: { cwd: string; cols: number; rows: number; env?: NodeJS.ProcessEnv }) => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }));
    let issuedCredential = "";
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn }), getBinding: () => binding,
      workspaceRoot: undefined, materializationState: state, irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: artifacts,
      dispatch: async ({ cwd, scope, mcp }) => {
        const descriptor = mcp as { version: string; url: string; credential: string };
        expect(descriptor).toMatchObject({ version: "1", url: "http://127.0.0.1:4787/api/native-sessions/mcp", credential: expect.any(String) });
        issuedCredential = descriptor.credential;
        writeNativeLaunchSpec(cwd, "analysis", vendor, scope, true);
      },
    });

    const created = await service.create({ purpose: "analysis", vendor });
    const materializationRoot = path.join(state.root, "native", created.row.id);
    expect(readNativeLaunchSpec(materializationRoot, "analysis", vendor, created.row.scopeId, binding, { version: "1", url: "http://127.0.0.1:4787/api/native-sessions/mcp", credential: issuedCredential }, state)).toMatchObject({ version: "4" });
    const spawnOptions = spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    expect(spawn.mock.calls[0]?.[1]).toEqual(vendor === "codex"
      ? ["--dangerously-bypass-hook-trust", welcomeFor("analysis")]
      : ["--session-id", expect.stringMatching(/^[0-9a-f-]{36}$/), welcomeFor("analysis")]);
    expect(spawnOptions.env?.[NATIVE_MCP_CREDENTIAL_ENV_VAR]).toBe(issuedCredential);
    expect(artifacts.hasCredential(issuedCredential)).toBe(true);
    expect(service.stop(created.row.id, created.capability!)).toBe(true);
    expect(artifacts.hasCredential(issuedCredential)).toBe(false);
    store.close();
  });

  it("stops project-scoped terminals and revokes their MCP bearer when the binding rotates", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    if (!binding) throw new Error("analysis fixture must be bound");
    const state = materializationState();
    const store = new Store(":memory:");
    let currentBinding = store.activateEnrichmentBinding(binding);
    const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => currentBinding });
    const issue = vi.spyOn(artifacts, "issue");
    const kill = vi.fn();
    const service = new NativeSessionService({
      store,
      terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill }) }),
      getBinding: () => currentBinding, workspaceRoot: undefined, materializationState: state,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: artifacts,
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope, true),
    });
    const created = await service.create({ purpose: "analysis", vendor: "codex" });
    const credential = (issue.mock.results[0]?.value as { credential: string }).credential;
    const rotated = store.activateEnrichmentBindingAndRevokeBoundNativeSessions({ path: dir, identity: binding.identity, revision: `${currentBinding.revision}-next` });
    currentBinding = rotated.binding;
    service.revokeBindingCapabilities(rotated.revokedNativeSessionIds);

    expect(rotated.revokedNativeSessionIds).toEqual([created.row.id]);
    expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "stopped", failure: "native project binding changed" });
    expect(artifacts.hasCredential(credential)).toBe(false);
    expect(kill).toHaveBeenCalledOnce();
    store.close();
  });

  it("revokes every stale capability even if the first terminal close throws", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    if (!binding) throw new Error("analysis fixture must be bound");
    const state = materializationState();
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const artifacts = new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
    const issue = vi.spyOn(artifacts, "issue");
    const secondKill = vi.fn();
    let spawned = 0;
    const service = new NativeSessionService({
      store,
      terminalManager: async () => new InteractiveTerminalManager({ spawn: () => {
        spawned += 1;
        return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill: spawned === 1 ? () => { throw new Error("kill failed"); } : secondKill };
      } }),
      getBinding: () => binding, workspaceRoot: undefined, materializationState: state,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", artifactService: artifacts,
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope, true),
    });
    const first = await service.create({ purpose: "analysis", vendor: "codex" });
    const second = await service.create({ purpose: "analysis", vendor: "codex" });
    const firstCredential = (issue.mock.results[0]?.value as { credential: string }).credential;
    const secondCredential = (issue.mock.results[1]?.value as { credential: string }).credential;
    const revoked = store.activateEnrichmentBindingAndRevokeBoundNativeSessions({ path: dir, identity: binding.identity, revision: binding.revision });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(service.attach(first.row.id, first.capability!)).toBeUndefined();
      service.revokeBindingCapabilities(revoked.revokedNativeSessionIds);
      expect(warning).toHaveBeenCalledWith("[native-sessions] terminal close failed during capability revocation");
    } finally {
      warning.mockRestore();
    }

    expect(new Set(revoked.revokedNativeSessionIds)).toEqual(new Set([first.row.id, second.row.id]));
    expect(service.runtime(first.row.id)).toBeUndefined();
    expect(service.runtime(second.row.id)).toBeUndefined();
    expect(service.attach(first.row.id, first.capability!)).toBeUndefined();
    expect(service.attach(second.row.id, second.capability!)).toBeUndefined();
    expect(artifacts.hasCredential(firstCredential)).toBe(false);
    expect(artifacts.hasCredential(secondCredential)).toBe(false);
    expect(secondKill).toHaveBeenCalledOnce();
    store.close();
  });

  it.each(["claude", "codex"] as const)("passes exact separate v2/v4 producer descriptors to the real process seam for %s and cleans them on success and failure", async (vendor) => {
    const success = fixture("analysis", vendor);
    const successState = materializationState();
    writeFileSync(path.join(success.dir, "analysis.json"), "{}");
    const successStore = new Store(":memory:");
    const externalDataRoot = mkdtempSync(path.join(tmpdir(), "genbi-native-data-")); dirs.push(externalDataRoot);
    const successArtifacts = new NativeArtifactService({ store: successStore, artifactsRoot: path.join(success.dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => success.binding });
    const issued = vi.spyOn(successArtifacts, "issue");
    const idle: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) };
    const codexAttestation = vendor === "codex" ? fakeCodexAttestation() : {};
    const successService = new NativeSessionService({
      store: successStore, terminalManager: async () => new InteractiveTerminalManager(idle), getBinding: () => success.binding,
      workspaceRoot: undefined, materializationState: successState, irPaths: { analysis: path.join(success.dir, "analysis.json"), setup: undefined, context_enrichment: undefined },
      warbleBin: fakeV4Producer(success.dir), artifactService: successArtifacts,
      ...codexAttestation,
      prepareCodexWrenHome: ({ cwd }) => {
        const home = path.join(cwd, ".wren");
        mkdirSync(home);
        writeFileSync(path.join(home, "profiles.yml"), "active: fixture\nprofiles:\n  fixture:\n    datasource: duckdb\n");
        return { home, dataRoots: [externalDataRoot] };
      },
    });
    const created = await successService.create({ purpose: "analysis", vendor });
    const descriptor = issued.mock.results[0]?.value as { version: "1"; url: string; credential: string };
    const successRoot = path.join(successState.root, "native", created.row.id);
    const observed = JSON.parse(readFileSync(path.join(successRoot, ".warble", "fake-producer-observation.json"), "utf8")) as Record<string, unknown>;
    expect(observed).toMatchObject({ scopeKeys: vendor === "codex" ? ["binding", "cwd", "entry", "kind", "scope_id", "version", "wren_runtime"] : ["binding", "cwd", "entry", "kind", "scope_id", "version"], mcpKeys: ["credential", "url", "version"], scopeMode: 0o600, mcpMode: 0o600, descriptorExact: true, hasNativeMcp: true, argvContainsCredential: false, credentialMatches: true });
    expect(existsSync(String(observed.scopePath))).toBe(false);
    expect(existsSync(String(observed.mcpPath))).toBe(false);
    expect(existsSync(String(observed.discovery))).toBe(true);
    if (vendor === "codex") {
      const permissions = readFileSync(path.join(successRoot, ".codex", "config.toml"), "utf8");
      expect(permissions).toContain(`${JSON.stringify(realpathSync(success.binding!.path))} = "read"`);
      expect(permissions).toContain(`${JSON.stringify(realpathSync(externalDataRoot))} = "read"`);
    }
    expect(readNativeLaunchSpec(successRoot, "analysis", vendor, created.row.scopeId, success.binding, descriptor, successState)).toMatchObject({ version: "4" });
    expect(JSON.stringify({ observed, row: created.row })).not.toContain(descriptor.credential);
    successStore.close();

    const failure = fixture("context_enrichment", vendor);
    const failureState = materializationState();
    writeFileSync(path.join(failure.dir, "enrich.json"), "{}");
    const failureStore = new Store(":memory:");
    const failureArtifacts = new NativeArtifactService({ store: failureStore, artifactsRoot: path.join(failure.dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => failure.binding });
    const failedIssue = vi.spyOn(failureArtifacts, "issue");
    const failureService = new NativeSessionService({
      store: failureStore, terminalManager: async () => new InteractiveTerminalManager(idle), getBinding: () => failure.binding,
      workspaceRoot: undefined, materializationState: failureState, irPaths: { analysis: undefined, setup: undefined, context_enrichment: path.join(failure.dir, "enrich.json") },
      warbleBin: fakeV4Producer(failure.dir), artifactService: failureArtifacts,
    });
    await expect(failureService.create({ purpose: "context_enrichment", vendor })).rejects.toThrow(/materialization failed/);
    const failedDescriptor = failedIssue.mock.results[0]?.value as { credential: string };
    const failureRoot = path.join(failureState.root, "native", failureService.list()[0]!.id);
    const failedObserved = JSON.parse(readFileSync(path.join(failureRoot, ".warble", "fake-producer-observation.json"), "utf8")) as Record<string, unknown>;
    expect(existsSync(String(failedObserved.scopePath))).toBe(false);
    expect(existsSync(String(failedObserved.mcpPath))).toBe(false);
    expect(failureArtifacts.hasCredential(failedDescriptor.credential)).toBe(false);
    failureStore.close();
  });

  it("coalesces duplicate start-separate actions while keeping independent launch actions distinct", async () => {
    const setup = fixture("setup", "codex");
    const store = new Store(":memory:");
    let releaseDispatch!: () => void;
    const dispatchGate = new Promise<void>((resolve) => { releaseDispatch = resolve; });
    const dispatch = vi.fn(async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => {
      writeNativeLaunchSpec(cwd, "setup", "codex", scope);
      await dispatchGate;
    });
    const spawn = vi.fn(() => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }));
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn }), getBinding: () => undefined,
      workspaceRoot: setup.dir, irPaths: { analysis: undefined, setup: path.join(setup.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch,
    });
    const first = service.startSeparate({ purpose: "setup", vendor: "codex", idempotencyKey: "00000000-0000-4000-8000-000000000010" });
    const second = service.startSeparate({ purpose: "setup", vendor: "codex", idempotencyKey: "00000000-0000-4000-8000-000000000010" });
    expect(dispatch).toHaveBeenCalledTimes(1);
    releaseDispatch();
    await expect(Promise.all([first, second])).resolves.toMatchObject([{ row: { id: expect.any(String) } }, { row: { id: expect.any(String) } }]);
    const [one, two] = await Promise.all([first, second]);
    expect(two).toEqual(one); expect(spawn).toHaveBeenCalledTimes(1);
    await expect(service.startSeparate({ purpose: "setup", vendor: "codex", idempotencyKey: "00000000-0000-4000-8000-000000000010" })).resolves.toEqual(one);
    expect(dispatch).toHaveBeenCalledTimes(1);

    const third = await service.startSeparate({ purpose: "setup", vendor: "codex", idempotencyKey: "00000000-0000-4000-8000-000000000011" });
    expect(third.row.id).not.toBe(one.row.id);
    expect(spawn).toHaveBeenCalledTimes(2);

    const rejected = new NativeSessionService({
      store: new Store(":memory:"), terminalManager: async () => new InteractiveTerminalManager({ spawn }), getBinding: () => undefined,
      workspaceRoot: setup.dir, irPaths: { analysis: undefined, setup: path.join(setup.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch: vi.fn().mockRejectedValueOnce(new Error("fail")).mockImplementation(async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => {
        writeNativeLaunchSpec(cwd, "setup", "codex", scope);
      }),
    });
    const failed = await rejected.startSeparate({ purpose: "setup", vendor: "codex", idempotencyKey: "00000000-0000-4000-8000-000000000012" });
    expect(failed).toMatchObject({ row: { status: "failed" }, recoveryCapability: expect.any(String) });
    await expect(rejected.startSeparate({ purpose: "setup", vendor: "codex", idempotencyKey: "00000000-0000-4000-8000-000000000012" })).resolves.toEqual(failed);
    await expect(rejected.startSeparate({ purpose: "setup", vendor: "codex", idempotencyKey: "00000000-0000-4000-8000-000000000013" })).resolves.toMatchObject({ row: { status: "running" } });
    store.close();
  });

  it("expires and fences settled start-separate deliveries before they can reuse stale authority", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState();
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    let currentBinding = binding!;
    const dispatch = vi.fn(async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope));
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => currentBinding,
      workspaceRoot: undefined, materializationState: state,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", dispatch,
      startSeparateReplayTtlMs: 10, startSeparateReplayLimit: 1,
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      const first = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000020" });
      await expect(service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000020" })).resolves.toEqual(first);
      expect(dispatch).toHaveBeenCalledTimes(1);
      await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000021" });
      const afterCapacityEviction = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000020" });
      expect(afterCapacityEviction.row.id).not.toBe(first.row.id);
      expect(dispatch).toHaveBeenCalledTimes(3);

      currentBinding = { ...currentBinding, generation: currentBinding.generation + 1, revision: "sha256:replacement" };
      await expect(service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000020" })).rejects.toThrow(/launch action is stale/);
      currentBinding = binding!;
      clock.mockReturnValue(111);
      const expired = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000020" });
      expect(expired.row.id).not.toBe(afterCapacityEviction.row.id);
      expect(expired.capability).not.toBe(afterCapacityEviction.capability);
      expect(dispatch).toHaveBeenCalledTimes(4);
      expect(service.stop(expired.row.id, expired.capability!)).toBe(true);
      const afterStop = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000020" });
      expect(afterStop.row.id).not.toBe(expired.row.id);
      expect(dispatch).toHaveBeenCalledTimes(5);
    } finally { clock.mockRestore(); store.close(); }
  });

  it("opens only the exact live row in the current bound scope", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState();
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    let currentBinding = binding!;
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => currentBinding,
      workspaceRoot: undefined, materializationState: state,
      irPaths: { analysis: path.join(dir, "analysis.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused",
      dispatch: async ({ cwd, scope }) => writeNativeLaunchSpec(cwd, "analysis", "codex", scope),
    });
    const first = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000030" });
    const second = await service.startSeparate({ purpose: "analysis", idempotencyKey: "00000000-0000-4000-8000-000000000031" });
    await expect(service.openExisting({ purpose: "analysis", id: second.row.id })).resolves.toEqual(second);
    await expect(service.openExisting({ purpose: "analysis", id: first.row.id })).resolves.toEqual(first);
    currentBinding = { ...currentBinding, generation: currentBinding.generation + 1, revision: "sha256:replacement" };
    await expect(service.openExisting({ purpose: "analysis", id: second.row.id })).rejects.toThrow(/unavailable/);
    store.close();
  });

  it("marks a bound session stale when binding changes while terminal manager resolution is pending", async () => {
    const context = fixture("context_enrichment", "claude");
    let binding = context.binding!;
    const store = new Store(":memory:");
    let releaseManager!: (manager: InteractiveTerminalManager) => void;
    const managerGate = new Promise<InteractiveTerminalManager>((resolve) => { releaseManager = resolve; });
    const spawn = vi.fn(() => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }));
    const service = new NativeSessionService({
      store, terminalManager: async () => managerGate, getBinding: () => binding,
      workspaceRoot: undefined, irPaths: { analysis: undefined, setup: undefined, context_enrichment: path.join(context.dir, "enrich.json") }, warbleBin: "unused", dispatch: async ({ cwd, scope }) => {
        writeNativeLaunchSpec(cwd, "context_enrichment", "claude", scope);
      },
    });
    const launch = service.create({ purpose: "context_enrichment", vendor: "claude" });
    await Promise.resolve();
    binding = { ...binding, generation: 8, revision: "sha256:changed" };
    releaseManager(new InteractiveTerminalManager({ spawn }));
    await expect(launch).rejects.toThrow(/bound project changed/);
    expect(spawn).not.toHaveBeenCalled();
    expect(service.list()[0]).toMatchObject({ status: "stale", failure: "native session binding changed before PTY launch" });
    store.close();
  });

  it("opens Setup only in the bootstrap workspace, never the current bound project", async () => {
    const bootstrap = fixture("setup", "claude");
    const unrelated = fixture("context_enrichment", "claude");
    const store = new Store(":memory:");
    let observed: { cwd: string; scope: Record<string, unknown> } | undefined;
    const dispatch = vi.fn(async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => {
      observed = { cwd, scope };
      writeNativeLaunchSpec(cwd, "setup", "claude", scope);
    });
    const idlePty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(idlePty), getBinding: () => unrelated.binding,
      workspaceRoot: bootstrap.dir, irPaths: { analysis: undefined, setup: path.join(bootstrap.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch,
    });
    const first = await service.openOrCreate({ purpose: "setup", vendor: "claude" });
    const reopened = await service.openOrCreate({ purpose: "setup", vendor: "claude" });
    expect(reopened).toEqual(first);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(observed).toMatchObject({ cwd: expect.stringContaining(`${path.sep}.genbi-native-state-`), scope: { kind: "bootstrap", cwd: expect.stringContaining(`${path.sep}.genbi-native-state-`), bootstrap_root: realpathSync(bootstrap.dir) } });
    expect(observed?.scope).not.toHaveProperty("binding");
    expect(first.row).toMatchObject({ purpose: "setup", scopeKind: "bootstrap", projectIdentity: null, bindingGeneration: null, projectRevision: null });
    store.close();
  });

  it("reopens Context only for its exact canonical binding generation and revision", async () => {
    const context = fixture("context_enrichment", "codex");
    let binding = context.binding!;
    const store = new Store(":memory:");
    const dispatch = vi.fn(async ({ cwd, scope }: { cwd: string; scope: Record<string, unknown> }) => {
      writeNativeLaunchSpec(cwd, "context_enrichment", "codex", scope);
    });
    const idlePty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(idlePty), getBinding: () => binding,
      workspaceRoot: undefined, irPaths: { analysis: undefined, setup: undefined, context_enrichment: path.join(context.dir, "enrich.json") }, warbleBin: "unused", dispatch,
    });
    const first = await service.openOrCreate({ purpose: "context_enrichment", vendor: "codex" });
    expect(await service.openOrCreate({ purpose: "context_enrichment", vendor: "codex" })).toEqual(first);
    binding = { ...binding, generation: 8, revision: "sha256:next" };
    const next = await service.openOrCreate({ purpose: "context_enrichment", vendor: "codex" });
    expect(next.row.id).not.toBe(first.row.id);
    expect(next.row).toMatchObject({ projectIdentity: "fixture-project", bindingGeneration: 8, projectRevision: "sha256:next" });
    expect(dispatch).toHaveBeenCalledTimes(2);
    store.close();
  });

  it("reports bootstrap Setup independently from bound-project purposes", async () => {
    const { dir } = fixture("setup", "claude");
    writeFileSync(path.join(dir, "setup.json"), "{}");
    const store = new Store(":memory:");
    const service = new NativeSessionService({
      store, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => undefined,
      workspaceRoot: dir, irPaths: { analysis: path.join(dir, "analysis.json"), setup: path.join(dir, "setup.json"), context_enrichment: path.join(dir, "enrich.json") }, warbleBin: "unused",
      terminalHostAvailable: async () => true, executableAvailable: () => true, producerAvailable: () => true,
    });
    await expect(service.readiness()).resolves.toEqual({
      analysis: { scopeKind: "bound_project", available: false, reason: "native sessions require a current bound project", vendors: { claude: { available: false, reason: "native sessions require a current bound project" }, codex: { available: false, reason: "native sessions require a current bound project" } } },
      setup: { scopeKind: "bootstrap", available: true, vendors: { claude: { available: true }, codex: { available: true } } },
      context_enrichment: { scopeKind: "bound_project", available: false, reason: "native sessions require a current bound project", vendors: { claude: { available: false, reason: "native sessions require a current bound project" }, codex: { available: false, reason: "native sessions require a current bound project" } } },
    });
    store.close();
  });

  it("reports unavailable terminal hosts and vendor executables without exposing launch details", async () => {
    const { dir, binding } = fixture("analysis", "claude");
    const store = new Store(":memory:");
    const options: NativeSessionServiceOptions = {
      store, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => binding,
      workspaceRoot: dir, irPaths: { analysis: path.join(dir, "analysis.json"), setup: path.join(dir, "setup.json"), context_enrichment: path.join(dir, "enrich.json") }, warbleBin: "unused",
      terminalHostAvailable: async () => false, executableAvailable: (vendor) => vendor === "codex", producerAvailable: () => true, dispatch: async () => {},
    };
    const service = new NativeSessionService(options);
    const hostUnavailable = await service.readiness();
    expect(hostUnavailable.analysis).toMatchObject({ available: false, vendors: { claude: { available: false, reason: "native terminal host cannot spawn local processes on this machine" }, codex: { available: false, reason: "native terminal host cannot spawn local processes on this machine" } } });
    const executableUnavailable = new NativeSessionService({ ...options, terminalHostAvailable: async () => true });
    await expect(executableUnavailable.readiness()).resolves.toMatchObject({ analysis: { available: true, vendors: { claude: { available: false, reason: "the claude interactive CLI is not available on this machine" }, codex: { available: true } } } });
    store.close();
  });

  it("marks a BFF-restarted process as restart-only in the browser-safe lifecycle projection", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "genbi-native-db-")), "state.sqlite"); dirs.push(path.dirname(file));
    const store = new Store(file);
    store.createNativeSession({ id: "native-1", purpose: "analysis", vendor: "codex", agent: "genbi-analysis", scopeKind: "bound_project", scopeId: "scope-1", projectIdentity: "project", bindingGeneration: 4, projectRevision: "sha256:r" });
    store.transitionNativeSession("native-1", "running", { started: true });
    expect(store.getNativeSession("native-1")).toMatchObject({ status: "running", projectIdentity: "project", bindingGeneration: 4 });
    // The public row has no transcript, input, capability, command, cwd, or environment field.
    expect(JSON.stringify(store.getNativeSession("native-1"))).not.toMatch(/transcript|capability|argv|cwd|environment/i);
    store.close();
    const reopened = new Store(file);
    expect(reopened.getNativeSession("native-1")).toMatchObject({ status: "interrupted", failure: "native session interrupted by BFF restart" });
    const app = createApp({
      store: reopened,
      route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [] }, trace: { steps: [] } }),
      baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: path.dirname(file), outDir: path.dirname(file) },
      nativeSessions: { list: () => reopened.listNativeSessions(), get: (id: string) => reopened.getNativeSession(id) } as never,
    });
    const response = await app.request("/api/native-sessions");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessions: [{ id: "native-1", status: "interrupted", lifecycle: { liveAction: "restart", resumeAvailable: false, reason: expect.stringContaining("no sealed provider resume handle") } }] });
    reopened.close();
  });

  it("records a bounded launch failure rather than leaving a creating row", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const state = materializationState();
    writeFileSync(path.join(dir, "missing-ir.json"), "{}");
    const store = new Store(":memory:");
    const service = new NativeSessionService({ store, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => binding, workspaceRoot: undefined, materializationState: state, irPaths: { analysis: path.join(dir, "missing-ir.json"), setup: undefined, context_enrichment: undefined }, warbleBin: path.join(dir, "missing-warble") });
    await expect(service.create({ purpose: "analysis", vendor: "codex" })).rejects.toThrow(/producer is incompatible/);
    expect(service.list()).toEqual([]);
    store.close();
  });

  it("returns a durable failed Setup row with only its browser recovery capability", async () => {
    const { dir } = fixture("setup", "codex");
    const store = new Store(":memory:");
    const service = new NativeSessionService({
      store, terminalManager: async () => { throw new Error("not reached"); }, getBinding: () => undefined,
      workspaceRoot: dir, irPaths: { analysis: undefined, setup: path.join(dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch: async () => { throw new Error("dispatch failed"); },
    });
    const failed = await service.openOrCreate({ purpose: "setup", vendor: "codex" });
    expect(failed).toMatchObject({ row: { purpose: "setup", status: "failed", failure: "native session launch failed" }, recoveryCapability: expect.any(String) });
    expect(failed.capability).toBeUndefined();
    expect(JSON.stringify(failed.row)).not.toMatch(/terminal|credential|transcript|capability/i);
    await expect(service.actOnSetupRecovery({ id: failed.row.id, capability: failed.recoveryCapability!, expectedVersion: 0, action: "retry" })).resolves.toMatchObject({ row: { purpose: "setup", status: "failed" }, recoveryCapability: expect.any(String) });
    store.close();
  });

  it("revokes Setup recovery after a normal PTY Stop", async () => {
    const setup = fixture("setup", "codex");
    const store = new Store(":memory:");
    const pty: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) };
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager(pty), getBinding: () => undefined,
      workspaceRoot: setup.dir, irPaths: { analysis: undefined, setup: path.join(setup.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch: async ({ cwd, scope }) => {
        writeNativeLaunchSpec(cwd, "setup", "codex", scope);
      },
    });
    const created = await service.openOrCreate({ purpose: "setup", vendor: "codex" });
    expect(service.stop(created.row.id, created.capability!)).toBe(true);
    expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "stopped" });
    await expect(service.actOnSetupRecovery({ id: created.row.id, capability: created.recoveryCapability!, expectedVersion: 0, action: "retry" })).rejects.toThrow(/unavailable/);
    store.close();
  });

  it("does not resurrect an immediately exited PTY as running", async () => {
    const { dir, binding } = fixture("analysis", "codex");
    const store = new Store(":memory:");
    const fastExit: PtyFactory = { spawn: () => ({ onData: () => ({ dispose() {} }), onExit: (listener) => { listener({ exitCode: 17 }); return { dispose() {} }; }, write() {}, resize() {}, kill() {} }) };
    const service = new NativeSessionService({ store, terminalManager: async () => new InteractiveTerminalManager(fastExit), getBinding: () => binding, workspaceRoot: undefined, irPaths: { analysis: path.join(dir, "ir.json"), setup: undefined, context_enrichment: undefined }, warbleBin: "unused", dispatch: async ({ cwd, scope }) => {
      writeNativeLaunchSpec(cwd, "analysis", "codex", scope);
    } });
    const created = await service.create({ purpose: "analysis", vendor: "codex" });
    expect(created.row).toMatchObject({ status: "exited", exitCode: 17 });
    expect(service.runtime(created.row.id)).toBeUndefined();
    expect(store.getNativeSession(created.row.id)).toMatchObject({ status: "exited", exitCode: 17 });
    store.close();
  });
  it.each([
    ["claude", "claude-code:interactive", "genbi-setup", "setup"],
    ["claude", "claude-code:interactive", "genbi-default", "analysis"],
    ["claude", "claude-code:interactive", "genbi-enrich-context", "context_enrichment"],
    ["codex", "codex:interactive", "genbi-setup", "setup"],
    ["codex", "codex:interactive", "genbi-default", "analysis"],
    ["codex", "codex:interactive", "genbi-enrich-context", "context_enrichment"],
  ] as const)("derives %s Runtime target for %s without browser vendor input", async (provider, target, profile, purpose) => {
    const { dir, binding } = fixture(purpose, provider);
    const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: provider, subscriptionDriverModel: "driver", tierModels: provider === "claude" ? [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] : [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }] });
    const service = new NativeSessionService({
      store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }),
      getBinding: () => binding, workspaceRoot: purpose === "setup" ? dir : undefined,
      irPaths: { analysis: purpose === "analysis" ? path.join(dir, "analysis.json") : undefined, setup: purpose === "setup" ? path.join(dir, "setup.json") : undefined, context_enrichment: purpose === "context_enrichment" ? path.join(dir, "enrich.json") : undefined },
      warbleBin: "unused", executableAvailable: () => true, dispatch: async ({ cwd, scope }) => {
        writeNativeLaunchSpec(cwd, purpose, provider, scope, true);
        expect(scope).toMatchObject({ kind: purpose === "setup" ? "bootstrap" : "bound_project" });
      }, artifactService: new NativeArtifactService({ store, artifactsRoot: path.join(dir, "artifacts"), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding }),
    });
    const readiness = await service.readiness();
    expect(readiness.runtime).toMatchObject({ configured: true, provider, target });
    expect(readiness.purposes[purpose]).toMatchObject({ profile, target, available: true });
    const created = await service.openOrCreate({ purpose });
    expect(created.row).toMatchObject({ purpose, vendor: provider, dispatchProfile: profile, dispatchTarget: target, runtimeGeneration: readiness.runtime.generation });
    store.close();
  });

  it("fails closed while Runtime is seeded or reset and rejects a stale materialization after a switch", async () => {
    const setup = fixture("setup", "claude"); const store = new Store(":memory:");
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    const service = new NativeSessionService({ store, terminalManager: async () => new InteractiveTerminalManager({ spawn: () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} }) }), getBinding: () => undefined, workspaceRoot: setup.dir, irPaths: { analysis: undefined, setup: path.join(setup.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch: async () => { await held; } });
    await expect(service.openOrCreate({ purpose: "setup" })).rejects.toThrow(/saved Runtime/);
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
    const pending = service.openOrCreate({ purpose: "setup" });
    await Promise.resolve();
    const revoked = store.setRuntimeSettingsAndRevokeIncompatibleNativeSessions({ ...store.getRuntimeSettings(), subscriptionProvider: "codex" });
    service.revokeRuntimeCapabilities(revoked); release();
    await expect(pending).resolves.toMatchObject({ row: { status: "stale", failure: "native runtime binding changed before launch" } });
    expect(store.getNativeRuntimeBinding()).toMatchObject({ provider: "codex", target: "codex:interactive" });
    store.resetSetup();
    await expect(service.openOrCreate({ purpose: "setup" })).rejects.toThrow(/saved Runtime/);
    store.close();
  });

  it("does not start a pending Setup PTY after Runtime reset revokes its captured binding", async () => {
    const setup = fixture("setup", "claude"); const store = new Store(":memory:");
    store.setRuntimeSettings({ ...store.getRuntimeSettings(), subscriptionProvider: "claude", subscriptionDriverModel: "driver", tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "sonnet" }] });
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    const terminalManager = vi.fn(async () => ({ start: vi.fn() }));
    const service = new NativeSessionService({ store, terminalManager: terminalManager as never, getBinding: () => undefined, workspaceRoot: setup.dir, irPaths: { analysis: undefined, setup: path.join(setup.dir, "setup.json"), context_enrichment: undefined }, warbleBin: "unused", dispatch: async () => { await held; } });
    const pending = service.openOrCreate({ purpose: "setup" });
    await Promise.resolve();
    store.resetSetup();
    release();
    await expect(pending).resolves.toMatchObject({ row: { status: "stale", failure: "native runtime binding changed before launch" } });
    expect(terminalManager).not.toHaveBeenCalled();
    store.close();
  });
});

describe("native launch-spec v2/v4", () => {
  for (const purpose of ["analysis", "setup", "context_enrichment"] as const) {
    for (const vendor of ["claude", "codex"] as const) {
      it(`accepts only server-selected ${purpose}/${vendor} launch data`, () => {
        const { dir, binding } = fixture(purpose, vendor);
        expect(readNativeLaunchSpec(dir, purpose, vendor, "fixture-scope", binding)).toMatchObject({ version: "2", target: vendor === "claude" ? "claude-code:interactive" : "codex:interactive" });
      });
    }
  }
  it("rejects changed argv, agent, scope, and binding before a PTY can launch", () => {
    const { dir, binding } = fixture("analysis", "claude");
    const specPath = path.join(dir, ".warble", "interactive-launch.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
    spec.argv = ["--agent", "answer_query", "--unsafe"];
    writeFileSync(specPath, JSON.stringify(spec));
    expect(() => readNativeLaunchSpec(dir, "analysis", "claude", "fixture-scope", binding)).toThrow(/incompatible/);
  });
  it("accepts the exact Claude analysis v4 scope-entry contract", () => {
    const { dir, binding } = fixture("analysis", "claude");
    writeNativeLaunchSpec(dir, "analysis", "claude", { kind: "bound_project", scope_id: "fixture-scope", binding: { project_identity: binding!.identity, generation: String(binding!.generation), revision: binding!.revision } }, true);
    expect(readNativeLaunchSpec(dir, "analysis", "claude", "fixture-scope", binding, { version: "1", url: NATIVE_MCP_URL, credential: "credential" })).toMatchObject({
      version: "4",
      argv: [welcomeFor("analysis")],
    });
  });
  // The pair below and above used to point the other way: analysis was pinned, so a scope-entry
  // spec was the stale one to refuse. Analysis now declares scope entry, so a PINNED spec is what
  // a stale producer would emit. The property being guarded is unchanged and is not about which
  // form is wider: this host accepts exactly the shape it declared and refuses the other, so a
  // producer and host that disagree can never launch something neither of them chose.
  it("rejects stale pinned Claude analysis v4 output instead of launching an undeclared driver", () => {
    const { dir, binding } = fixture("analysis", "claude");
    writeNativeLaunchSpec(dir, "analysis", "claude", { kind: "bound_project", scope_id: "fixture-scope", binding: { project_identity: binding!.identity, generation: String(binding!.generation), revision: binding!.revision } }, true);
    const specPath = path.join(dir, ".warble", "interactive-launch.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
    spec.argv = ["--agent", "answer_query", welcomeFor("analysis")];
    spec.agent = { kind: "claude_agent", name: "answer_query" };
    writeFileSync(specPath, JSON.stringify(spec));
    expect(() => readNativeLaunchSpec(dir, "analysis", "claude", "fixture-scope", binding, { version: "1", url: NATIVE_MCP_URL, credential: "credential" })).toThrow(/incompatible/);
  });
  it.each([
    ["setup", "claude", "answer_query"],
    ["context_enrichment", "claude", "answer_query"],
    ["analysis", "codex", "genbi-setup"],
    ["setup", "codex", "genbi-analysis"],
    ["context_enrichment", "codex", "genbi-analysis"],
  ] as const)("rejects a cross-purpose %s/%s driver or skill before launch", (purpose, vendor, overgrantedAgent) => {
    const { dir, binding } = fixture(purpose, vendor);
    const scope = purpose === "setup"
      ? { kind: "bootstrap", scope_id: "fixture-scope", bootstrap_root: realpathSync(path.dirname(dir)) }
      : { kind: "bound_project", scope_id: "fixture-scope", binding: { project_identity: binding!.identity, generation: String(binding!.generation), revision: binding!.revision } };
    writeNativeLaunchSpec(dir, purpose, vendor, scope, true);
    const specPath = path.join(dir, ".warble", "interactive-launch.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
    spec.agent = { kind: vendor === "claude" ? "claude_agent" : "codex_skill", name: overgrantedAgent };
    if (vendor === "claude") spec.argv = ["--agent", overgrantedAgent, welcomeFor(purpose)];
    writeFileSync(specPath, JSON.stringify(spec));
    expect(() => readNativeLaunchSpec(dir, purpose, vendor, "fixture-scope", binding, { version: "1", url: NATIVE_MCP_URL, credential: "credential" }, undefined, purpose === "setup" ? realpathSync(path.dirname(dir)) : undefined)).toThrow(/incompatible/);
  });
  it("rejects a browser-shaped v4 welcome argv before a PTY can launch", () => {
    const { dir, binding } = fixture("analysis", "claude");
    writeNativeLaunchSpec(dir, "analysis", "claude", { kind: "bound_project", scope_id: "fixture-scope", binding: { project_identity: binding!.identity, generation: String(binding!.generation), revision: binding!.revision } }, true);
    const specPath = path.join(dir, ".warble", "interactive-launch.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
    spec.argv = ["browser supplied prompt"];
    writeFileSync(specPath, JSON.stringify(spec));
    expect(() => readNativeLaunchSpec(dir, "analysis", "claude", "fixture-scope", binding, { version: "1", url: NATIVE_MCP_URL, credential: "credential" })).toThrow(/incompatible/);
  });
  it.each(["claude", "codex"] as const)("rejects an unsealed %s resume field rather than inventing a vendor restart contract", (vendor) => {
    const { dir, binding } = fixture("analysis", vendor);
    writeNativeLaunchSpec(dir, "analysis", vendor, { kind: "bound_project", scope_id: "fixture-scope", binding: { project_identity: binding!.identity, generation: String(binding!.generation), revision: binding!.revision } }, true);
    const specPath = path.join(dir, ".warble", "interactive-launch.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
    spec.resume = { handle: "caller-supplied" };
    writeFileSync(specPath, JSON.stringify(spec));
    expect(() => readNativeLaunchSpec(dir, "analysis", vendor, "fixture-scope", binding, { version: "1", url: NATIVE_MCP_URL, credential: "credential" })).toThrow(/incompatible/);
  });
  for (const mutate of [
    (spec: Record<string, unknown>) => { (spec.agent as Record<string, unknown>).extra = true; },
    (spec: Record<string, unknown>) => { (spec.scope as Record<string, unknown>).extra = true; },
    (spec: Record<string, unknown>) => { ((spec.scope as Record<string, unknown>).binding as Record<string, unknown>).extra = true; },
  ]) {
    it("rejects unknown nested agent/scope/binding fields before launch", () => {
      const { dir, binding } = fixture("analysis", "claude");
      const specPath = path.join(dir, ".warble", "interactive-launch.json");
      const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
      mutate(spec); writeFileSync(specPath, JSON.stringify(spec));
      expect(() => readNativeLaunchSpec(dir, "analysis", "claude", "fixture-scope", binding)).toThrow(/incompatible/);
    });
  }
  it("rejects an unknown v4 MCP field instead of admitting a producer-selected tool grant", () => {
    const { dir, binding } = fixture("analysis", "claude");
    writeNativeLaunchSpec(dir, "analysis", "claude", { kind: "bound_project", scope_id: "fixture-scope", binding: { project_identity: binding!.identity, generation: String(binding!.generation), revision: binding!.revision } }, true);
    const specPath = path.join(dir, ".warble", "interactive-launch.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
    (spec.mcp as Record<string, unknown>).tool = "persist_answer";
    writeFileSync(specPath, JSON.stringify(spec));
    expect(() => readNativeLaunchSpec(dir, "analysis", "claude", "fixture-scope", binding, { version: "1", url: NATIVE_MCP_URL, credential: "credential" })).toThrow(/incompatible/);
  });
});
