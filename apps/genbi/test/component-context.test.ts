import { beforeAll, describe, expect, it } from "vitest";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { createComponentBroker } from "../harness/components/broker.js";
import { planDigest } from "../harness/components/plan.js";
import { ComponentRunner, type ComponentPlan, type ExecutionPlan } from "../harness/components/runner.js";

let binary: string;
beforeAll(async () => { binary = await resolveWarbleBinary(process.env.WARBLE_TEST_CLI); });
const snapshot = { context_version: 2, parseable: true, metrics: [], models: [], dimensions: [] };
function node(id: string, conditions: unknown): ComponentPlan {
  return { id, declaration: { context_binding: { project: "host-project" }, ...(conditions !== undefined ? { context_precondition: conditions } : {}),
    precondition_result: { status: "pass" }, guardrails: [{ name: "read_only_execution", locked: true }] },
  steps: [{ name: "run", tier: "cheap", prompt: "Use context", consumes: [], produces: "answer", tools: [], calls: [] }] };
}
function fixture(conditions: unknown, context: unknown = snapshot) {
  const child = node("child", conditions);
  const root = node("root", []);
  const plan: ExecutionPlan = { identity: "plan", entries: ["root"], components: {
    root: { ...root, steps: [{ ...root.steps[0]!, calls: [{ alias: "child", component: "child" }] }] }, child,
  } };
  const contexts = Object.fromEntries([root, child].map((value) => [value.id, { binding: value.declaration.context_binding as Record<string, unknown>, snapshot: context }]));
  const identity = { session: "s", vendor: "fixture", account: "account", generation: "1", project: "project",
    bindingRevision: "1", contextDigest: planDigest(contexts), planDigest: plan.identity };
  let prepared = 0;
  let modelCalls = 0;
  const host = createComponentBroker({ plan, contexts, verifierBinary: binary, identity, currentIdentity: () => identity,
    async prepare() { prepared++; return { async query() {}, async inspect() {}, async close() {} }; },
    async step(run) { modelCalls++; expect(run.prompt).toContain('"parseable":true'); return { value: "done" }; },
    async normalize() { return { status: "ok", output: { kind: "value", value: "done" } }; },
  });
  return { plan, contexts, host, counts: () => ({ prepared, modelCalls }) };
}

describe("host context admission", () => {
  it.each([
    ["false", [{ predicate: "has_metric" }]],
    ["unanswerable", [{ predicate: "source_introspectable" }]],
    ["unknown", [{ predicate: "trust_model" }]],
    ["unresolved", [{ predicate: "model_has_timestamp", args: { model: "$param:model" } }]],
    ["malformed selector", [{ predicate: "model_has_timestamp", args: { model: 1 } }]],
    ["malformed declaration", { predicate: "mdl_parseable" }],
  ])("rejects %s callee predicates before any model or callee binding", async (_label, conditions) => {
    const f = fixture(conditions);
    expect((await new ComponentRunner(f.plan, f.host).run("root", { request: "go" })).status).toBe("error");
    expect(f.counts()).toEqual({ prepared: 1, modelCalls: 0 });
  });
  it.each([null, { context_version: 1, parseable: true }, { context_version: 2, parseable: "true" }])("rejects malformed snapshots", async (context) => {
    const f = fixture([{ predicate: "mdl_parseable" }], context);
    expect((await new ComponentRunner(f.plan, f.host).run("root", { request: "go" })).status).toBe("error");
    expect(f.counts()).toEqual({ prepared: 1, modelCalls: 0 });
  });
  it.each([undefined, []])("preserves absent or empty predicate compatibility", async (conditions) => {
    const f = fixture(conditions);
    expect((await new ComponentRunner(f.plan, f.host).run("root", { request: "go" })).status).toBe("ok");
  });
  it("keeps the verified snapshot when the caller mutates its source", async () => {
    const f = fixture([{ predicate: "mdl_parseable" }]);
    f.contexts.child!.snapshot = { context_version: 2, parseable: false };
    expect((await new ComponentRunner(f.plan, f.host).run("root", { request: "go" })).status).toBe("ok");
    expect(f.counts()).toEqual({ prepared: 2, modelCalls: 1 });
  });
  it("rejects a substituted callee even with the same top-level plan identity", async () => {
    const f = fixture([{ predicate: "mdl_parseable" }]);
    const changed = { ...f.plan, components: { ...f.plan.components, child: node("child", []) } };
    expect((await new ComponentRunner(changed, f.host).run("root", { request: "go" })).status).toBe("error");
    expect(f.counts().modelCalls).toBe(0);
  });
});
