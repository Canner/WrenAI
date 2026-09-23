import { describe, expect, it } from "vitest";
import { checkSemanticGuards, type QuerySemantics } from "../harness/components/semantic-guards.js";
import { normalizeComponentEvidence } from "../harness/components/normalize.js";
import type { ComponentPlan } from "../harness/components/runner.js";
const member = (name: string) => ({ name, owner: "sales" });
const context = { context_version: 2, parseable: true, metrics: [{ ...member("revenue"), declared: true, additivity: "additive" }],
  dimensions: [{ ...member("day"), is_temporal: true }, ...["region", "product", "channel", "customer"].map((name) => ({ ...member(name), is_temporal: false }))] };
const guards = [{ name: "additivity_guard", locked: true }, { name: "drill_depth_limit", threshold: 3 }];
const proof = (dims: string[]): QuerySemantics => ({ version: "1", sql: "SELECT revenue, region FROM sales", metrics: [member("revenue")], dimensions: dims.map(member), temporal_dimensions: [member("day")] });
describe("observed semantic guards", () => {
  it("counts distinct declared non-temporal dimensions across the whole execution", () => {
    expect(checkSemanticGuards(guards, [proof(["region", "product"]), proof(["region", "channel"])], context)).toBe(true);
    expect(checkSemanticGuards(guards, [proof(["region", "product"]), proof(["channel", "customer"])], context)).toBe(false);
  });
  it.each(["non_additive", "semi_additive", null])("refuses %s even if a narrative could claim a caveat", (additivity) => {
    expect(checkSemanticGuards(guards, [proof(["region"])], { ...context, metrics: [{ ...context.metrics[0], additivity }] })).toBe(false);
  });
  it("refuses absent, undeclared, ambiguous and forged members", () => {
    expect(checkSemanticGuards(guards, [], context)).toBe(false);
    expect(checkSemanticGuards(guards, [proof(["invented"])], context)).toBe(false);
    expect(checkSemanticGuards(guards, [proof(["day"])], context)).toBe(false);
    expect(checkSemanticGuards(guards, [proof([])], { ...context, metrics: context.metrics.map((m) => ({ ...m, declared: false })) })).toBe(false);
    expect(checkSemanticGuards(guards, [proof([])], { ...context, metrics: [...context.metrics, ...context.metrics] })).toBe(false);
    expect(checkSemanticGuards(guards, [{ ...proof([]), temporal_dimensions: [] }], context)).toBe(false);
  });
  it("never accepts model-created semantic proof or mismatched observed SQL", () => {
    const component: ComponentPlan = { id: "analysis", declaration: { guardrails: guards, required_capabilities: ["sql_execution:read_only"], effect: { render_blocks: [] } },
      steps: [{ name: "query", tier: "strong", produces: "result", prompt: "", consumes: [], calls: [], tools: [{ name: "query", source: "native" }] }] };
    const output = { columns: ["revenue"], rows: [{ revenue: 1 }] };
    const evidence = { steps: { result: { verified: true, semantics: proof(["region"]) } }, children: [],
      tools: [{ step: "query", tool: "query", input: { sql: proof([]).sql }, output }] };
    expect(normalizeComponentEvidence(component, evidence, context).status).toBe("refused");
    const observed = { ...evidence, tools: [{ ...evidence.tools[0]!, output: { ...output, semantics: proof(["region"]) } }] };
    expect(normalizeComponentEvidence(component, observed, context).status).toBe("ok");
    observed.tools[0]!.output.semantics.sql = "SELECT forged";
    expect(normalizeComponentEvidence(component, observed, context).status).toBe("refused");
  });
});
