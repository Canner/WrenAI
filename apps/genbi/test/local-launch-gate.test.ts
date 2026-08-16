import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveExclusiveLaunchMode } from "../server/launch-attestation.js";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import { readLocalLaunchAttestationPublic } from "../vite.config.js";
import { HARNESS_SUPPORT } from "../harness/bundle/version.js";
// @ts-expect-error The operator-facing verifier intentionally stays plain Node ESM.
import { verifyLive, verifyLocalLaunch } from "../scripts/verify-local-launch.mjs";

const dirs: string[] = [];
const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const verifier = path.join(packageRoot, "scripts", "verify-local-launch.mjs");
const uiStarter = path.join(packageRoot, "scripts", "start-ui-gated.mjs");
const bffVerifier = path.join(packageRoot, "scripts", "verify-bff-attestation.mjs");
const bffStarter = path.join(packageRoot, "scripts", "start-bff-gated.mjs");
const digest = "a".repeat(64);

function attestationFixture() {
  const publicValue = {
    version: "genbi-launch-attestation/v1" as const,
    mode: "bootstrap" as const,
    genbi: { rootDigest: digest, commit: "abc123", treeIdentity: digest },
    warble: { rootDigest: digest, commit: "def456", treeIdentity: digest, binarySha256: digest, runtimeInputs: { profileTreeSha256: digest, setupIrSha256: digest, enrichIrSha256: digest, analysisIrSha256: digest } },
    runtime: { mode: "subscription" as const, provider: "claude" as const, dispatcher: "claude-agent-sdk" as const, agentSdkSha256: digest },
    bff: { entrySha256: digest, closureSha256: digest },
    ui: { rootDigest: digest, commit: "abc123", treeIdentity: digest },
  };
  return { publicValue, fullValue: { ...publicValue, local: { genbiRoot: "/private/genbi", warbleRoot: "/private/warble", warbleBin: "/private/warble/bin", agentSdkBin: "/private/warble/agent-sdk", profile: "/private/warble/profile", setupIr: "/private/warble/setup.json", enrichIr: "/private/warble/enrich.json", analysisIr: "/private/warble/analysis.json", modeInput: "/private/workspace" } } };
}

const runtimeBindingRequiredReason = 'native sessions require a saved Runtime & authentication binding';

function readinessFixture(mode: 'bootstrap' | 'bound' = 'bootstrap') {
  const configured = mode === 'bound';
  const runtime = configured
    ? { configured: true, generation: 2, provider: 'claude', target: 'claude-code:interactive', targetLabel: 'Claude CLI' }
    : { configured: false, generation: 0 };
  const purpose = (scopeKind: 'bootstrap' | 'bound_project', profile: string) => ({
    scopeKind,
    profile,
    ...(configured ? { target: 'claude-code:interactive', targetLabel: 'Claude CLI' } : {}),
    available: configured && scopeKind === 'bound_project',
    ...(!configured ? { reason: runtimeBindingRequiredReason } : scopeKind === 'bootstrap' ? { reason: 'native setup sessions require a workspace root' } : {}),
    vendors: {},
    producer: { available: true },
  });
  return {
    runtime,
    purposes: {
      analysis: purpose('bound_project', 'genbi-default'),
      setup: purpose('bootstrap', 'genbi-setup'),
      context_enrichment: purpose('bound_project', 'genbi-enrich-context'),
    },
    mcp: { server: 'GenBI MCP', tool: 'save_dashboard', destination: 'GenBI Artifacts', available: false, reason: 'GenBI MCP is not configured' },
  };
}

async function listen(handler: (url: string) => unknown) {
  const server = createServer((request, response) => {
    const value = handler(request.url ?? "/");
    if (typeof value === "string") { response.setHeader("content-type", "text/html"); response.end(value); }
    else { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
  return { server, url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function hashTree(root: string): string {
  const digest = createHash("sha256");
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(directory, entry.name); const relative = path.relative(root, candidate);
      if (relative === "local-launch-attestation.json") continue;
      if (entry.isDirectory()) visit(candidate); else if (entry.isFile()) { digest.update(relative); digest.update("\0"); digest.update(readFileSync(candidate)); }
    }
  };
  visit(root); return digest.digest("hex");
}

function fixture(mode: "compatible" | "bad-launch" = "compatible", dispatcher: "compatible" | "old-verb" | "malformed" | "incompatible-ir" = "compatible") {
  const root = mkdtempSync(path.join(os.tmpdir(), "genbi-local-launch-gate-"));
  dirs.push(root);
  const warble = path.join(root, "warble");
  mkdirSync(path.join(warble, "genbi-default"), { recursive: true });
  mkdirSync(path.join(warble, "genbi-setup"));
  mkdirSync(path.join(warble, "genbi-enrich-context"));
  writeFileSync(path.join(warble, "genbi-default", "ir.golden.json"), "{}");
  writeFileSync(path.join(warble, "genbi-setup", "ir.golden.json"), "{}");
  writeFileSync(path.join(warble, "genbi-enrich-context", "ir.golden.json"), "{}");
  const bin = path.join(warble, "warble");
  const agentSdk = path.join(warble, "warble-agent-sdk");
  const staleAgentSdk = path.join(warble, "warble-agent-sdk-stale");
  // "incompatible-ir" simulates a Warble checkout whose Vercel dispatcher emits a compat
  // window that excludes the harness's currently-declared HARNESS_SUPPORT.irVersion — the
  // exact live defect this fixture exists to catch. Every other case emits a window that
  // matches the harness's own declared version, so this fixture fixture stays correct
  // automatically as HARNESS_SUPPORT.irVersion moves forward.
  const vercelIrVersion = dispatcher === "incompatible-ir" ? "0.1" : HARNESS_SUPPORT.irVersion;
  const vercelBundle = JSON.stringify({
    vercel_bundle_version: "0.1",
    compat: { min_ir_version: vercelIrVersion, max_ir_version: vercelIrVersion },
    profile: "genbi-default",
    target: "vercel:headless",
    agents: [],
  });
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
if (args.includes('--help')) { console.log('dispatch\\n--target\\n--purpose\\n--native-scope\\n--native-mcp\\n--out'); process.exit(0); }
if (args[0] === 'compile') {
  writeFileSync(value('-o'), JSON.stringify({ components: [{ llm_calls: [{ tier: 'cheap' }, { tier: 'strong' }] }] }));
  process.exit(0);
}
if (args[0] !== 'dispatch') process.exit(2);
const target = value('--target'); const out = value('--out');
mkdirSync(out, { recursive: true });
if (target === 'vercel') { appendFileSync(${JSON.stringify(path.join(root, "vercel-providers.log"))}, value('--provider') + '\\n'); writeFileSync(path.join(out, 'bundle.json'), ${JSON.stringify(vercelBundle)}); process.exit(0); }
const purpose = value('--purpose'); const vendor = target.startsWith('claude') ? 'claude' : 'codex';
const scope = JSON.parse(readFileSync(value('--native-scope'), 'utf8'));
if (vendor === 'codex' && !scope.wren_runtime) process.exit(71);
if (vendor === 'claude' && Object.hasOwn(scope, 'wren_runtime')) process.exit(72);
if (scope.version !== '2' || scope.cwd !== out || (purpose === 'setup' && (typeof scope.bootstrap_root !== 'string' || scope.bootstrap_root === out))) process.exit(73);
const agent = purpose === 'analysis' ? 'answer_query' : purpose === 'setup' ? 'connect_source' : 'draft_enrichment';
const profile = purpose === 'analysis' ? 'genbi-default' : purpose === 'setup' ? 'genbi-setup' : 'genbi-enrich-context';
const scopeEntry = false;
const welcome = purpose === 'setup'
  ? 'Help me set up this GenBI project. Start by explaining the next setup step and ask what data source I want to connect.'
  : purpose === 'analysis'
    ? 'Help me analyze this data. Ask me what question I want to answer about the server-bound project.'
    : "Help me inspect this project's context and draft a read-only enrichment proposal. Do not apply changes; ask what context I want to review.";
writeFileSync(path.join(out, 'RUN.md'), 'handoff'); mkdirSync(path.join(out, '.warble'));
writeFileSync(path.join(out, '.warble', 'interactive-launch.json'), JSON.stringify({
  version: '4', target, purpose, executable: vendor === 'claude' ? 'claude' : 'codex',
  argv: scopeEntry ? [welcome] : vendor === 'claude' ? ['--agent', agent, welcome] : [welcome],
  agent: scopeEntry
    ? { kind: 'claude_scope', name: ${JSON.stringify(mode)} === 'bad-launch' ? 'wrong' : profile }
    : { kind: vendor === 'claude' ? 'claude_agent' : 'codex_skill', name: ${JSON.stringify(mode)} === 'bad-launch' ? 'wrong' : vendor === 'claude' ? agent : 'genbi-' + (purpose === 'context_enrichment' ? 'enrich-context' : purpose) },
  mcp: { server_name: 'genbi_session', credential_env_var: 'WARBLE_MCP_CONNECTION_CREDENTIAL' },
  ...(purpose === 'setup' ? { bootstrap_root: scope.bootstrap_root } : {}),
  cwd: out, artifact_root: out, handoff_path: path.join(out, 'RUN.md'),
}));
if (vendor === 'codex') {
  mkdirSync(path.join(out, '.codex'), { recursive: true });
  writeFileSync(path.join(out, '.codex', 'config.toml'), 'default_permissions = "warble_native_wren"\\n\\n[permissions.warble_native_wren.filesystem]\\n":minimal" = "read"\\n\\n[permissions.warble_native_wren.filesystem.":workspace_roots"]\\n"." = "write"\\n');
}
`);
  chmodSync(bin, 0o700);
  writeFileSync(agentSdk, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(${JSON.stringify(dispatcher === "old-verb" ? "usage: warble-agent-sdk dispatch-ask" : "usage: warble-agent-sdk manifest")}); process.exit(0); }
if (args[0] === 'chat' && args.includes('apply_enrichment')) { process.stderr.write('context_write_authz: unavailable\\n'); process.exit(1); }
if (${JSON.stringify(dispatcher)} === 'old-verb' || args[0] !== 'manifest') process.exit(21);
if (${JSON.stringify(dispatcher)} === 'malformed') { process.stdout.write('{not-json}\\n'); process.exit(0); }
if (!args.includes('--include-unavailable')) { process.stderr.write('context_write_authz: unavailable\\n'); process.exit(1); }
const ir = args[1] ?? '';
const profile = ir.includes('genbi-setup') ? 'genbi-setup' : ir.includes('genbi-enrich-context') ? 'genbi-enrich-context' : 'genbi-default';
const available = (id) => ({ id, verb: id, steps: [{ name: 'step' }], guardrails: { fixed: {} }, tools: [{ name: 'tool' }], output_schema: { type: 'object' }, capabilities: [{ capability: 'read' }] });
const agents = profile === 'genbi-enrich-context'
  ? [available('inspect_context'), available('draft_enrichment'), { id: 'apply_enrichment', verb: 'apply_enrichment', steps: [], guardrails: {}, tools: [], output_schema: {}, capabilities: [], availability: { status: 'unavailable', reason: 'component is unavailable on the configured runtime' } }]
  : [available('agent')];
process.stdout.write(JSON.stringify({ manifest_version: '0.1', target: 'claude-agent-sdk:local', profile, agents }) + '\\n');
`);
  chmodSync(agentSdk, 0o700);
  writeFileSync(staleAgentSdk, "#!/bin/sh\necho stale dispatcher\n"); chmodSync(staleAgentSdk, 0o700);
  for (const args of [["init"], ["config", "user.email", "fixture@example.test"], ["config", "user.name", "fixture"], ["add", "."], ["commit", "-m", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: warble, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return { root, warble, bin, agentSdk, staleAgentSdk };
}

function run(args: string[], env: Record<string, string> = {}) {
  const warbleRoot = args[args.indexOf("--warble-root") + 1]!;
  return spawnSync(process.execPath, [verifier, ...args, "--runtime", "subscription:claude", "--agent-sdk-bin", path.join(warbleRoot, "warble-agent-sdk")], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test", ...env } });
}

function gateOptions(options: Record<string, unknown>, warble: string) {
  return { ...options, runtime: "subscription:claude", agentSdkBin: path.join(warble, "warble-agent-sdk") };
}

afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("local GenBI launch gate", () => {
  it("projects a closed path-free attestation through BFF and Vite readers", async () => {
    const { publicValue, fullValue } = attestationFixture();
    const app = createApp({ store: new Store(":memory:"), baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: "/fixture/project" }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), launchAttestation: fullValue as never });
    const bff = await app.request("/api/local-launch-attestation");
    expect(bff.status).toBe(200);
    expect(await bff.json()).toEqual(publicValue);
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "genbi-public-attestation-")), "attestation.json"); dirs.push(path.dirname(file)); writeFileSync(file, JSON.stringify(fullValue));
    expect(readLocalLaunchAttestationPublic(file)).toEqual(publicValue);
    expect(JSON.stringify(readLocalLaunchAttestationPublic(file))).not.toContain("/private/");
  });

  it("fails closed on an extra attestation field instead of exposing it from BFF or Vite", async () => {
    const { publicValue, fullValue } = attestationFixture();
    const malformed = { ...fullValue, extra: "/private/extra" };
    const app = createApp({ store: new Store(":memory:"), baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: "/fixture/project" }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), launchAttestation: malformed as never });
    const bff = await app.request("/api/local-launch-attestation");
    expect(bff.status).toBe(503);
    expect(JSON.stringify(await bff.json())).not.toContain("/private/");
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "genbi-public-attestation-")), "attestation.json"); dirs.push(path.dirname(file)); writeFileSync(file, JSON.stringify(malformed));
    expect(() => readLocalLaunchAttestationPublic(file)).toThrow("public shape is invalid");
    expect(publicValue).not.toHaveProperty("local");
  });

  it("verifyLive accepts only the truthful fresh bootstrap Runtime tuple", async () => {
    const { publicValue, fullValue } = attestationFixture();
    const readiness = readinessFixture();
    const bff = await listen((url) => url === "/api/local-launch-attestation" ? publicValue : readiness);
    const ui = await listen((url) => url === "/_genbi/local-launch-attestation" ? publicValue : '<div id="root"></div>');
    try {
      await expect(verifyLive({ mode: "bootstrap", bffUrl: bff.url, uiUrl: ui.url }, { attestation: { public: publicValue } })).resolves.toMatchObject({ requiredPurposes: [] });
    } finally { await bff.close(); await ui.close(); }
    const leakedBff = await listen((url) => url === "/api/local-launch-attestation" ? fullValue : readiness);
    const leakedUi = await listen((url) => url === "/_genbi/local-launch-attestation" ? fullValue : '<div id="root"></div>');
    try {
      await expect(verifyLive({ mode: "bootstrap", bffUrl: leakedBff.url, uiUrl: leakedUi.url }, { attestation: { public: publicValue } })).rejects.toThrow("selected public tuple");
    } finally { await leakedBff.close(); await leakedUi.close(); }
    const publicBff = await listen((url) => url === "/api/local-launch-attestation" ? publicValue : readiness);
    const uiOnlyLeak = await listen((url) => url === "/_genbi/local-launch-attestation" ? fullValue : '<div id="root"></div>');
    try {
      await expect(verifyLive({ mode: "bootstrap", bffUrl: publicBff.url, uiUrl: uiOnlyLeak.url }, { attestation: { public: publicValue } })).rejects.toThrow("selected public tuple");
    } finally { await publicBff.close(); await uiOnlyLeak.close(); }
  });

  it("rejects configured, malformed, wrong-reason, and producer-incompatible bootstrap readiness", async () => {
    const { publicValue } = attestationFixture();
    const baseline = readinessFixture();
    const cases: Array<[unknown, string]> = [
      [readinessFixture('bound'), 'unconfigured Runtime'],
      [{ runtime: { configured: false, generation: 0 } }, 'purposes are malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, setup: { ...baseline.purposes.setup, reason: 'wrong reason' } } }, 'must be unavailable until Runtime authentication is saved'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, vendors: { claude: { available: true } } } } }, 'vendors projection is malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, vendors: [] } } }, 'vendors projection is malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, vendors: null } } }, 'vendors projection is malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, producer: { available: false, category: 'native_session_producer_incompatible' } } } }, 'producer is incompatible'],
    ];
    for (const [readiness, message] of cases) {
      const bff = await listen((url) => url === '/api/local-launch-attestation' ? publicValue : readiness);
      try {
        await expect(verifyLive({ mode: 'bootstrap', bffUrl: bff.url, uiUrl: 'http://127.0.0.1:9' }, { attestation: { public: publicValue } })).rejects.toThrow(message);
      } finally { await bff.close(); }
    }
  });

  it("keeps bound live validation strict for analysis and context while ignoring retired Setup availability", async () => {
    const { publicValue } = attestationFixture();
    const boundAttestation = { ...publicValue, mode: 'bound' as const };
    const readiness = readinessFixture('bound');
    const bff = await listen((url) => url === '/api/local-launch-attestation' ? boundAttestation : readiness);
    const ui = await listen((url) => url === '/_genbi/local-launch-attestation' ? boundAttestation : '<div id="root"></div>');
    try {
      await expect(verifyLive({ mode: 'bound', bffUrl: bff.url, uiUrl: ui.url }, { attestation: { public: boundAttestation } })).resolves.toMatchObject({ requiredPurposes: ['analysis', 'context_enrichment'] });
    } finally { await bff.close(); await ui.close(); }
    const unavailable = { ...readiness, purposes: { ...readiness.purposes, context_enrichment: { ...readiness.purposes.context_enrichment, available: false, reason: 'native terminal host cannot spawn local processes on this machine' } } };
    const unavailableBff = await listen((url) => url === '/api/local-launch-attestation' ? boundAttestation : unavailable);
    try {
      await expect(verifyLive({ mode: 'bound', bffUrl: unavailableBff.url, uiUrl: 'http://127.0.0.1:9' }, { attestation: { public: boundAttestation } })).rejects.toThrow('BFF reports native purpose context_enrichment unavailable');
    } finally { await unavailableBff.close(); }
  });

  it("rejects BFF dual mode before any runtime initialization", () => {
    expect(() => resolveExclusiveLaunchMode("/project", "/workspace")).toThrow("set exactly one");
    expect(() => resolveExclusiveLaunchMode(undefined, undefined)).toThrow("set exactly one");
    expect(resolveExclusiveLaunchMode(undefined, "/workspace")).toBe("bootstrap");
    expect(resolveExclusiveLaunchMode("/project", undefined)).toBe("bound");
  });
  it("uses production providers and BFF native preflight for every required Warble surface without starting services", () => {
    const { root, warble, bin, agentSdk } = fixture();
    const result = run(["--", "--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(root, "bootstrap"), "--warble-root", warble, "--warble-bin", bin]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("launch gate PASSED");
    expect(result.stdout).toContain('"tiers": [');
    expect(result.stdout).toContain("dispatch:native(context_enrichment/codex)");
    expect(result.stdout).toContain('"packageRoot"');
    expect(result.stderr).not.toContain("launch gate BLOCKED");
    expect(readFileSync(path.join(root, "vercel-providers.log"), "utf8").trim().split("\n")).toEqual([
      path.join(packageRoot, "providers", "wren.provider.yaml"),
      path.join(packageRoot, "providers", "setup.provider.yaml"),
    ]);
  });

  it("uses the same canonical identity for a fresh absent bootstrap root at preflight and BFF startup", async () => {
    const { root, warble, bin, agentSdk } = fixture();
    const workspace = path.join(root, "fresh", "nested-bootstrap");
    const selected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: workspace, warbleRoot: warble, warbleBin: bin }, warble));
    expect(existsSync(workspace)).toBe(false);
    expect(selected.attestation.public.warble.runtimeInputs.profileTreeSha256).toMatch(/^[a-f0-9]{64}$/);
    const result = spawnSync(process.execPath, [bffVerifier], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WREN_GENBI_LAUNCH_ATTESTATION: selected.attestation.file,
        WREN_HARNESS_WORKSPACE_ROOT: workspace,
        WREN_HARNESS_WARBLE_BIN: bin,
        WREN_HARNESS_PROFILE: path.join(warble, "genbi-default"),
        WREN_HARNESS_SETUP_IR: path.join(warble, "genbi-setup", "ir.golden.json"),
        WREN_HARNESS_ENRICH_IR: path.join(warble, "genbi-enrich-context", "ir.golden.json"),
        WREN_HARNESS_ANALYSIS_IR: path.join(warble, "genbi-default", "ir.golden.json"),
        WREN_HARNESS_MODE: "subscription", WREN_HARNESS_PROVIDER: "claude", WREN_HARNESS_AGENT_SDK_BIN: agentSdk,
      },
    });
    expect(result.status).toBe(0);
  });

  it("fails closed on a malformed native launch contract instead of offering manual testing", () => {
    const { root, warble, bin } = fixture("bad-launch");
    const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(root, "bootstrap"), "--warble-root", warble, "--warble-bin", bin]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("launch gate BLOCKED [contract]");
    expect(result.stderr).toContain("dispatch_analysis_claude");
  });

  it("fails closed when the BFF Codex runtime closure is missing or invalid", () => {
    const { root, warble, bin, agentSdk } = fixture();
    const invalidShim = path.join(root, "invalid-wren"); writeFileSync(invalidShim, "not a shim\n");
    const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(root, "bootstrap"), "--warble-root", warble, "--warble-bin", bin], { WREN_HARNESS_WREN_SHIM: invalidShim });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("launch gate BLOCKED [contract]");
    expect(result.stderr).toContain("wren_runtime_unavailable");
  });

  it("rejects an old dispatcher verb and a malformed generic manifest", () => {
    for (const dispatcher of ["old-verb", "malformed"] as const) {
      const { root, warble, bin } = fixture("compatible", dispatcher);
      const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(root, "bootstrap"), "--warble-root", warble, "--warble-bin", bin]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("launch gate BLOCKED [contract]");
    }
  });

  it("fails closed when the selected Warble's Vercel bundle compat window excludes the harness's declared IR version", () => {
    // Regression for the live defect this ticket fixed: a Warble checkout whose dispatched
    // bundle no longer overlaps HARNESS_SUPPORT.irVersion (harness/bundle/version.ts) must be
    // caught by the launch gate itself, not just discovered later as a live 500 from
    // `GET /api/harness`.
    const { root, warble, bin } = fixture("compatible", "incompatible-ir");
    const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(root, "bootstrap"), "--warble-root", warble, "--warble-bin", bin]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("launch gate BLOCKED [describe]");
    expect(result.stderr).toContain("failed the harness describe/compat check");
  });

  it("keeps bootstrap and bound input modes unambiguous", () => {
    const { root, warble, bin, agentSdk } = fixture();
    const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(root, "bootstrap"), "--project", path.join(root, "project"), "--warble-root", warble, "--warble-bin", bin]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("launch gate BLOCKED [usage]");
    expect(result.stderr).toContain("forbids --project");
  });

  it("does not permit an operator to bypass the current dist-server build", () => {
    const result = spawnSync(process.execPath, [verifier, "--skip-build", "--mode", "bootstrap", "--workspace-root", "/tmp/fixture", "--runtime", "subscription:claude", "--warble-root", "/tmp/fixture", "--warble-bin", "/tmp/fixture/warble", "--agent-sdk-bin", "/tmp/fixture/warble-agent-sdk"], { encoding: "utf8", env: { ...process.env, NODE_ENV: "production" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("launch gate BLOCKED [usage]");
    expect(result.stderr).toContain("reserved for the deterministic fixture suite");
  });

  it("fails closed when the selected Warble checkout has untracked source", () => {
    const { root, warble, bin } = fixture();
    writeFileSync(path.join(warble, "untracked-source.yml"), "unsafe: true\n");
    const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(root, "bootstrap"), "--warble-root", warble, "--warble-bin", bin]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("launch gate BLOCKED [dirty_source]");
  });

  it("rejects a symlinked bootstrap root", () => {
    const { root, warble, bin } = fixture();
    const target = path.join(root, "real-root");
    mkdirSync(target);
    const link = path.join(root, "bootstrap-link");
    spawnSync("ln", ["-s", target, link]);
    const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", link, "--warble-root", warble, "--warble-bin", bin]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not be a symlink");
  });

  it("rejects a bootstrap root nested inside an existing Wren project", () => {
    const { root, warble, bin } = fixture();
    const project = path.join(root, "bound-project"); mkdirSync(project); writeFileSync(path.join(project, "wren_project.yml"), "name: bound\n");
    const result = run(["--skip-build", "--mode", "bootstrap", "--workspace-root", path.join(project, "fresh-workspace"), "--warble-root", warble, "--warble-bin", bin]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not be inside a Wren project");
  });

  it("rejects a bootstrap path that is replaced by a symlink after valid preflight", async () => {
    const { root, warble, bin, agentSdk } = fixture();
    const workspace = path.join(root, "fresh", "bootstrap");
    const selected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: workspace, warbleRoot: warble, warbleBin: bin }, warble));
    mkdirSync(path.dirname(workspace), { recursive: true });
    const outside = path.join(root, "outside"); mkdirSync(outside);
    spawnSync("ln", ["-s", outside, workspace]);
    const result = spawnSync(process.execPath, [bffStarter], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WREN_GENBI_LAUNCH_ATTESTATION: selected.attestation.file,
        WREN_HARNESS_WORKSPACE_ROOT: workspace,
        WREN_HARNESS_WARBLE_BIN: bin,
        WREN_HARNESS_PROFILE: path.join(warble, "genbi-default"),
        WREN_HARNESS_SETUP_IR: path.join(warble, "genbi-setup", "ir.golden.json"),
        WREN_HARNESS_ENRICH_IR: path.join(warble, "genbi-enrich-context", "ir.golden.json"),
        WREN_HARNESS_ANALYSIS_IR: path.join(warble, "genbi-default", "ir.golden.json"),
        WREN_HARNESS_MODE: "subscription", WREN_HARNESS_PROVIDER: "claude", WREN_HARNESS_AGENT_SDK_BIN: agentSdk,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not be a symlink");
  });

  it("does not accept an arbitrary process on the requested BFF port", async () => {
    const { root, warble, bin } = fixture();
    const expected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: path.join(root, "bootstrap"), warbleRoot: warble, warbleBin: bin }, warble));
    const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end("{}"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
    try {
      await expect(verifyLive({ mode: "bootstrap", bffUrl: `http://127.0.0.1:${address.port}`, uiUrl: "http://127.0.0.1:9" }, expected)).rejects.toThrow("BFF launch attestation does not match");
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it("exact-matches mode, worktree identity, commit, and binary hash attestations", async () => {
    const { root, warble, bin } = fixture();
    const expected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: path.join(root, "bootstrap"), warbleRoot: warble, warbleBin: bin }, warble));
    const mismatched = { ...expected.attestation.public, mode: "bound" };
    const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(mismatched)); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
    try {
      await expect(verifyLive({ mode: "bootstrap", bffUrl: `http://127.0.0.1:${address.port}`, uiUrl: "http://127.0.0.1:9" }, expected)).rejects.toThrow("BFF launch attestation does not match");
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it("rejects a selected tuple attestation replayed by the production UI wrapper in another worktree", async () => {
    const { root, warble, bin } = fixture();
    const selected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: path.join(root, "bootstrap"), warbleRoot: warble, warbleBin: bin }, warble));
    const copy = path.join(root, "copied-worktree"); mkdirSync(copy);
    for (const args of [["init"], ["config", "user.email", "fixture@example.test"], ["config", "user.name", "fixture"], ["commit", "--allow-empty", "-m", "copy"]]) {
      const result = spawnSync("git", args, { cwd: copy, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr);
    }
    const result = spawnSync(process.execPath, [uiStarter], { cwd: copy, encoding: "utf8", env: { ...process.env, WREN_GENBI_LAUNCH_ATTESTATION: selected.attestation.file } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("belongs to a different UI worktree");
  });

  it("rejects a tampered non-entry dist-server module while bin.js is unchanged", () => {
    const distRoot = path.join(packageRoot, "dist-server"); const entry = path.join(distRoot, "server", "bin.js"); const module = path.join(distRoot, "server", "app.js");
    const original = readFileSync(module); const attestation = path.join(mkdtempSync(path.join(os.tmpdir(), "genbi-attestation-")), "attestation.json"); dirs.push(path.dirname(attestation));
    const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex"); const placeholder = "0".repeat(64);
    writeFileSync(attestation, JSON.stringify({ version: "genbi-launch-attestation/v1", mode: "bootstrap", genbi: { rootDigest: placeholder, commit: "fixture", treeIdentity: placeholder }, warble: { rootDigest: placeholder, commit: "fixture", treeIdentity: placeholder, binarySha256: placeholder, runtimeInputs: { profileTreeSha256: placeholder, setupIrSha256: placeholder, enrichIrSha256: placeholder, analysisIrSha256: placeholder } }, runtime: { mode: "subscription", provider: "claude", dispatcher: "claude-agent-sdk", agentSdkSha256: placeholder }, bff: { entrySha256: digest(readFileSync(entry)), closureSha256: hashTree(distRoot) }, ui: { rootDigest: placeholder, commit: "fixture", treeIdentity: placeholder } }));
    try {
      writeFileSync(module, Buffer.concat([original, Buffer.from("\n// tampered fixture\n")]));
      const result = spawnSync(process.execPath, [entry], { cwd: packageRoot, encoding: "utf8", env: { ...process.env, WREN_GENBI_LAUNCH_ATTESTATION: attestation, WREN_HARNESS_WORKSPACE_ROOT: path.join(path.dirname(attestation), "workspace") } });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("does not match this dist-server closure");
    } finally { writeFileSync(module, original); }
  });

  it("production BFF verifier rejects replayed worktrees and every swapped runtime input", async () => {
    const { root, warble, bin, agentSdk, staleAgentSdk } = fixture(); const workspace = path.join(root, "workspace"); mkdirSync(workspace);
    const selected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: workspace, warbleRoot: warble, warbleBin: bin }, warble));
    const baseEnv = { ...process.env, WREN_GENBI_LAUNCH_ATTESTATION: selected.attestation.file, WREN_HARNESS_WORKSPACE_ROOT: workspace, WREN_HARNESS_WARBLE_BIN: bin, WREN_HARNESS_PROFILE: path.join(warble, "genbi-default"), WREN_HARNESS_SETUP_IR: path.join(warble, "genbi-setup", "ir.golden.json"), WREN_HARNESS_ENRICH_IR: path.join(warble, "genbi-enrich-context", "ir.golden.json"), WREN_HARNESS_ANALYSIS_IR: path.join(warble, "genbi-default", "ir.golden.json"), WREN_HARNESS_MODE: "subscription", WREN_HARNESS_PROVIDER: "claude", WREN_HARNESS_AGENT_SDK_BIN: agentSdk };
    expect(spawnSync(process.execPath, [bffVerifier], { cwd: packageRoot, encoding: "utf8", env: baseEnv }).status).toBe(0);
    const other = path.join(root, "other"); mkdirSync(other); for (const args of [["init"], ["config", "user.email", "f@e.test"], ["config", "user.name", "f"], ["commit", "--allow-empty", "-m", "copy"]]) spawnSync("git", args, { cwd: other });
    expect(spawnSync(process.execPath, [bffVerifier], { cwd: other, encoding: "utf8", env: baseEnv }).status).toBe(1);
    const replacement = path.join(warble, "replacement"); writeFileSync(replacement, "different"); chmodSync(replacement, 0o700);
    for (const override of [
      { WREN_HARNESS_WARBLE_BIN: replacement }, { WREN_HARNESS_PROFILE: path.join(warble, "genbi-setup") },
      { WREN_HARNESS_SETUP_IR: path.join(warble, "genbi-enrich-context", "ir.golden.json") }, { WREN_HARNESS_ENRICH_IR: path.join(warble, "genbi-setup", "ir.golden.json") },
      { WREN_HARNESS_ANALYSIS_IR: path.join(warble, "genbi-setup", "ir.golden.json") }, { WREN_HARNESS_PROJECT: workspace },
      { WREN_HARNESS_AGENT_SDK_BIN: staleAgentSdk }, { WREN_HARNESS_MODE: "api-key" }, { WREN_HARNESS_PROVIDER: "codex" },
    ]) expect(spawnSync(process.execPath, [bffVerifier], { cwd: packageRoot, encoding: "utf8", env: { ...baseEnv, ...override } }).status).toBe(1);
  });

  it("production BFF wrapper rejects a same-path Warble input edit after valid preflight", async () => {
    const { root, warble, bin, agentSdk } = fixture(); const workspace = path.join(root, "workspace");
    const selected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: workspace, warbleRoot: warble, warbleBin: bin }, warble));
    writeFileSync(path.join(warble, "genbi-setup", "ir.golden.json"), '{"changed":true}\n');
    const result = spawnSync(process.execPath, [bffStarter], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WREN_GENBI_LAUNCH_ATTESTATION: selected.attestation.file,
        WREN_HARNESS_WORKSPACE_ROOT: workspace,
        WREN_HARNESS_WARBLE_BIN: bin,
        WREN_HARNESS_PROFILE: path.join(warble, "genbi-default"),
        WREN_HARNESS_SETUP_IR: path.join(warble, "genbi-setup", "ir.golden.json"),
        WREN_HARNESS_ENRICH_IR: path.join(warble, "genbi-enrich-context", "ir.golden.json"),
        WREN_HARNESS_ANALYSIS_IR: path.join(warble, "genbi-default", "ir.golden.json"),
        WREN_HARNESS_MODE: "subscription", WREN_HARNESS_PROVIDER: "claude", WREN_HARNESS_AGENT_SDK_BIN: agentSdk,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Warble worktree has tracked or untracked source changes");
  });
});
