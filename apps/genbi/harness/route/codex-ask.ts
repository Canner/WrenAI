import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { enforceCompliance } from "../compliance/index.js";
import { compileProfile } from "../compile/pipeline.js";
import { createAgentEventEmitter, type AgentEventInput } from "../events/index.js";
import type { ResolvedCli } from "./agent-sdk-cli.js";
import { CodexAskEventMapper } from "./codex-ask-events.js";
import { resolveCodexLocalCli } from "./codex-local-cli.js";
import {
  CODEX_ASK_COMPONENTS,
  type CodexAskComponent,
  type CodexManifestModels,
} from "./codex-local-manifest.js";
import type { CodexAskOptions, CodexAskResult } from "./types.js";

const CODEX_BILLING_ENV_KEYS = new Set([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_ORGANIZATION",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
  "OPENAI_PROJECT_ID",
]);

const DEFAULT_CODEX_ASK_TIMEOUT_MS = 10 * 60 * 1000;

export function buildCodexAskArgs(
  cli: ResolvedCli,
  options: {
    readonly irPath: string;
    readonly question: string;
    readonly userProject: string;
    readonly codexHome: string;
    readonly models: CodexManifestModels;
    readonly mcpServer: ResolvedCli;
    readonly codexBin?: string;
    readonly timeoutMs: number;
    readonly component?: CodexAskComponent;
  },
): readonly string[] {
  if (!options.question.trim()) throw new Error("Codex Ask question must not be empty");
  return [
    ...cli.prefixArgs,
    "dispatch",
    options.irPath,
    options.question,
    "--component",
    options.component ?? "answer_query",
    "--project",
    options.userProject,
    "--codex-home",
    options.codexHome,
    "--orchestrator-model",
    options.models.orchestrator,
    "--cheap-model",
    options.models.cheap,
    "--strong-model",
    options.models.strong,
    "--server",
    "wren",
    "--server-command",
    options.mcpServer.command,
    ...options.mcpServer.prefixArgs.flatMap((arg) =>
      arg.startsWith("-") ? [`--server-arg=${arg}`] : ["--server-arg", arg],
    ),
    "--server-arg",
    "serve",
    "--server-arg",
    "mcp",
    "--server-arg=--project",
    "--server-arg",
    options.userProject,
    "--server-arg=--quiet",
    "--inspect-tool",
    "get_context",
    "--query-tool",
    "run_sql",
    "--timeout",
    String(options.timeoutMs),
    ...(options.codexBin ? ["--codex-bin", options.codexBin] : []),
    "--stream-json",
  ];
}

export async function runCodexAskDefault(options: CodexAskOptions): Promise<CodexAskResult> {
  enforceCompliance(options.authChoice, { deployment: options.deployment ?? "personal" });
  if (options.authChoice.provider !== "codex") {
    throw new Error("Codex Ask runner requires a Codex subscription auth choice");
  }
  const agentId = options.agentId ?? "answer_query";
  if (!CODEX_ASK_COMPONENTS.includes(agentId as CodexAskComponent)) {
    throw new Error(`codex:local Ask does not support the "${agentId}" component`);
  }
  const component = agentId as CodexAskComponent;
  const models = resolveModels(options.codexModels);
  const codexHome = options.codexHome?.trim();
  if (!codexHome || !path.isAbsolute(codexHome)) {
    throw new Error("Codex Ask requires an absolute WREN_HARNESS_CODEX_HOME for its dedicated authenticated session home");
  }
  if (options.signal?.aborted) throw new Error("warble-codex-local Ask was cancelled before start");

  const emitter = createAgentEventEmitter(options.onEvent);
  emitter.emit({ kind: "run.start", mode: "B", agentId: component });
  try {
    const irPath = options.irPath ?? (await compileProfile({
      profileSource: options.profileSource,
      userProject: options.userProject,
      mode: "native",
      ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
      ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    })).irPath;
    if (options.signal?.aborted) throw new Error("warble-codex-local Ask was cancelled during preparation");
    const cli = options.codexLocalCli ?? (await resolveCodexLocalCli(options.codexLocalBin));
    if (options.signal?.aborted) throw new Error("warble-codex-local Ask was cancelled during preparation");
    const mcpServer = options.mcpServer ?? { command: resolveExecutableOnPath("wren"), prefixArgs: [] };
    if (options.signal?.aborted) throw new Error("warble-codex-local Ask was cancelled during preparation");
    const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_ASK_TIMEOUT_MS;
    const args = buildCodexAskArgs(cli, {
      irPath,
      question: options.question,
      userProject: options.userProject,
      codexHome,
      models,
      mcpServer,
      timeoutMs,
      component,
      ...(options.codexBin !== undefined ? { codexBin: options.codexBin } : {}),
    });
    const mapper = new CodexAskEventMapper(models, component);
    const finalText = await spawnCodexAsk(
      cli.command,
      args,
      mapper,
      emitter.emit,
      options.processTimeoutMs ?? timeoutMs + 5_000,
      options.signal,
    );
    emitter.emit({ kind: "run.finish", status: "answer" });
    return { finalText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitter.emit({ kind: "error", message });
    emitter.emit({ kind: "run.finish", status: "error" });
    throw error;
  }
}

function resolveModels(value: CodexAskOptions["codexModels"]): CodexManifestModels {
  const models = typeof value === "function" ? value() : value;
  if (!models || !models.orchestrator.trim() || !models.cheap.trim() || !models.strong.trim()) {
    throw new Error("Codex Ask requires orchestrator, cheap, and strong model bindings");
  }
  return models;
}

function resolveExecutableOnPath(name: string): string {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching.
    }
  }
  throw new Error(`could not find the "${name}" executable on PATH`);
}

function sanitizedCodexEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !CODEX_BILLING_ENV_KEYS.has(key.toUpperCase()),
    ),
  );
}

function spawnCodexAsk(
  command: string,
  args: readonly string[],
  mapper: CodexAskEventMapper,
  emit: (event: AgentEventInput) => void,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("warble-codex-local Ask was cancelled before spawn")); return; }
    const child = spawn(command, [...args], {
      env: sanitizedCodexEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stderr = "";
    let settled = false;
    let stopReason: "timeout" | "cancelled" | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = (childSignal: NodeJS.Signals): void => {
      if (child.pid !== undefined && process.platform !== "win32") {
        try {
          process.kill(-child.pid, childSignal);
          return;
        } catch {
          // Fall through to the direct child.
        }
      }
      child.kill(childSignal);
    };
    const stop = (reason: "timeout" | "cancelled"): void => {
      if (settled || stopReason !== undefined) return;
      stopReason = reason;
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const cancel = (): void => stop("cancelled");
    signal?.addEventListener("abort", cancel, { once: true });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (settled || !line.trim()) return;
      try {
        for (const event of mapper.nextLine(line)) emit(event);
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        terminate("SIGTERM");
        killTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
        reject(error);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_192) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancel);
      reject(new Error(`warble-codex-local Ask failed to start: ${error.message}`));
    });
    child.on("close", (code, childSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      lines.close();
      if (settled) return;
      settled = true;
      if (stopReason === "timeout") {
        reject(new Error(`warble-codex-local Ask timed out after ${timeoutMs}ms`));
      } else if (stopReason === "cancelled") {
        reject(new Error("warble-codex-local Ask was cancelled"));
      } else if (code !== 0) {
        reject(new Error(`warble-codex-local Ask exited with ${code ?? childSignal ?? "unknown"}: ${stderr.trim()}`));
      } else {
        try {
          resolve(mapper.result());
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}
