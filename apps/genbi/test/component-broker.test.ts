import { beforeAll, describe, expect, it } from "vitest";
import { createComponentBroker, type ComponentIdentity } from "../harness/components/broker.js";
import { normalizeComponentEvidence } from "../harness/components/normalize.js";
import { ComponentRunner, type ComponentPlan, type ExecutionPlan, type StepRun } from "../harness/components/runner.js";

import { planDigest } from "../harness/components/plan.js";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";

let verifierBinary: string;
beforeAll(async () => { verifierBinary = await resolveWarbleBinary(process.env.WARBLE_TEST_CLI); });
const contexts = { answer: { binding: {}, snapshot: { context_version: 2, parseable: true } } };
const identity: ComponentIdentity = { session: "session", vendor: "synthetic", account: "approved-account", generation: "1",
  project: "project", bindingRevision: "revision", contextDigest: planDigest(contexts), planDigest: "plan" };
function component(): ComponentPlan {
  return { id: "answer", declaration: { context_binding: {}, context_precondition: [{ predicate: "mdl_parseable" }], required_capabilities: ["sql_execution:read_only"], effect: { render_blocks: [] },
    guardrails: [{ name: "read_only_execution", locked: true }, { name: "row_limit", locked: true, threshold: 2 }] },
  steps: [{ name: "query", tier: "cheap", prompt: "query", consumes: [], produces: "data", tools: [{ name: "query", source: "native" }], calls: [] }] };
}
function fixture(step: (run: StepRun) => Promise<unknown>) {
  let current: ComponentIdentity | undefined = { ...identity };
  let closed = 0;
  const queries: unknown[] = [];
  const broker = createComponentBroker({ plan: plan(), contexts, verifierBinary, identity, currentIdentity: () => current,
    async prepare() { return {
      async query(input, signal) { signal.throwIfAborted(); queries.push(input); return { columns: ["n"], rows: [{ n: 7 }] }; },
      async inspect() { return { models: [] }; }, async close() { closed++; },
    }; },
    async step(run) { return { value: await step(run) }; },
    async normalize(node, evidence) { return normalizeComponentEvidence(node, evidence); },
  });
  return { broker, queries, closed: () => closed, replace: (value: ComponentIdentity | undefined) => { current = value; } };
}
function plan(): ExecutionPlan { return { identity: "plan", entries: ["answer"], components: { answer: component() } }; }

describe("component-owned typed access", () => {
  it("bounds SQL rows and earns result provenance only from observed data", async () => {
    const f = fixture(async (run) => {
      expect(run.toolSchemas.query).toMatchObject({ additionalProperties: false });
      await run.tools.query!({ sql: "SELECT 7 AS n", limit: 999 });
      return JSON.stringify({ verified: true, rows: [{ n: 999 }] });
    });
    const result = await new ComponentRunner(plan(), f.broker).run("answer", { request: "question" });
    expect(result).toMatchObject({ status: "ok", output: { value: { rows: [{ n: 7 }] } }, provenance: { verified: true, definition: { sql: "SELECT 7 AS n" } } });
    expect(f.queries).toEqual([{ sql: "SELECT 7 AS n", limit: 2 }]);
    expect(f.closed()).toBe(1);
  });
  it.each(["project", "connection", "cwd", "component", "step"])("rejects model override %s before data access", async (field) => {
    const f = fixture(async (run) => run.tools.query!({ sql: "SELECT 7", [field]: "forged" }));
    expect((await new ComponentRunner(plan(), f.broker).run("answer", { request: "go" })).status).toBe("error");
    expect(f.queries).toEqual([]);
  });
  it.each(Object.keys(identity) as (keyof ComponentIdentity)[])("revokes access after %s changes", async (field) => {
    const f = fixture(async (run) => {
      f.replace({ ...identity, [field]: "changed" });
      return run.tools.query!({ sql: "SELECT 7" });
    });
    expect(await new ComponentRunner(plan(), f.broker).run("answer", { request: "go" })).toMatchObject({ status: "error", code: "cancelled" });
    expect(f.queries).toEqual([]);
  });
  it("refuses model self-attestation without observed query success", async () => {
    const f = fixture(async () => JSON.stringify({ verified: true, rows: [{ n: 7 }] }));
    expect((await new ComponentRunner(plan(), f.broker).run("answer", { request: "go" })).status).toBe("refused");
  });
  it.each(["refused", "error"])("observed SQL cannot override terminal %s", async (status) => {
    const f = fixture(async (run) => { await run.tools.query!({ sql: "SELECT 7 AS n" }); return JSON.stringify({ status, message: "stop" }); });
    expect((await new ComponentRunner(plan(), f.broker).run("answer", { request: "go" })).status).toBe("refused");
  });
  it("refuses stale and unknown tool bindings before opening data access", async () => {
    const f = fixture(async () => "unused");
    f.replace(undefined);
    await expect(f.broker.prepare(component(), new AbortController().signal)).rejects.toThrow();
    f.replace(identity);
    const node = component();
    (node.steps[0]!.tools[0]! as { source: string }).source = "mcp:ambient/query";
    await expect(f.broker.prepare(node, new AbortController().signal)).rejects.toThrow();
  });
});
