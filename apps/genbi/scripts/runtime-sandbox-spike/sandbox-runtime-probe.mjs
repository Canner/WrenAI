#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(process.cwd(), ".runtime-sandbox-probe-"));
const SRT_PACKAGE = "@anthropic-ai/sandbox-runtime@0.0.75";
const workspace = path.join(root, "workspace");
const settingsPath = path.join(root, "srt-settings.json");
const deniedPath = path.join(os.homedir(), `.genbi-srt-denied-${randomUUID()}`);
const insidePath = path.join(workspace, "written.txt");
const checks = [];
const networkServer = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain", Connection: "close" });
  response.end("network-ok");
});

await mkdir(workspace, { recursive: true });
await writeFile(deniedPath, "outside\n");
await writeFile(
  settingsPath,
  `${JSON.stringify({
    filesystem: {
      denyRead: [os.homedir()],
      allowRead: [workspace],
      allowWrite: [workspace],
      denyWrite: [],
    },
    network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: false },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
  }, null, 2)}\n`,
);

try {
  const insideWrite = await runSrt([
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(insidePath)}, "written")`,
  ]);
  check(insideWrite.code === 0 && (await readFile(insidePath, "utf8")) === "written", "workspace write allowed", insideWrite);

  const outsideReadCommand = ["/bin/cat", deniedPath];
  const outsideReadControl = await run(outsideReadCommand[0], outsideReadCommand.slice(1));
  check(
    outsideReadControl.code === 0 && outsideReadControl.stdout === "outside\n",
    "outside read positive control",
    outsideReadControl,
  );
  const outsideRead = await runSrt(outsideReadCommand);
  check(
    outsideRead.code !== 0 && /operation not permitted|permission denied/i.test(outsideRead.stderr),
    "outside read denied",
    outsideRead,
  );

  const outsideWrite = await runSrt([
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(deniedPath)}, "overwritten")`,
  ]);
  check(outsideWrite.code !== 0 && (await readFile(deniedPath, "utf8")) === "outside\n", "outside write denied", outsideWrite);

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
  const networkControl = await run(networkCommand[0], networkCommand.slice(1));
  check(
    networkControl.code === 0 && networkControl.stdout === "network-ok",
    "network positive control",
    networkControl,
  );
  const network = await runSrt(networkCommand);
  check(network.code === 23, "network denied", network);

  const descendant = await runSrt([
    process.execPath,
    "-e",
    [
      'const {spawnSync}=require("node:child_process");',
      `const r=spawnSync("/bin/cat",[${JSON.stringify(deniedPath)}],{encoding:"utf8"});`,
      'const denied=Number.isInteger(r.status)&&r.status!==0&&/operation not permitted|permission denied/i.test(r.stderr??"");',
      'if(denied){process.stdout.write("child-started-denied");process.exit(0);}',
      "process.exit(r.error?42:r.status===0?41:43);",
    ].join(""),
  ]);
  check(
    descendant.code === 0 && descendant.stdout === "child-started-denied",
    "sandbox covers descendant process",
    descendant,
  );

  const missingRuntime = await run("/definitely/missing/genbi-srt", ["--version"]);
  check(missingRuntime.spawnError?.code === "ENOENT", "missing sandbox runtime fails closed", missingRuntime);

  const claudeBin = process.env.CLAUDE_BIN ?? "claude";
  const claudeResolved = await resolveExecutable(claudeBin);
  if (claudeResolved) {
    const claudeSettings = path.join(root, "claude-srt-settings.json");
    await writeFile(
      claudeSettings,
      `${JSON.stringify({
        filesystem: {
          denyRead: [path.join(os.homedir(), ".ssh")],
          allowRead: [workspace, claudeResolved, path.dirname(claudeResolved)],
          allowWrite: [workspace],
          denyWrite: [],
        },
        network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: false },
        enableWeakerNestedSandbox: false,
        enableWeakerNetworkIsolation: false,
        allowAppleEvents: false,
      }, null, 2)}\n`,
    );
    const claudeVersion = await runSrt([claudeResolved, "--version"], claudeSettings);
    check(claudeVersion.code === 0 && /Claude Code|\d+\.\d+/.test(claudeVersion.stdout), "Claude binary starts inside whole-process sandbox", claudeVersion);
  } else {
    checks.push({ name: "Claude binary starts inside whole-process sandbox", ok: false, blocked: "claude executable unavailable" });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, platform: process.platform, arch: process.arch, checks }, null, 2)}\n`);
} finally {
  await Promise.all([
    closeServer(networkServer),
    rm(root, { recursive: true, force: true }),
    rm(deniedPath, { force: true }),
  ]);
}

async function runSrt(command, selectedSettings = settingsPath) {
  const explicit = process.env.SRT_BIN;
  if (explicit) return run(explicit, ["--settings", selectedSettings, ...command], workspace);
  return run("npm", ["exec", "--yes", "--package", SRT_PACKAGE, "--", "srt", "--settings", selectedSettings, ...command], workspace);
}

function run(command, args, cwd = workspace) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (spawnError) => {
      if (settled) return;
      settled = true;
      resolve({ code: null, signal: null, stdout, stderr, spawnError: { code: spawnError.code, message: spawnError.message } });
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, stdout, stderr });
    });
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

async function resolveExecutable(command) {
  if (path.isAbsolute(command)) {
    try {
      return await realpath(command);
    } catch {
      return undefined;
    }
  }
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    try {
      return await realpath(path.join(entry, command));
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

function check(condition, name, evidence) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`${name} failed: ${JSON.stringify(evidence)}`);
}
