#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { RpcClient } from "./rpc-client.mjs";

const CODEX_BIN = process.env.CODEX_BIN ?? "codex";
const root = await mkdtemp(path.join(process.cwd(), ".runtime-sandbox-probe-"));
const codexHome = path.join(root, "codex-home");
const workspace = path.join(root, "workspace");
const deniedPath = path.join(os.homedir(), `.genbi-codex-denied-${randomUUID()}`);
const profileId = "genbi-spike";

await mkdir(codexHome, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(path.join(workspace, "readable.txt"), "inside\n");
await writeFile(deniedPath, "outside\n");
await writeFile(
  path.join(codexHome, "config.toml"),
  [
    `default_permissions = "${profileId}"`,
    "",
    `[permissions.${profileId}]`,
    'description = "GenBI vendor sandbox compatibility probe"',
    "",
    `[permissions.${profileId}.filesystem]`,
    '":minimal" = "read"',
    "",
    `[permissions.${profileId}.filesystem.":workspace_roots"]`,
    '"." = "write"',
    "",
  ].join("\n"),
);

const childEnv = { ...process.env, CODEX_HOME: codexHome, WREN_PROJECT_HOME: "/ambient/poison" };
for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY"]) delete childEnv[key];

const server = spawn(CODEX_BIN, ["app-server", "--stdio", "--strict-config"], {
  cwd: workspace,
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"],
});
const rpc = new RpcClient(server);
const checks = [];
let timeoutParent;
let timeoutChild;
const networkServer = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain", Connection: "close" });
  response.end("network-ok");
});

try {
  const initialized = await rpc.request("initialize", {
    clientInfo: { name: "genbi-runtime-sandbox-spike", title: "GenBI runtime sandbox spike", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  rpc.notify("initialized", {});
  check(Boolean(initialized?.platformFamily), "initialize reports platform family", initialized);

  const policy = {
    type: "workspaceWrite",
    writableRoots: [workspace, codexHome],
    networkAccess: false,
    excludeSlashTmp: true,
    excludeTmpdirEnvVar: true,
  };

  const buffered = await rpc.request("command/exec", {
    command: [process.execPath, "-e", 'process.stdout.write("buffered-ok")'],
    cwd: workspace,
    sandboxPolicy: policy,
    timeoutMs: 5_000,
  });
  check(buffered.exitCode === 0 && buffered.stdout === "buffered-ok", "buffered command/exec", buffered);

  const insidePath = path.join(workspace, "written.txt");
  const insideWrite = await rpc.request("command/exec", {
    command: [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(insidePath)}, "written")`],
    cwd: workspace,
    sandboxPolicy: policy,
    timeoutMs: 5_000,
  });
  check(insideWrite.exitCode === 0 && (await readFile(insidePath, "utf8")) === "written", "workspace write allowed", insideWrite);

  const outsideWrite = await rpc.request("command/exec", {
    command: [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(deniedPath)}, "overwritten")`],
    cwd: workspace,
    sandboxPolicy: policy,
    timeoutMs: 5_000,
  });
  check(outsideWrite.exitCode !== 0 && (await readFile(deniedPath, "utf8")) === "outside\n", "outside write denied", outsideWrite);

  const outsideReadCommand = ["/bin/cat", deniedPath];
  const outsideReadControl = await runHostCommand(outsideReadCommand, workspace);
  check(
    outsideReadControl.exitCode === 0 && outsideReadControl.stdout === "outside\n",
    "outside read positive control",
    outsideReadControl,
  );
  const outsideRead = await rpc.request("command/exec", {
    command: outsideReadCommand,
    cwd: workspace,
    permissionProfile: profileId,
    timeoutMs: 5_000,
  });
  check(
    outsideRead.exitCode !== 0 && /operation not permitted|permission denied/i.test(outsideRead.stderr),
    "permission profile denies outside read",
    outsideRead,
  );

  await listenOnLoopback(networkServer);
  const networkAddress = networkServer.address();
  if (!networkAddress || typeof networkAddress === "string") throw new Error("network control server has no TCP address");
  const networkUrl = `http://127.0.0.1:${networkAddress.port}/probe`;
  const networkCommand = [
    process.execPath,
    "-e",
    [
      `fetch(${JSON.stringify(networkUrl)})`,
      '.then(async response=>{const body=await response.text();process.stdout.write(body);process.exitCode=response.ok&&body==="network-ok"?0:41;},',
      "()=>{process.exitCode=23;});",
    ].join(""),
  ];
  const networkControl = await runHostCommand(networkCommand, workspace);
  check(
    networkControl.exitCode === 0 && networkControl.stdout === "network-ok",
    "network positive control",
    networkControl,
  );
  const network = await rpc.request("command/exec", {
    command: networkCommand,
    cwd: workspace,
    sandboxPolicy: policy,
    timeoutMs: 8_000,
  });
  check(network.exitCode === 23, "network denied", network);

  const sanitized = await rpc.request("command/exec", {
    command: [process.execPath, "-e", 'process.stdout.write(process.env.WREN_PROJECT_HOME ?? "")'],
    cwd: workspace,
    sandboxPolicy: policy,
    env: { WREN_PROJECT_HOME: null },
    timeoutMs: 5_000,
  });
  check(sanitized.exitCode === 0 && sanitized.stdout === "", "ambient redirect can be explicitly removed", sanitized);

  const timeoutId = `timeout-${randomUUID()}`;
  let timeoutOutput = "";
  const unsubscribeTimeout = rpc.onNotification((message) => {
    if (message.method !== "command/exec/outputDelta" || message.params?.processId !== timeoutId) return;
    timeoutOutput += Buffer.from(message.params.deltaBase64, "base64").toString("utf8");
    const match = timeoutOutput.match(/PIDS:(\d+):(\d+)/);
    if (match) {
      timeoutParent = Number(match[1]);
      timeoutChild = Number(match[2]);
    }
  });
  const timeoutStartedAt = Date.now();
  const timeoutResultPromise = rpc.request("command/exec", {
    command: [
      process.execPath,
      "-e",
      [
        'const {spawn}=require("node:child_process");',
        'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});',
        'process.stdout.write(`PIDS:${process.pid}:${child.pid}\\n`);',
        "setInterval(()=>{},1000);",
      ].join(""),
    ],
    cwd: workspace,
    sandboxPolicy: policy,
    processId: timeoutId,
    streamStdoutStderr: true,
    timeoutMs: 750,
  });
  await waitFor(() => Number.isInteger(timeoutParent) && Number.isInteger(timeoutChild), "timeout probe process ids");
  const timeoutResult = await timeoutResultPromise;
  const timeoutElapsedMs = Date.now() - timeoutStartedAt;
  unsubscribeTimeout();
  check(
    timeoutResult.exitCode !== 0 && timeoutElapsedMs >= 600 && timeoutElapsedMs < 5_000,
    "command/exec timeout stops command",
    { result: timeoutResult, elapsedMs: timeoutElapsedMs },
  );
  await waitFor(() => !isAlive(timeoutParent) && !isAlive(timeoutChild), "timeout process-tree cleanup");
  check(true, "command/exec timeout cleans up command and descendant");

  const ptyId = `pty-${randomUUID()}`;
  const ptyOutput = [];
  const unsubscribe = rpc.onNotification((message) => {
    if (message.method === "command/exec/outputDelta" && message.params?.processId === ptyId) {
      ptyOutput.push(Buffer.from(message.params.deltaBase64, "base64").toString("utf8"));
    }
  });
  const ptyResultPromise = rpc.request("command/exec", {
    command: [
      process.execPath,
      "-e",
      [
        'process.stdout.write(`READY:${process.stdout.columns}x${process.stdout.rows}\\n`);',
        'process.on("SIGWINCH",()=>process.stdout.write(`RESIZE:${process.stdout.columns}x${process.stdout.rows}\\n`));',
        'process.stdin.on("data",d=>{const s=d.toString().trim(); if(s==="exit") process.exit(0); process.stdout.write(`ECHO:${s}\\n`);});',
        "setInterval(()=>{},1000);",
      ].join(""),
    ],
    cwd: workspace,
    sandboxPolicy: policy,
    processId: ptyId,
    tty: true,
    size: { cols: 80, rows: 24 },
    timeoutMs: 15_000,
  });
  await waitFor(() => ptyOutput.join("").includes("READY:80x24"), "PTY ready output");
  await rpc.request("command/exec/resize", { processId: ptyId, size: { cols: 100, rows: 40 } });
  await waitFor(() => ptyOutput.join("").includes("RESIZE:100x40"), "PTY resize output");
  await rpc.request("command/exec/write", { processId: ptyId, deltaBase64: Buffer.from("ping\n").toString("base64") });
  await waitFor(() => ptyOutput.join("").includes("ECHO:ping"), "PTY stdin/output");
  await rpc.request("command/exec/write", {
    processId: ptyId,
    deltaBase64: Buffer.from("exit\n").toString("base64"),
    closeStdin: true,
  });
  const ptyResult = await ptyResultPromise;
  unsubscribe();
  check(ptyResult.exitCode === 0, "PTY exits cleanly", { result: ptyResult, output: ptyOutput.join("") });

  const tuiId = `codex-tui-${randomUUID()}`;
  const tuiOutput = [];
  const unsubscribeTui = rpc.onNotification((message) => {
    if (message.method === "command/exec/outputDelta" && message.params?.processId === tuiId) {
      tuiOutput.push(Buffer.from(message.params.deltaBase64, "base64").toString("utf8"));
    }
  });
  let tuiSettled = false;
  const tuiResultPromise = rpc.request("command/exec", {
    command: [CODEX_BIN, "--no-alt-screen"],
    cwd: workspace,
    sandboxPolicy: policy,
    processId: tuiId,
    tty: true,
    size: { cols: 100, rows: 30 },
    env: { TERM: "xterm-256color" },
    timeoutMs: 10_000,
  }).then((result) => {
    tuiSettled = true;
    return result;
  });
  await waitFor(
    () => stripTerminalControl(tuiOutput.join("")).length > 40 || tuiSettled,
    "nested Codex TUI startup",
    5_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  let terminatedTui = false;
  if (!tuiSettled) {
    try {
      await rpc.request("command/exec/terminate", { processId: tuiId });
      terminatedTui = true;
    } catch (error) {
      if (!tuiSettled) throw error;
    }
  }
  const tuiResult = await tuiResultPromise;
  unsubscribeTui();
  const tuiText = stripTerminalControl(tuiOutput.join(""));
  check(terminatedTui && /codex|sign in|welcome/i.test(tuiText) && !/couldn't start|damaged|panic/i.test(tuiText), "Codex TUI starts inside command/exec PTY", {
    exitCode: tuiResult.exitCode,
    outputBytes: Buffer.byteLength(tuiOutput.join("")),
    terminatedByProbe: terminatedTui,
    outputPreview: tuiText.slice(0, 240),
  });

  const terminateId = `terminate-${randomUUID()}`;
  const terminateOutput = [];
  const unsubscribeTerminate = rpc.onNotification((message) => {
    if (message.method === "command/exec/outputDelta" && message.params?.processId === terminateId) {
      terminateOutput.push(Buffer.from(message.params.deltaBase64, "base64").toString("utf8"));
    }
  });
  const terminateResultPromise = rpc.request("command/exec", {
    command: [process.execPath, "-e", 'process.stdout.write("WAITING\\n"); setInterval(()=>{},1000)'],
    cwd: workspace,
    sandboxPolicy: policy,
    processId: terminateId,
    streamStdoutStderr: true,
    streamStdin: true,
    timeoutMs: 15_000,
  });
  await waitFor(() => terminateOutput.join("").includes("WAITING"), "terminate probe ready");
  await rpc.request("command/exec/terminate", { processId: terminateId });
  const terminateResult = await terminateResultPromise;
  unsubscribeTerminate();
  check(terminateResult.exitCode !== 0, "command/exec terminate stops process", terminateResult);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    codex: CODEX_BIN,
    platform: initialized,
    tui: {
      exitCode: tuiResult.exitCode,
      terminatedByProbe: terminatedTui,
      outputPreview: tuiText.slice(0, 240),
    },
    checks,
  }, null, 2)}\n`);
} finally {
  for (const pid of [timeoutChild, timeoutParent]) {
    if (!Number.isInteger(pid) || !isAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between the liveness check and kill.
    }
  }
  rpc.close();
  await ensureChildExited(server);
  await closeServer(networkServer);
  await Promise.all([
    rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }),
    rm(deniedPath, { force: true }),
  ]);
}

function check(condition, name, evidence) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`${name} failed: ${JSON.stringify(evidence)}`);
}

function stripTerminalControl(value) {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runHostCommand(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ exitCode: null, signal: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("exit", (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
  });
}

function listenOnLoopback(serverHandle) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    serverHandle.once("error", onError);
    serverHandle.listen(0, "127.0.0.1", () => {
      serverHandle.off("error", onError);
      resolve();
    });
  });
}

function closeServer(serverHandle) {
  if (!serverHandle.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    serverHandle.close((error) => (error ? reject(error) : resolve()));
  });
}

async function ensureChildExited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (exited) return;
  child.kill("SIGKILL");
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function waitFor(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out`);
}
