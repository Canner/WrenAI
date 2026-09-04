#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "./rpc-client.mjs";

if (process.env.GENBI_RUN_CODEX_AUTHENTICATED !== "1") {
  process.stderr.write("Refusing to start an authenticated Codex turn without GENBI_RUN_CODEX_AUTHENTICATED=1\n");
  process.exit(2);
}

const codex = process.env.CODEX_BIN ?? "codex";
const authenticatedHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
if (!existsSync(path.join(authenticatedHome, "auth.json"))) {
  throw new Error("authenticated Codex home is unavailable");
}

const root = await mkdtemp(path.join(process.cwd(), ".runtime-sandbox-probe-"));
const outerCodexHome = path.join(root, "outer-codex-home");
const workspace = path.join(root, "workspace");
const mockMcp = fileURLToPath(new URL("../../test/fixtures/mock-mcp-server.mjs", import.meta.url));
await mkdir(outerCodexHome, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(path.join(outerCodexHome, "config.toml"), "");

const outerEnv = { ...process.env, CODEX_HOME: outerCodexHome };
for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY"]) delete outerEnv[key];
const server = spawn(codex, ["app-server", "--stdio", "--strict-config"], {
  cwd: workspace,
  env: outerEnv,
  stdio: ["pipe", "pipe", "pipe"],
});
const rpc = new RpcClient(server);

try {
  await rpc.request("initialize", {
    clientInfo: { name: "genbi-authenticated-sandbox-spike", title: "GenBI authenticated sandbox spike", version: "0.1.0" },
  });
  rpc.notify("initialized", {});

  const authEnv = {
    CODEX_HOME: authenticatedHome,
    OPENAI_API_KEY: null,
    CODEX_API_KEY: null,
    AZURE_OPENAI_API_KEY: null,
  };
  const login = await rpc.request("command/exec", {
    command: [codex, "login", "status"],
    cwd: workspace,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    env: authEnv,
    timeoutMs: 10_000,
  });
  if (login.exitCode !== 0 || !/logged in/i.test(`${login.stdout}\n${login.stderr}`)) {
    throw new Error("Codex authentication was not available inside the outer sandbox");
  }

  const nonce = randomUUID();
  const prompt = [
    "This is an authorized GenBI sandbox smoke test.",
    `First use the command tool to run exactly: /bin/echo GENBI_COMMAND_OK_${nonce}`,
    `Then call the MCP tool mcp__genbi_spike__query with exactly {\"sql\":\"select '${nonce}' as nonce\"}.`,
    "Do not read or write files. Do not call any other tool.",
    `After both tool calls succeed, reply exactly GENBI_AUTH_SMOKE_OK_${nonce}`,
  ].join("\n");
  const serverKey = "mcp_servers.genbi_spike";
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    workspace,
    "-c",
    "shell_environment_policy.inherit=none",
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    "project_root_markers=[]",
    "-c",
    'web_search="disabled"',
    "-c",
    "features.code_mode.enabled=false",
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
    ...[
      "standalone_web_search",
      "apps",
      "plugins",
      "in_app_browser",
      "browser_use",
      "computer_use",
      "image_generation",
      "skill_search",
      "multi_agent",
    ].flatMap((feature) => ["--disable", feature]),
    prompt,
  ];

  const processId = `auth-turn-${randomUUID()}`;
  let streamed = "";
  rpc.onNotification((message) => {
    if (message.method !== "command/exec/outputDelta" || message.params?.processId !== processId) return;
    streamed += Buffer.from(message.params.deltaBase64, "base64").toString("utf8");
  });
  const result = await rpc.request("command/exec", {
    command: [codex, ...args],
    cwd: workspace,
    sandboxPolicy: { type: "readOnly", networkAccess: true },
    env: authEnv,
    processId,
    streamStdoutStderr: true,
    timeoutMs: 120_000,
    outputBytesCap: 2_000_000,
  });

  const events = streamed
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line));
  const completedItems = events.filter((event) => event.type === "item.completed").map((event) => event.item);
  const commands = completedItems.filter((item) => item?.type === "command_execution");
  const mcpCalls = completedItems.filter((item) => item?.type === "mcp_tool_call");
  const messages = completedItems.filter((item) => item?.type === "agent_message");
  const commandOk = commands.some((item) => `${item.command ?? ""}${item.aggregated_output ?? ""}`.includes(`GENBI_COMMAND_OK_${nonce}`));
  const mcpOk = mcpCalls.some((item) => item.server === "genbi_spike" && item.tool === "query" && item.status === "completed");
  const finalOk = messages.some((item) => item.text?.trim() === `GENBI_AUTH_SMOKE_OK_${nonce}`);
  const forbiddenItems = completedItems.filter((item) => ["file_change", "web_search"].includes(item?.type));

  if (result.exitCode !== 0 || !commandOk || !mcpOk || !finalOk || forbiddenItems.length > 0) {
    const authHomeWriteDenied = /readonly database|operation not permitted/i.test(streamed);
    const stderrTail = streamed.slice(-1_000).replaceAll(authenticatedHome, "<CODEX_HOME>");
    throw new Error(JSON.stringify({
      message: "authenticated Codex sandbox smoke failed",
      exitCode: result.exitCode,
      commandOk,
      mcpOk,
      finalOk,
      authHomeWriteDenied,
      forbiddenItemTypes: forbiddenItems.map((item) => item.type),
      stderrTail,
    }));
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    authenticatedVia: "ChatGPT identity in caller-owned Codex home",
    outerSandbox: "readOnly with network enabled for the authenticated turn",
    innerSandbox: "codex exec read-only",
    checks: [
      { name: "authenticated Codex identity available inside outer sandbox", ok: true },
      { name: "harmless command completed", ok: commandOk },
      { name: "only allowlisted scoped MCP tool completed", ok: mcpOk },
      { name: "agent returned nonce-bound terminal attestation", ok: finalOk },
      { name: "no file-change or web-search item completed", ok: forbiddenItems.length === 0 },
    ],
  }, null, 2)}\n`);
} finally {
  rpc.close();
  await rm(root, { recursive: true, force: true });
}
