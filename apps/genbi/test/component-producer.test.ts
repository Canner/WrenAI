import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { HOST_FEATURES, VERCEL_HOST_CONTRACT, planDigest, readExecutionPlan } from "../harness/components/plan.js";
import { ComponentRunner } from "../harness/components/runner.js";

describe("real composed producer contracts", () => {
  it("preserves the default dashboard call edge in both host formats", async () => {
    // Explicit candidate override supports contract development; installed package is the default.
    const binary = await resolveWarbleBinary(process.env.WARBLE_TEST_CLI);
    const temp = mkdtempSync(path.join(os.tmpdir(), "genbi-component-contract-"));
    try {
      const irPath = path.resolve("profiles/genbi-default/ir.golden.json");
      const bytes = readFileSync(irPath, "utf8");
      const ir = JSON.parse(bytes);
      const vercelHost = path.join(temp, "vercel-host.json");
      writeFileSync(vercelHost, JSON.stringify(VERCEL_HOST_CONTRACT));
      execFileSync(binary, ["dispatch", irPath, "--target", "vercel", "--provider", path.resolve("providers/wren.provider.yaml"),
        "--host-contract", vercelHost, "--out", path.join(temp, "vercel")], { timeout: 30_000, stdio: "pipe" });
      const bundleText = readFileSync(path.join(temp, "vercel/bundle.json"), "utf8");
      const bundle = JSON.parse(bundleText);
      const vercelPlan = readExecutionPlan(bundleText, { digest: bundle.bundle_sha256, declarations: Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node])), contextBinding: ir.context_binding, inputIrDigest: planDigest(ir) });

      const directHost = path.join(temp, "direct-host.json");
      const nodes = Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node]));
      const closure = new Set<string>();
      const visit = (id: string): void => {
        if (closure.has(id)) return;
        closure.add(id);
        for (const step of nodes[id].llm_calls) for (const edge of step.component_calls ?? []) visit(edge.component);
      };
      visit("generate_dashboard");
      writeFileSync(directHost, JSON.stringify({ version: "2", protocol: "warble-component-host/1", execution: HOST_FEATURES,
        components: Object.fromEntries([...closure].map((id) => [id, {
          version: "2", tiers: [...new Set(nodes[id].llm_calls.map((step: { tier: string }) => step.tier))],
          capabilities: { "sql_execution:read_only": { tool: "query_read_only" }, semantic_introspection: { tool: "inspect_context" },
            artifact_write: {}, render_contract: {}, component_invocation: {} },
          guardrails: nodes[id].guardrails,
          execution: ["ordered_steps", "isolated_step_tools", "artifact_provenance", "per_step_tiers", "bounded_repair", "render_contract"],
        }])) }));
      const directPath = path.join(temp, "direct.json");
      execFileSync(binary, ["produce-session", irPath, "--component", "generate_dashboard", "--host-contract", directHost, "--out", directPath], { timeout: 30_000, stdio: "pipe" });
      const directText = readFileSync(directPath, "utf8");
      const direct = JSON.parse(directText);
      const directPlan = readExecutionPlan(directText, { digest: direct.plan_sha256, declarations: Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node])), contextBinding: ir.context_binding, directHostDocument: readFileSync(directHost, "utf8"), inputIrDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });

      for (const plan of [vercelPlan, directPlan]) {
        const root = plan.components.generate_dashboard!;
        expect(root.steps.flatMap((step) => step.calls)).toEqual([{ alias: "answer", component: "answer_query" }]);
        expect(root.steps.flatMap((step) => step.tools)).toEqual([]);
        expect(plan.components.answer_query!.steps.some((step) => step.tools.length > 0)).toBe(true);
        let childRuns = 0;
        const runner = new ComponentRunner(plan, {
          async prepare(component) {
            const grants = [...new Map(component.steps.flatMap((step) => step.tools).map((tool) => [tool.name, tool])).values()];
            return { tools: grants.map((tool) => ({ ...tool, async execute() { return { columns: ["n"], rows: [[1]] }; } })),
              isCurrent: () => true, async close() {},
              async normalize(evidence) { return { status: "ok", output: { kind: "value", value: evidence.steps } }; } };
          },
          async runStep(step) {
            if (step.tools.answer) {
              await step.tools.answer({ request: "first question" });
              await step.tools.answer({ request: "second question" });
            } else if (step.request !== "overview") childRuns++;
            return { value: { complete: true } };
          },
        });
        expect((await runner.run("generate_dashboard", { request: "overview" })).status).toBe("ok");
        expect(childRuns).toBeGreaterThan(1);
      }
      const changed = JSON.parse(bundleText);
      changed.components.generate_dashboard.steps[0].tools = [{ name: "query", source: "native" }];
      expect(() => readExecutionPlan(JSON.stringify(changed), { digest: bundle.bundle_sha256, declarations: Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node])), contextBinding: ir.context_binding, inputIrDigest: planDigest(ir) })).toThrow();
      expect(() => readExecutionPlan(bundleText, { digest: bundle.bundle_sha256, declarations: Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node])), contextBinding: ir.context_binding, inputIrDigest: `sha256:${"0".repeat(64)}` })).toThrow();
      expect(() => readExecutionPlan(JSON.stringify({ ...bundle, agents: [] }), { digest: bundle.bundle_sha256, declarations: Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node])), contextBinding: ir.context_binding, inputIrDigest: planDigest(ir) })).toThrow();
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
