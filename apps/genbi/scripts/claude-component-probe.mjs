// Unauthenticated SDK/CLI compatibility probe. Every user input is intercepted.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeComponentStep } from "../dist-server/server/runtime-host/claude-component-step.js";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

if (!process.env.CLAUDE_BIN || !path.isAbsolute(process.env.CLAUDE_BIN)) throw Error("absolute CLAUDE_BIN required");
const executable = realpathSync(process.env.CLAUDE_BIN);
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "genbi-claude-step-")));
const cwd = path.join(root, "work"), home = path.join(root, "home"), login = path.join(root, "login");
for (const directory of [cwd, home, login]) mkdirSync(directory, { mode: 0o700 });
let child;
let closing;
let userInput = 0;
let accountReturned = false;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);
const groupExists = (pid) => {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; if (error.code === "EPERM") return true; throw error; }
};
const close = () => closing ??= (async () => {
  if (!child) return;
  const pid = child.pid;
  if (!Number.isSafeInteger(pid) || pid < 2) throw Error("probe child did not spawn");
  for (const [signal, attempts] of [["SIGTERM", 50], ["SIGKILL", 100]]) {
    try { process.kill(-pid, signal); } catch (error) { if (error.code !== "ESRCH" && error.code !== "EPERM") throw error; }
    for (let i = 0; i < attempts; i++) {
      if (!groupExists(pid)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw Error("owned SDK probe process group did not disappear");
})();
try {
  await assert.rejects(runClaudeComponentStep({
    cwd, executable, model: "claude-sonnet-4-5", account: { email: "nobody@example.test", tokenSource: "synthetic", subscriptionType: "synthetic" },
    environment: { PATH: "/usr/bin:/bin", HOME: home, CLAUDE_CONFIG_DIR: login }, assertCurrent() {}, close,
    spawn: (options) => {
      assert.equal(child, undefined, "exactly one vendor process");
      child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      child.stderr.resume(); return child;
    },
    query: (input) => {
      const actual = query({ ...input, prompt: (async function* () {
        for await (const _message of input.prompt) { userInput++; throw Error("model request forbidden"); }
      })() });
      return new Proxy(actual, { get(target, key) {
        if (key === "accountInfo") return async () => { const value = await target.accountInfo(); accountReturned = true; return value; };
        const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
      } });
    },
  }, { tier: "cheap", request: "no model", input: {}, consumes: {}, prompt: "no model", tools: {}, toolSchemas: {}, toolDescriptions: {}, signal: controller.signal }), { message: "Claude component protocol" });
  assert.equal(userInput, 0); assert.equal(accountReturned, true);
  console.log(JSON.stringify({ sdkAccountProbe: true, userInputSent: 0, realLogin: false }));
} finally {
  clearTimeout(timer); controller.abort();
  try { await close(); } finally { rmSync(root, { recursive: true, force: true }); }
}
