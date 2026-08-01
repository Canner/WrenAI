import { describe, expect, it } from "vitest";
import type { ExecutionEnv, ExecutionPolicy } from "../harness/exec/index.js";
import { WrenBinaryNotFoundError, WrenIntrospectExecutionError } from "../harness/tools/errors.js";
import { createWrenNativeToolRegistry, createWrenSemanticIntrospectTool } from "../harness/tools/native.js";

function stubEnv(exec: ExecutionEnv["exec"]): ExecutionEnv {
  return {
    exec,
    readFile: async () => {
      throw new Error("not used in these tests");
    },
    writeFile: async () => {
      throw new Error("not used in these tests");
    },
    fetch: async () => {
      throw new Error("not used in these tests");
    },
  };
}

const POLICY: ExecutionPolicy = { readOnly: true };

/** A small canned `wren context show -o json` object — enough shape to exercise the parse path, not a full real project. */
const CANNED_INTROSPECT_JSON = JSON.stringify({
  catalog: "wren",
  schema: "public",
  models: [
    {
      name: "customers",
      columns: [
        { name: "customer_id", type: "INT", notNull: true },
        { name: "first_name", type: "TEXT" },
      ],
      primaryKey: "customer_id",
    },
    {
      name: "orders",
      columns: [
        { name: "order_id", type: "INT", notNull: true },
        { name: "customer_id", type: "INT" },
      ],
      primaryKey: "order_id",
    },
  ],
  relationships: [{ name: "orders_customers", models: ["orders", "customers"], joinType: "MANY_TO_ONE" }],
  views: [],
  cubes: [],
});

describe("createWrenSemanticIntrospectTool (notFound vs nonzero exit vs parse failure)", () => {
  it("throws WrenBinaryNotFoundError when the underlying exec reports notFound: true", async () => {
    const env = stubEnv(async () => ({ stdout: "", stderr: "", exitCode: 1, notFound: true }));
    const introspectTool = createWrenSemanticIntrospectTool({ env, policy: POLICY, projectDir: "/unused" });

    await expect(
      introspectTool.execute!({}, { toolCallId: "call-1", messages: [], context: undefined }),
    ).rejects.toThrow(WrenBinaryNotFoundError);
  });

  it("throws WrenIntrospectExecutionError on an ordinary nonzero exit (notFound absent)", async () => {
    const env = stubEnv(async () => ({ stdout: "", stderr: "project not found", exitCode: 1 }));
    const introspectTool = createWrenSemanticIntrospectTool({ env, policy: POLICY, projectDir: "/unused" });

    await expect(
      introspectTool.execute!({}, { toolCallId: "call-1", messages: [], context: undefined }),
    ).rejects.toThrow(WrenIntrospectExecutionError);
  });

  it("throws WrenIntrospectExecutionError when exitCode is 0 but stdout is not parseable JSON", async () => {
    const env = stubEnv(async () => ({ stdout: "not json at all", stderr: "", exitCode: 0 }));
    const introspectTool = createWrenSemanticIntrospectTool({ env, policy: POLICY, projectDir: "/unused" });

    await expect(
      introspectTool.execute!({}, { toolCallId: "call-1", messages: [], context: undefined }),
    ).rejects.toThrow(WrenIntrospectExecutionError);
  });

  it("parses a single JSON object (not JSONL) from stdout on success, passed through as-is", async () => {
    const env = stubEnv(async () => ({ stdout: CANNED_INTROSPECT_JSON, stderr: "", exitCode: 0 }));
    const introspectTool = createWrenSemanticIntrospectTool({ env, policy: POLICY, projectDir: "/unused" });

    const result = await introspectTool.execute!({}, { toolCallId: "call-1", messages: [], context: undefined });

    expect(result).toEqual(JSON.parse(CANNED_INTROSPECT_JSON));
    const models = (result as { models: { name: string }[] }).models;
    expect(models.map((m) => m.name)).toEqual(["customers", "orders"]);
  });

  it("invokes `wren context show -o json` with cwd: projectDir, mode: read", async () => {
    let seenCmd: unknown;
    const env = stubEnv(async (cmd) => {
      seenCmd = cmd;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    });
    const introspectTool = createWrenSemanticIntrospectTool({ env, policy: POLICY, projectDir: "/some/project" });

    await introspectTool.execute!({}, { toolCallId: "call-1", messages: [], context: undefined });

    expect(seenCmd).toMatchObject({
      mode: "read",
      command: "wren",
      args: ["context", "show", "-o", "json"],
      cwd: "/some/project",
    });
  });
});

describe("createWrenNativeToolRegistry (semantic_introspect registration)", () => {
  it("resolves a `semantic_introspect` factory alongside `query`, `build_dashboard`, and `write_artifact`", () => {
    const env = stubEnv(async () => ({ stdout: "{}", stderr: "", exitCode: 0 }));
    const policy: ExecutionPolicy = { readOnly: true, artifactWriteScope: "." };
    const registry = createWrenNativeToolRegistry({ env, policy, projectDir: "/unused" });

    expect(registry.has("semantic_introspect")).toBe(true);
    const tool = registry.create("semantic_introspect");
    expect(tool.execute).toBeTypeOf("function");
  });
});
