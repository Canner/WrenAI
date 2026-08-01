import { fileURLToPath } from "node:url";
import path from "node:path";
import type { McpServerConfig } from "../harness/tools/index.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(testDir, "fixtures", "mock-mcp-server.mjs");

export interface MockWrenServerOptions {
  /**
   * Failure injection: the server's `query` tool fails its first
   * `failQueryCount` calls with a JSON-RPC top-level error (surfacing as a
   * tool-error content part — see the `.mjs` server's comment for why),
   * then serves canned rows as usual. Defaults to 0 (never fails), matching
   * every test's expectations unchanged.
   */
  readonly failQueryCount?: number;
}

/**
 * Connection config for the hermetic mock stdio MCP server
 * (`test/fixtures/mock-mcp-server.mjs`), which exposes `query` and
 * `semantic_introspect` tools returning canned fixture rows. Used by
 * tests in place of a real `wren` MCP server + DuckDB, and by
 * repair-fold tests to script a failing-then-recovering (or
 * always-failing) `query` tool.
 */
export function mockWrenServerConfig(options: MockWrenServerOptions = {}): McpServerConfig {
  const { failQueryCount = 0 } = options;
  return {
    kind: "stdio",
    command: process.execPath,
    args: [serverScript],
    ...(failQueryCount > 0 ? { env: { MOCK_QUERY_FAIL_COUNT: String(failQueryCount) } } : {}),
  };
}
