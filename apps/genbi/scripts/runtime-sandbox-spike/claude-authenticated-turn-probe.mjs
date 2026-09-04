#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.GENBI_RUN_CLAUDE_AUTHENTICATED !== "1") {
  process.stderr.write("Refusing to start an authenticated Claude turn without GENBI_RUN_CLAUDE_AUTHENTICATED=1\n");
  process.exit(2);
}

const runtimeHome = process.env.GENBI_PHASE0_CLAUDE_HOME;
if (!runtimeHome) throw new Error("GENBI_PHASE0_CLAUDE_HOME must name an externally authenticated runtime home");
for (const forbidden of [os.homedir(), path.join(os.homedir(), ".claude")]) {
  if (path.resolve(runtimeHome) === path.resolve(forbidden)) {
    throw new Error("GENBI_PHASE0_CLAUDE_HOME must not be the caller's default home or Claude config directory");
  }
}
await access(runtimeHome, constants.R_OK | constants.W_OK);
await access(path.join(runtimeHome, ".claude.json"), constants.R_OK);

const claude = await resolveExecutable(process.env.CLAUDE_BIN ?? "claude");
if (!claude) throw new Error("claude executable is unavailable");
const root = await mkdtemp(path.join(process.cwd(), ".runtime-sandbox-probe-"));
const workspace = path.join(root, "workspace");
const runtimeTmp = await mkdtemp(path.join(os.tmpdir(), "genbi-claude-tmp-"));
const nonce = randomUUID();
const deniedPath = path.join(os.tmpdir(), `genbi-claude-denied-${nonce}`);
const insidePath = path.join(workspace, "inside.txt");
const commandAttestationPath = path.join(workspace, "command-attestation.txt");
const hookAttestationPath = path.join(workspace, "hook-attestation.log");
const mcpAttestationPath = path.join(workspace, "mcp-attestation.log");
const hookPath = path.join(workspace, "sandbox-hook.mjs");
const commandChildPath = path.join(workspace, "command-child.mjs");
const srtSettingsPath = path.join(workspace, "srt-settings.json");
const claudeSettingsPath = path.join(workspace, "claude-settings.json");
const mcpConfigPath = path.join(workspace, "mcp.json");
const claudeDebugPath = path.join(workspace, "claude-debug.log");
const mcpServer = fileURLToPath(new URL("./claude-sandbox-mcp-server.mjs", import.meta.url));
const oauthToken = loadMacClaudeOAuthToken();
const realTokenHash = createHash("sha256").update(oauthToken).digest("hex");
await mkdir(workspace);
await writeFile(deniedPath, "outside-canary\n");
await writeFile(insidePath, `INSIDE_${nonce}\n`);
await writeFile(
  hookPath,
  [
    'import { appendFileSync, readFileSync } from "node:fs";',
    'import { createHash } from "node:crypto";',
    `const deniedPath = ${JSON.stringify(deniedPath)};`,
    `const attestationPath = ${JSON.stringify(hookAttestationPath)};`,
    `const nonce = ${JSON.stringify(nonce)};`,
    `const realTokenHash = ${JSON.stringify(realTokenHash)};`,
    'const visibleTokenHash = createHash("sha256").update(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "").digest("hex");',
    "const tokenMasked = visibleTokenHash !== realTokenHash;",
    "try {",
    '  readFileSync(deniedPath, "utf8");',
    '  appendFileSync(attestationPath, `HOOK_ESCAPED_${nonce}_${tokenMasked ? "TOKEN_MASKED" : "TOKEN_LEAKED"}\\n`);',
    "  process.exit(42);",
    "} catch {",
    '  appendFileSync(attestationPath, `HOOK_DENIED_${nonce}_${tokenMasked ? "TOKEN_MASKED" : "TOKEN_LEAKED"}\\n`);',
    "  if (!tokenMasked) process.exit(43);",
    "}",
    "",
  ].join("\n"),
);
await writeFile(
  commandChildPath,
  [
    'import { createHash } from "node:crypto";',
    'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
    `const deniedPath = ${JSON.stringify(deniedPath)};`,
    `const attestationPath = ${JSON.stringify(commandAttestationPath)};`,
    `const nonce = ${JSON.stringify(nonce)};`,
    `const realTokenHash = ${JSON.stringify(realTokenHash)};`,
    'const visibleTokenHash = createHash("sha256").update(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "").digest("hex");',
    "const tokenMasked = visibleTokenHash !== realTokenHash;",
    'writeFileSync(attestationPath, `COMMAND_STARTED_${nonce}_${tokenMasked ? "TOKEN_MASKED" : "TOKEN_LEAKED"}\\n`);',
    "try {",
    '  readFileSync(deniedPath, "utf8");',
    '  appendFileSync(attestationPath, `COMMAND_ESCAPED_${nonce}_${tokenMasked ? "TOKEN_MASKED" : "TOKEN_LEAKED"}\\n`);',
    "  process.exit(41);",
    "} catch {",
    '  appendFileSync(attestationPath, `COMMAND_DENIED_${nonce}_${tokenMasked ? "TOKEN_MASKED" : "TOKEN_LEAKED"}\\n`);',
    "  if (!tokenMasked) process.exit(43);",
    "}",
    "",
  ].join("\n"),
);

const allowedDomains = providerDomains();
const credentialInjectHosts = ["api.anthropic.com"];
const shellCommand = `${process.execPath} ${shellQuote(commandChildPath)}`;
const bashPermission = `Bash(${process.execPath} *)`;
await writeFile(
  srtSettingsPath,
  `${JSON.stringify({
    filesystem: {
      denyRead: [os.homedir(), deniedPath],
      allowRead: [workspace, runtimeTmp, runtimeHome, claude, path.dirname(claude), mcpServer],
      allowWrite: [workspace, runtimeTmp, runtimeHome],
      denyWrite: [deniedPath],
    },
    network: { allowedDomains, deniedDomains: [], allowLocalBinding: false, tlsTerminate: {} },
    credentials: {
      files: [{ path: path.join(runtimeHome, ".claude.json"), mode: "deny" }],
      envVars: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "mask", injectHosts: credentialInjectHosts }],
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
  }, null, 2)}\n`,
);
await writeFile(
  claudeSettingsPath,
  `${JSON.stringify({
    permissions: {
      allow: ["Read", bashPermission, "mcp__genbi_spike__query"],
      deny: ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"],
    },
    sandbox: { enabled: false },
    hooks: {
      PreToolUse: [{
        matcher: "Bash|Read|mcp__genbi_spike__query",
        hooks: [{ type: "command", command: `${process.execPath} ${hookPath}`, timeout: 10 }],
      }],
    },
  }, null, 2)}\n`,
);
await writeFile(
  mcpConfigPath,
  `${JSON.stringify({
    mcpServers: {
      genbi_spike: {
        type: "stdio",
        command: process.execPath,
        args: [mcpServer],
        env: {
          GENBI_DENIED_PATH: deniedPath,
          GENBI_MCP_ATTESTATION_PATH: mcpAttestationPath,
          GENBI_SANDBOX_NONCE: nonce,
          GENBI_REAL_TOKEN_HASH: realTokenHash,
        },
      },
    },
  }, null, 2)}\n`,
);

const childEnv = {
  ...process.env,
  CLAUDE_CONFIG_DIR: runtimeHome,
  CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
  CLAUDE_CODE_TMPDIR: runtimeTmp,
  CLAUDE_TMPDIR: runtimeTmp,
  BUN_TMPDIR: runtimeTmp,
  TMPDIR: runtimeTmp,
  TMP: runtimeTmp,
  TEMP: runtimeTmp,
};
delete childEnv.ANTHROPIC_BASE_URL;
for (const key of [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "WREN_PROJECT_HOME",
  "BASH_ENV",
  "ENV",
  "ZDOTDIR",
  "PROMPT_COMMAND",
]) delete childEnv[key];

try {
  const configProbe = await runSrt([
    process.execPath,
    "-e",
    'const fs=require("node:fs"); const os=require("node:os"); const {spawnSync}=require("node:child_process"); const p=process.env.CLAUDE_CONFIG_DIR; const keychain=spawnSync("/usr/bin/security",["find-generic-password","-s","Claude Code-credentials","-a",os.userInfo().username,"-w"],{stdio:"ignore"}); process.stdout.write(JSON.stringify({configDirVisible:Boolean(p),credentialsReadable:Boolean(p&&fs.existsSync(`${p}/.claude.json`)),keychainCredentialAccessible:keychain.status===0}))',
  ], childEnv, 30_000);
  let parsedConfigProbe = {};
  try {
    parsedConfigProbe = JSON.parse(configProbe.stdout);
  } catch {
    // Report only booleans below.
  }
  const authStatus = await runSrt([claude, "auth", "status", "--json"], childEnv, 30_000);
  let parsedAuth = {};
  try {
    parsedAuth = JSON.parse(authStatus.stdout);
  } catch {
    // Report only sanitized process metadata below.
  }
  if (authStatus.code !== 0 || !parsedAuth.loggedIn) {
    throw new Error(JSON.stringify({
      message: "Claude authentication was not available inside sandbox-runtime",
      exitCode: authStatus.code,
      signal: authStatus.signal,
      loggedIn: Boolean(parsedAuth.loggedIn),
      authMethod: parsedAuth.authMethod ?? "unknown",
      configDirVisible: Boolean(parsedConfigProbe.configDirVisible),
      credentialsReadable: Boolean(parsedConfigProbe.credentialsReadable),
      keychainCredentialAccessible: Boolean(parsedConfigProbe.keychainCredentialAccessible),
      stderrTail: authStatus.stderr.slice(-1_200)
        .replaceAll(runtimeHome, "<CLAUDE_CONFIG_DIR>")
        .replaceAll(os.homedir(), "<HOME>"),
    }));
  }

  if (process.env.GENBI_CLAUDE_PREFLIGHT_ONLY === "1") {
    process.stdout.write(`${JSON.stringify({ ok: true, preflightOnly: true, authMethod: parsedAuth.authMethod })}\n`);
  } else if (process.env.GENBI_CLAUDE_PREFLIGHT_ONLY === "command-child") {
    const commandResult = await runSrt([process.execPath, commandChildPath], childEnv, 30_000);
    const commandAttestationLines = (await readOptional(commandAttestationPath)).trim().split(/\r?\n/).filter(Boolean);
    const canary = await readFile(deniedPath, "utf8");
    const commandOk = commandResult.code === 0
      && commandAttestationLines.length === 2
      && commandAttestationLines[0] === `COMMAND_STARTED_${nonce}_TOKEN_MASKED`
      && commandAttestationLines[1] === `COMMAND_DENIED_${nonce}_TOKEN_MASKED`;
    const canaryOk = canary === "outside-canary\n";
    if (!commandOk || !canaryOk) {
      throw new Error(JSON.stringify({
        message: "Claude command-child sandbox preflight failed",
        exitCode: commandResult.code,
        commandOk,
        canaryOk,
      }));
    }
    process.stdout.write(`${JSON.stringify({ ok: true, preflightOnly: "command-child", commandOk, canaryOk })}\n`);
  } else if (process.env.GENBI_CLAUDE_PREFLIGHT_ONLY === "shell-command-child") {
    const shellResult = await runSrt([
      process.env.SHELL ?? "/bin/sh",
      "-c",
      shellCommand,
    ], childEnv, 30_000);
    const commandAttestationLines = (await readOptional(commandAttestationPath)).trim().split(/\r?\n/).filter(Boolean);
    const canary = await readFile(deniedPath, "utf8");
    const commandOk = shellResult.code === 0
      && commandAttestationLines.length === 2
      && commandAttestationLines[0] === `COMMAND_STARTED_${nonce}_TOKEN_MASKED`
      && commandAttestationLines[1] === `COMMAND_DENIED_${nonce}_TOKEN_MASKED`;
    process.stdout.write(`${JSON.stringify({
      ok: true,
      preflightOnly: "shell-command-child",
      shellExitCode: shellResult.code,
      shellSignal: shellResult.signal,
      commandOk,
      canaryOk: canary === "outside-canary\n",
      commandAttestationStatus: commandAttestationLines[0]?.startsWith(`COMMAND_STARTED_${nonce}_`)
        ? "started"
        : commandAttestationLines.length ? "unexpected" : "missing",
      stderrCategory: classifyText(shellResult.stderr, shellResult.code !== 0),
    })}\n`);
  } else if (process.env.GENBI_CLAUDE_PREFLIGHT_ONLY === "temp-write") {
    const tempResult = await runSrt([
      process.execPath,
      "-e",
      'const fs=require("node:fs"),os=require("node:os"),path=require("node:path"); const values=[process.env.CLAUDE_CODE_TMPDIR,process.env.CLAUDE_TMPDIR,process.env.BUN_TMPDIR,process.env.TMPDIR,process.env.TMP,process.env.TEMP]; if(new Set(values).size!==1||values[0]!==os.tmpdir())process.exit(41); fs.writeFileSync(path.join(os.tmpdir(),"genbi-temp-preflight"),"ok")',
    ], childEnv, 30_000);
    process.stdout.write(`${JSON.stringify({
      ok: tempResult.code === 0,
      preflightOnly: "temp-write",
      tempExitCode: tempResult.code,
      tempSignal: tempResult.signal,
      stderrCategory: classifyText(tempResult.stderr, tempResult.code !== 0),
    })}\n`);
  } else if (process.env.GENBI_CLAUDE_PREFLIGHT_ONLY === "nested-seatbelt") {
    if (process.platform !== "darwin") throw new Error("nested-seatbelt preflight is macOS-only");
    const nestedResult = await runSrt([
      "/usr/bin/sandbox-exec",
      "-p",
      "(version 1) (allow default)",
      process.execPath,
      commandChildPath,
    ], childEnv, 30_000);
    const commandAttestationLines = (await readOptional(commandAttestationPath)).trim().split(/\r?\n/).filter(Boolean);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      preflightOnly: "nested-seatbelt",
      nestedExitCode: nestedResult.code,
      nestedSignal: nestedResult.signal,
      commandAttestationStatus: commandAttestationLines[0]?.startsWith(`COMMAND_STARTED_${nonce}_`)
        ? "started"
        : commandAttestationLines.length ? "unexpected" : "missing",
      stderrCategory: classifyText(nestedResult.stderr, nestedResult.code !== 0),
    })}\n`);
  } else {
  const prompt = [
    "This is an authorized GenBI sandbox compatibility probe. Perform exactly these steps in order:",
    `1. Use Read on ${insidePath} and confirm it contains INSIDE_${nonce}.`,
    `2. Use Read on ${deniedPath}. This read must fail; continue after the expected error.`,
    `3. Use Bash to run exactly: ${shellCommand}`,
    `4. Call mcp__genbi_spike__query with exactly {\"nonce\":\"${nonce}\"}.`,
    "Do not use any other tool and do not retry a failed tool.",
    `After the sequence, reply exactly GENBI_CLAUDE_AUTH_SMOKE_OK_${nonce}`,
  ].join("\n");
  const claudeArgs = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--debug-file",
    claudeDebugPath,
    "--include-hook-events",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigPath,
    "--settings",
    claudeSettingsPath,
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-chrome",
    "--tools",
    "Read,Bash,mcp__genbi_spike__query",
    "--allowedTools",
    "Read",
    bashPermission,
    "mcp__genbi_spike__query",
    "--model",
    "haiku",
    "--effort",
    "low",
    "--max-budget-usd",
    "1.00",
    prompt,
  ];
  const result = await runSrt([claude, ...claudeArgs], childEnv, 180_000);
  const claudeDebug = await readOptional(claudeDebugPath);
  const events = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line));
  const blocks = events.flatMap((event) => Array.isArray(event.message?.content) ? event.message.content : []);
  const toolUses = blocks.filter((block) => block.type === "tool_use");
  const toolResults = blocks.filter((block) => block.type === "tool_result");
  const usesById = new Map(toolUses.map((use) => [use.id, use]));
  const insideRead = toolUses.find((use) => use.name === "Read" && use.input?.file_path === insidePath);
  const deniedRead = toolUses.find((use) => use.name === "Read" && use.input?.file_path === deniedPath);
  const deniedReadResult = toolResults.find((item) => item.tool_use_id === deniedRead?.id);
  const bashUses = toolUses.filter((use) => use.name === "Bash");
  const bashUse = bashUses.length === 1 ? bashUses[0] : undefined;
  const bashResult = toolResults.find((item) => item.tool_use_id === bashUse?.id);
  const mcpUse = toolUses.find((use) => use.name === "mcp__genbi_spike__query" && use.input?.nonce === nonce);
  const unexpectedTools = toolUses.filter((use) => !["Read", "Bash", "mcp__genbi_spike__query"].includes(use.name));
  const resultEvent = events.findLast((event) => event.type === "result");
  const hookLines = (await readOptional(hookAttestationPath)).trim().split(/\r?\n/).filter(Boolean);
  const commandAttestationLines = (await readOptional(commandAttestationPath)).trim().split(/\r?\n/).filter(Boolean);
  const mcpAttestation = (await readOptional(mcpAttestationPath)).trim();
  const canary = await readFile(deniedPath, "utf8");
  const insideReadOk = Boolean(insideRead) && result.stdout.includes(`INSIDE_${nonce}`);
  const deniedReadOk = Boolean(deniedRead && deniedReadResult?.is_error);
  const hookOk = hookLines.length >= 4 && hookLines.every((line) => line === `HOOK_DENIED_${nonce}_TOKEN_MASKED`);
  const commandStartedOk = commandAttestationLines[0] === `COMMAND_STARTED_${nonce}_TOKEN_MASKED`;
  const commandCaughtDenial = commandAttestationLines.length === 2
    && commandAttestationLines[1] === `COMMAND_DENIED_${nonce}_TOKEN_MASKED`;
  const bashResultText = toolResultText(bashResult);
  const bashDeniedByTool = Boolean(bashResult?.is_error)
    && /permission|not allowed|denied|sandbox/i.test(bashResultText)
    && bashResultText.includes(deniedPath);
  // The nonce-bound start attestation proves that the generated child ran with a masked token.
  // A denial may either be caught by the child or terminate the tool at the sandbox boundary.
  // Requiring Claude to preserve the prompt's absolute command spelling in its tool input is
  // not a security property and makes the harness sensitive to equivalent command rewrites.
  const commandOk = bashUses.length === 1 && commandStartedOk && (commandCaughtDenial || bashDeniedByTool);
  const mcpOk = Boolean(mcpUse) && mcpAttestation === `MCP_DENIED_${nonce}_TOKEN_MASKED` && result.stdout.includes('"sandboxDenied":true') && result.stdout.includes('"tokenMasked":true');
  const finalOk = resultEvent?.result?.trim() === `GENBI_CLAUDE_AUTH_SMOKE_OK_${nonce}`;
  const canaryOk = canary === "outside-canary\n";

  if (result.code !== 0 || !insideReadOk || !deniedReadOk || !hookOk || !commandOk || !mcpOk || !finalOk || !canaryOk || unexpectedTools.length > 0) {
    const stderrTail = result.stderr.slice(-1_200)
      .replaceAll(runtimeHome, "<CLAUDE_CONFIG_DIR>")
      .replaceAll(os.homedir(), "<HOME>");
    throw new Error(JSON.stringify({
      message: "authenticated Claude whole-process sandbox smoke failed",
      exitCode: result.code,
      signal: result.signal,
      insideReadOk,
      deniedReadOk,
      hookOk,
      commandOk,
      bashUseCount: bashUses.length,
      bashCommandMatchesExact: bashUse?.input?.command === shellCommand,
      bashCommandReferencesChild: Boolean(bashUse?.input?.command?.includes(commandChildPath)),
      bashResultStatus: !bashResult ? "missing" : bashResult.is_error ? "error" : "success",
      bashResultCategory: classifyToolResult(bashResult),
      bashResultReferencesDeniedCanary: bashResultText.includes(deniedPath),
      bashResultReferencesSystemTemp: [os.tmpdir(), "/tmp", "/private/tmp"].some((entry) => entry && bashResultText.includes(entry)),
      bashResultReferencesRuntimeTmp: bashResultText.includes(runtimeTmp),
      bashResultReferencesRuntimeHome: bashResultText.includes(runtimeHome),
      bashResultReferencesWorkspace: bashResultText.includes(workspace),
      bashResultTail: sanitizeBashResult(bashResultText),
      commandAttestationStatus: commandCaughtDenial ? "caught-denial" : commandStartedOk ? "started-only" : commandAttestationLines.length ? "unexpected" : "missing",
      permissionDiagnostics: {
        allowedRuleIgnored: /Ignoring --allowedTools rule/i.test(claudeDebug),
        allowedToolsIgnoredByManagedPolicy: /allowManagedPermissionRulesOnly/i.test(claudeDebug),
        broadBashRuleStripped: /broad_bash_detected|broad Bash/i.test(claudeDebug),
        permissionPromptDeniedLocally: /permission prompts are answered with a local deny/i.test(claudeDebug),
        sandboxUnavailable: /sandbox unavailable/i.test(claudeDebug),
      },
      mcpOk,
      finalOk,
      canaryOk,
      toolNames: toolUses.map((use) => use.name),
      unresolvedToolResultIds: toolResults.filter((item) => !usesById.has(item.tool_use_id)).map((item) => item.tool_use_id),
      unexpectedTools: unexpectedTools.map((use) => use.name),
      stderrTail,
    }));
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    authenticatedVia: "Claude.ai identity in an externally authenticated isolated writable runtime home",
    outerBoundary: "Anthropic sandbox-runtime around the whole Claude process tree",
    failClosed: { failIfUnavailable: true, allowUnsandboxedCommands: false },
    providerNetworkAllowlist: allowedDomains,
    checks: [
      { name: "authenticated Claude turn completed", ok: result.code === 0 },
      { name: "workspace file tool read succeeded", ok: insideReadOk },
      { name: "workspace-external file tool read failed", ok: deniedReadOk },
      { name: "hook process inherited outside-read denial", ok: hookOk },
      { name: "Bash command child inherited outside-read denial", ok: commandOk },
      { name: "scoped MCP child inherited outside-read denial", ok: mcpOk },
      { name: "hook, command, and MCP children saw only masked OAuth credential", ok: hookOk && commandOk && mcpOk },
      { name: "outside canary remained unchanged", ok: canaryOk },
      { name: "agent returned nonce-bound terminal attestation", ok: finalOk },
      { name: "no unrequested tool was used", ok: unexpectedTools.length === 0 },
    ],
  }, null, 2)}\n`);
  }
} finally {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(runtimeTmp, { recursive: true, force: true }),
    rm(deniedPath, { force: true }),
  ]);
}

function providerDomains() {
  return ["api.anthropic.com", "claude.ai", "platform.claude.com"];
}

function loadMacClaudeOAuthToken() {
  if (process.platform !== "darwin") throw new Error("this Phase 0 credential adapter currently supports macOS only");
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", "Claude Code-credentials", "-a", os.userInfo().username, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) throw new Error("Claude OAuth credential was unavailable from the external macOS keychain");
  let credential;
  try {
    credential = JSON.parse(result.stdout.trim()).claudeAiOauth;
  } catch {
    throw new Error("Claude OAuth credential had an unsupported external keychain format");
  }
  if (!credential?.accessToken || credential.expiresAt <= Date.now()) {
    throw new Error("Claude OAuth access token was absent or expired; refresh it outside the sandbox");
  }
  return credential.accessToken;
}

function runSrt(command, env, timeoutMs) {
  const explicit = process.env.SRT_BIN;
  if (explicit) return run(explicit, ["--settings", srtSettingsPath, "--", ...command], workspace, env, timeoutMs);
  return run(
    "npm",
    ["exec", "--yes", "--package", "@anthropic-ai/sandbox-runtime@0.0.75", "--", "srt", "--settings", srtSettingsPath, "--", ...command],
    workspace,
    env,
    timeoutMs,
  );
}

function run(command, args, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (spawnError) => finish({ code: null, signal: null, stdout, stderr, timedOut: false, spawnError: { code: spawnError.code, message: spawnError.message } }));
    child.on("exit", (code, signal) => finish({ code, signal, stdout, stderr, timedOut: signal === "SIGTERM" }));

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }
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

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function classifyToolResult(result) {
  if (!result) return "missing";
  const content = toolResultText(result);
  return classifyText(content, Boolean(result.is_error));
}

function classifyText(content, isError) {
  if (!content) return isError ? "unclassified-error" : "empty-success";
  if (/permission|not allowed|denied|sandbox/i.test(content)) return "permission-or-sandbox";
  if (/not found|enoent|command not found/i.test(content)) return "not-found";
  if (/timed? out|timeout/i.test(content)) return "timeout";
  return isError ? "other-error" : "other-success";
}

function toolResultText(result) {
  if (!result) return "";
  return Array.isArray(result.content)
    ? result.content.map((item) => typeof item?.text === "string" ? item.text : "").join("\n")
    : typeof result.content === "string" ? result.content : "";
}

function sanitizeBashResult(content) {
  let sanitized = content;
  for (const [value, replacement] of [
    [oauthToken, "<REDACTED_TOKEN>"],
    [realTokenHash, "<REDACTED_TOKEN_HASH>"],
    [nonce, "<NONCE>"],
    [deniedPath, "<DENIED_CANARY>"],
    [commandChildPath, "<COMMAND_CHILD>"],
    [runtimeTmp, "<RUNTIME_TMP>"],
    [workspace, "<WORKSPACE>"],
    [runtimeHome, "<RUNTIME_HOME>"],
    [os.homedir(), "<HOME>"],
    [process.execPath, "<NODE>"],
  ]) {
    if (value) sanitized = sanitized.replaceAll(value, replacement);
  }
  return sanitized
    .replace(/(?:bearer\s+|sk-(?:ant-)?)[a-z0-9._=-]+/gi, "<REDACTED_SECRET>")
    .replace(/[a-z0-9_+/=-]{80,}/gi, "<REDACTED_LONG_VALUE>")
    .slice(-600);
}
