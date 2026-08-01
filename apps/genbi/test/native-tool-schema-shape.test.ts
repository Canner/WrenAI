import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createLocalExecutionEnv, type ExecutionPolicy } from "../harness/exec/index.js";
import {
  BUILD_DASHBOARD_TOOL_NAME,
  createDefaultNativeToolRegistry,
  createNativeToolRegistry,
  createSetupExecutionTool,
  createWrenNativeToolRegistry,
  SEMANTIC_INTROSPECT_TOOL_NAME,
  SETUP_EXECUTION_TOOL_NAME,
  WREN_QUERY_TOOL_NAME,
  WRITE_ARTIFACT_TOOL_NAME,
  type NativeToolRegistry,
} from "../harness/tools/index.js";

/**
 * A real Mode A run (OpenAI, `gpt-4.1`, api-key/`openai-compatible` adapter)
 * rejected `setup_execution` outright:
 *
 *   AI_APICallError: Invalid schema for function 'setup_execution':
 *   schema must be a JSON Schema of 'type: "object"', got 'type: "None"'.
 *
 * Root cause: `setupExecutionInputSchema` was a `z.discriminatedUnion`,
 * which `z.toJSONSchema` converts to a top-level `{"oneOf": [...]}` with NO
 * top-level `"type": "object"` — OpenAI's function-calling API requires an
 * object schema at the top level, and (per `@ai-sdk/anthropic`'s
 * `prepareTools`, which forwards `tool.inputSchema` verbatim as
 * `input_schema` with no normalization of its own) Anthropic's
 * `input_schema` would reject the identical shape for the identical reason.
 *
 * Every OTHER native tool (`harness/tools/native.ts`) already uses a flat
 * top-level `z.object(...)` — nested `z.union`s inside a property (e.g.
 * `build_dashboard`'s `dashboardRowSchema`) are fine; a union/discriminated-
 * union AT THE SCHEMA'S OWN TOP LEVEL is what's forbidden. A mock-model test
 * cannot catch this: the `mock` adapter never serializes a tool's
 * `inputSchema` to a provider wire format, so a discriminated-union schema
 * looks perfectly fine to every other test in this suite. This is the
 * provider-wire-shape assertion those tests are missing — covering every
 * tool a production native-tool registry actually constructs, so adding a
 * new native tool with a top-level union/discriminated-union schema fails
 * here before it ever reaches a real provider call.
 */
function assertTopLevelObjectSchema(toolName: string, inputSchema: unknown): void {
  const jsonSchema = z.toJSONSchema(inputSchema as z.core.$ZodType, { target: "draft-7" }) as Record<string, unknown>;
  expect(jsonSchema.type, `tool "${toolName}"'s inputSchema must serialize with a top-level "type": "object"`).toBe(
    "object",
  );
}

describe("native tool registry — every registered tool's inputSchema serializes with a top-level \"type\": \"object\"", () => {
  const policy: ExecutionPolicy = { readOnly: false, artifactWriteScope: "." };

  it("createDefaultNativeToolRegistry (write_artifact, build_dashboard)", () => {
    const env = createLocalExecutionEnv({ rootDir: os.tmpdir() });
    const registry: NativeToolRegistry = createDefaultNativeToolRegistry(env, policy);

    for (const name of [WRITE_ARTIFACT_TOOL_NAME, BUILD_DASHBOARD_TOOL_NAME]) {
      assertTopLevelObjectSchema(name, registry.create(name).inputSchema);
    }
  });

  it("createWrenNativeToolRegistry (write_artifact, build_dashboard, query, semantic_introspect)", () => {
    const env = createLocalExecutionEnv({ rootDir: os.tmpdir() });
    const registry: NativeToolRegistry = createWrenNativeToolRegistry({ env, policy, projectDir: os.tmpdir() });

    for (const name of [WRITE_ARTIFACT_TOOL_NAME, BUILD_DASHBOARD_TOOL_NAME, WREN_QUERY_TOOL_NAME, SEMANTIC_INTROSPECT_TOOL_NAME]) {
      assertTopLevelObjectSchema(name, registry.create(name).inputSchema);
    }
  });

  it("ModeASetupRunner's setup registry (setup_execution) — the exact construction harness/setup/runner.ts uses", () => {
    const workspaceRoot = os.tmpdir();
    const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
    const registry = createNativeToolRegistry();
    registry.register(SETUP_EXECUTION_TOOL_NAME, () => createSetupExecutionTool({ env, policy, workspaceRoot: path.resolve(workspaceRoot) }));

    assertTopLevelObjectSchema(SETUP_EXECUTION_TOOL_NAME, registry.create(SETUP_EXECUTION_TOOL_NAME).inputSchema);
  });
});
