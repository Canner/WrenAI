#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const codex = process.env.CODEX_BIN ?? "codex";
const out = await mkdtemp(path.join(os.tmpdir(), "genbi-codex-schema-"));

try {
  const generated = await run(codex, ["app-server", "generate-json-schema", "--experimental", "--out", out]);
  if (generated.code !== 0) throw new Error(`schema generation failed: ${generated.stderr}`);

  const schema = JSON.parse(await readFile(path.join(out, "ClientRequest.json"), "utf8"));
  const definitions = schema.definitions ?? {};
  const turnSandbox = definitions.TurnStartParams?.properties?.sandboxPolicy;
  const commandExec = definitions.CommandExecParams;
  const shellDescription = definitions.ThreadShellCommandParams?.properties?.command?.description ?? "";
  const processDescription = definitions.ProcessSpawnParams?.description ?? "";

  const checks = [
    { name: "turn/start accepts sandboxPolicy", ok: Boolean(turnSandbox) },
    { name: "command/exec exposes sandboxPolicy", ok: Boolean(commandExec?.properties?.sandboxPolicy) },
    { name: "command/exec exposes PTY lifecycle fields", ok: ["processId", "tty", "streamStdin", "streamStdoutStderr", "size"].every((key) => key in (commandExec?.properties ?? {})) },
    { name: "thread/shellCommand is explicitly unsandboxed", ok: /unsandboxed with full access/.test(shellDescription) },
    { name: "process/spawn is explicitly outside Codex sandbox", ok: /without a Codex sandbox/.test(processDescription) },
  ];
  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) throw new Error(`schema contract checks failed: ${JSON.stringify(failed)}`);
  process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`);
} finally {
  await rm(out, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
