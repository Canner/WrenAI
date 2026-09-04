#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "./rpc-client.mjs";

if (process.env.GENBI_RUN_CODEX_AUTHENTICATED !== "1") {
  process.stderr.write("Refusing to start an authenticated Codex turn without GENBI_RUN_CODEX_AUTHENTICATED=1\n");
  process.exit(2);
}

const codex = process.env.CODEX_BIN ?? "codex";
const runtimeHome = process.env.GENBI_PHASE0_CODEX_HOME;
if (!runtimeHome) throw new Error("GENBI_PHASE0_CODEX_HOME must name an externally authenticated runtime home");
if (path.resolve(runtimeHome) === path.resolve(path.join(os.homedir(), ".codex"))) {
  throw new Error("GENBI_PHASE0_CODEX_HOME must not be the caller's default Codex home");
}
await access(runtimeHome, constants.R_OK | constants.W_OK);
await access(path.join(runtimeHome, "auth.json"), constants.R_OK);

const root = await mkdtemp(path.join(process.cwd(), ".runtime-sandbox-probe-"));
const workspace = path.join(root, "workspace");
const mockMcp = fileURLToPath(new URL("../../test/fixtures/mock-mcp-server.mjs", import.meta.url));
await mkdir(workspace);
const nonce = randomUUID();
const serverKey = "mcp_servers.genbi_spike";
const serverArgs = [
  "-c",
  "shell_environment_policy.inherit=none",
  "-c",
  "project_doc_max_bytes=0",
  "-c",
  "project_root_markers=[]",
  "-c",
  'web_search="disabled"',
  "-c",
  `${serverKey}.command=${JSON.stringify(process.execPath)}`,
  "-c",
  `${serverKey}.args=[${JSON.stringify(mockMcp)}]`,
  "-c",
  `${serverKey}.enabled_tools=["query"]`,
  "-c",
  `${serverKey}.default_tools_approval_mode="approve"`,
  "-c",
  `${serverKey}.required=true`,
  "app-server",
  "--stdio",
  "--strict-config",
];
const serverEnv = { ...process.env, CODEX_HOME: runtimeHome };
for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY", "WREN_PROJECT_HOME"]) {
  delete serverEnv[key];
}
const server = spawn(codex, serverArgs, {
  cwd: workspace,
  env: serverEnv,
  stdio: ["pipe", "pipe", "pipe"],
});
const rpc = new RpcClient(server);

try {
  await rpc.request("initialize", {
    clientInfo: { name: "genbi-direct-authenticated-sandbox-spike", title: "GenBI direct authenticated sandbox spike", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  rpc.notify("initialized", {});

  const threadResult = await rpc.request("thread/start", {
    cwd: workspace,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    baseInstructions: "Follow the user's tool sequence exactly. Do not inspect or change files and do not use any unrequested tool.",
    developerInstructions: "This is an authorized GenBI sandbox compatibility probe. Use only the requested command and MCP tool.",
  });
  const threadId = threadResult.thread.id;
  const completedItems = [];
  const turnCompleted = waitForTurn(rpc, threadId, completedItems, 120_000);
  const prompt = [
    "First use the command tool to run exactly:",
    `/bin/echo GENBI_COMMAND_OK_${nonce}`,
    "Then call mcp__genbi_spike__query with exactly:",
    JSON.stringify({ sql: `select '${nonce}' as nonce` }),
    "Do not read or write files. Do not call web search or any other tool.",
    `After both tool calls succeed, reply exactly GENBI_DIRECT_AUTH_SMOKE_OK_${nonce}`,
  ].join("\n");

  const turnResult = await rpc.request("turn/start", {
    threadId,
    input: [{ type: "text", text: prompt }],
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    cwd: workspace,
  });
  const completed = await turnCompleted;
  if (completed.turn.id !== turnResult.turn.id) throw new Error("completed turn id did not match started turn");

  const commands = completedItems.filter((item) => item?.type === "commandExecution");
  const mcpCalls = completedItems.filter((item) => item?.type === "mcpToolCall");
  const messages = completedItems.filter((item) => item?.type === "agentMessage");
  const commandOk = commands.some((item) => `${item.command}\n${item.aggregatedOutput ?? ""}`.includes(`GENBI_COMMAND_OK_${nonce}`) && item.status === "completed");
  const mcpOk = mcpCalls.some((item) => item.server === "genbi_spike" && item.tool === "query" && item.status === "completed");
  const onlyScopedMcp = mcpCalls.length === 1 && mcpOk;
  const finalOk = messages.some((item) => item.text?.trim() === `GENBI_DIRECT_AUTH_SMOKE_OK_${nonce}`);
  const forbiddenItems = completedItems.filter((item) => ["fileChange", "webSearch"].includes(item?.type));
  const turnOk = completed.turn.status === "completed";

  if (!turnOk || !commandOk || !onlyScopedMcp || !finalOk || forbiddenItems.length > 0) {
    throw new Error(JSON.stringify({
      message: "direct authenticated Codex sandbox smoke failed",
      turnStatus: completed.turn.status,
      commandOk,
      onlyScopedMcp,
      finalOk,
      forbiddenItemTypes: forbiddenItems.map((item) => item.type),
      completedItemTypes: completedItems.map((item) => item?.type),
    }));
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    authenticatedVia: "ChatGPT identity in an externally authenticated isolated writable runtime home",
    transport: "direct app-server thread/start plus turn/start events",
    turnSandbox: "readOnly (writes denied) with command network denied",
    checks: [
      { name: "authenticated direct app-server turn completed", ok: turnOk },
      { name: "harmless command completed inside turn sandbox", ok: commandOk },
      { name: "only allowlisted scoped MCP tool completed", ok: onlyScopedMcp },
      { name: "agent returned nonce-bound terminal attestation", ok: finalOk },
      { name: "no file-change or web-search item completed", ok: forbiddenItems.length === 0 },
    ],
  }, null, 2)}\n`);
} finally {
  rpc.close();
  await rm(root, { recursive: true, force: true });
}

function waitForTurn(rpcClient, threadId, completedItems, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out after ${timeoutMs}ms waiting for turn/completed`));
    }, timeoutMs);
    const unsubscribe = rpcClient.onNotification((message) => {
      if (message.params?.threadId !== threadId) return;
      if (message.method === "item/completed") completedItems.push(message.params.item);
      if (message.method !== "turn/completed") return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(message.params);
    });
  });
}
