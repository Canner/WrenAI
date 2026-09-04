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
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { closeServerBounded, runBounded, spawnProcessGroup, stopProcessTree } from "./process-cleanup.mjs";
import { readSseFrames } from "./sse-frames.mjs";

const packageRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "genbi-installed-package-"));
const packDirectory = path.join(tempRoot, "pack");
const installRoot = path.join(tempRoot, "fresh-install");
const workspaceRoot = path.join(tempRoot, "workspace");
const sourceAuditHook = path.join(tempRoot, "block-checkout-access.cjs");
const port = await reservePort();
const fixtureProvider = await startSetupFixtureProvider();
let serverProcess;
let phase = "initialize";

try {
  markPhase("pack");
  await Promise.all([mkdir(packDirectory), mkdir(installRoot), mkdir(workspaceRoot)]);
  await run("pnpm", ["pack", "--pack-destination", packDirectory], { cwd: packageRoot });

  const packageTarball = await onlyTarball(packDirectory);
  const packedFiles = await tarFiles(packageTarball);
  assertPublishedFiles(packedFiles);

  markPhase("install");
  await run("npm", ["init", "--yes"], { cwd: installRoot });
  await run("npm", ["install", "--no-audit", "--no-fund", packageTarball], { cwd: installRoot });

  const installedPackageRoot = path.join(installRoot, "node_modules", "@wrenai", "genbi");
  if (!existsSync(path.join(installedPackageRoot, "package.json"))) {
    throw new Error("fresh install did not contain @wrenai/genbi");
  }
  for (const forbidden of ["scripts", "test", "examples", path.join("node_modules", "examples")]) {
    if (existsSync(path.join(installedPackageRoot, forbidden))) {
      throw new Error(`published package unexpectedly contains ${forbidden}`);
    }
  }

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
  await stopProcessTree(serverProcess);
  serverProcess = undefined;

  markPhase("complete");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [
      { name: "tarball excludes checkout-only scripts, tests, fixtures, and examples", ok: true },
      { name: "fresh install launches through npx with package-manager PATH", ok: true },
      { name: "first-run Setup connect terminal flow works without checkout access or development escapes", ok: true },
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

function assertPublishedFiles(files) {
  if (files.length === 0) throw new Error("package tarball is empty");
  const forbidden = /(^|\/)(scripts|test|tests|fixtures|examples|\.git)(\/|$)|(^|\/)node_modules(\/|$)/;
  const unexpected = files.filter((file) => forbidden.test(file));
  if (unexpected.length > 0) throw new Error(`package tarball contains repository-only files: ${JSON.stringify(unexpected)}`);
  for (const required of ["package/bin/genbi.mjs", "package/dist/index.html", "package/dist-server/server/bin.js"]) {
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
