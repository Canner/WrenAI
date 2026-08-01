import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

// Same mocking approach as test/mode-b-setup-runner.test.ts: mock the one
// external boundary (the `warble dispatch` subprocess wrapper) so no real
// warble binary is needed, while everything downstream of it — bundle
// loading, tier binding, native-tool wiring, and the model turn itself — runs
// as real, unmocked code. The model turn is driven through a scripted
// MOCK_ADAPTER_ID adapter (mirrors test/tool-loop-integration.test.ts)
// rather than mocking `executeAgent`, since the whole point of this runner is
// the wiring between the setup policy/env/native-tool registry and
// `executeAgent` — a coarse `executeAgent` mock would hide exactly the code
// this test exists to exercise.
const runWarbleMock = vi.fn();
vi.mock("../harness/compile/pipeline.js", () => ({
  runWarble: (...args: unknown[]) => runWarbleMock(...args),
}));

afterEach(() => {
  runWarbleMock.mockReset();
});

const EXISTING_FILE = fileURLToPath(import.meta.url); // stands in for warbleBin's existsSync tier-1 check; never executed since runWarble is mocked.

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

/** Makes the mocked `runWarble` behave like the real `warble dispatch` CLI: write `bundle.json` into whatever `--out` dir it was given. */
function respondWithBundle(bundle: unknown): void {
  runWarbleMock.mockImplementation(async (_bin: string, args: string[]) => {
    const outIdx = args.indexOf("--out");
    const outDir = args[outIdx + 1]!;
    await writeFile(path.join(outDir, "bundle.json"), JSON.stringify(bundle), "utf-8");
    return { stdout: "", stderr: "" };
  });
}

function scriptedBinding(doGenerate: (options: LanguageModelV4CallOptions) => Promise<LanguageModelV4GenerateResult>): TierBinding {
  return { tiers: { cheap: { adapter: MOCK_ADAPTER_ID, config: { doGenerate } } } };
}

describe("ModeASetupRunner (the real production Mode A setup runner, not a stub)", () => {
  it("a subscription authChoice throws WITHOUT dispatching anything", async () => {
    const { ModeASetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeASetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: EXISTING_FILE });

    await expect(
      runner.run({
        prompt: "scaffold a new project",
        workspaceRoot: "/tmp/wren-harness-mode-a-setup-runner-test",
        authChoice: { mode: "subscription", provider: "claude" },
      }),
    ).rejects.toThrow(/api-key\/local\/gateway/i);

    expect(runWarbleMock).not.toHaveBeenCalled();
  });

  it("an api-key dispatch runs the compiled bundle's agent for real (via a scripted mock model) and returns the produced artifact as finalText/sessionId:null", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-a-setup-runner-ws-"));
    try {
      respondWithBundle(
        buildSyntheticBundle({ tools: [{ name: "setup_execution", source: "native" }] }),
      );

      const { ModeASetupRunner } = await import("../harness/setup/runner.js");
      const runner = new ModeASetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: EXISTING_FILE });

      const doGenerate = async () => textResult("connected to postgres");

      // ModeASetupRunner builds the model binding itself from `authChoice` via
      // `deriveAdapterSpec`; for `mode: "api-key"` that function passes
      // `authChoice.adapter`/`authChoice.config` straight through, so pointing
      // it at MOCK_ADAPTER_ID with a scripted `doGenerate` config drives a real
      // (unmocked) `executeAgent` call end to end.
      const result = await runner.run({
        prompt: "scaffold a new project named acme",
        workspaceRoot,
        authChoice: { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: { doGenerate } },
        agentId: "synthetic_agent",
      });

      expect(result).toEqual({ finalText: "connected to postgres", sessionId: null });
      expect(runWarbleMock).toHaveBeenCalledTimes(1);

      const [bin, args] = runWarbleMock.mock.calls[0] as [string, string[]];
      expect(bin).toBe(EXISTING_FILE);
      expect(args).toEqual([
        "dispatch",
        "--target",
        "vercel",
        "--provider",
        expect.stringContaining("setup.provider.yaml"),
        "/fixture/genbi-setup/ir.golden.json",
        "--out",
        expect.any(String),
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("actually reaches the real setup_execution native tool: a scripted tool call executes a real shell command scoped to workspaceRoot, and writes a real file within scope", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-a-setup-runner-ws-"));
    try {
      respondWithBundle(
        buildSyntheticBundle({ tools: [{ name: "setup_execution", source: "native" }] }),
      );

      const { ModeASetupRunner } = await import("../harness/setup/runner.js");
      const runner = new ModeASetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: EXISTING_FILE });

      const calls: LanguageModelV4CallOptions[] = [];
      const results = [
        toolCallResult("setup_execution", "call-1", {
          action: "write",
          path: "notes/connected.txt",
          content: "postgres://acme",
        }),
        textResult("wrote connection notes"),
      ];
      let callIndex = 0;
      const doGenerate = async (options: LanguageModelV4CallOptions) => {
        calls.push(options);
        const result = results[callIndex]!;
        callIndex += 1;
        return result;
      };

      const result = await runner.run({
        prompt: "scaffold a new project named acme",
        workspaceRoot,
        authChoice: { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: { doGenerate } },
        agentId: "synthetic_agent",
      });

      expect(calls).toHaveLength(2);
      expect(result.finalText).toBe("wrote connection notes");

      // The write actually happened, for real, scoped under workspaceRoot —
      // proof `ModeASetupRunner` wires a real ExecutionEnv/policy/native-tool
      // registry through to `executeAgent`, not a stub.
      const written = await readFile(path.join(workspaceRoot, "notes/connected.txt"), "utf-8");
      expect(written).toBe("postgres://acme");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("forwards run.start / answer / run.finish bookend events to onEvent on a successful dispatch", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-a-setup-runner-ws-"));
    try {
      respondWithBundle(
        buildSyntheticBundle({ tools: [{ name: "setup_execution", source: "native" }] }),
      );

      const { ModeASetupRunner } = await import("../harness/setup/runner.js");
      const runner = new ModeASetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: EXISTING_FILE });

      const events: Array<{ kind: string }> = [];
      await runner.run({
        prompt: "scaffold a new project named acme",
        workspaceRoot,
        authChoice: {
          mode: "api-key",
          adapter: MOCK_ADAPTER_ID,
          config: { doGenerate: async () => textResult("connected") },
        },
        agentId: "synthetic_agent",
        onEvent: (event) => events.push(event),
      });

      const kinds = events.map((event) => event.kind);
      expect(kinds[0]).toBe("run.start");
      expect(kinds).toContain("answer");
      expect(kinds.at(-1)).toBe("run.finish");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("still emits run.start / error / run.finish and rethrows when the compiled bundle has no matching agentId", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-a-setup-runner-ws-"));
    try {
      respondWithBundle(
        buildSyntheticBundle({ tools: [{ name: "setup_execution", source: "native" }] }),
      );

      const { ModeASetupRunner } = await import("../harness/setup/runner.js");
      const runner = new ModeASetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: EXISTING_FILE });

      const events: Array<{ kind: string }> = [];
      await expect(
        runner.run({
          prompt: "scaffold a new project named acme",
          workspaceRoot,
          authChoice: { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: {} },
          agentId: "no_such_agent",
          onEvent: (event) => events.push(event),
        }),
      ).rejects.toThrow(/no_such_agent/);

      const kinds = events.map((event) => event.kind);
      expect(kinds[0]).toBe("run.start");
      expect(kinds).toContain("error");
      expect(kinds.at(-1)).toBe("run.finish");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("effectiveMaxTurns() reports exactly the budget run() dispatches with — build_context gets DEFAULT_SETUP_MAX_TURNS by default, connect_source stays undefined, and an explicit override always wins", async () => {
    const { ModeASetupRunner, DEFAULT_SETUP_MAX_TURNS } = await import("../harness/setup/runner.js");

    const defaultRunner = new ModeASetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: EXISTING_FILE });
    expect(defaultRunner.effectiveMaxTurns("build_context")).toBe(DEFAULT_SETUP_MAX_TURNS);
    expect(defaultRunner.effectiveMaxTurns("connect_source")).toBeUndefined();

    const overriddenRunner = new ModeASetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: EXISTING_FILE,
      maxTurns: 2,
    });
    expect(overriddenRunner.effectiveMaxTurns("connect_source")).toBe(2);
    expect(overriddenRunner.effectiveMaxTurns("build_context")).toBe(2);
  });

  it("run() actually dispatches the effectiveMaxTurns() value as ExecuteAgentContext.maxSteps — a scripted model that never finishes on its own is cut off exactly there, as StepBudgetExhaustedError", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-a-setup-runner-budget-"));
    try {
      respondWithBundle(buildSyntheticBundle({ tools: [{ name: "setup_execution", source: "native" }] }));

      const { ModeASetupRunner, StepBudgetExhaustedError } = await import("../harness/setup/runner.js");
      const runner = new ModeASetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: EXISTING_FILE, maxTurns: 2 });
      expect(runner.effectiveMaxTurns("synthetic_agent")).toBe(2);

      // Always calls the tool again — never returns a "stop" finish — so only
      // the step budget (not the model's own cooperation) can end the turn.
      let callCount = 0;
      const doGenerate = async () => {
        callCount += 1;
        return toolCallResult("setup_execution", `call-${callCount}`, {
          action: "write",
          path: `notes/${callCount}.txt`,
          content: "x",
        });
      };

      const error = await runner
        .run({
          prompt: "scaffold a new project named acme",
          workspaceRoot,
          authChoice: { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: { doGenerate } },
          agentId: "synthetic_agent",
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(StepBudgetExhaustedError);
      expect((error as InstanceType<typeof StepBudgetExhaustedError>).maxSteps).toBe(2);
      // The enriched, honest failure message (not a generic parse error) —
      // see ModeASetupRunner.run()'s catch block.
      expect((error as Error).message).toContain('ran out of steps (2 max)');
      expect((error as Error).message).toContain(workspaceRoot);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
