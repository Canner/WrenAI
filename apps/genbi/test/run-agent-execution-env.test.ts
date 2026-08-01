import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { createDefaultCapabilityRegistry } from "../harness/capability/registry.js";
import { createLocalExecutionEnv } from "../harness/exec/index.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { runAgent } from "../harness/session/index.js";
import { WRITE_ARTIFACT_TOOL_NAME } from "../harness/tools/index.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

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

/**
 * A single "cheap" tier that scripts, in order: the step's write_artifact
 * tool call, the step's finishing text, and the render envelope stage's
 * `generateObject` JSON — all three run on the same tier because the
 * synthetic bundle has exactly one step and no `renderTier` override.
 */
function buildBinding(turns: LanguageModelV4GenerateResult[]) {
  const calls: LanguageModelV4CallOptions[] = [];
  let index = 0;

  const binding: TierBinding = {
    tiers: {
      cheap: {
        adapter: MOCK_ADAPTER_ID,
        config: {
          doGenerate: async (options: LanguageModelV4CallOptions) => {
            calls.push(options);
            const result = turns[index]!;
            index += 1;
            return result;
          },
        },
      },
    },
  };

  return { binding, calls };
}

describe("runAgent threading an injected ExecutionEnv down to the native write_artifact tool", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "wren-harness-run-agent-exec-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("writes the artifact into the injected LocalExecutionEnv's scoped workspace, derived from a locked scoped_write guardrail", async () => {
    const bundle = loadBundle(
      buildSyntheticBundle({
        tools: [{ name: WRITE_ARTIFACT_TOOL_NAME, source: "native" }],
        guardrails: {
          read_only_execution: { enforcement: "read_only", locked: true },
          artifact_write: { enforcement: "scoped_write", locked: true, scope: "." },
        },
      }),
    );

    const { binding } = buildBinding([
      toolCallResult(WRITE_ARTIFACT_TOOL_NAME, "call-1", { path: "report.md", content: "hello" }),
      textResult("wrote the artifact"),
      textResult("{}"),
    ]);

    const result = await runAgent(bundle, "synthetic_agent", "write a report", {
      binding,
      registry: createDefaultProviderRegistry(),
      capabilityRegistry: createDefaultCapabilityRegistry(),
      executionEnv: createLocalExecutionEnv({ rootDir }),
    });

    expect(result.kind).toBe("answer");
    const written = await readFile(path.join(rootDir, "report.md"), "utf-8");
    expect(written).toBe("hello");
  });
});
