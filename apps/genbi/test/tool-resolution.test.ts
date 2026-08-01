import type { Tool } from "ai";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { createLocalExecutionEnv, WriteScopeNotGrantedError } from "../harness/exec/index.js";
import {
  createWrenNativeToolRegistry,
  McpServerNotConfiguredError,
  McpToolNotExposedError,
  resolveTools,
  UnknownNativeToolError,
  WRITE_ARTIFACT_TOOL_NAME,
} from "../harness/tools/index.js";
import { readFixture } from "./fixtures.js";
import { mockWrenServerConfig } from "./mock-mcp-server.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

describe("resolveTools (tool binding)", () => {
  it("resolves mcp:sample/query from the connected mock MCP server into a callable ToolSet entry", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query")!;

    const resolved = await resolveTools(agent, { mcpServers: { sample: mockWrenServerConfig() } });
    try {
      expect(Object.keys(resolved.tools)).toEqual(["query"]);
      expect(typeof resolved.tools.query?.execute).toBe("function");
    } finally {
      await resolved.close();
    }
  });

  it("executes the resolved query tool against the mock MCP server, returning canned rows with no LLM call", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query")!;

    const resolved = await resolveTools(agent, { mcpServers: { sample: mockWrenServerConfig() } });
    try {
      const queryTool = resolved.tools.query as Tool;
      const output = await queryTool.execute!(
        { sql: "select * from customers" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );
      expect(output).toEqual({
        content: [{ type: "text", text: JSON.stringify({ columns: ["customer", "revenue"], rows: [["Acme", 1000], ["Globex", 500]] }) }],
        isError: false,
        structuredContent: { columns: ["customer", "revenue"], rows: [["Acme", 1000], ["Globex", 500]] },
      });
    } finally {
      await resolved.close();
    }
  });

  it("resolves native write_artifact to a real tool present in the ToolSet, fail-closed by default (no scoped_write guardrail)", async () => {
    const bundle = loadBundle(
      buildSyntheticBundle({ tools: [{ name: WRITE_ARTIFACT_TOOL_NAME, source: "native" }] }),
    );
    const agent = bundle.agents[0]!;

    const resolved = await resolveTools(agent, {});
    try {
      expect(Object.keys(resolved.tools)).toEqual([WRITE_ARTIFACT_TOOL_NAME]);
      const writeArtifactTool = resolved.tools[WRITE_ARTIFACT_TOOL_NAME] as Tool;
      // resolveTools defaults enforcementPolicy to { readOnly: false } (no
      // artifactWriteScope) when the caller doesn't thread one through —
      // see harness/session/run.ts, which derives a real policy via
      // deriveEnforcement(agent) instead of relying on this fallback.
      await expect(
        writeArtifactTool.execute!(
          { path: "report.md", content: "hello" },
          { toolCallId: "call-1", messages: [], context: undefined },
        ),
      ).rejects.toThrow(WriteScopeNotGrantedError);
    } finally {
      await resolved.close();
    }
  });

  it("fails fast with McpServerNotConfiguredError for a declared server with no injected config", async () => {
    const bundle = loadBundle(
      buildSyntheticBundle({ tools: [{ name: "query", source: "mcp:missing_server/query" }] }),
    );
    const agent = bundle.agents[0]!;

    await expect(resolveTools(agent, { mcpServers: {} })).rejects.toThrow(McpServerNotConfiguredError);
    await expect(resolveTools(agent, { mcpServers: {} })).rejects.toThrow(/missing_server/);
  });

  it("fails fast with McpToolNotExposedError when the connected server doesn't expose the declared tool", async () => {
    const bundle = loadBundle(
      buildSyntheticBundle({ tools: [{ name: "nope", source: "mcp:sample/nope" }] }),
    );
    const agent = bundle.agents[0]!;

    await expect(
      resolveTools(agent, { mcpServers: { sample: mockWrenServerConfig() } }),
    ).rejects.toThrow(McpToolNotExposedError);
    await expect(
      resolveTools(agent, { mcpServers: { sample: mockWrenServerConfig() } }),
    ).rejects.toThrow(/nope/);
  });

  it("fails fast with UnknownNativeToolError for an unrecognized native tool name", async () => {
    const bundle = loadBundle(buildSyntheticBundle({ tools: [{ name: "mystery", source: "native" }] }));
    const agent = bundle.agents[0]!;

    await expect(resolveTools(agent, {})).rejects.toThrow(UnknownNativeToolError);
    await expect(resolveTools(agent, {})).rejects.toThrow(/mystery/);
  });

  /**
   * Blocker 1 regression coverage: `generate_dashboard`'s native
   * bundle declares `query` + `build_dashboard` + `write_artifact`, all
   * `source: native` (per `providers/wren.provider.yaml`'s
   * `genbi_build -> build_dashboard` mapping). Before `build_dashboard` was
   * registered in `createDefaultNativeToolRegistry`, this resolution threw
   * `UnknownNativeToolError("build_dashboard")` — every `generate_dashboard`
   * run failed before the loop executor ever ran a step.
   */
  it("resolves generate_dashboard's full native tool set (query + build_dashboard + write_artifact), no UnknownNativeToolError", async () => {
    const bundle = loadBundle(readFixture("genbi-default.native.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "generate_dashboard")!;

    const nativeTools = createWrenNativeToolRegistry({
      env: createLocalExecutionEnv(),
      policy: { readOnly: true },
      projectDir: "/unused",
    });
    const resolved = await resolveTools(agent, { nativeTools });
    try {
      expect(Object.keys(resolved.tools).sort()).toEqual(["build_dashboard", "query", "write_artifact"]);
      expect(typeof resolved.tools.build_dashboard?.execute).toBe("function");
    } finally {
      await resolved.close();
    }
  });

  /**
   * explore_model regression coverage: its dataflow step declares
   * `semantic_introspect` (native) as its only tool. Before that factory was
   * registered, this resolution threw `UnknownNativeToolError`
   * ("semantic_introspect") — every `explore_model` run failed before the
   * loop executor ever ran its step.
   */
  it("resolves explore_model's native tool set (semantic_introspect), no UnknownNativeToolError", async () => {
    const bundle = loadBundle(readFixture("genbi-default.native.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "explore_model")!;

    const nativeTools = createWrenNativeToolRegistry({
      env: createLocalExecutionEnv(),
      policy: { readOnly: true },
      projectDir: "/unused",
    });
    const resolved = await resolveTools(agent, { nativeTools });
    try {
      expect(Object.keys(resolved.tools)).toEqual(["semantic_introspect"]);
      expect(typeof resolved.tools.semantic_introspect?.execute).toBe("function");
    } finally {
      await resolved.close();
    }
  });
});
