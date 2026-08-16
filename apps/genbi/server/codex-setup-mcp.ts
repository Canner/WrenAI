#!/usr/bin/env node
import { createInterface } from "node:readline";
import { open } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createLocalExecutionEnv } from "../harness/exec/index.js";
import {
  executeSetupExecution,
  setupExecutionInputSchema,
  SETUP_EXECUTION_TOOL_NAME,
} from "../harness/tools/index.js";
import type { SetupExecutionInput } from "../harness/tools/index.js";
import type { ExecutionPolicy } from "../harness/exec/index.js";

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

const inputSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["exec", "write"] },
    command: { type: "string" },
    cwd: { type: "string" },
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["action"],
  additionalProperties: false,
};

const { values } = parseArgs({
  options: { "workspace-root": { type: "string" }, "trace-path": { type: "string" } },
});
const workspaceRoot = values["workspace-root"];
if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
  process.stderr.write("codex setup MCP requires an absolute --workspace-root\n");
  process.exit(1);
}
const resolvedWorkspaceRoot = workspaceRoot;
const tracePath = values["trace-path"];
if (tracePath !== undefined && !path.isAbsolute(tracePath)) {
  process.stderr.write("codex setup MCP requires an absolute --trace-path\n");
  process.exit(1);
}
const traceHandle = tracePath ? await open(tracePath, "a") : undefined;

const env = createLocalExecutionEnv({ rootDir: resolvedWorkspaceRoot });
const policy: ExecutionPolicy = { readOnly: false, artifactWriteScope: "." };

function send(id: string | number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id: string | number, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function boundedDetail(value: unknown): string {
  const text = JSON.stringify(value) ?? "null";
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`;
}

async function appendTrace(input: SetupExecutionInput, result: unknown): Promise<void> {
  if (!traceHandle) return;
  const safeInput = {
    action: input.action,
    ...(input.command !== undefined ? { command: input.command } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.path !== undefined ? { path: input.path } : {}),
  };
  await traceHandle.appendFile(`${JSON.stringify({ input: safeInput, detail: boundedDetail(result) })}\n`, "utf8");
}

async function handle(request: JsonRpcRequest): Promise<void> {
  if (request.id === undefined) return;
  switch (request.method) {
    case "initialize":
      send(request.id, {
        protocolVersion:
          typeof request.params?.["protocolVersion"] === "string"
            ? request.params["protocolVersion"]
            : "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "wren-genbi-setup", version: "0.1.0" },
      });
      return;
    case "ping":
      send(request.id, {});
      return;
    case "tools/list":
      send(request.id, {
        tools: [
          {
            name: SETUP_EXECUTION_TOOL_NAME,
            description:
              "Run a guarded command or write a file within the setup workspace. exec requires command; write requires path and content; cwd is optional and must stay inside the workspace.",
            inputSchema,
          },
        ],
      });
      return;
    case "tools/call": {
      const name = request.params?.["name"];
      if (name !== SETUP_EXECUTION_TOOL_NAME) {
        sendError(request.id, -32602, "unknown setup tool");
        return;
      }
      const parsed = setupExecutionInputSchema.safeParse(request.params?.["arguments"] ?? {});
      if (!parsed.success) {
        send(request.id, {
          isError: true,
          content: [{ type: "text", text: "invalid setup_execution input" }],
        });
        return;
      }
      try {
        const result = await executeSetupExecution(parsed.data, { env, policy, workspaceRoot: resolvedWorkspaceRoot });
        await appendTrace(parsed.data, result);
        send(request.id, { content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (error) {
        await appendTrace(parsed.data, { error: "setup tool failed" });
        send(request.id, {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : "setup tool failed" }],
        });
      }
      return;
    }
    default:
      sendError(request.id, -32601, "method not found");
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pendingRequests = new Set<Promise<void>>();
let inputClosed = false;

function closeTraceWhenIdle(): void {
  if (inputClosed && pendingRequests.size === 0) void traceHandle?.close();
}

lines.on("line", (line) => {
  if (!line.trim()) return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return;
  }
  const pending = handle(request).catch((error: unknown) => {
    if (request.id !== undefined) sendError(request.id, -32603, error instanceof Error ? error.message : "internal error");
  });
  pendingRequests.add(pending);
  void pending.finally(() => {
    pendingRequests.delete(pending);
    closeTraceWhenIdle();
  });
});
lines.on("close", () => {
  inputClosed = true;
  closeTraceWhenIdle();
});
