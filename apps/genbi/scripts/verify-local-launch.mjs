#!/usr/bin/env node
/**
 * Deterministic pre-launch gate for a local GenBI UI/BFF pair.  It is deliberately
 * a standalone Node program so an operator can run it before either long-lived
 * process is started.  It never contacts a model, starts a server, or reads
 * credentials: all Warble calls compile/dispatch local files only.
 */
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativePurposes = ["analysis", "setup", "context_enrichment"];
const livePurposeContracts = {
  analysis: { scopeKind: "bound_project", profile: "genbi-default" },
  setup: { scopeKind: "bootstrap", profile: "genbi-setup" },
  context_enrichment: { scopeKind: "bound_project", profile: "genbi-enrich-context" },
};
const nativeRuntimeBindingRequiredReason = "native sessions require a saved Runtime & authentication binding";
// A launch is gated before Setup has run, so no native purpose can be live yet — each one
// is asserted unavailable-for-the-right-reason above instead.
const liveRequiredPurposes = [];
const nativeVendors = ["claude", "codex"];

function usage(message) {
  const text = [
    message ? `error: ${message}` : undefined,
    "Usage: pnpm run check:contracts -- --workspace-root <directory> --runtime subscription:claude|subscription:codex --warble-bin <binary> [runtime inputs]",
    "  Claude runtime: --agent-sdk-bin <binary>",
    "  Codex runtime:  --codex-local-bin <binary> --codex-bin <exact-codex-executable>",
    "  An existing project is adopted through the running app, not selected here.",
    "Optional: --profile <dir> --setup-ir <file> --enrich-ir <file> --analysis-ir <file>",
    "  Profiles and their committed IRs live in this package's own profiles/ tree, not the Warble checkout.",
    "Live gate: --live --bff-url <url> --ui-url <url> (after both processes are running)",
  ].filter(Boolean).join("\n");
  throw new GateError("usage", text);
}

class GateError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseArgs(argv) {
  // pnpm forwards the separator itself to a bare `node` script: accept the
  // conventional `pnpm run check:contracts -- --workspace-root ...` spelling as well as a
  // direct `node scripts/verify-local-launch.mjs --workspace-root ...` invocation.
  if (argv[0] === "--") argv = argv.slice(1);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") usage();
    if (argument === "--skip-build") { options.skipBuild = true; continue; }
    if (argument === "--live") { options.live = true; continue; }
    if (!argument.startsWith("--")) usage(`unexpected argument ${JSON.stringify(argument)}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) usage(`${argument} requires a value`);
    if (Object.hasOwn(options, key)) usage(`${argument} was supplied more than once`);
    options[key] = value;
    index += 1;
  }
  // The retired bound-mode selectors are rejected by name rather than ignored as unknown
  // flags: a caller still passing them believes they have an effect, and silently ignoring
  // them would launch differently from what the caller asked for without any signal.
  if (options.project !== undefined) usage("--project is no longer supported — an existing project is adopted through the running app");
  if (options.mode !== undefined) usage("--mode is no longer supported — the BFF has a single boot mode");
  if (options.warbleRoot !== undefined) usage("--warble-root is no longer supported — Warble is identified by its binary path, not a required checkout root");
  for (const required of ["workspaceRoot", "runtime", "warbleBin"]) if (!options[required]) usage(`--${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  if (options.runtime !== "subscription:claude" && options.runtime !== "subscription:codex") usage("--runtime must be subscription:claude or subscription:codex");
  if (options.runtime === "subscription:claude") {
    if (!options.agentSdkBin) usage("--agent-sdk-bin is required for subscription:claude");
    if (options.codexLocalBin || options.codexBin) usage("--codex-local-bin and --codex-bin apply only to subscription:codex");
  } else {
    if (!options.codexLocalBin || !options.codexBin) usage("--codex-local-bin and --codex-bin are required for subscription:codex");
    if (options.agentSdkBin) usage("--agent-sdk-bin applies only to subscription:claude");
  }
  if (options.skipBuild && process.env.NODE_ENV !== "test") usage("--skip-build is reserved for the deterministic fixture suite");
  if (options.live && (!options.bffUrl || !options.uiUrl)) usage("--live requires --bff-url and --ui-url");
  if (!options.live && (options.bffUrl || options.uiUrl)) usage("--bff-url and --ui-url require --live");
  return options;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function regularFile(value, label) {
  try {
    const canonical = realpathSync(value);
    if (!statSync(canonical).isFile()) throw new Error("not a file");
    return canonical;
  } catch {
    throw new GateError("missing_input", `${label} must be a readable regular file: ${value}`);
  }
}

function directory(value, label) {
  try {
    const canonical = realpathSync(value);
    if (!statSync(canonical).isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch {
    throw new GateError("missing_input", `${label} must be a readable directory: ${value}`);
  }
}

function run(command, args, { cwd = packageRoot, capture = false } = {}) {
  const result = execFileSyncResult(command, args, cwd);
  if (!capture && result.code !== 0) throw new GateError("command_failed", `${command} ${args.join(" ")} exited ${result.code}`);
  return result;
}

function execFileSyncResult(command, args, cwd) {
  // `spawnSync` gives this CLI a simple fail-closed boundary and avoids a shell.
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return { code: result.status ?? (result.error ? 1 : 0), stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function bootstrapRoot(value) {
  const raw = path.resolve(value);
  let existing = raw;
  const missing = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new GateError("boot_mode", `bootstrap workspace has no writable parent: ${value}`);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  // Do not let a lexical symlink in the supplied path turn an apparently fresh
  // root into a different directory between preflight and BFF startup.
  if (lstatSync(existing).isSymbolicLink()) throw new GateError("boot_mode", "bootstrap workspace root or parent must not be a symlink");
  const parent = directory(existing, "bootstrap workspace parent");
  const canonical = path.join(parent, ...missing);
  if (!contained(parent, canonical) || missing.some((part) => part === "." || part === ".." || path.basename(part) !== part)) {
    throw new GateError("boot_mode", "bootstrap workspace root escapes its canonical parent");
  }
  if (existsSync(canonical)) {
    if (lstatSync(canonical).isSymbolicLink()) throw new GateError("boot_mode", "bootstrap workspace root must not be a symlink");
    const resolved = directory(canonical, "bootstrap workspace root");
    if (existsSync(path.join(resolved, "wren_project.yml"))) throw new GateError("boot_mode", "bootstrap workspace root must not already be a Wren project");
    for (let ancestor = path.dirname(resolved); ; ancestor = path.dirname(ancestor)) {
      if (existsSync(path.join(ancestor, "wren_project.yml"))) throw new GateError("boot_mode", "bootstrap workspace root must not be inside a Wren project");
      if (ancestor === path.dirname(ancestor)) break;
    }
    return { root: resolved, parent: resolved };
  }
  for (let ancestor = parent; ; ancestor = path.dirname(ancestor)) {
    if (existsSync(path.join(ancestor, "wren_project.yml"))) throw new GateError("boot_mode", "bootstrap workspace root must not be inside a Wren project");
    if (ancestor === path.dirname(ancestor)) break;
  }
  try { accessSync(parent, constants.W_OK | constants.X_OK); } catch { throw new GateError("boot_mode", `bootstrap workspace parent is not writable: ${parent}`); }
  return { root: canonical, parent };
}

function validateMode(options) {
  const workspace = bootstrapRoot(options.workspaceRoot);
  return { workspaceRoot: workspace.root, workspaceParent: workspace.parent };
}

function assertIr(pathToIr, label) {
  const canonical = regularFile(pathToIr, label);
  try { JSON.parse(readFileSync(canonical, "utf8")); } catch { throw new GateError("contract", `${label} is not valid JSON: ${canonical}`); }
  return canonical;
}

async function loadHarnessBundleLoader() {
  const module = regularFile(path.join(packageRoot, "dist-server", "harness", "index.js"), "fresh dist-server harness bundle loader");
  try {
    return await import(`${pathToFileURL(module).href}?launch-gate=${Date.now()}`);
  } catch {
    throw new GateError("build", "could not load the freshly built harness bundle loader");
  }
}

async function probeNativeSessionProducer({ bin, irPaths }) {
  const module = regularFile(path.join(packageRoot, "dist-server", "server", "native-sessions.js"), "fresh dist-server native-session producer");
  let producer;
  try {
    ({ probeNativeSessionProducer: producer } = await import(`${pathToFileURL(module).href}?launch-gate=${Date.now()}`));
  } catch {
    throw new GateError("build", "could not load the freshly built BFF native-session producer");
  }
  if (typeof producer !== "function") throw new GateError("build", "fresh dist-server does not export the BFF native-session producer");
  const result = await producer({
    warbleBin: bin,
    irPaths,
    ...(process.env.WREN_HARNESS_WREN_SHIM !== undefined ? { wrenShim: process.env.WREN_HARNESS_WREN_SHIM } : {}),
  });
  if (!result?.available) throw new GateError("contract", `Warble native producer preflight failed for the selected runtime closure (${result?.diagnostic ?? "incompatible"})`);
  return { available: true, evidence: nativePurposes.flatMap((purpose) => nativeVendors.map((vendor) => `dispatch:native(${purpose}/${vendor})`)) };
}

async function runWarbleContractProbe({ bin, profile, setupIr, enrichIr, analysisIr }) {
  const probeRoot = mkdtempSync(path.join(tmpdir(), "genbi-launch-gate-"));
  try {
    const compiledIr = path.join(probeRoot, "profile.ir.json");
    let result = run(bin, ["compile", profile, "-o", compiledIr], { capture: true });
    if (result.code !== 0) throw new GateError("contract", "Warble compile profile probe failed");
    let compiled;
    try { compiled = JSON.parse(readFileSync(compiledIr, "utf8")); } catch { throw new GateError("contract", "Warble compile profile probe did not create valid JSON"); }
    const tiers = new Set();
    if (!Array.isArray(compiled?.components)) throw new GateError("runtime_binding", "compiled profile IR has no components array");
    for (const component of compiled.components) for (const call of component?.llm_calls ?? []) if (typeof call?.tier === "string" && call.tier.trim()) tiers.add(call.tier.trim());
    if (tiers.size === 0) throw new GateError("runtime_binding", "compiled profile IR declares no runtime tiers");

    // This is also the launch gate's one live exercise of the in-process/agnostic
    // describe path: not just checking the dispatcher produced a file, but
    // actually loading it through the same `loadBundle`/`assertCompat` check
    // the BFF's `GET /api/harness` route runs, against a bundle this probe
    // just dispatched from the selected Warble checkout — not a committed
    // fixture. A stale harness-declared IR version against a newer Warble
    // pin fails here, not silently at the first live describe request.
    const { loadBundle } = await loadHarnessBundleLoader();
    for (const [label, ir, provider] of [
      ["profile", compiledIr, path.join(packageRoot, "providers", "wren.provider.yaml")],
      ["setup", setupIr, path.join(packageRoot, "providers", "setup.provider.yaml")],
    ]) {
      const out = path.join(probeRoot, `${label}-vercel`);
      result = run(bin, ["dispatch", "--target", "vercel", "--provider", provider, ir, "--out", out], { capture: true });
      const bundlePath = path.join(out, "bundle.json");
      if (result.code !== 0 || !existsSync(bundlePath)) throw new GateError("contract", `Warble Vercel dispatch probe failed for ${label}`);
      let bundleJson;
      try { bundleJson = JSON.parse(readFileSync(bundlePath, "utf8")); } catch { throw new GateError("contract", `Warble Vercel dispatch probe for ${label} did not produce valid JSON`); }
      try { loadBundle(bundleJson); } catch (error) { throw new GateError("describe", `Warble Vercel bundle for ${label} failed the harness describe/compat check: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const native = await probeNativeSessionProducer({ bin, irPaths: { analysis: analysisIr, setup: setupIr, context_enrichment: enrichIr } });
    return { tiers: [...tiers].sort(), native };
  } finally { rmSync(probeRoot, { recursive: true, force: true }); }
}

function runAgentSdkContractProbe({ bin, analysisIr, setupIr, enrichIr }) {
  const help = run(bin, ["--help"], { capture: true });
  if (help.code !== 0 || !help.stdout.includes("manifest")) throw new GateError("contract", "agent-sdk dispatcher does not expose the generic manifest command");
  const evidence = [];
  for (const [label, ir, profile] of [["analysis", analysisIr, "genbi-default"], ["setup", setupIr, "genbi-setup"], ["context_enrichment", enrichIr, "genbi-enrich-context"]]) {
    const result = run(bin, ["manifest", ir, "--include-unavailable"], { capture: true });
    let manifest;
    try { manifest = JSON.parse(result.stdout); } catch { throw new GateError("contract", `agent-sdk manifest probe did not return valid JSON for ${label}`); }
    if (result.code !== 0 || !manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.manifest_version !== "0.1" || manifest.target !== "claude-agent-sdk:local" || manifest.profile !== profile || !Array.isArray(manifest.agents)) {
      throw new GateError("contract", `agent-sdk manifest probe is incompatible for ${label}`);
    }
    const agents = new Map(manifest.agents.map((agent) => [agent?.id, agent]));
    if (label !== "context_enrichment") {
      if (manifest.agents.some((agent) => !agent || typeof agent !== "object" || Array.isArray(agent) || Object.hasOwn(agent, "availability"))) {
        throw new GateError("contract", `agent-sdk display manifest unexpectedly marks ${label} unavailable`);
      }
    } else {
      for (const id of ["inspect_context", "draft_enrichment"]) {
        const agent = agents.get(id);
        if (!agent || typeof agent !== "object" || Array.isArray(agent) || Object.hasOwn(agent, "availability")) {
          throw new GateError("contract", `agent-sdk display manifest does not keep ${id} available`);
        }
      }
      const unavailable = agents.get("apply_enrichment");
      if (!unavailable || typeof unavailable !== "object" || Array.isArray(unavailable)
        || unavailable.availability?.status !== "unavailable"
        || unavailable.availability?.reason !== "component is unavailable on the configured runtime"
        || !["steps", "tools", "capabilities"].every((key) => Array.isArray(unavailable[key]) && unavailable[key].length === 0)
        || !["guardrails", "output_schema"].every((key) => unavailable[key] && typeof unavailable[key] === "object" && !Array.isArray(unavailable[key]) && Object.keys(unavailable[key]).length === 0)) {
        throw new GateError("contract", "agent-sdk display manifest does not redact unavailable apply_enrichment surfaces");
      }
      const defaultManifest = run(bin, ["manifest", ir], { capture: true });
      if (defaultManifest.code === 0 || !defaultManifest.stderr.includes("context_write_authz")) {
        throw new GateError("contract", "agent-sdk default enrichment manifest no longer preserves the context_write_authz wall");
      }
      const unavailableChat = run(bin, ["chat", ir, "--component", "apply_enrichment"], { capture: true });
      if (unavailableChat.code === 0 || !unavailableChat.stderr.includes("context_write_authz")) {
        throw new GateError("contract", "agent-sdk apply_enrichment chat no longer preserves the context_write_authz wall");
      }
    }
    evidence.push(`agent-sdk:manifest(${label})`);
  }
  return evidence;
}

function runCodexLocalContractProbe({ bin, analysisIr, setupIr, enrichIr }) {
  const evidence = [];
  for (const [label, ir, profile, components, extra] of [
    ["analysis", analysisIr, "genbi-default", ["answer_query", "generate_dashboard"], ["--orchestrator-model", "fixture", "--cheap-model", "fixture", "--strong-model", "fixture", "--inspect-tool", "get_context", "--query-tool", "run_sql"]],
    ["setup", setupIr, "genbi-setup", [undefined], ["--source-tool", "setup_execution", "--context-tool", "setup_execution"]],
    ["context_enrichment", enrichIr, "genbi-enrich-context", ["inspect_context", "draft_enrichment"], ["--model", "fixture", "--semantic-tool", "get_context", "--raw-material-tool", "get_context"]],
  ]) {
    for (const component of components) {
      const args = ["manifest", ir, "--server-command", process.execPath, ...(component ? ["--component", component] : []), ...extra];
      const result = run(bin, args, { capture: true });
      let manifest;
      try { manifest = JSON.parse(result.stdout); } catch { throw new GateError("contract", `codex-local manifest probe did not return valid JSON for ${label}`); }
      if (result.code !== 0 || !manifest || typeof manifest !== "object" || Array.isArray(manifest)
        || manifest.manifest_version !== "0.1" || manifest.target !== "codex:local"
        || manifest.profile !== profile || !Array.isArray(manifest.agents) || manifest.agents.length === 0) {
        throw new GateError("contract", `codex-local manifest probe is incompatible for ${label}`);
      }
      if (component && !manifest.agents.some((agent) => agent?.id === component)) {
        throw new GateError("contract", `codex-local manifest probe does not expose ${component} for ${label}`);
      }
    }
    evidence.push(`codex-local:manifest(${label})`);
  }
  return evidence;
}

function codexExecutableIdentity(bin) {
  const result = run(bin, ["--version"], { capture: true });
  const match = /^codex-cli ([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)\s*$/.exec(result.stdout);
  if (result.code !== 0 || !match) throw new GateError("contract", "Codex executable did not report a supported codex-cli version");
  let sourceRoot = bin;
  for (let candidate = path.dirname(bin); candidate !== path.dirname(candidate); candidate = path.dirname(candidate)) {
    const packageFile = path.join(candidate, "package.json");
    if (!existsSync(packageFile)) continue;
    try {
      const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
      if (metadata?.name === "@openai/codex") { sourceRoot = candidate; break; }
    } catch { /* A malformed ancestor package is not the selected Codex source. */ }
  }
  const source = sourceRoot === bin ? "standalone" : "npm:@openai/codex";
  return { source, version: match[1] };
}

function build() {
  const startedAt = Date.now();
  run("pnpm", ["run", "build"]);
  const entry = regularFile(path.join(packageRoot, "dist-server", "server", "bin.js"), "current dist-server entrypoint");
  // A build was run in this invocation, rather than accepting a previously-existing dist tree.
  return { entry, builtAt: new Date(startedAt).toISOString() };
}

export async function verifyLocalLaunch(options) {
  const mode = validateMode(options);
  const warbleBin = regularFile(options.warbleBin, "Warble binary");
  let agentSdkBin;
  let codexLocalBin;
  let codexBin;
  if (options.runtime === "subscription:claude") {
    agentSdkBin = regularFile(options.agentSdkBin, "agent-sdk dispatcher binary");
  } else {
    codexLocalBin = regularFile(options.codexLocalBin, "codex-local dispatcher binary");
    codexBin = regularFile(options.codexBin, "Codex executable");
  }

  const profiles = path.join(packageRoot, "profiles");
  const profile = directory(options.profile ?? path.join(profiles, "genbi-default"), "GenBI profile");
  const setupIr = assertIr(options.setupIr ?? path.join(profiles, "genbi-setup", "ir.golden.json"), "Setup IR");
  const enrichIr = assertIr(options.enrichIr ?? path.join(profiles, "genbi-enrich-context", "ir.golden.json"), "enrichment IR");
  const analysisIr = assertIr(options.analysisIr ?? path.join(profile, "ir.golden.json"), "analysis IR");
  const dist = options.skipBuild ? { entry: "(fixture skipped build)", builtAt: "(fixture skipped build)" } : build();
  const contracts = await runWarbleContractProbe({ bin: warbleBin, profile, setupIr, enrichIr, analysisIr });
  const runtimeProbes = options.runtime === "subscription:claude"
    ? runAgentSdkContractProbe({ bin: agentSdkBin, analysisIr, setupIr, enrichIr })
    : runCodexLocalContractProbe({ bin: codexLocalBin, analysisIr, setupIr, enrichIr });
  const codexIdentity = codexBin ? codexExecutableIdentity(codexBin) : undefined;
  return {
    result: "passed",
    mode: "bootstrap",
    ui: { packageRoot, launchCommand: "pnpm dev" },
    bff: { packageRoot, entry: dist.entry, build: dist, launchCommand: "pnpm run start:bff" },
    warble: { binary: warbleBin },
    profiles: { root: profiles, profile, setupIr, enrichIr, analysisIr },
    ...(agentSdkBin ? { agentSdk: { binary: agentSdkBin } } : {}),
    ...(codexLocalBin && codexBin ? {
      codexLocal: { binary: codexLocalBin },
      codex: { binary: codexBin, ...codexIdentity },
    } : {}),
    runtimeBinding: { runtime: options.runtime === "subscription:claude"
      ? { mode: "subscription", provider: "claude", dispatcher: "claude-agent-sdk" }
      : { mode: "subscription", provider: "codex", dispatcher: "codex-local", ...codexIdentity }, tiers: contracts.tiers },
    boot: mode,
    probes: ["compile", "dispatch:vercel(profile)", "dispatch:vercel(setup)", ...contracts.native.evidence, ...runtimeProbes],
  };
}

async function fetchRequired(url, label) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new GateError("readiness", `${label} is not reachable at ${url}`);
  }
  if (!response.ok) throw new GateError("smoke", `${label} returned HTTP ${response.status} at ${url}`);
  return response;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainEmptyObject(value) {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0;
}

function assertReadiness(condition, message) {
  if (!condition) throw new GateError("readiness", message);
}

/**
 * Prove the selected BFF is in the expected boot state, rather than only
 * accepting a reachable API.
 */
function assertLiveReadiness(readiness) {
  assertReadiness(isRecord(readiness), "BFF native-session readiness API returned an invalid shape");
  const runtime = readiness.runtime;
  assertReadiness(isRecord(runtime) && typeof runtime.configured === "boolean" && Number.isSafeInteger(runtime.generation) && runtime.generation >= 0, "BFF native-session readiness runtime binding is malformed");
  assertReadiness(runtime.configured === false, "BFF must report an unconfigured Runtime binding at launch");
  assertReadiness(!Object.hasOwn(runtime, "provider") && !Object.hasOwn(runtime, "target") && !Object.hasOwn(runtime, "targetLabel"), "BFF Runtime binding unexpectedly selects a native target before Setup ran");

  const purposes = readiness.purposes;
  assertReadiness(isRecord(purposes), "BFF native-session readiness purposes are malformed");
  for (const purpose of nativePurposes) {
    const expected = livePurposeContracts[purpose];
    const value = purposes[purpose];
    assertReadiness(isRecord(value) && value.scopeKind === expected.scopeKind && value.profile === expected.profile && typeof value.available === "boolean", `BFF native purpose ${purpose} readiness is malformed`);
    assertReadiness(isPlainEmptyObject(value.vendors), `BFF native purpose ${purpose} vendors projection is malformed`);
    assertReadiness(isRecord(value.producer) && value.producer.available === true && !Object.hasOwn(value.producer, "category"), `BFF native purpose ${purpose} producer is incompatible`);
    assertReadiness(value.reason === undefined || typeof value.reason === "string", `BFF native purpose ${purpose} reason is malformed`);
    assertReadiness(!Object.hasOwn(value, "target") && !Object.hasOwn(value, "targetLabel"), `BFF native purpose ${purpose} unexpectedly selects a target`);
    assertReadiness(value.available === false && value.reason === nativeRuntimeBindingRequiredReason, `BFF native purpose ${purpose} must be unavailable until Runtime authentication is saved`);
  }
  const mcp = readiness.mcp;
  assertReadiness(isRecord(mcp) && mcp.server === "GenBI MCP" && mcp.tool === "save_dashboard" && mcp.destination === "GenBI Artifacts" && typeof mcp.available === "boolean" && (mcp.reason === undefined || typeof mcp.reason === "string"), "BFF native-session MCP readiness is malformed");
  for (const purpose of liveRequiredPurposes) {
    const value = purposes[purpose];
    assertReadiness(value.available === true && value.reason === undefined, `BFF reports native purpose ${purpose} unavailable`);
  }
  return liveRequiredPurposes;
}

export async function verifyLive(options) {
  const bffUrl = new URL(options.bffUrl);
  const uiUrl = new URL(options.uiUrl);
  const readinessResponse = await fetchRequired(new URL("/api/native-sessions/readiness", bffUrl), "BFF native-session readiness API");
  let readiness;
  try { readiness = await readinessResponse.json(); } catch { throw new GateError("readiness", "BFF native-session readiness API did not return JSON"); }
  const requiredPurposes = assertLiveReadiness(readiness);
  const ui = await fetchRequired(uiUrl, "UI");
  if (!(await ui.text()).includes('id="root"')) throw new GateError("smoke", "UI response is not the GenBI Vite entrypoint");
  return { bffUrl: bffUrl.toString(), uiUrl: uiUrl.toString(), requiredPurposes };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await verifyLocalLaunch(options);
    if (options.live) result.live = await verifyLive(options);
    process.stdout.write(`launch gate PASSED\n${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error instanceof GateError) process.stderr.write(`launch gate BLOCKED [${error.code}]: ${error.message}\n`);
    else process.stderr.write(`launch gate BLOCKED [internal]: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
