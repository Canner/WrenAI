import { describe, expect, it } from "vitest";
import type { ExecCommand, ExecutionEnv, ExecutionPolicy } from "../harness/exec/index.js";
import { WrenBinaryNotFoundError, WrenQueryExecutionError } from "../harness/tools/errors.js";
import { createWrenQueryTool } from "../harness/tools/native.js";

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

/** Spies on every `cmd` a stubbed `env.exec` receives, returning a canned successful result. */
function spyEnv(seen: ExecCommand[]): ExecutionEnv {
  return stubEnv(async (cmd) => {
    seen.push(cmd);
    return { stdout: "", stderr: "", exitCode: 0 };
  });
}

const POLICY: ExecutionPolicy = { readOnly: true };

describe("createWrenQueryTool (mid-run ENOENT vs a real nonzero exit)", () => {
  it("throws WrenBinaryNotFoundError when the underlying exec reports notFound: true", async () => {
    const env = stubEnv(async () => ({ stdout: "", stderr: "", exitCode: 1, notFound: true }));
    const queryTool = createWrenQueryTool({ env, policy: POLICY, projectDir: "/unused" });

    await expect(
      queryTool.execute!({ sql: "select 1" }, { toolCallId: "call-1", messages: [], context: undefined }),
    ).rejects.toThrow(WrenBinaryNotFoundError);
  });

  it("throws the generic WrenQueryExecutionError on an ordinary nonzero exit (notFound absent)", async () => {
    const env = stubEnv(async () => ({ stdout: "", stderr: "syntax error", exitCode: 1 }));
    const queryTool = createWrenQueryTool({ env, policy: POLICY, projectDir: "/unused" });

    await expect(
      queryTool.execute!({ sql: "select 1" }, { toolCallId: "call-1", messages: [], context: undefined }),
    ).rejects.toThrow(WrenQueryExecutionError);
  });

  it("parses JSONL stdout into columns/rows on success", async () => {
    const env = stubEnv(async () => ({
      stdout: '{"a":1,"b":"x"}\n{"a":2,"b":"y"}\n',
      stderr: "",
      exitCode: 0,
    }));
    const queryTool = createWrenQueryTool({ env, policy: POLICY, projectDir: "/unused" });

    const result = await queryTool.execute!(
      { sql: "select a, b from t" },
      { toolCallId: "call-1", messages: [], context: undefined },
    );

    expect(result).toEqual({
      columns: ["a", "b"],
      rows: [
        { a: 1, b: "x" },
        { a: 2, b: "y" },
      ],
    });
  });
});

describe("createWrenQueryTool (guardrail enforcement: row-limit clamp + statement timeout)", () => {
  it("clamps a model-requested limit above policy.rowLimit down to the policy value", async () => {
    const seen: ExecCommand[] = [];
    const policy: ExecutionPolicy = { readOnly: true, rowLimit: 100 };
    const queryTool = createWrenQueryTool({ env: spyEnv(seen), policy, projectDir: "/unused" });

    await queryTool.execute!({ sql: "select 1", limit: 500 }, { toolCallId: "call-1", messages: [], context: undefined });

    expect(seen[0]!.args).toEqual(["-q", "-o", "json", "-l", "100", "-s", "select 1"]);
  });

  it("applies policy.rowLimit as -l even when the model volunteers no limit at all", async () => {
    const seen: ExecCommand[] = [];
    const policy: ExecutionPolicy = { readOnly: true, rowLimit: 100 };
    const queryTool = createWrenQueryTool({ env: spyEnv(seen), policy, projectDir: "/unused" });

    await queryTool.execute!({ sql: "select 1" }, { toolCallId: "call-1", messages: [], context: undefined });

    expect(seen[0]!.args).toEqual(["-q", "-o", "json", "-l", "100", "-s", "select 1"]);
  });

  it("uses the model's smaller requested limit when it is below policy.rowLimit", async () => {
    const seen: ExecCommand[] = [];
    const policy: ExecutionPolicy = { readOnly: true, rowLimit: 100 };
    const queryTool = createWrenQueryTool({ env: spyEnv(seen), policy, projectDir: "/unused" });

    await queryTool.execute!({ sql: "select 1", limit: 10 }, { toolCallId: "call-1", messages: [], context: undefined });

    expect(seen[0]!.args).toEqual(["-q", "-o", "json", "-l", "10", "-s", "select 1"]);
  });

  it("passes a model-requested limit through unclamped when policy has no rowLimit at all", async () => {
    const seen: ExecCommand[] = [];
    const queryTool = createWrenQueryTool({ env: spyEnv(seen), policy: POLICY, projectDir: "/unused" });

    await queryTool.execute!({ sql: "select 1", limit: 250 }, { toolCallId: "call-1", messages: [], context: undefined });

    expect(seen[0]!.args).toEqual(["-q", "-o", "json", "-l", "250", "-s", "select 1"]);
  });

  it("passes policy.statementTimeoutSec through as ExecCommand.timeoutMs (in milliseconds)", async () => {
    const seen: ExecCommand[] = [];
    const policy: ExecutionPolicy = { readOnly: true, statementTimeoutSec: 30 };
    const queryTool = createWrenQueryTool({ env: spyEnv(seen), policy, projectDir: "/unused" });

    await queryTool.execute!({ sql: "select 1" }, { toolCallId: "call-1", messages: [], context: undefined });

    expect(seen[0]!.timeoutMs).toBe(30000);
  });
});
