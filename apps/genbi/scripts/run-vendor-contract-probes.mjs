#!/usr/bin/env node

/**
 * Run only deterministic Phase 0 contracts. This runner deliberately never
 * invokes an authenticated probe or `turn/start`; exact tested-baseline
 * versions are evidence inputs, not a production certification claim.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const expected = { codex: "0.146.0", claude: "2.1.259", sandboxRuntime: "0.0.75" };
const spikeDirectory = path.join(process.cwd(), "scripts", "runtime-sandbox-spike");
const toolRoot = process.env.GENBI_VENDOR_TOOL_ROOT;
const isolatedHome = await mkdtemp(path.join(os.tmpdir(), "genbi-vendor-contract-"));

try {
  if (!toolRoot) throw new Error("GENBI_VENDOR_TOOL_ROOT is required for exact deterministic vendor-contract verification");
  const toolBin = path.join(toolRoot, "node_modules", ".bin");
  const codexBin = path.join(toolBin, "codex");
  const claudeBin = path.join(toolBin, "claude");
  const srtBin = path.join(toolBin, "srt");
  const sandboxPackage = JSON.parse(await readFile(path.join(toolRoot, "node_modules", "@anthropic-ai", "sandbox-runtime", "package.json"), "utf8"));
  if (sandboxPackage.version !== expected.sandboxRuntime) {
    throw new Error(`sandbox-runtime version must be ${expected.sandboxRuntime}, received ${JSON.stringify(sandboxPackage.version)}`);
  }

  await assertVersion(codexBin, ["--version"], expected.codex, "Codex");
  await assertVersion(claudeBin, ["--version"], expected.claude, "Claude");

  const probeEnv = cleanEnvironment({ codexBin, claudeBin, srtBin });
  for (const probe of [
    "rpc-client-probe.mjs",
    "codex-app-server-probe.mjs",
    "codex-connection-cleanup-probe.mjs",
    "codex-schema-contract-probe.mjs",
    "sandbox-runtime-probe.mjs",
  ]) {
    await run(process.execPath, [path.join(spikeDirectory, probe)], probeEnv);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    evidenceState: "tested_baseline",
    versions: expected,
    checks: [
      { name: "exact vendor versions selected before deterministic probes", ok: true },
      { name: "RPC, Codex lifecycle/schema/cleanup, and Claude SRT probes passed", ok: true },
      { name: "no authenticated or model-backed probe was selected", ok: true },
    ],
  }, null, 2)}\n`);
} finally {
  await rm(isolatedHome, { recursive: true, force: true });
}

function cleanEnvironment({ codexBin, claudeBin, srtBin }) {
  const environment = { ...process.env, CODEX_BIN: codexBin, CLAUDE_BIN: claudeBin, SRT_BIN: srtBin };
  for (const key of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "GENBI_RUN_CODEX_AUTHENTICATED",
    "GENBI_RUN_CLAUDE_AUTHENTICATED",
  ]) delete environment[key];
  environment.CODEX_HOME = path.join(isolatedHome, "codex-home");
  environment.CLAUDE_CONFIG_DIR = path.join(isolatedHome, "claude-home");
  return environment;
}

async function assertVersion(command, args, expectedVersion, label) {
  const result = await run(command, args, process.env);
  const observed = result.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (observed !== expectedVersion) {
    throw new Error(`${label} version must be ${expectedVersion}, received ${JSON.stringify(observed ?? result.stdout.trim())}`);
  }
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(command)} ${args.map(String).join(" ")} failed (${code}): ${stderr.slice(-4_000)}`)));
  });
}
