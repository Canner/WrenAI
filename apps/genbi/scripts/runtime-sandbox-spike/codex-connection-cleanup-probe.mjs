#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RpcClient } from "./rpc-client.mjs";

const codex = process.env.CODEX_BIN ?? "codex";
const root = await mkdtemp(path.join(process.cwd(), ".runtime-sandbox-probe-"));
const codexHome = path.join(root, "codex-home");
const workspace = path.join(root, "workspace");
await mkdir(codexHome, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(path.join(codexHome, "config.toml"), "");

const server = spawn(codex, ["app-server", "--stdio", "--strict-config"], {
  cwd: workspace,
  env: { ...process.env, CODEX_HOME: codexHome },
  stdio: ["pipe", "pipe", "pipe"],
});
const rpc = new RpcClient(server);
const processId = `disconnect-${randomUUID()}`;
let output = "";
let sandboxParent;
let sandboxChild;

try {
  await rpc.request("initialize", {
    clientInfo: { name: "genbi-runtime-cleanup-spike", title: "GenBI runtime cleanup spike", version: "0.1.0" },
  });
  rpc.notify("initialized", {});
  rpc.onNotification((message) => {
    if (message.method !== "command/exec/outputDelta" || message.params?.processId !== processId) return;
    output += Buffer.from(message.params.deltaBase64, "base64").toString("utf8");
    const match = output.match(/PIDS:(\d+):(\d+)/);
    if (match) {
      sandboxParent = Number(match[1]);
      sandboxChild = Number(match[2]);
    }
  });

  const commandResult = rpc.request("command/exec", {
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
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [workspace],
      networkAccess: false,
      excludeSlashTmp: true,
      excludeTmpdirEnvVar: true,
    },
    processId,
    streamStdoutStderr: true,
    timeoutMs: 20_000,
  }).catch(() => undefined);

  await waitFor(() => Number.isInteger(sandboxParent) && Number.isInteger(sandboxChild), "sandbox process ids");
  server.stdin.end();
  await onceExit(server);
  await commandResult;
  await waitFor(() => !isAlive(sandboxParent) && !isAlive(sandboxChild), "connection-close process-tree cleanup");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [{ name: "closing the app-server connection terminates command and descendant", ok: true }],
  }, null, 2)}\n`);
} finally {
  for (const pid of [sandboxChild, sandboxParent]) {
    if (!Number.isInteger(pid) || !isAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between the liveness check and kill.
    }
  }
  rpc.close();
  await rm(root, { recursive: true, force: true });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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

function onceExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}
