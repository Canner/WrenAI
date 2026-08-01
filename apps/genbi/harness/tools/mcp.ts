import { createMCPClient, type MCPClient, type MCPClientConfig } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

/**
 * Connection config for one MCP server, keyed by server id (e.g. `"wren"`)
 * in `McpServerConfigMap`. Two shapes: `"stdio"` spawns a local process
 * (the real `mcp:wren` wiring — a `wren` MCP process over a jaffle DuckDB —
 * is this shape), and `"transport"` accepts any `@ai-sdk/mcp` transport config/instance
 * directly (http/sse, or a hand-rolled `MCPTransport` such as the hermetic
 * mock server this package's tests spawn over stdio).
 *
 * This is always supplied by the caller at run time — never read from the
 * bundle (the bundle only names the server id via `mcp:<server>/<name>`).
 */
export type McpServerConfig =
  | {
      readonly kind: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      readonly cwd?: string;
    }
  | {
      readonly kind: "transport";
      readonly transport: MCPClientConfig["transport"];
    };

/** Runtime-injected map of MCP server id -> connection config. */
export type McpServerConfigMap = Readonly<Record<string, McpServerConfig>>;

const DEFAULT_CLIENT_NAME = "wren-harness";

/** Connects to one configured MCP server, returning the live client. */
export async function connectMcpServer(config: McpServerConfig): Promise<MCPClient> {
  const transport =
    config.kind === "stdio"
      ? new Experimental_StdioMCPTransport({
          command: config.command,
          ...(config.args ? { args: [...config.args] } : {}),
          ...(config.env ? { env: { ...config.env } } : {}),
          ...(config.cwd ? { cwd: config.cwd } : {}),
        })
      : config.transport;

  return createMCPClient({ transport, clientName: DEFAULT_CLIENT_NAME });
}
