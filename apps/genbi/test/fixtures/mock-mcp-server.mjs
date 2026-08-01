#!/usr/bin/env node
// Hermetic mock MCP server for tests: a minimal JSON-RPC 2.0 over stdio
// implementation of the subset of the Model Context Protocol the harness's
// `resolveTools` needs (initialize, tools/list, tools/call). It returns
// canned fixture rows — no LLM, no real `wren` CLI, no live DuckDB — so
// `test/tool-resolution.test.ts` and `test/tool-loop-integration.test.ts`
// can prove the full resolve -> discover -> execute path offline.
//
// Framing matches `@ai-sdk/mcp`'s `Experimental_StdioMCPTransport`:
// newline-delimited JSON, one JSON-RPC message per line.

import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "query",
    description: "Run a read-only SQL query against the hermetic fixture dataset.",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" } },
      required: ["sql"],
    },
  },
  {
    name: "semantic_introspect",
    description: "Introspect the hermetic fixture dataset's semantic model.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "build_dashboard",
    description: "Assemble a dashboard from panel results. Exposed for tool-resolution coverage only — no test currently invokes it against this mock server.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
];

const CANNED_RESULTS = {
  query: {
    columns: ["customer", "revenue"],
    rows: [
      ["Acme", 1000],
      ["Globex", 500],
    ],
  },
  semantic_introspect: {
    models: ["customers", "orders"],
  },
  build_dashboard: {
    blocks: [],
  },
};

// Failure-injection knob: when set, the first N `query` calls this
// process handles fail with a JSON-RPC top-level error (the shape that
// surfaces as a `tool-error` content part in the AI SDK's tool loop — see
// `test/mock-mcp-server.ts` for why this, not `isError: true`, is used).
// Defaults to 0 — every existing test that doesn't set this env var sees
// unchanged, always-succeeds behavior.
const QUERY_FAIL_COUNT = Number.parseInt(process.env.MOCK_QUERY_FAIL_COUNT ?? "0", 10) || 0;
let queryCallCount = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handleRequest(message) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize": {
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "wren-harness-mock-mcp-server", version: "0.0.0" },
      });
      return;
    }
    case "tools/list": {
      respond(id, { tools: TOOLS });
      return;
    }
    case "tools/call": {
      const toolName = params?.name;

      if (toolName === "query") {
        queryCallCount += 1;
        if (queryCallCount <= QUERY_FAIL_COUNT) {
          respondError(id, -32000, `simulated query failure (attempt ${queryCallCount})`);
          return;
        }
      }

      const result = CANNED_RESULTS[toolName];
      if (result === undefined) {
        respondError(id, -32602, `unknown tool: ${toolName}`);
        return;
      }
      respond(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      });
      return;
    }
    default: {
      respondError(id, -32601, `unsupported method: ${method}`);
    }
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  // Notifications (e.g. "notifications/initialized") carry no `id` and
  // expect no response.
  if (message.id === undefined) return;
  handleRequest(message);
});
