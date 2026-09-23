import { describe, expect, it } from "vitest";
import { ComponentRunner, type ComponentBinding, type ExecutionPlan, type RunnerHost, type StepRun } from "../harness/components/runner.js";

function plan(): ExecutionPlan {
  return {
    identity: "synthetic-plan", entries: ["dashboard"], components: {
      dashboard: { id: "dashboard", declaration: {}, steps: [
        { name: "layout", tier: "strong", prompt: "layout", consumes: [], produces: "layout",
          tools: [], calls: [{ alias: "answer", component: "answer" }] },
      ] },
      answer: { id: "answer", declaration: {}, steps: [
        { name: "query", tier: "cheap", prompt: "query", consumes: [], produces: "data",
          tools: [{ name: "query", source: "mcp:wren/query" }], calls: [] },
      ] },
    },
  };
}
function fixture(run: (step: StepRun) => Promise<unknown>) {
  const prepared: string[] = [];
  const closed: string[] = [];
  const queries: unknown[] = [];
  const completed: string[] = [];
  let current = true;
  const host: RunnerHost = {
    async prepare(component) {
      prepared.push(component.id);
      return {
        tools: component.id === "answer" ? [{ name: "query", source: "mcp:wren/query", async execute(input) { queries.push(input); return { rows: [[1]] }; } }] : [],
        isCurrent: () => current,
        async normalize(evidence) {
          completed.push(component.id);
          return { status: "ok", output: { kind: "value", value: evidence.steps } };
        },
        async close() { closed.push(component.id); },
      } satisfies ComponentBinding;
    },
    async runStep(step) { return { value: await run(step), usage: { inputTokens: 2, outputTokens: 1 } }; },
  };
  return { host, prepared, closed, queries, completed, revoke: () => { current = false; } };
}

describe("host-owned component runner", () => {
  it("prepares the closure first and isolates repeated child tools and inputs", async () => {
    const seen: StepRun[] = [];
    const f = fixture(async (step) => {
      expect(f.prepared).toEqual(["dashboard", "answer"]);
      seen.push(step);
      if (step.prompt === "layout") {
        expect(Object.keys(step.tools)).toEqual(["answer"]);
        const first = await step.tools.answer!({ request: "first", input: { local: 1 } });
        const second = await step.tools.answer!({ request: "second" });
        return [first, second];
      }
      expect(Object.keys(step.tools)).toEqual(["query"]);
      expect(step.consumes).toEqual({});
      return step.tools.query!({ sql: "select 1" });
    });
    const runner = new ComponentRunner(plan(), f.host);
    expect((await runner.run("dashboard", { request: "dashboard", input: { secret: "root-only" } })).status).toBe("ok");
    expect(seen[1]!.input).toEqual({ local: 1 });
    expect(seen[2]!.input).toEqual({});
    expect(f.queries).toHaveLength(2);
    expect(f.completed).toEqual(["answer", "answer", "dashboard"]);
    expect(runner.observedUsage).toEqual({ inputTokens: 6, outputTokens: 3 });
    expect(f.closed.sort()).toEqual(["answer", "dashboard"]);
  });

  it("refuses stale step tools after completion", async () => {
    let retained!: (input: unknown) => Promise<unknown>;
    const f = fixture(async (step) => { retained = step.tools.answer!; return "done"; });
    const runner = new ComponentRunner(plan(), f.host);
    await runner.run("dashboard", { request: "go" });
    await expect(retained({ request: "replay" })).rejects.toThrow();
    expect(f.queries).toHaveLength(0);
    await expect(runner.run("dashboard", { request: "again" })).rejects.toThrow("single-use");
  });

  it.each(["refused", "error"] as const)("cannot hide a child %s result behind a successful parent", async (status) => {
    const f = fixture(async (step) => {
      if (step.tools.answer) {
        await step.tools.answer({ request: "child" }).catch(() => {});
        return "parent claims success";
      }
      return "child output";
    });
    let persisted = 0;
    f.host.persistRoot = async () => { persisted++; };
    const prepare = f.host.prepare;
    f.host.prepare = async (component, signal) => {
      const bound = await prepare(component, signal);
      if (component.id !== "answer") return bound;
      return { ...bound, normalize: async () => status === "refused"
        ? { status, code: "callee_refused", message: "denied" }
        : { status, code: "invalid_result", message: "invalid", retryable: false } };
    };
    expect(await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go" })).toMatchObject({ status: "error", code: "callee_failed" });
    expect(f.completed).toEqual([]);
    expect(persisted).toBe(0);
  });

  it("persists only the successful root after repeated child normalization", async () => {
    const f = fixture(async (step) => {
      if (step.tools.answer) {
        await step.tools.answer({ request: "one" });
        await step.tools.answer({ request: "two" });
      }
      return "valid";
    });
    let persisted = 0;
    f.host.persistRoot = async (result, binding, signal) => {
      persisted++;
      expect(result.status).toBe("ok");
      expect(binding.tools).toEqual([]);
      expect(signal.aborted).toBe(false);
      expect(f.completed).toEqual(["answer", "answer", "dashboard"]);
      expect(f.closed.sort()).toEqual(["answer", "dashboard"]);
    };
    expect((await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go" })).status).toBe("ok");
    expect(persisted).toBe(1);
  });

  it("withholds persistence if required resource cleanup fails", async () => {
    const f = fixture(async () => "result");
    const prepare = f.host.prepare;
    f.host.prepare = async (node, signal) => ({ ...await prepare(node, signal), async close() { throw new Error("cleanup failed"); } });
    let persisted = false;
    f.host.persistRoot = async () => { persisted = true; };
    expect((await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go" })).status).toBe("error");
    expect(persisted).toBe(false);
  });

  it("rejects malformed host normalization before persistence", async () => {
    const f = fixture(async () => "result");
    const prepare = f.host.prepare;
    f.host.prepare = async (node, signal) => ({ ...await prepare(node, signal), async normalize() { return { status: "ok" } as never; } });
    expect(await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go" })).toMatchObject({ status: "error", code: "invalid_result" });
  });

  it("refuses undeclared entry, model-supplied authority and tool-source substitution", async () => {
    const f = fixture(async () => { throw new Error("must not run"); });
    expect((await new ComponentRunner(plan(), f.host).run("answer", { request: "go" })).status).toBe("error");
    expect((await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go", component: "answer" })).status).toBe("error");
    const original = f.host.prepare;
    f.host.prepare = async (component, signal) => {
      const binding = await original(component, signal);
      return { ...binding, tools: binding.tools.map((tool) => ({ ...tool, source: "untrusted" })) };
    };
    expect((await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go" })).status).toBe("error");
    expect(f.completed).toHaveLength(0);
  });

  it("stops admission on binding revocation", async () => {
    const f = fixture(async (step) => {
      f.revoke();
      await step.tools.answer!({ request: "go" });
      return "bad";
    });
    const result = await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go" });
    expect(result).toMatchObject({ status: "error", code: "cancelled" });
    expect(f.queries).toHaveLength(0);
    expect(f.completed).toHaveLength(0);
  });

  it("cancels descendants and discards a late result while retaining observed usage", async () => {
    const cancel = new AbortController();
    let resolve!: (value: unknown) => void;
    let started!: () => void;
    const running = new Promise<void>((r) => { started = r; });
    const f = fixture(async (step) => {
      if (step.prompt === "layout") return step.tools.answer!({ request: "child" });
      started();
      return new Promise((r) => { resolve = r; });
    });
    const runner = new ComponentRunner(plan(), f.host);
    const promise = runner.run("dashboard", { request: "go" }, cancel.signal);
    await running;
    cancel.abort();
    expect(await promise).toMatchObject({ status: "error", code: "cancelled" });
    resolve("late-data");
    await new Promise((r) => setImmediate(r));
    expect(f.completed).toHaveLength(0);
    expect(runner.observedUsage.inputTokens).toBeGreaterThanOrEqual(2);
  });

  it("serializes sibling calls and bounds repeated admissions", async () => {
    let active = 0;
    let peak = 0;
    const f = fixture(async (step) => {
      if (step.prompt === "layout") return Promise.all(Array.from({ length: 33 }, () => step.tools.answer!({ request: "child" })));
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setImmediate(r));
      active--;
      return "value";
    });
    const result = await new ComponentRunner(plan(), f.host).run("dashboard", { request: "go" });
    expect(result).toMatchObject({ status: "error", code: "budget_exhausted" });
    expect(peak).toBe(1);
    expect(f.completed).toHaveLength(32);
  });

  it("keeps repair output distinct and supplies only exact consumed products", async () => {
    const root = plan().components.dashboard!;
    const testPlan = { identity: "repair", entries: [root.id], components: {
      [root.id]: { ...root, steps: [
        { ...root.steps[0]!, calls: [] },
        { ...root.steps[0]!, name: "repair", prompt: "repair", produces: "fixed", consumes: ["layout"], calls: [], repairOf: "layout" },
        { ...root.steps[0]!, name: "next", prompt: "next", produces: "final", consumes: ["layout"], calls: [] },
      ] },
    } };
    const f = fixture(async () => "unused");
    f.host.runStep = async (step) => {
      if (step.prompt === "layout") return { value: "secret error", failed: true };
      expect(step.consumes).toEqual({ layout: { status: "error", code: "step_failed" } });
      return { value: step.prompt };
    };
    const result = await new ComponentRunner(testPlan, f.host).run(root.id, { request: "go" });
    expect(result).toMatchObject({ status: "ok", output: { value: {
      layout: { status: "error", code: "step_failed" }, fixed: "repair", final: "next",
    } } });
  });

  it("rejects cyclic closure and conditional-only dataflow before preparation", () => {
    const cyclic = plan();
    const edge = cyclic.components.dashboard!.steps[0]!.calls[0]! as { component: string };
    edge.component = "dashboard";
    const f = fixture(async () => "unused");
    expect(() => new ComponentRunner(cyclic, f.host)).toThrow("closure");
    expect(f.prepared).toEqual([]);
  });

  it("takes an immutable snapshot before callers can replace steps", async () => {
    const source = plan();
    const f = fixture(async (step) => { expect(step.prompt).toBe("layout"); return "done"; });
    const runner = new ComponentRunner(source, f.host);
    (source.components.dashboard!.steps[0]! as { prompt: string }).prompt = "changed";
    expect((await runner.run("dashboard", { request: "go" })).status).toBe("ok");
  });
});
