import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeComponentPlan } from "../harness/components/display.js";
import type { ExecutionPlan, StepRun } from "../harness/components/runner.js";
import { runInProcessDefault } from "../harness/route/in-process.js";
import { runAiComponentStep } from "../harness/components/ai-step.js";
import { openWrenComponentAccess } from "../harness/components/wren-access.js";

vi.mock("../harness/components/ai-step.js", () => ({ runAiComponentStep: vi.fn() }));
vi.mock("../harness/components/wren-access.js", async (original) => ({ ...await original<typeof import("../harness/components/wren-access.js")>(), openWrenComponentAccess: vi.fn() }));
vi.mock("../harness/tools/index.js", async (original) => ({ ...await original<typeof import("../harness/tools/index.js")>(), resolveWrenBinary: vi.fn() }));
vi.mock("../harness/compile/context-loader.js", () => ({ resolveContextLoader: () => ({ bin: "synthetic-context-loader" }),
  generatePreparedContext: async (_bin: string, _project: string, output: string) => writeFile(output, JSON.stringify({ context_version: 2, parseable: true })),
}));

function plan(project: string): ExecutionPlan {
  const declaration = { verb: "answer", type: "analytical", realization_kind: "skill", required_capabilities: ["sql_execution:read_only"],
    context_binding: { project }, guardrails: [{ name: "read_only_execution", locked: true }], effect: { render_blocks: [] } };
  return { identity: "synthetic-route", entries: ["dashboard"], systemPrompt: "Profile instructions", components: {
    dashboard: { id: "dashboard", declaration: { ...declaration, required_capabilities: ["component_invocation", "render_contract"],
      effect: { render_blocks: [{ type: "table", fields: { columns: "string[]", rows: "row[]" } }] } },
      steps: [{ name: "layout", tier: "strong", prompt: "Compose data", consumes: [], produces: "dashboard", tools: [], calls: [{ alias: "answer", component: "answer" }] }] },
    answer: { id: "answer", declaration,
      steps: [{ name: "query", tier: "cheap", prompt: "Read data", consumes: [], produces: "data", tools: [{ name: "query", source: "native" }], calls: [] }] },
  } };
}

beforeEach(() => vi.resetAllMocks());
describe("in-process composed route", () => {
  it("uses the dedicated route, repeated isolated child access and truthful events", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "genbi-composed-route-"));
    try {
      const query = vi.fn(async () => ({ columns: ["n"], rows: [{ n: 7 }] }));
      const close = vi.fn(async () => {});
      vi.mocked(openWrenComponentAccess).mockResolvedValue({ query, inspect: async () => ({}), close });
      vi.mocked(runAiComponentStep).mockImplementation(async (step: StepRun) => {
        expect(step.prompt).toContain("Profile instructions");
        expect(step.prompt).toContain("Host semantic context");
        if (step.tools.answer) {
          expect(Object.keys(step.tools)).toEqual(["answer"]);
          expect(step.prompt).toContain("Render output:");
          for (const request of ["first", "second"]) {
            expect(await step.tools.answer({ request })).toMatchObject({ status: "ok", output: { value: { verified: true, rows: [{ n: 7 }] } } });
          }
          return { value: JSON.stringify({ blocks: [{ type: "table", columns: ["n"], rows: [[7]] }] }) };
        }
        expect(Object.keys(step.tools)).toEqual(["query"]);
        expect(step.prompt).not.toContain("Render output:");
        expect(step.consumes).toEqual({});
        await step.tools.query!({ sql: "SELECT 7 AS n" });
        return { value: "done" };
      });
      const events: { kind: string }[] = [];
      const result = await runInProcessDefault({ bundle: describeComponentPlan(plan(project), "synthetic"), userProject: project, question: "overview", agentId: "dashboard",
        authChoice: { mode: "api-key", adapter: "openai" }, profileSource: project,
        tierBinding: { strong: { adapter: "mock", config: {} }, cheap: { adapter: "mock", config: {} } },
        ...(process.env.WARBLE_TEST_CLI ? { warbleBin: process.env.WARBLE_TEST_CLI } : {}), onEvent: (event) => events.push(event),
      });
      expect(result).toMatchObject({ kind: "answer", envelope: { verified: true, blocks: [{ type: "table", rows: [[7]] }] } });
      expect(result.trace?.steps).toHaveLength(4);
      expect(result.trace?.steps.map((step) => step.ordinal)).toEqual([0, 1, 2, 3]);
      expect(query).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledOnce();
      expect(events.filter((event) => event.kind === "step.start")).toHaveLength(3);
      expect(events.filter((event) => event.kind === "answer")).toHaveLength(1);
      expect(events.filter((event) => event.kind === "tool.call")).toHaveLength(4);
      expect(events.filter((event) => event.kind === "tool.result")).toHaveLength(4);
      expect(events.at(-1)).toMatchObject({ kind: "run.finish", status: "answer" });
    } finally { await rm(project, { recursive: true, force: true }); }
  });
  it("does not execute a serialized display projection", async () => {
    const bundle = structuredClone(describeComponentPlan(plan("/synthetic"), "synthetic"));
    await expect(runInProcessDefault({ bundle, userProject: "/synthetic", profileSource: "/synthetic", question: "go", authChoice: { mode: "api-key", adapter: "openai" } })).rejects.toThrow("trusted execution plan");
    expect(runAiComponentStep).not.toHaveBeenCalled(); expect(openWrenComponentAccess).not.toHaveBeenCalled();
  });
});
