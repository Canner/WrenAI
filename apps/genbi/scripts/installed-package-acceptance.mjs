#!/usr/bin/env node

/**
 * Exercise the package at its distribution boundary, not through this checkout.
 *
 * This deliberately lives in scripts/ (which is not published). It packs the
 * current package, installs that tarball into a new project, and starts the
 * installed command through `npx --no-install`. The launched process gets a
 * minimal PATH and a require hook that turns any source-checkout read into a
 * hard failure, so a checkout-only fallback cannot make this pass.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeServerBounded, runBounded, spawnProcessGroup, stopProcessTree } from "./process-cleanup.mjs";
import { readSseFrames } from "./sse-frames.mjs";

const packageRoot = path.resolve(process.cwd());
const contextLoaderSource = path.resolve(packageRoot, "..", "context-loader");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "genbi-installed-package-"));
const packDirectory = path.join(tempRoot, "pack");
const contextLoaderPackDirectory = path.join(tempRoot, "context-loader-pack");
const contextLoaderStage = path.join(tempRoot, "context-loader-stage");
const installRoot = path.join(tempRoot, "fresh-install");
const workspaceRoot = path.join(tempRoot, "workspace");
const sourceAuditHook = path.join(tempRoot, "block-checkout-access.cjs");
const port = await reservePort();
const fixtureProvider = await startSetupFixtureProvider();
let serverProcess;
let phase = "initialize";

try {
  markPhase("pack");
  await Promise.all([mkdir(packDirectory), mkdir(contextLoaderPackDirectory), mkdir(installRoot), mkdir(workspaceRoot)]);
  await run("pnpm", ["pack", "--pack-destination", packDirectory], { cwd: packageRoot });
  const contextLoaderTarball = await packVerifiedContextLoaderFixture(contextLoaderSource, contextLoaderStage, contextLoaderPackDirectory);

  const packageTarball = await onlyTarball(packDirectory);
  const packedFiles = await tarFiles(packageTarball);
  assertPublishedFiles(packedFiles);
  const packedManifest = await tarJson(packageTarball, "package/package.json");
  if (packedManifest.dependencies?.["@wrenai/context-loader"] !== "0.1.0") {
    throw new Error("packed @wrenai/genbi does not retain an exact @wrenai/context-loader version");
  }

  markPhase("install");
  await run("npm", ["init", "--yes"], { cwd: installRoot });
  await run("npm", ["install", "--no-audit", "--no-fund", packageTarball, contextLoaderTarball], { cwd: installRoot });

  const installedPackageRoot = path.join(installRoot, "node_modules", "@wrenai", "genbi");
  if (!existsSync(path.join(installedPackageRoot, "package.json"))) {
    throw new Error("fresh install did not contain @wrenai/genbi");
  }
  const installedContextLoaderRoot = path.join(installRoot, "node_modules", "@wrenai", "context-loader");
  const installedContextLoaderBin = path.join(installedContextLoaderRoot, "bin", "wren-context-loader");
  if (!existsSync(path.join(installedContextLoaderRoot, "install-state.json")) || !existsSync(installedContextLoaderBin)) {
    throw new Error("fresh install did not preserve the verified context-loader package record");
  }
  for (const forbidden of ["scripts", "test", "examples", path.join("node_modules", "examples")]) {
    if (existsSync(path.join(installedPackageRoot, forbidden))) {
      throw new Error(`published package unexpectedly contains ${forbidden}`);
    }
  }

  markPhase("managed-wren-provision");
  await writeFile(sourceAuditHook, createSourceAuditHook(), { mode: 0o600 });
  await verifyInstalledCodexBackend({ installRoot, installedPackageRoot, sourceAuditHook, workspaceRoot, port, fixtureEndpoint: fixtureProvider.endpoint });
  await verifyInstalledManagedWrenProvision({ installRoot, installedPackageRoot, sourceAuditHook, workspaceRoot, port, fixtureEndpoint: fixtureProvider.endpoint, tempRoot });

  markPhase("start");
  await writeFile(sourceAuditHook, createSourceAuditHook(), { mode: 0o600 });
  const childEnv = controlledEnvironment({ installRoot, workspaceRoot, port, sourceAuditHook, fixtureEndpoint: fixtureProvider.endpoint });
  serverProcess = spawnProcessGroup("npx", ["--no-install", "genbi"], {
    cwd: installRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectOutput(serverProcess);

  markPhase("setup-connect");
  await waitForServer(port, output);
  await verifyFirstRunSetup(port, workspaceRoot, fixtureProvider);
  await verifyInstalledProjectBind({ installRoot, workspaceRoot, sourceAuditHook, installedPackageRoot, installedContextLoaderBin, port, fixtureEndpoint: fixtureProvider.endpoint });
  await stopProcessTree(serverProcess);
  serverProcess = undefined;

  markPhase("complete");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [
      { name: "tarball excludes checkout-only scripts, tests, fixtures, and examples", ok: true },
      { name: "fresh installed package rejects its staged managed-Wren manifest by default, then provisions only exact local fixture mirror bytes without checkout, ambient Python, or index resolution", ok: true },
      { name: "fresh install launches through npx with package-manager PATH", ok: true },
      { name: "installed Codex driver handles deterministic command events while the production backend remains unavailable", ok: true },
      { name: "first-run Setup connect terminal flow works without checkout access or development escapes", ok: true },
      { name: "fresh install binds through a verified package-local context loader with no Rust toolchain or checkout access", ok: true },
    ],
  }, null, 2)}\n`);
} finally {
  const cleanupErrors = [];
  markPhase("cleanup-child");
  if (serverProcess) await stopProcessTree(serverProcess).catch((error) => cleanupErrors.push(error));
  markPhase("cleanup-fixture");
  await closeServerBounded(fixtureProvider.server).catch((error) => cleanupErrors.push(error));
  markPhase("cleanup-temp");
  await rm(tempRoot, { recursive: true, force: true }).catch((error) => cleanupErrors.push(error));
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `installed package cleanup failed during ${phase}`);
}

function controlledEnvironment({ installRoot, workspaceRoot, port: selectedPort, sourceAuditHook: hook, fixtureEndpoint }) {
  const environment = { ...process.env };
  const developmentEscapes = [
    "NODE_PATH",
    "WREN_HOME",
    "WREN_PROJECT_HOME",
    "WREN_HARNESS_PROJECT",
    "WREN_HARNESS_PROFILE",
    "WREN_HARNESS_SETUP_IR",
    "WREN_HARNESS_ANALYSIS_IR",
    "WREN_HARNESS_ENRICH_IR",
    "WREN_HARNESS_ARTIFACTS_DIR",
    "WREN_HARNESS_SETUP_MAX_TURNS",
    "WREN_HARNESS_NATIVE_MCP_URL",
    "WREN_HARNESS_WREN_SHIM",
    "WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT",
    "WREN_HARNESS_WARBLE_BIN",
    "WREN_HARNESS_AGENT_SDK_BIN",
    "WREN_HARNESS_OUT",
    "WREN_HARNESS_MODELS_CONFIG",
    "WREN_HARNESS_TIER_ADAPTER",
    "WREN_HARNESS_CHAT_TIMEOUT_MS",
    "WREN_HARNESS_DEPLOYMENT",
    "WREN_HARNESS_CODEX_BIN",
    "WREN_HARNESS_CODEX_HOME",
    "WREN_HARNESS_CODEX_LOCAL_BIN",
    "WREN_HARNESS_MODE",
    "WREN_HARNESS_PROVIDER",
    "WREN_HARNESS_ADAPTER",
    "WREN_HARNESS_API_KEY",
    "WREN_HARNESS_MODEL",
    "WREN_HARNESS_ENDPOINT",
    "WREN_HARNESS_CASSETTE_DIR",
    "WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX",
    "WREN_HARNESS_CASSETTE_REAL_BIN",
    "WREN_HARNESS_CASSETTE_REPLAY_DELAY_MS",
    "WREN_HARNESS_CASSETTE_SCENARIO",
    "WREN_HARNESS_RUN_CASSETTE_DIR",
    "WREN_HARNESS_RUN_PORT",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "PYTHONHOME",
    "PYTHONPATH",
    "VIRTUAL_ENV",
    "PIP_INDEX_URL",
    "PIP_EXTRA_INDEX_URL",
    "PIP_FIND_LINKS",
    "PIP_REQUIRE_VIRTUALENV",
  ];
  for (const key of developmentEscapes) delete environment[key];
  if (developmentEscapes.some((key) => environment[key] !== undefined)) {
    throw new Error("development escape environment was not removed");
  }

  // `npx`'s env shebang needs Node itself and npm invokes its command through
  // the platform shell. The package bin is supplied only by the fresh install;
  // deliberately do not append the caller PATH or any developer tool paths.
  environment.PATH = [path.join(installRoot, "node_modules", ".bin"), path.dirname(process.execPath), "/bin"].join(path.delimiter);
  environment.PORT = String(selectedPort);
  environment.WREN_HARNESS_WORKSPACE_ROOT = workspaceRoot;
  environment.WREN_BFF_DB_PATH = path.join(installRoot, "first-run.sqlite");
  // Boot through the app's local OpenAI-compatible adapter. The fixture is a
  // loopback protocol double, not an authenticated or paid model endpoint.
  environment.WREN_HARNESS_MODE = "local";
  environment.WREN_HARNESS_ENDPOINT = fixtureEndpoint;
  environment.WREN_HARNESS_MODEL = "genbi-setup-fixture";
  environment.GENBI_PACKAGING_FORBIDDEN_ROOT = packageRoot;
  environment.NODE_OPTIONS = `--require=${hook}`;
  return environment;
}

async function packVerifiedContextLoaderFixture(source, stage, destination) {
  await cp(source, stage, { recursive: true });
  const binary = path.join(stage, "bin", "wren-context-loader");
  const content = Buffer.from("#!/bin/sh\nprintf '{\"context_version\":1,\"parseable\":true}' > \"$3\"\n");
  const binarySha256 = createHash("sha256").update(content).digest("hex");
  await writeFile(binary, content, { mode: 0o755 });
  await chmod(binary, 0o755);
  const packageJson = JSON.parse(await readFile(path.join(stage, "package.json"), "utf8"));
  await writeFile(path.join(stage, "artifacts.json"), JSON.stringify({ schema: 1, package: packageJson.name, version: packageJson.version, artifacts: { "darwin-arm64": { url: "https://example.invalid/context-loader.tar.gz", archiveSha256: "0".repeat(64), binarySha256, binaryPath: "wren-context-loader" } } }));
  await writeFile(path.join(stage, "install-state.json"), JSON.stringify({ package: packageJson.name, version: packageJson.version, target: "darwin-arm64", archiveSha256: "0".repeat(64), binarySha256, binaryPath: path.join("bin", "wren-context-loader") }));
  await run("npm", ["pack", "--ignore-scripts", "--pack-destination", destination], { cwd: stage });
  return onlyTarball(destination);
}

async function verifyInstalledProjectBind({ installRoot, workspaceRoot, sourceAuditHook, installedPackageRoot, installedContextLoaderBin, port: selectedPort, fixtureEndpoint }) {
  const project = path.join(workspaceRoot, "bound-project");
  const warble = path.join(installRoot, "warble-fixture");
  await mkdir(project);
  await writeFile(path.join(project, "wren_project.yml"), "name: bound-project\n");
  await writeFile(warble, "#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"-o\" ]; then shift; printf '{}' > \"$1\"; fi; shift; done\n", { mode: 0o755 });
  await chmod(warble, 0o755);
  const pipeline = pathToFileURL(path.join(installedPackageRoot, "dist-server", "harness", "compile", "pipeline.js")).href;
  const profile = path.join(installedPackageRoot, "profiles", "genbi-default");
  const bindEnv = controlledEnvironment({ installRoot, workspaceRoot, port: selectedPort, sourceAuditHook, fixtureEndpoint });
  bindEnv.XDG_CACHE_HOME = path.join(installRoot, "package-cache");
  const runBind = async () => run(process.execPath, ["--input-type=module", "--eval", `import { compileProfile } from ${JSON.stringify(pipeline)}; const result = await compileProfile({ profileSource: ${JSON.stringify(profile)}, userProject: ${JSON.stringify(project)}, mode: "native", warbleBin: ${JSON.stringify(warble)}, hubDir: "/fixture/hub" }); console.log(JSON.stringify({ cacheHit: result.cacheHit }));`], {
    cwd: installRoot,
    env: bindEnv,
  });
  const bound = await runBind();
  if (!/"cacheHit":false/.test(bound.stdout)) throw new Error(`installed package did not bind a user project through its context loader: ${bound.stdout}${bound.stderr}`);
  await writeFile(installedContextLoaderBin, "tampered", { mode: 0o755 });
  let failed = false;
  try {
    await runBind();
  } catch (error) {
    failed = /could not resolve the "wren-context-loader" binary/.test(String(error));
  }
  if (!failed) throw new Error("tampered package-local context loader did not fail closed");
}

/**
 * Runner-only fixture seam: production sees the packaged staged manifest and
 * fails closed. This mutates only the disposable npm installation, while the
 * installed module still derives its own package root and accepts no env
 * selector for artifacts or interpreters.
 */
async function verifyInstalledManagedWrenProvision({ installRoot, installedPackageRoot, sourceAuditHook, workspaceRoot: selectedWorkspaceRoot, port: selectedPort, fixtureEndpoint, tempRoot: selectedTempRoot }) {
  const manifestPath = path.join(installedPackageRoot, "managed-wren", "manifest.json");
  const packaged = JSON.parse(await readFile(manifestPath, "utf8"));
  if (packaged.activation !== "staged" || packaged.licenseApproval?.state !== "pending") throw new Error("packed managed-Wren manifest unexpectedly enables provisioning by default");
  const requestedRuntimeRoot = path.join(installRoot, "managed-wren-runtime");
  await mkdir(requestedRuntimeRoot, { mode: 0o700 });
  const runtimeRoot = await realpath(requestedRuntimeRoot);
  const moduleUrl = pathToFileURL(path.join(installedPackageRoot, "dist-server", "server", "managed-wren-runtime.js")).href;
  const childEnv = controlledEnvironment({ installRoot, workspaceRoot: selectedWorkspaceRoot, port: selectedPort, sourceAuditHook, fixtureEndpoint });
  const defaultProbe = await run(process.execPath, ["--input-type=module", "--eval", `import { provisionManagedWrenRuntime } from ${JSON.stringify(moduleUrl)}; try { await provisionManagedWrenRuntime({ runtimeRoot: ${JSON.stringify(runtimeRoot)} }); process.exitCode = 9; } catch (error) { console.log(error?.code ?? "unknown"); }`], { cwd: installRoot, env: childEnv });
  if (defaultProbe.stdout.trim() !== "codex_wren_runtime_unprovisioned") throw new Error(`staged installed manifest did not fail closed: ${defaultProbe.stdout}${defaultProbe.stderr}`);

  const fixture = await managedWrenFixture(selectedTempRoot);
  await writeFile(manifestPath, JSON.stringify(fixture.manifest), { mode: 0o600 });
  const provision = await run(process.execPath, ["--input-type=module", "--eval", `
    import { readFileSync } from "node:fs";
    import { provisionManagedWrenRuntime, resolveManagedWrenRuntime } from ${JSON.stringify(moduleUrl)};
    const fixtures = new Map(${JSON.stringify([[fixture.manifest.python.mirror.url, fixture.archive], [fixture.manifest.wheels[0].url, fixture.wheel]])});
    const calls = [];
    globalThis.fetch = async (input) => { const url = String(input); calls.push(url); const asset = fixtures.get(url); return asset ? new Response(readFileSync(asset), { status: 200 }) : new Response("not found", { status: 404 }); };
    const first = await provisionManagedWrenRuntime({ runtimeRoot: ${JSON.stringify(runtimeRoot)} });
    const second = resolveManagedWrenRuntime({ runtimeRoot: ${JSON.stringify(runtimeRoot)} });
    console.log(JSON.stringify({ first: first.generation_root, second: second.generation_root, calls, pip: readFileSync(first.generation_root + "/pip-args", "utf8") }));
  `], { cwd: installRoot, env: childEnv });
  let observed;
  try { observed = JSON.parse(provision.stdout); } catch { throw new Error(`installed managed-Wren fixture did not produce JSON: ${provision.stdout}${provision.stderr}`); }
  if (observed.first !== observed.second || JSON.stringify(observed.calls) !== JSON.stringify([fixture.manifest.python.mirror.url, fixture.manifest.wheels[0].url])) throw new Error(`installed managed-Wren provision used an unexpected generation or URL: ${JSON.stringify(observed)}`);
  if (typeof observed.pip !== "string" || !observed.pip.includes("--no-index --no-deps --require-hashes")) throw new Error(`installed managed-Wren provision did not use offline hash-locked install: ${JSON.stringify(observed)}`);
}

async function managedWrenFixture(root) {
  const fixtureRoot = path.join(root, "managed-wren-fixture"); const source = path.join(fixtureRoot, "source");
  const python = path.join(source, "python", "install", "bin", "python3.11"); await mkdir(path.dirname(python), { recursive: true });
  await writeFile(python, [
    "#!/bin/sh", 'if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then', '  target="$3"; if [ "$target" = "--copies" ]; then target="$4"; fi',
    '  /bin/mkdir -p "$target/bin" "$target/lib/python3.11/site-packages/wren" "$target/lib/python3.11/site-packages/dependency"',
    '  /bin/cp "$0" "$target/bin/python"', '  /bin/chmod 700 "$target/bin/python"',
    '  /usr/bin/printf "home = %s\\nexecutable = %s\\n" "$(/usr/bin/dirname \"$0\")" "$0" > "$target/pyvenv.cfg"',
    "  /usr/bin/printf '#!%s\\nfrom wren.cli import app\\n' \"$target/bin/python\" > \"$target/bin/wren\"", '  /bin/chmod 700 "$target/bin/wren"',
    "  /usr/bin/printf \"__version__ = '0.13.0'\\n\" > \"$target/lib/python3.11/site-packages/wren/__init__.py\"", "  /usr/bin/printf 'dependency = 1\\n' > \"$target/lib/python3.11/site-packages/dependency/__init__.py\"", '  /bin/chmod 600 "$target/lib/python3.11/site-packages/wren/__init__.py"', "  exit 0", "fi",
    'if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then', '  /usr/bin/printf "%s\\n" "$*" > "$HOME/pip-args"', "  exit 0", "fi", "exit 1", "",
  ].join("\n"), { mode: 0o700 });
  await chmod(python, 0o700);
  const archive = path.join(fixtureRoot, "python.tar.gz"); await run("tar", ["-czf", archive, "-C", source, "."]);
  const archiveSha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
  const wheel = path.join(fixtureRoot, "wrenai-0.13.0-py3-none-any.whl"); await writeFile(wheel, "fixture wheel\n", { mode: 0o600 });
  const wheelSha256 = createHash("sha256").update(await readFile(wheel)).digest("hex");
  const digestFile = (contents) => createHash("sha256").update(contents).digest("hex");
  const pythonTreeSha256 = digestFile(`install/bin/python3.11\0${"700"}\0file\0${digestFile(await readFile(python))}`);
  const packageDigest = digestFile(`__init__.py\0${"600"}\0file\0${digestFile("__version__ = '0.13.0'\n")}`);
  const sitePackagesDigest = digestFile([`dependency/__init__.py\0${"644"}\0file\0${digestFile("dependency = 1\n")}`, `wren/__init__.py\0${"600"}\0file\0${digestFile("__version__ = '0.13.0'\n")}`].join("\n"));
  const wheelName = path.basename(wheel); const closureSha256 = digestFile(`${wheelName}\0${wheelSha256}`); const release = "https://github.com/Canner/WrenAI/releases/download/managed-wren-fixture";
  return { archive, wheel, manifest: {
    schema: 1, activation: "approved", platform: "darwin-arm64", compatibility: { genbi: "0.0.4", profile: "genbi-native-v4", wren: "0.13.0" },
    python: { implementation: "cpython", version: "3.11.16", upstream: { release: "20260901", url: "https://example.invalid/python.tar.gz", sha256: archiveSha256 }, mirror: { url: `${release}/python.tar.gz`, sha256: archiveSha256 }, interpreterPath: "python/install/bin/python3.11" },
    wheels: [{ distribution: "wrenai", version: "0.13.0", filename: wheelName, url: `${release}/${wheelName}`, sourceUrl: "https://files.pythonhosted.org/fixture/wrenai-0.13.0-py3-none-any.whl", sha256: wheelSha256 }],
    runtime: { pythonArchivePath: "python.tar.gz", venvInterpreterPath: "venv/bin/python", launcherPath: "venv/bin/wren", module: "wren.cli:app", packagePath: "venv/lib/python3.11/site-packages/wren", sitePackagesPath: "venv/lib/python3.11/site-packages", pythonTreeSha256, packageTreeSha256: packageDigest, sitePackagesTreeSha256: sitePackagesDigest, closureSha256 },
    licenseApproval: { state: "approved", evidence: "packed-fixture-only" },
  } };
}

function createSourceAuditHook() {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const blocked = path.resolve(process.env.GENBI_PACKAGING_FORBIDDEN_ROOT);',
    'const inside = (value) => typeof value === "string" && (path.resolve(value) === blocked || path.resolve(value).startsWith(blocked + path.sep));',
    'const reject = (value) => { if (inside(value)) throw new Error("installed package attempted to read the source checkout"); };',
    'for (const name of ["accessSync", "createReadStream", "existsSync", "lstatSync", "openSync", "readFileSync", "readdirSync", "realpathSync", "statSync"]) {',
    '  const original = fs[name]; if (typeof original === "function") fs[name] = function(value, ...rest) { reject(value); return original.call(this, value, ...rest); };',
    '}',
    'for (const name of ["access", "lstat", "open", "readFile", "readdir", "realpath", "stat"]) {',
    '  const original = fs.promises[name]; if (typeof original === "function") fs.promises[name] = async function(value, ...rest) { reject(value); return original.call(this, value, ...rest); };',
    '}',
  ].join("\n");
}

async function verifyFirstRunSetup(selectedPort, selectedWorkspaceRoot, provider) {
  const baseUrl = `http://127.0.0.1:${selectedPort}`;
  const shell = await fetch(`${baseUrl}/`);
  const shellText = await shell.text();
  if (!shell.ok || !/<!doctype html>/i.test(shellText)) throw new Error("installed package did not serve the SPA shell");

  const initialMode = await json(`${baseUrl}/api/setup/mode`);
  if (initialMode.mode !== undefined) throw new Error(`first-run setup mode was not empty: ${JSON.stringify(initialMode)}`);
  const initialSteps = await json(`${baseUrl}/api/setup/steps`);
  if (!Array.isArray(initialSteps) || initialSteps.length === 0) throw new Error("first-run setup steps were unavailable");

  const selected = await json(`${baseUrl}/api/setup/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "create" }),
  });
  if (selected.mode !== "create" || !Array.isArray(selected.steps) || !selected.steps.some((step) => step?.key === "connect")) {
    throw new Error(`Setup create-mode selection failed: ${JSON.stringify(selected)}`);
  }

  const connect = await json(`${baseUrl}/api/setup/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName: "fixture-connect", sourceType: "postgres" }),
  });
  if (typeof connect.sessionId !== "string" || typeof connect.turnId !== "string") {
    throw new Error(`Setup connect did not create a turn: ${JSON.stringify(connect)}`);
  }
  const frames = await readSseFrames(`${baseUrl}/api/sessions/${encodeURIComponent(connect.sessionId)}/stream?turn=${encodeURIComponent(connect.turnId)}`);
  const terminal = frames.find((frame) => frame.event === "event" && frame.data?.kind === "setup_status");
  if (terminal?.data?.status !== "ok" || !/fixture connected/.test(terminal.data.message ?? "")) {
    throw new Error(`Setup connect did not reach its expected terminal result: ${JSON.stringify(frames)}`);
  }
  const completedSteps = await json(`${baseUrl}/api/setup/steps`);
  const stateFor = (key) => completedSteps.find((step) => step?.key === key)?.state;
  if (stateFor("runtime") !== "done" || stateFor("connect") !== "done" || stateFor("context") !== "current") {
    throw new Error(`Setup connect did not persist its step transition: ${JSON.stringify(completedSteps)}`);
  }
  if (!existsSync(path.join(selectedWorkspaceRoot, "fixture-connect", "wren_project.yml")) || !existsSync(path.join(selectedWorkspaceRoot, "fixture-connect", ".env"))) {
    throw new Error("Setup connect terminal success did not leave its required project artifacts");
  }
  if (provider.requests !== 3 || provider.toolCalls !== 3) {
    throw new Error(`fixture provider did not drive the expected setup tool loop: ${JSON.stringify({ requests: provider.requests, toolCalls: provider.toolCalls })}`);
  }
}

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`request ${new URL(url).pathname} failed with ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function startSetupFixtureProvider() {
  let requests = 0;
  let toolCalls = 0;
  const server = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400).end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions" || !Array.isArray(body.tools) || !body.tools.some((tool) => tool?.function?.name === "setup_execution")) {
      response.writeHead(400).end(JSON.stringify({ error: "unexpected local fixture request" }));
      return;
    }
    requests += 1;
    const reply = fixtureReply(requests);
    toolCalls += reply.tool_calls?.length ?? 0;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: `fixture-${requests}`, object: "chat.completion", created: 0, model: "genbi-setup-fixture", choices: [{ index: 0, message: reply, finish_reason: reply.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not start local Setup fixture provider");
  return {
    server,
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    get requests() { return requests; },
    get toolCalls() { return toolCalls; },
  };
}

function fixtureReply(requestNumber) {
  const call = (id, input) => ({ id, type: "function", function: { name: "setup_execution", arguments: JSON.stringify(input) } });
  if (requestNumber === 1) return { role: "assistant", content: null, tool_calls: [call("fixture-mkdir", { action: "exec", command: "mkdir -p fixture-connect" })] };
  if (requestNumber === 2) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        call("fixture-project", { action: "write", path: "fixture-connect/wren_project.yml", content: "name: fixture-connect\\n" }),
        call("fixture-env", { action: "write", path: "fixture-connect/.env", content: "" }),
      ],
    };
  }
  if (requestNumber === 3) return { role: "assistant", content: "SETUP_STATUS: ok - fixture connected" };
  return { role: "assistant", content: "SETUP_STATUS: error - fixture received an unexpected extra request" };
}

async function waitForServer(selectedPort, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (output.exitCode !== undefined) throw new Error(`npx genbi exited before startup (${output.exitCode}): ${output.text()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${selectedPort}/api/setup/mode`);
      if (response.ok) return;
    } catch {
      // The listener has not bound yet.
    }
    await delay(100);
  }
  throw new Error(`installed package did not start: ${output.text()}`);
}

function collectOutput(child) {
  let stdout = "";
  let stderr = "";
  let exitCode;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.once("exit", (code) => (exitCode = code));
  return { get exitCode() { return exitCode; }, text: () => `${stdout}${stderr}`.slice(-4_000) };
}

async function onlyTarball(directory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".tgz"));
  if (files.length !== 1) throw new Error(`expected one package tarball, found ${JSON.stringify(files)}`);
  return path.join(directory, files[0]);
}

async function tarFiles(tarball) {
  const result = await run("tar", ["-tzf", tarball]);
  return result.stdout.split("\n").filter(Boolean);
}

async function tarJson(tarball, entry) {
  const result = await run("tar", ["-xOzf", tarball, entry]);
  return JSON.parse(result.stdout);
}

async function verifyInstalledCodexBackend(input) {
  const { installRoot, installedPackageRoot } = input;
  const moduleUrl = (name) => pathToFileURL(path.join(installedPackageRoot, "dist-server", "server", "runtime-host", name + ".js")).href;
  const runtimeRoot = path.join(installRoot, "must-not-be-created");
  const code = `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { CodexAppServerBackend } from ${JSON.stringify(moduleUrl("codex-app-server"))};
    import { CODEX_CERTIFIED_ROWS } from ${JSON.stringify(moduleUrl("codex-compatibility"))};
    import { CodexSession } from ${JSON.stringify(moduleUrl("codex-session"))};
    assert.equal(CODEX_CERTIFIED_ROWS.length, 0);
    const backend = new CodexAppServerBackend({ executable: '/not-installed/codex', source: 'https://example.invalid/fixture', runtimeRoot: ${JSON.stringify(runtimeRoot)} });
    const readiness = (await backend.probe()).readiness;
    assert.notEqual(readiness.state, 'ready');
    assert.throws(() => backend.prepareLaunch());
    assert.equal(existsSync(${JSON.stringify(runtimeRoot)}), false);
    const messages = []; let handlers; let closes = 0; const events = [];
    const transport = {
      listen(value) { handlers = value; },
      close: async () => { closes++; },
      write(line) {
        const message = JSON.parse(line); messages.push(message);
        if (!message.id) return;
        let result;
        if (message.method === 'initialize') result = { codexHome: '/login', platformFamily: 'unix', platformOs: 'macos', userAgent: 'codex_cli_rs/0.146.0 fixture' };
        else if (message.method === 'config/read') result = { config: {} };
        else if (message.method === 'permissionProfile/list') result = { data: [{ id: 'genbi-scoped', allowed: true }], nextCursor: null };
        else if (message.method === 'command/exec') {
          assert.equal(message.params.permissionProfile, 'genbi-scoped');
          assert.equal(message.params.env.CODEX_HOME, null);
          assert.equal('sandboxPolicy' in message.params, false);
          handlers.data(Buffer.from(JSON.stringify({ method: 'command/exec/outputDelta', params: { processId: message.params.processId, stream: 'stdout', deltaBase64: 'b2s=', capReached: false } }) + '\\n'));
          result = { exitCode: 0, stdout: '', stderr: '' };
        } else throw new Error('unexpected method');
        handlers.data(Buffer.from(JSON.stringify({ id: message.id, result }) + '\\n'));
      }
    };
    const session = await CodexSession.connect(transport, { cwd: '/scope', codexHome: '/login', profile: 'genbi-scoped', args: [], environment: {}, commandEnvironment: { CODEX_HOME: null }, configuration: {} }, () => {}, event => events.push(event));
    const command = session.startCommand({ command: ['/bin/echo', 'ok'] });
    assert.deepEqual(await command.completed, { exitCode: 0 });
    assert.equal(events.length, 1);
    handlers.data(Buffer.from(JSON.stringify({ method: 'unknown/event', params: {} }) + '\\n'));
    assert.throws(() => session.startCommand({ command: ['/bin/echo'] }));
    await session.close(); assert.equal(closes, 1);
    assert.notEqual((await backend.probe()).readiness.state, 'ready');
    await backend.shutdown(); console.log('installed-codex-contract-ok');
  `;
  const result = await run("npx", ["--no-install", "--", "node", "--input-type=module", "--eval", code], { cwd: installRoot, env: controlledEnvironment(input) });
  if (result.stdout.trim() !== "installed-codex-contract-ok") throw new Error("installed Codex contract failed");
}

function assertPublishedFiles(files) {
  if (files.length === 0) throw new Error("package tarball is empty");
  const forbidden = /(^|\/)(scripts|test|tests|fixtures|examples|\.git)(\/|$)|(^|\/)node_modules(\/|$)/;
  const unexpected = files.filter((file) => forbidden.test(file));
  if (unexpected.length > 0) throw new Error(`package tarball contains repository-only files: ${JSON.stringify(unexpected)}`);
  for (const required of ["package/bin/genbi.mjs", "package/dist/index.html", "package/dist-server/server/bin.js", "package/managed-wren/manifest.json", "package/dist-server/server/runtime-host/codex-app-server.js", "package/dist-server/server/runtime-host/codex-session.js"]) {
    if (!files.includes(required)) throw new Error(`package tarball is missing ${required}`);
  }
}

function run(command, args, options) {
  return runBounded(command, args, options);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("could not reserve a loopback port");
  return address.port;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function markPhase(nextPhase) {
  phase = nextPhase;
  process.stderr.write(`[installed-package] phase=${phase}\n`);
}
