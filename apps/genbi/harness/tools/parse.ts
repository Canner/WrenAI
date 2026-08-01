import { UnsupportedToolSourceError } from "./errors.js";

/** A tool declaration's `source` field, parsed into its harness-meaningful shape. */
export type ParsedToolSource =
  | { readonly kind: "native" }
  | { readonly kind: "mcp"; readonly server: string; readonly toolName: string };

const MCP_SOURCE_PATTERN = /^mcp:([^/]+)\/(.+)$/;

/**
 * Parses an `agent.tools[].source` string. Two shapes are recognized:
 * `"native"` and `"mcp:<server>/<name>"` (e.g. `"mcp:wren/query"`). Anything
 * else is a load-time error — bundle producers only ever emit these two.
 */
export function parseToolSource(source: string): ParsedToolSource {
  if (source === "native") {
    return { kind: "native" };
  }

  const match = MCP_SOURCE_PATTERN.exec(source);
  if (match) {
    const [, server, toolName] = match;
    return { kind: "mcp", server: server!, toolName: toolName! };
  }

  throw new UnsupportedToolSourceError(source);
}
