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
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const packageRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "genbi-installed-package-"));
const packDirectory = path.join(tempRoot, "pack");
const installRoot = path.join(tempRoot, "fresh-install");
const workspaceRoot = path.join(tempRoot, "workspace");
const sourceAuditHook = path.join(tempRoot, "block-checkout-access.cjs");
const port = await reservePort();
let serverProcess;

try {
  await Promise.all([mkdir(packDirectory), mkdir(installRoot), mkdir(workspaceRoot)]);
  await run("pnpm", ["pack", "--pack-destination", packDirectory], { cwd: packageRoot });

  const packageTarball = await onlyTarball(packDirectory);
  const packedFiles = await tarFiles(packageTarball);
  assertPublishedFiles(packedFiles);

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

  await writeFile(sourceAuditHook, createSourceAuditHook(), { mode: 0o600 });
  const childEnv = controlledEnvironment({ installRoot, workspaceRoot, port, sourceAuditHook });
  serverProcess = spawn("npx", ["--no-install", "genbi"], {
    cwd: installRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectOutput(serverProcess);

  await waitForServer(port, output);
  await verifyFirstRunSetup(port);
  await stop(serverProcess);
  serverProcess = undefined;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [
      { name: "tarball excludes checkout-only scripts, tests, fixtures, and examples", ok: true },
      { name: "fresh install launches through npx with package-manager PATH", ok: true },
      { name: "first-run Setup bootstrap flow works without checkout access or development escapes", ok: true },
    ],
  }, null, 2)}\n`);
} finally {
  if (serverProcess) await stop(serverProcess).catch(() => undefined);
  await rm(tempRoot, { recursive: true, force: true });
}

function controlledEnvironment({ installRoot, workspaceRoot, port: selectedPort, sourceAuditHook: hook }) {
  const environment = { ...process.env };
  const developmentEscapes = [
    "NODE_PATH",
    "WREN_HOME",
    "WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT",
    "WREN_HARNESS_WARBLE_BIN",
    "WREN_HARNESS_AGENT_SDK_BIN",
    "WREN_HARNESS_CODEX_BIN",
    "WREN_HARNESS_CODEX_HOME",
    "WREN_HARNESS_CODEX_LOCAL_BIN",
    "WREN_HARNESS_MODE",
    "WREN_HARNESS_PROVIDER",
    "WREN_HARNESS_ADAPTER",
    "WREN_HARNESS_API_KEY",
    "WREN_HARNESS_MODEL",
    "WREN_HARNESS_ENDPOINT",
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
  // Boot with a local mode only to make the setup control-plane test
  // deterministic. The runner never submits an agent turn or contacts it.
  environment.WREN_HARNESS_MODE = "local";
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

async function verifyFirstRunSetup(selectedPort) {
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

  const reset = await json(`${baseUrl}/api/setup/reset`, { method: "POST" });
  if (reset.ok !== true) throw new Error(`Setup reset failed: ${JSON.stringify(reset)}`);
  const afterReset = await json(`${baseUrl}/api/setup/mode`);
  if (afterReset.mode !== undefined) throw new Error(`Setup reset did not restore first-run mode: ${JSON.stringify(afterReset)}`);
}

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`request ${new URL(url).pathname} failed with ${response.status}: ${JSON.stringify(body)}`);
  return body;
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

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
  });
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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.slice(-4_000)}`)));
  });
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
