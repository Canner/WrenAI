import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HARNESS_SUPPORT } from "../harness/bundle/version.js";
// @ts-expect-error The operator-facing verifier intentionally stays plain Node ESM.
import { verifyLive, verifyLocalLaunch } from "../scripts/verify-local-launch.mjs";

const dirs: string[] = [];
const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const verifier = path.join(packageRoot, "scripts", "verify-local-launch.mjs");

const runtimeBindingRequiredReason = 'native sessions require a saved Runtime & authentication binding';

function readinessFixture(configured = false) {
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
      if (entry.isDirectory()) visit(candidate); else if (entry.isFile()) { digest.update(relative); digest.update("\0"); digest.update(readFileSync(candidate)); }
    }
  };
  visit(root); return digest.digest("hex");
}

function fixture(mode: "compatible" | "bad-launch" | "bad-codex-purpose" | "malformed-codex" = "compatible", dispatcher: "compatible" | "old-verb" | "malformed" | "incompatible-ir" = "compatible") {
  const root = mkdtempSync(path.join(os.tmpdir(), "genbi-local-launch-gate-"));
  dirs.push(root);
  const warble = path.join(root, "warble");
  mkdirSync(warble, { recursive: true });
  const bin = path.join(warble, "warble");
  const agentSdk = path.join(warble, "warble-agent-sdk");
  const staleAgentSdk = path.join(warble, "warble-agent-sdk-stale");
  const codexLocal = path.join(warble, "warble-codex-local");
  const staleCodexLocal = path.join(warble, "warble-codex-local-stale");
  const codexPackage = path.join(root, "codex-package");
  mkdirSync(path.join(codexPackage, "bin"), { recursive: true });
  const codexBin = path.join(codexPackage, "bin", "codex");
  const staleCodexBin = path.join(root, "codex-stale");
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
if (scope.version !== '3' || scope.cwd !== out || (purpose === 'setup' && (typeof scope.bootstrap_root !== 'string' || scope.bootstrap_root === out))) process.exit(73);
const agent = purpose === 'analysis' ? 'answer_query' : purpose === 'setup' ? 'connect_source' : 'draft_enrichment';
const profile = purpose === 'analysis' ? 'genbi-default' : purpose === 'setup' ? 'genbi-setup' : 'genbi-enrich-context';
const scopeEntry = vendor === 'claude' && purpose === 'analysis';
const welcome = purpose === 'setup'
  ? 'Help me set up this GenBI project. Start by explaining the next setup step and ask what data source I want to connect.'
  : purpose === 'analysis'
    ? 'Help me analyze this data. Ask me what question I want to answer about the server-bound project.'
    : "Help me inspect this project's context and draft a read-only enrichment proposal. Do not apply changes; ask what context I want to review.";
const entryKeys = scopeEntry ? ['kind', 'prompt'] : ['prompt', 'verb'];
if (!scope.entry || JSON.stringify(Object.keys(scope.entry).sort()) !== JSON.stringify(entryKeys) || scope.entry.prompt !== welcome) process.exit(73);
if (scopeEntry ? scope.entry.kind !== 'scope' : scope.entry.verb !== agent) process.exit(73);
writeFileSync(path.join(out, 'RUN.md'), 'handoff'); mkdirSync(path.join(out, '.warble'));
writeFileSync(path.join(out, '.warble', 'interactive-launch.json'), JSON.stringify({
  version: ${JSON.stringify(mode)} === 'malformed-codex' && vendor === 'codex' ? '999' : '4', target,
  purpose: ${JSON.stringify(mode)} === 'bad-codex-purpose' && vendor === 'codex' ? (purpose === 'analysis' ? 'setup' : 'analysis') : purpose,
  executable: vendor === 'claude' ? 'claude' : 'codex',
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
  writeFileSync(codexLocal, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== 'manifest') process.exit(31);
const ir = args[1] ?? '';
const component = args.includes('--component') ? args[args.indexOf('--component') + 1] : 'connect_source';
const profile = ir.includes('genbi-setup') ? 'genbi-setup' : ir.includes('genbi-enrich-context') ? 'genbi-enrich-context' : 'genbi-default';
process.stdout.write(JSON.stringify({ manifest_version: '0.1', target: 'codex:local', profile, agents: [{ id: component }] }) + '\\n');
`);
  chmodSync(codexLocal, 0o700);
  writeFileSync(staleCodexLocal, "#!/bin/sh\necho stale dispatcher\n"); chmodSync(staleCodexLocal, 0o700);
  writeFileSync(codexBin, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'codex-cli 0.146.0'; else exit 97; fi\n"); chmodSync(codexBin, 0o700);
  writeFileSync(path.join(codexPackage, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.146.0" }));
  writeFileSync(staleCodexBin, "#!/bin/sh\necho 'codex-cli 0.145.0'\n"); chmodSync(staleCodexBin, 0o700);
  // The fixture no longer git-inits its directory, so a binary taken straight from it is not
  // inside any checkout. That is the *checkout* arm of the identity split all the same: a bare
  // binary with no owning @warble/cli package is identified by its own content hash, which is
  // what that arm has always meant. The genuinely package-shaped case needs a package tree
  // around the binary and is built by warbleCliPackageInstall below.
  return { root, warble, bin, agentSdk, staleAgentSdk, codexLocal, staleCodexLocal, codexPackage, codexBin, staleCodexBin };
}

/**
 * The shape a pinned npm install actually has: a trampoline as the package's bin, the resolution
 * logic beside it, and the native executable downloaded into the package's own
 * node_modules/.bin_real. The version is read from this package's own pin so the lockfile lookup
 * resolves against the real pnpm-lock.yaml, as it does in a real launch.
 */
function warbleCliPackageInstall(root: string, executableSource: string) {
  const pinned = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).dependencies["@warble/cli"];
  const installed = path.join(root, "node_modules", "@warble", "cli");
  const extracted = path.join(installed, "node_modules", ".bin_real");
  mkdirSync(extracted, { recursive: true });
  const executable = path.join(extracted, "warble");
  writeFileSync(executable, readFileSync(executableSource)); chmodSync(executable, 0o700);
  const trampoline = path.join(installed, "run-warble.js");
  writeFileSync(trampoline, '#!/bin/sh\nexec "$(dirname "$0")/node_modules/.bin_real/warble" "$@"\n'); chmodSync(trampoline, 0o700);
  writeFileSync(path.join(installed, "package.json"), JSON.stringify({ name: "@warble/cli", version: pinned, bin: { warble: "run-warble.js" } }));
  writeFileSync(path.join(installed, "binary.js"), "module.exports = require('./binary-install');\n");
  writeFileSync(path.join(installed, "binary-install.js"), "// verifies the download against a baked-in digest\n");
  return { pinned, trampoline, executable };
}

function run(args: string[], warble: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [verifier, ...args, "--runtime", "subscription:claude", "--agent-sdk-bin", path.join(warble, "warble-agent-sdk")], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test", ...env } });
}

function runCodex(args: string[], value: ReturnType<typeof fixture>, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [verifier, ...args, "--runtime", "subscription:codex", "--codex-local-bin", value.codexLocal, "--codex-bin", value.codexBin], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test", ...env } });
}

function gateOptions(options: Record<string, unknown>, warble: string) {
  return { ...options, runtime: "subscription:claude", agentSdkBin: path.join(warble, "warble-agent-sdk") };
}

function codexGateOptions(options: Record<string, unknown>, value: ReturnType<typeof fixture>) {
  return { ...options, runtime: "subscription:codex", codexLocalBin: value.codexLocal, codexBin: value.codexBin };
}

afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("local GenBI launch gate", () => {

  it("rejects configured, malformed, wrong-reason, and producer-incompatible bootstrap readiness", async () => {
    const baseline = readinessFixture();
    const cases: Array<[unknown, string]> = [
      [readinessFixture(true), 'unconfigured Runtime'],
      [{ runtime: { configured: false, generation: 0 } }, 'purposes are malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, setup: { ...baseline.purposes.setup, reason: 'wrong reason' } } }, 'must be unavailable until Runtime authentication is saved'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, vendors: { claude: { available: true } } } } }, 'vendors projection is malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, vendors: [] } } }, 'vendors projection is malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, vendors: null } } }, 'vendors projection is malformed'],
      [{ ...baseline, purposes: { ...baseline.purposes, analysis: { ...baseline.purposes.analysis, producer: { available: false, category: 'native_session_producer_incompatible' } } } }, 'producer is incompatible'],
    ];
    for (const [readiness, message] of cases) {
      const bff = await listen(() => readiness);
      try {
        await expect(verifyLive({ mode: 'bootstrap', bffUrl: bff.url, uiUrl: 'http://127.0.0.1:9' })).rejects.toThrow(message);
      } finally { await bff.close(); }
    }
  });

  it("uses production providers and BFF native preflight for every required Warble surface without starting services", () => {
    const { root, warble, bin, agentSdk } = fixture();
    const result = run(["--", "--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", bin], warble);
    expect(result.status, `${result.stderr}${result.stdout}`.trim() || "(no gate output)").toBe(0);
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

  it("accepts and projects only a fully pinned Codex tuple after all file-only purpose probes", async () => {
    const value = fixture();
    const selected = await verifyLocalLaunch(codexGateOptions({ skipBuild: false, mode: "bootstrap", workspaceRoot: path.join(value.root, "bootstrap"), warbleBin: value.bin }, value));
    // Only what the probe can establish by running the executable: which Codex, and whether it
    // came from a standalone install or the npm package. The content hashes that used to sit
    // here identified an artifact for an attestation that no longer exists.
    expect(selected.runtimeBinding.runtime).toEqual({
      mode: "subscription",
      provider: "codex",
      dispatcher: "codex-local",
      source: "npm:@openai/codex",
      version: "0.146.0",
    });
    expect(selected.probes).toEqual(expect.arrayContaining([
      "dispatch:native(analysis/codex)", "dispatch:native(setup/codex)", "dispatch:native(context_enrichment/codex)",
      "codex-local:manifest(analysis)", "codex-local:manifest(setup)", "codex-local:manifest(context_enrichment)",
    ]));
  }, 15_000);

  it("rejects wrong-purpose and malformed Codex launch contracts", () => {
    for (const mode of ["bad-codex-purpose", "malformed-codex"] as const) {
      const value = fixture(mode);
      const result = runCodex(["--skip-build", "--workspace-root", path.join(value.root, "bootstrap"), "--warble-bin", value.bin], value);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("launch gate BLOCKED [contract]");
      expect(result.stderr).toContain("codex");
    }
  });

  it("requires closed vendor-specific launch inputs", () => {
    const value = fixture();
    const codexWithClaude = spawnSync(process.execPath, [verifier, "--skip-build", "--workspace-root", path.join(value.root, "bootstrap"), "--warble-bin", value.bin, "--runtime", "subscription:codex", "--codex-local-bin", value.codexLocal, "--codex-bin", value.codexBin, "--agent-sdk-bin", value.agentSdk], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
    expect(codexWithClaude.status).toBe(1);
    expect(codexWithClaude.stderr).toContain("applies only to subscription:claude");
    const claudeWithCodex = spawnSync(process.execPath, [verifier, "--skip-build", "--workspace-root", path.join(value.root, "bootstrap"), "--warble-bin", value.bin, "--runtime", "subscription:claude", "--agent-sdk-bin", value.agentSdk, "--codex-local-bin", value.codexLocal, "--codex-bin", value.codexBin], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
    expect(claudeWithCodex.status).toBe(1);
    expect(claudeWithCodex.stderr).toContain("apply only to subscription:codex");
  });

  it("fails closed on a malformed native launch contract instead of offering manual testing", () => {
    const { root, warble, bin } = fixture("bad-launch");
    const result = run(["--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", bin], warble);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("launch gate BLOCKED [contract]");
    expect(result.stderr).toContain("dispatch_analysis_claude");
  });

  it("fails closed when the BFF Codex runtime closure is missing or invalid", () => {
    const { root, warble, bin, agentSdk } = fixture();
    const invalidShim = path.join(root, "invalid-wren"); writeFileSync(invalidShim, "not a shim\n");
    const result = run(["--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", bin], warble, { WREN_HARNESS_WREN_SHIM: invalidShim });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("launch gate BLOCKED [contract]");
    expect(result.stderr).toContain("wren_runtime_unavailable");
  });

  it("rejects an old dispatcher verb and a malformed generic manifest", () => {
    for (const dispatcher of ["old-verb", "malformed"] as const) {
      const { root, warble, bin } = fixture("compatible", dispatcher);
      const result = run(["--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", bin], warble);
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
    const result = run(["--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", bin], warble);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("launch gate BLOCKED [describe]");
    expect(result.stderr).toContain("failed the harness describe/compat check");
  });

  it("refuses to gate a launch with no workspace root to bootstrap into", () => {
    const { warble, bin } = fixture();
    const result = run(["--skip-build", "--warble-bin", bin], warble);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("launch gate BLOCKED [usage]");
    expect(result.stderr).toContain("--workspace-root is required");
  });

  it("rejects the removed bound-mode selector rather than silently bootstrapping", () => {
    const { root, warble, bin } = fixture();
    const result = run(["--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--project", path.join(root, "project"), "--warble-bin", bin], warble);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("launch gate BLOCKED [usage]");
  });

  it("accepts a Warble binary that lives inside a git checkout, dirty or not", () => {
    // Nothing checks Warble's git status any more (see verify-local-launch.mjs): a binary
    // that happens to live inside a git checkout — clean or, as here, with untracked
    // source, the way a developer's own Warble checkout normally looks mid-edit — is just
    // a binary like any other. This is the direct disproof that the old dirty-checkout
    // gate was silently retained; it also stands in for the "local Warble development"
    // case the content-hash identity must not break.
    const { root, warble, bin } = fixture();
    for (const args of [["init"], ["config", "user.email", "fixture@example.test"], ["config", "user.name", "fixture"], ["add", "."], ["commit", "-m", "fixture"]]) {
      const result = spawnSync("git", args, { cwd: warble, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    }
    writeFileSync(path.join(warble, "untracked-source.yml"), "unsafe: true\n");
    const result = run(["--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", bin], warble);
    expect(result.status, `${result.stderr}${result.stdout}`.trim() || "(no gate output)").toBe(0);
    expect(result.stdout).toContain("launch gate PASSED");
  });

  it("accepts a loose binary under node_modules that no @warble/cli package owns", () => {
    // A binary that lives under node_modules but has no owning @warble/cli package.json is not
    // the package arm: with nothing to read a version or a lockfile entry from, it is identified
    // by its own content hash, exactly as a checkout binary is. The real package shape — a
    // trampoline whose hash says nothing, with the executable downloaded beside it — is covered
    // by "records the package arm end to end" below.
    const { root, warble, bin } = fixture();
    const packageBinDir = path.join(root, "node_modules", ".bin");
    mkdirSync(packageBinDir, { recursive: true });
    const packageBin = path.join(packageBinDir, "warble");
    writeFileSync(packageBin, readFileSync(bin));
    chmodSync(packageBin, 0o700);
    const result = run(["--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", packageBin], warble);
    expect(result.status, `${result.stderr}${result.stdout}`.trim() || "(no gate output)").toBe(0);
    expect(result.stdout).toContain("launch gate PASSED");
  });

  it("accepts an agent-sdk dispatcher binary that is not inside any Warble checkout either", () => {
    // Same claim as above (AC: dispatcher binaries get the same treatment as the Warble CLI
    // binary) but for the Claude dispatcher: verify-local-launch.mjs resolves it with only
    // an executability check, never a containment/git check.
    const { root, bin, agentSdk } = fixture();
    const packageBinDir = path.join(root, "node_modules", ".bin");
    mkdirSync(packageBinDir, { recursive: true });
    const packageAgentSdk = path.join(packageBinDir, "warble-agent-sdk");
    writeFileSync(packageAgentSdk, readFileSync(agentSdk));
    chmodSync(packageAgentSdk, 0o700);
    const result = spawnSync(process.execPath, [verifier, "--skip-build", "--workspace-root", path.join(root, "bootstrap"), "--warble-bin", bin, "--runtime", "subscription:claude", "--agent-sdk-bin", packageAgentSdk], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
    expect(result.status, `${result.stderr}${result.stdout}`.trim() || "(no gate output)").toBe(0);
    expect(result.stdout).toContain("launch gate PASSED");
  });

  it("rejects a symlinked bootstrap root", () => {
    const { root, warble, bin } = fixture();
    const target = path.join(root, "real-root");
    mkdirSync(target);
    const link = path.join(root, "bootstrap-link");
    spawnSync("ln", ["-s", target, link]);
    const result = run(["--skip-build", "--workspace-root", link, "--warble-bin", bin], warble);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not be a symlink");
  });

  it("rejects a bootstrap root nested inside an existing Wren project", () => {
    const { root, warble, bin } = fixture();
    const project = path.join(root, "bound-project"); mkdirSync(project); writeFileSync(path.join(project, "wren_project.yml"), "name: bound\n");
    const result = run(["--skip-build", "--workspace-root", path.join(project, "fresh-workspace"), "--warble-bin", bin], warble);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not be inside a Wren project");
  });


  it("does not accept an arbitrary process on the requested BFF port", async () => {
    const { root, warble, bin } = fixture();
    const expected = await verifyLocalLaunch(gateOptions({ skipBuild: true, mode: "bootstrap", workspaceRoot: path.join(root, "bootstrap"), warbleBin: bin }, warble));
    const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end("{}"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
    try {
      await expect(verifyLive({ mode: "bootstrap", bffUrl: `http://127.0.0.1:${address.port}`, uiUrl: "http://127.0.0.1:9" })).rejects.toThrow("BFF native-session readiness");
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });


});
