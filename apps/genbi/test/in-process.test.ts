import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { createLocalExecutionEnv } from "../harness/exec/index.js";
import type { ExecutionPolicy } from "../harness/exec/index.js";
import { MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import { resolveArtifactsDir, runInProcessDefault } from "../harness/route/index.js";
import { route } from "../harness/route/index.js";
import type { AuthChoice } from "../harness/auth/index.js";
import { createWrenNativeToolRegistry, WREN_QUERY_TOOL_NAME, WrenBinaryNotFoundError, WRITE_ARTIFACT_TOOL_NAME } from "../harness/tools/index.js";
import { mockWrenServerConfig } from "./mock-mcp-server.js";
import { readFixture } from "./fixtures.js";

const EMPTY_USAGE: LanguageModelV4Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

function textResult(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: EMPTY_USAGE,
    warnings: [],
  };
}

function toolCallResult(toolName: string, toolCallId: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: EMPTY_USAGE,
    warnings: [],
  };
}

// The flat table shape `generate_sql`'s finishing text is contractually
// supposed to produce, already carrying `verified`/`summary` — the
// deterministic direct-render fast path (`renderEnvelope`'s
// `tryDirectEnvelope`) picks this up straight off the dataflow artifact, so
// no separate render-LLM call happens after it.
const VERIFIED_QUERY_RESULT_TEXT = JSON.stringify({
  columns: ["customer", "revenue"],
  rows: [["Acme", 1000]],
  summary: "Acme is the top customer by revenue.",
  verified: true,
});

const UNVERIFIED_QUERY_RESULT_TEXT = JSON.stringify({
  columns: ["customer", "revenue"],
  rows: [["Acme", 1000]],
  summary: "Not fully confirmed.",
  verified: false,
});

/**
 * `buildUniformTierBinding` binds every distinct tier the `answer_query`
 * agent uses (`cheap` and `strong`) to the *same* `AdapterSpec` — in-process
 * targets a single api-key/local model, not a multi-tier setup — so a single
 * scripted mock model must answer every call across both tiers, in order:
 * `resolve_intent` (cheap), the `query` tool call, its finishing text, then
 * the render envelope's own `generateObject` call (all "strong" in the
 * fixture, but here all routed through the one uniform adapter).
 */
function scriptedTurns(turns: LanguageModelV4GenerateResult[]) {
  const calls: LanguageModelV4CallOptions[] = [];
  let index = 0;
  const doGenerate = async (options: LanguageModelV4CallOptions) => {
    calls.push(options);
    const result = turns[index]!;
    index += 1;
    return result;
  };
  return { calls, doGenerate };
}

describe("in-process wiring (route -> runInProcessDefault -> runAgent)", () => {
  it("assembles a RunAgentContext from an ApiKeyAuthChoice and returns an AnswerResult", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    const { calls, doGenerate } = scriptedTurns([
      textResult("intent: top customer by revenue"),
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(VERIFIED_QUERY_RESULT_TEXT),
    ]);

    const authChoice: AuthChoice = { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: { doGenerate } };

    const result = await route({
      authChoice,
      profileSource: "/unused/profile",
      userProject: "/unused/project",
      question: "who is our top customer?",
      bundle,
      mcpServers: { sample: mockWrenServerConfig() },
    });

    if (result.backend !== "agent") throw new Error("expected the agent backend (in-process)");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("expected an answer result");
    expect(result.envelope).toEqual({
      blocks: [{ type: "table", columns: ["customer", "revenue"], rows: [["Acme", 1000]] }],
      summary: "Acme is the top customer by revenue.",
      verified: true,
    });
    // resolve_intent + query tool-call + generate_sql finish; the direct fast
    // path skips the render-LLM synthesis call entirely.
    expect(calls).toHaveLength(3);
  });

  it("a real successful data-access call earns verified:true even when the render output self-attests verified: false", async () => {
    // Pre-existing behavior trusted the render output's own "verified"
    // self-attestation and refused here. The fix intentionally changes this:
    // a locked gated_check guardrail on a data-access-requiring agent is
    // satisfied by a real successful `query` tool call, regardless of what
    // the render output separately claims about "verified" (see the matching
    // test in test/run-agent.test.ts for the full rationale).
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    const { doGenerate } = scriptedTurns([
      textResult("intent: top customer by revenue"),
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(UNVERIFIED_QUERY_RESULT_TEXT),
    ]);

    const authChoice: AuthChoice = { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: { doGenerate } };

    const result = await route({
      authChoice,
      profileSource: "/unused/profile",
      userProject: "/unused/project",
      question: "who is our top customer?",
      bundle,
      mcpServers: { sample: mockWrenServerConfig() },
    });

    if (result.backend !== "agent") throw new Error("expected the agent backend (in-process)");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("expected an answer result");
    expect(result.envelope.verified).toBe(true);
  });

  it("uses options.agentId instead of the answer_query default when set — proven by looking up the agent it names", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const authChoice: AuthChoice = {
      mode: "api-key",
      adapter: MOCK_ADAPTER_ID,
      config: {
        doGenerate: async () => {
          throw new Error("must not be reached — the agent lookup itself should fail first");
        },
      },
    };

    // An id that isn't in the fixture bundle: if runInProcessDefault still used the hardcoded
    // ANSWER_QUERY_AGENT_ID it would find "answer_query" and never reach this error at all.
    await expect(
      runInProcessDefault({
        authChoice,
        profileSource: "/unused/profile",
        userProject: "/unused/project",
        question: "why did revenue drop?",
        bundle,
        agentId: "not_a_real_agent",
        mcpServers: { sample: mockWrenServerConfig() },
      }),
    ).rejects.toThrow(/compiled bundle has no "not_a_real_agent" agent/);
  });

  it("preflights the wren binary before wiring the native tool registry, surfacing WrenBinaryNotFoundError when missing", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const authChoice: AuthChoice = { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: { doGenerate: async () => {
      throw new Error("must not be reached — the preflight should fail first");
    } } };

    const originalPath = process.env["PATH"];
    process.env["PATH"] = "";
    try {
      await expect(
        runInProcessDefault({
          authChoice,
          profileSource: "/unused/profile",
          userProject: "/unused/project",
          question: "who is our top customer?",
          bundle,
          // no mcpServers — must take the real native-tool path, which preflights `wren`.
        }),
      ).rejects.toThrow(WrenBinaryNotFoundError);
    } finally {
      if (originalPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = originalPath;
    }
  });
});

/**
 * `runInProcessDefault` used to wire its native-tool `ExecutionEnv` via a bare
 * `createLocalExecutionEnv()` — no `rootDir` — which defaults to
 * `process.cwd()`. For a live BFF process that's wherever the server process
 * happens to be launched from, so every `write_artifact` call from a
 * scoped-write agent (`explain_change`/`generate_dashboard`) dropped its
 * output straight into whatever directory started the process. These tests
 * cover the fix's two halves: `resolveArtifactsDir` (the precedence logic) in
 * isolation, and the exact `createWrenNativeToolRegistry` +
 * `createLocalExecutionEnv` wiring `runInProcessDefault` now builds around it,
 * proving `write_artifact` lands under the resolved artifacts dir — never
 * `process.cwd()` — while `query`'s exec cwd stays pinned to `projectDir`
 * regardless.
 */
describe("in-process's native write_artifact scope is never process.cwd()", () => {
  const ARTIFACTS_DIR_ENV_VAR = "WREN_HARNESS_ARTIFACTS_DIR";

  afterEach(() => {
    delete process.env[ARTIFACTS_DIR_ENV_VAR];
  });

  describe("resolveArtifactsDir", () => {
    it("prefers an explicit outDir over everything else", () => {
      process.env[ARTIFACTS_DIR_ENV_VAR] = "/should-be-ignored";
      expect(resolveArtifactsDir("/explicit/out-dir")).toBe("/explicit/out-dir");
    });

    it("falls back to WREN_HARNESS_ARTIFACTS_DIR when no outDir is given", () => {
      process.env[ARTIFACTS_DIR_ENV_VAR] = "/from-env-var";
      expect(resolveArtifactsDir(undefined)).toBe("/from-env-var");
    });

    it("defaults to an os.tmpdir()-based path — never process.cwd() — when neither is set", () => {
      delete process.env[ARTIFACTS_DIR_ENV_VAR];
      const resolved = resolveArtifactsDir(undefined);
      expect(resolved).not.toBe(process.cwd());
      expect(resolved.startsWith(tmpdir())).toBe(true);
    });
  });

  describe("the runInProcessDefault wiring (createWrenNativeToolRegistry over createLocalExecutionEnv({ rootDir: resolveArtifactsDir(...) }))", () => {
    let artifactsDir: string;

    beforeEach(async () => {
      artifactsDir = await mkdtemp(path.join(tmpdir(), "wren-harness-in-process-artifacts-"));
    });

    afterEach(async () => {
      await rm(artifactsDir, { recursive: true, force: true });
    });

    it("writes write_artifact's output under the resolved artifacts dir, not process.cwd()", async () => {
      // Mirrors runInProcessDefault's own wiring exactly (harness/route/in-process.ts):
      // createLocalExecutionEnv({ rootDir: resolveArtifactsDir(options.outDir) })
      // fed into createWrenNativeToolRegistry alongside a scoped_write policy,
      // as explain_change/generate_dashboard carry.
      const env = createLocalExecutionEnv({ rootDir: resolveArtifactsDir(artifactsDir) });
      const policy: ExecutionPolicy = { readOnly: true, artifactWriteScope: "." };
      const nativeTools = createWrenNativeToolRegistry({ env, policy, projectDir: "/unused/project" });

      const writeArtifactTool = nativeTools.create(WRITE_ARTIFACT_TOOL_NAME);
      await writeArtifactTool.execute!(
        { path: "driver_explanation.md", content: "why revenue dropped" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      const written = await readFile(path.join(artifactsDir, "driver_explanation.md"), "utf-8");
      expect(written).toBe("why revenue dropped");

      // The old bug: this same file dropped into process.cwd() instead.
      await expect(readFile(path.join(process.cwd(), "driver_explanation.md"), "utf-8")).rejects.toThrow(/ENOENT/);
    });

    it("keeps query's exec cwd pinned to projectDir, unaffected by the artifacts-dir rootDir change", async () => {
      const capturedCwds: (string | undefined)[] = [];
      const env = createLocalExecutionEnv({
        rootDir: resolveArtifactsDir(artifactsDir),
        execImpl: async (cmd) => {
          capturedCwds.push(cmd.cwd);
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      });
      const policy: ExecutionPolicy = { readOnly: false };
      const projectDir = "/a/real/wren/project";
      const nativeTools = createWrenNativeToolRegistry({ env, policy, projectDir });

      const queryTool = nativeTools.create(WREN_QUERY_TOOL_NAME);
      await queryTool.execute!({ sql: "select 1" }, { toolCallId: "call-1", messages: [], context: undefined });

      // query's cwd is projectDir, not the artifacts rootDir the env was scoped to above.
      expect(capturedCwds).toEqual([projectDir]);
      expect(capturedCwds[0]).not.toBe(artifactsDir);
    });
  });
});
