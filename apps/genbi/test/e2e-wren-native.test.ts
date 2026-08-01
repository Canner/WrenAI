import type {
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultCapabilityRegistry } from "../harness/capability/registry.js";
import { createLocalExecutionEnv } from "../harness/exec/index.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { runAgent } from "../harness/session/index.js";
import { createWrenNativeToolRegistry } from "../harness/tools/index.js";
import { readFixture } from "./fixtures.js";
import { loadBundle } from "../harness/bundle/loader.js";
import { WARBLE_REPO } from "./warble-checkout.js";

/**
 * Opt-in end-to-end coverage (skipped by default, no flag needed): this is
 * the only test in the suite that shells out to a real `wren` binary and
 * reads a real DuckDB-backed wren project, so it's gated on both being
 * present rather than hermetic like the rest of the suite. The LLM stays entirely mocked
 * (no API credits burned) — only the `query` tool call is real.
 */
const DEFAULT_PROJECT_DIR = path.join(WARBLE_REPO, "examples", "jaffle-wren");
const projectDir = process.env["WREN_TEST_PROJECT"] ?? DEFAULT_PROJECT_DIR;

function isWrenOnPath(): boolean {
  try {
    execFileSync("wren", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = existsSync(path.join(projectDir, "wren_project.yml")) && isWrenOnPath();

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

/** Digs the real `query` tool's output out of the tool-loop turn that follows its call. */
function findToolResultOutput(call: LanguageModelV4CallOptions, toolCallId: string): LanguageModelV4ToolResultOutput {
  for (const message of call.prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result" && part.toolCallId === toolCallId) {
        return part.output;
      }
    }
  }
  throw new Error(`no tool-result content part found for toolCallId "${toolCallId}"`);
}

describe.skipIf(!canRun)("runAgent against a real wren project (native query tool, mock LLM) [opt-in e2e]", () => {
  it("executes the query tool through the real wren CLI and returns real jaffle rows", async () => {
    const sql = "SELECT first_name, customer_lifetime_value FROM customers ORDER BY customer_lifetime_value DESC LIMIT 1";
    let capturedToolResult: LanguageModelV4ToolResultOutput | undefined;

    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async () => textResult("intent: find the customer with the highest customer_lifetime_value"),
          },
        },
        strong: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: (() => {
              let step = 0;
              return async (options: LanguageModelV4CallOptions) => {
                const current = step;
                step += 1;

                if (current === 0) {
                  return toolCallResult("query", "call-1", { sql, limit: 1 });
                }
                if (current === 1) {
                  capturedToolResult = findToolResultOutput(options, "call-1");
                  return textResult(JSON.stringify(capturedToolResult));
                }
                return textResult(
                  JSON.stringify({
                    blocks: [{ type: "table" }],
                    summary: "The customer with the highest lifetime value is identified below.",
                    verified: true,
                  }),
                );
              };
            })(),
          },
        },
      },
    };

    // This fixture was dispatched by `warble dispatch --target vercel --provider
    // providers/wren.provider.yaml` (the wren provider fragment realizes the genbi analytical
    // domain capabilities natively), so its `query` tool source is already `native` — no inline
    // override needed.
    const bundle = loadBundle(readFixture("genbi-default.native.bundle.json"));
    const env = createLocalExecutionEnv();
    const policy = { readOnly: true };
    const nativeTools = createWrenNativeToolRegistry({ env, policy, projectDir });

    const result = await runAgent(bundle, "answer_query", "who is our most valuable customer?", {
      binding,
      registry: createDefaultProviderRegistry(),
      capabilityRegistry: createDefaultCapabilityRegistry(),
      nativeTools,
    });

    expect(result.kind).toBe("answer");
    expect(capturedToolResult).toBeDefined();
    expect(capturedToolResult?.type).toBe("json");
    if (capturedToolResult?.type !== "json") throw new Error("expected a json tool-result output");

    const queryResult = capturedToolResult.value as { columns: string[]; rows: Record<string, unknown>[] };
    expect(queryResult.columns).toEqual(["first_name", "customer_lifetime_value"]);
    expect(queryResult.rows).toHaveLength(1);
    // Real row from the checked-in jaffle_shop.duckdb, verified independently
    // via `wren -q -o json -l 1 -s '<sql>'` before writing this assertion —
    // not canned/mock data.
    expect(queryResult.rows[0]).toEqual({ first_name: "Howard", customer_lifetime_value: 99.0 });
  });
});

describe.skipIf(!canRun)("runAgent(explore_model) against a real wren project (native semantic_introspect tool, mock LLM) [opt-in e2e]", () => {
  it("executes the semantic_introspect tool through the real wren CLI and returns real jaffle model names", async () => {
    let capturedToolResult: LanguageModelV4ToolResultOutput | undefined;

    // explore_model's single step ("summarize_semantics") runs on the
    // "cheap" tier — unlike answer_query's two-tier shape (a "cheap" intent
    // classification pass, then a "strong" tool-calling step), so this mock
    // only needs the "cheap" tier: one call to invoke the tool, a second to
    // read its real result and produce the step's required final JSON
    // (`{"columns": ["model"], "rows": [...]}`, per the component's step
    // prompt). That flat {columns,rows} shape is what lets `renderEnvelope`'s
    // `tryDirectEnvelope` fast path build the answer directly — no third
    // render-tier call is needed here (unlike the `answer_query` e2e above,
    // whose MCP-wrapped tool result isn't a flat table at the top level).
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: (() => {
              let step = 0;
              return async (options: LanguageModelV4CallOptions) => {
                const current = step;
                step += 1;

                if (current === 0) {
                  return toolCallResult("semantic_introspect", "call-1", {});
                }

                capturedToolResult = findToolResultOutput(options, "call-1");
                if (capturedToolResult.type !== "json") {
                  throw new Error("expected a json tool-result output from semantic_introspect");
                }
                const introspected = capturedToolResult.value as { models?: { name: string }[] };
                const modelNames = (introspected.models ?? []).map((model) => model.name);
                return textResult(JSON.stringify({ columns: ["model"], rows: modelNames.map((name) => [name]) }));
              };
            })(),
          },
        },
      },
    };

    const bundle = loadBundle(readFixture("genbi-default.native.bundle.json"));
    const env = createLocalExecutionEnv();
    const policy = { readOnly: true };
    const nativeTools = createWrenNativeToolRegistry({ env, policy, projectDir });

    const result = await runAgent(bundle, "explore_model", "what does this project's semantic layer contain?", {
      binding,
      registry: createDefaultProviderRegistry(),
      capabilityRegistry: createDefaultCapabilityRegistry(),
      nativeTools,
    });

    expect(result.kind).toBe("answer");
    expect(capturedToolResult).toBeDefined();
    expect(capturedToolResult?.type).toBe("json");
    if (capturedToolResult?.type !== "json") throw new Error("expected a json tool-result output");

    // Real models from the checked-in jaffle project's MDL — not canned/mock
    // data; verified independently via `wren context show -o json` before
    // writing this assertion.
    const introspected = capturedToolResult.value as { models: { name: string }[] };
    const modelNames = introspected.models.map((model) => model.name);
    expect(modelNames).toContain("customers");
    expect(modelNames).toContain("orders");

    if (result.kind !== "answer") throw new Error("expected an answer result");
    const blocks = result.envelope.blocks as { type: string; columns?: string[]; rows?: unknown[][] }[];
    const tableBlock = blocks.find((block) => block.type === "table");
    expect(tableBlock).toBeDefined();
    expect(tableBlock?.columns).toEqual(["model"]);
    expect(tableBlock?.rows).toEqual(expect.arrayContaining([["customers"], ["orders"]]));
  });
});
