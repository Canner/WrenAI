import type { ToolSet } from "ai";
import type { MCPClient } from "@ai-sdk/mcp";
import type { Agent } from "../bundle/schema.js";
import { createLocalExecutionEnv, type ExecutionEnv, type ExecutionPolicy } from "../exec/index.js";
import { McpServerNotConfiguredError, McpToolNotExposedError, UnknownNativeToolError } from "./errors.js";
import { connectMcpServer, type McpServerConfigMap } from "./mcp.js";
import { createDefaultNativeToolRegistry, type NativeToolRegistry } from "./native.js";
import { parseToolSource } from "./parse.js";

export interface ResolveToolsContext {
  /**
   * Defaults to a registry built from `executionEnv`/`enforcementPolicy`
   * (built-in `write_artifact` tool only). Supplying this bypasses both of
   * those fields entirely.
   */
  readonly nativeTools?: NativeToolRegistry;
  /** Runtime-injected MCP server connection config, keyed by server id. Defaults to `{}`. */
  readonly mcpServers?: McpServerConfigMap;
  /** Backend native tools execute side effects through. Defaults to `createLocalExecutionEnv()`. */
  readonly executionEnv?: ExecutionEnv;
  /**
   * The guardrail-derived policy passed to every native-tool call. Defaults
   * to `{ readOnly: false }` (no scope, no allowlist) — the secure-by-default
   * fallback: without a real `deriveEnforcement(agent)` result threaded in
   * (as `runAgent` does), `write_artifact` rejects every call.
   */
  readonly enforcementPolicy?: ExecutionPolicy;
}

export interface ResolvedTools {
  /** The AI SDK tool set the loop executor consumes as `ExecuteAgentContext.tools`. */
  readonly tools: ToolSet;
  /** Shuts down every MCP client this resolution opened. Always safe to call once. */
  close(): Promise<void>;
}

/**
 * Turns `agent.tools[]` into an AI SDK `ToolSet`, connecting whatever MCP
 * servers the agent's tools declare and discovering their tools. This is
 * the tool-level "second door" (mirroring the capability gate):
 * every declared tool is resolved and validated *before* the loop executor
 * ever runs a step, so a misconfigured or drifted tool fails loud at
 * session start rather than surfacing as an opaque tool-call error mid-run.
 *
 * Fail-fast is two passes:
 *  1. Before connecting anything: unknown `native` names
 *     ({@link UnknownNativeToolError}) and MCP server ids with no entry in
 *     `mcpServers` ({@link McpServerNotConfiguredError}).
 *  2. After connecting + discovering each referenced server's tools: any
 *     declared `mcp:<server>/<name>` whose server doesn't actually expose
 *     `<name>` ({@link McpToolNotExposedError}).
 *
 * On any failure (including a later tool in the list) every MCP client this
 * call opened is closed before the error propagates — resolution never
 * leaks a connected client.
 */
export async function resolveTools(
  agent: Agent,
  ctx: ResolveToolsContext = {},
): Promise<ResolvedTools> {
  const executionEnv = ctx.executionEnv ?? createLocalExecutionEnv();
  const enforcementPolicy = ctx.enforcementPolicy ?? { readOnly: false };
  const nativeTools = ctx.nativeTools ?? createDefaultNativeToolRegistry(executionEnv, enforcementPolicy);
  const mcpServers = ctx.mcpServers ?? {};

  const specs = agent.tools.map((toolSpec) => ({
    toolSpec,
    source: parseToolSource(toolSpec.source),
  }));

  const serverIds = new Set<string>();
  for (const { toolSpec, source } of specs) {
    if (source.kind === "native") {
      if (!nativeTools.has(toolSpec.name)) {
        throw new UnknownNativeToolError(toolSpec.name);
      }
    } else if (!mcpServers[source.server]) {
      throw new McpServerNotConfiguredError(source.server);
    } else {
      serverIds.add(source.server);
    }
  }

  const clients = new Map<string, MCPClient>();
  const discoveredByServer = new Map<string, ToolSet>();

  async function closeAll(): Promise<void> {
    await Promise.all([...clients.values()].map((client) => client.close().catch(() => undefined)));
  }

  try {
    for (const serverId of serverIds) {
      const client = await connectMcpServer(mcpServers[serverId]!);
      clients.set(serverId, client);
      discoveredByServer.set(serverId, (await client.tools()) as ToolSet);
    }

    const tools: Record<string, ToolSet[string]> = {};
    for (const { toolSpec, source } of specs) {
      if (source.kind === "native") {
        tools[toolSpec.name] = nativeTools.create(toolSpec.name);
        continue;
      }

      const serverTools = discoveredByServer.get(source.server)!;
      const discoveredTool = serverTools[source.toolName];
      if (!discoveredTool) {
        throw new McpToolNotExposedError(source.server, source.toolName);
      }
      tools[toolSpec.name] = discoveredTool;
    }

    return { tools, close: closeAll };
  } catch (error) {
    await closeAll();
    throw error;
  }
}
