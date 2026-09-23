import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { createComponentBroker, type ComponentBrokerOptions } from "../harness/components/broker.js";
import { normalizeComponentEvidence } from "../harness/components/normalize.js";
import { VERCEL_HOST_CONTRACT, planDigest, readExecutionPlan } from "../harness/components/plan.js";
import { ComponentRunner, type ComponentEvent } from "../harness/components/runner.js";
import { prepareNativeComponentHost } from "../server/native-component-preparation.js";
import { NativeComponentAdmission, nativeComponentHostContract, readNativeComponentPlans } from "../server/native-components.js";

/** Real profile/compiler/broker/normalizer/admission; only model and database responses are synthetic. */
describe("default dashboard cross-mode contract", () => {
  it("preserves repeated answers, caller isolation, results, persistence and events in all three modes", async () => {
    const binary = await resolveWarbleBinary(process.env.WARBLE_TEST_CLI);
    const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "genbi-default-parity-")));
    const irPath = path.resolve("profiles/genbi-default/ir.golden.json");
    const irDocument = readFileSync(irPath, "utf8");
    const ir = JSON.parse(irDocument);
    const snapshot = JSON.parse(readFileSync(path.resolve("profiles/genbi-default/context/context.json"), "utf8"));
    const contexts = Object.fromEntries(ir.components.map((node: { id: string; context_binding: Record<string, unknown> }) => [node.id, { binding: node.context_binding, snapshot }]));
    const summaries: unknown[] = [];
    try {
      for (const mode of ["vercel", "claude", "codex"] as const) {
        const out = path.join(temp, mode); mkdirSync(out);
        const events: ComponentEvent[] = [];
        const children: unknown[] = [];
        const accesses: string[] = [];
        let queries = 0, closed = 0, persisted = 0;
        const operations: Pick<ComponentBrokerOptions, "prepare" | "step" | "normalize" | "persistRoot" | "onEvent"> = {
          async prepare(component) {
            accesses.push(component.id);
            return {
              async query(input) {
                expect(component.id).toBe("answer_query"); expect(input.limit).toBe(1000); queries++;
                return { columns: ["n"], rows: [{ n: 7 }], definition: { sql: input.sql, source_tables: [], filters: [] } };
              },
              async inspect() { expect(component.id).toBe("answer_query"); return snapshot; },
              async close() { closed++; },
            };
          },
          async step(run, component) {
            if (component.id === "generate_dashboard") {
              const expected = run.terminal ? ["answer"] : [];
              expect(Object.keys(run.tools)).toEqual(expected);
              // A caller cannot discover or invoke any query capability, even via the
              // native producer's different host tool names.
              expect(Object.values(run.toolSchemas).every((schema) => !JSON.stringify(schema).includes('"sql"'))).toBe(true);
              if (!run.terminal) return { value: "Two panels" };
              for (const request of ["first panel", "second panel"]) children.push(await run.tools.answer!({ request }));
              return { value: JSON.stringify({ blocks: [{ type: "table", columns: ["n"], rows: [[7]] }], summary: "Two verified panels" }) };
            }
            expect(component.id).toBe("answer_query");
            if (!Object.hasOwn(run.consumes, "query_intent")) {
              expect(run.consumes).toEqual({});
              return { value: "Count the synthetic rows" };
            }
            const tool = Object.entries(run.toolSchemas).find(([, schema]) => JSON.stringify(schema).includes('"sql"'))?.[0];
            expect(tool).toBeDefined(); await run.tools[tool!]!({ sql: "SELECT 7 AS n" });
            return { value: { verified: true, columns: ["n"], rows: [[7]] } };
          },
          async normalize(component, evidence, _signal, context) { return normalizeComponentEvidence(component, evidence, context); },
          async persistRoot(result) { expect(result.output.kind).toBe("render"); expect(closed).toBe(2); persisted++; },
          onEvent(event) { events.push(event); },
        };
        let result: unknown;
        if (mode === "vercel") {
          const hostPath = path.join(temp, "vercel-host.json"); writeFileSync(hostPath, JSON.stringify(VERCEL_HOST_CONTRACT));
          execFileSync(binary, ["dispatch", irPath, "--target", "vercel", "--provider", path.resolve("providers/wren.provider.yaml"), "--host-contract", hostPath, "--out", out], { stdio: "pipe", timeout: 30_000 });
          const text = readFileSync(path.join(out, "bundle.json"), "utf8");
          const plan = readExecutionPlan(text, { digest: JSON.parse(text).bundle_sha256, inputIrDigest: planDigest(ir), contextBinding: ir.context_binding,
            declarations: Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node])) });
          const identity = { session: "synthetic", vendor: mode, account: "synthetic", generation: "1", project: "synthetic", bindingRevision: "1", contextDigest: planDigest(contexts), planDigest: plan.identity };
          result = await new ComponentRunner(plan, createComponentBroker({ ...operations, plan, contexts, identity, currentIdentity: () => identity, verifierBinary: binary })).run("generate_dashboard", { request: "overview" });
        } else {
          const identity = { session_id: "synthetic", vendor: mode, auth_identity: "synthetic", runtime_generation: "1", binding: { project_identity: "synthetic", generation: "1", revision: "1" } };
          const scopeDocument = JSON.stringify({ version: "3", kind: "bound_project", scope_id: "synthetic", cwd: out, binding: identity.binding,
            entry: mode === "claude" ? { kind: "scope", prompt: "overview" } : { kind: "agent", verb: "generate_dashboard", prompt: "overview" } });
          const prepared = prepareNativeComponentHost(irDocument, JSON.parse(scopeDocument), { ...operations, identity, contexts, verifierBinary: binary, currentIdentity: () => identity, assertCurrent() {} })!;
          const scopePath = path.join(out, "scope.json"), hostPath = path.join(out, "host.json"), mcpPath = path.join(out, "mcp.json");
          writeFileSync(scopePath, scopeDocument); writeFileSync(hostPath, JSON.stringify(nativeComponentHostContract(prepared)));
          writeFileSync(mcpPath, JSON.stringify({ version: "1", url: "http://127.0.0.1:0/api/native-sessions/mcp", credential: "synthetic" }));
          execFileSync(binary, ["dispatch", irPath, "--target", mode === "claude" ? "claude-code:interactive" : "codex:interactive", "--purpose", "analysis", "--native-scope", scopePath, "--native-host", hostPath, "--native-mcp", mcpPath, "--out", out], { stdio: "pipe", timeout: 30_000 });
          const launch = JSON.parse(readFileSync(path.join(out, ".warble/interactive-launch.json"), "utf8"));
          const plans = readNativeComponentPlans(readFileSync(path.join(out, ".warble/component-plans.json"), "utf8"), launch.component_host,
            { identity, contexts: prepared.contexts, hostRoots: prepared.hostRoots, irDocument, scopeDocument });
          const admission = new NativeComponentAdmission(plans, () => identity, prepared.host);
          try { result = await admission.call(plans.tools.generate_dashboard!, { request: "overview" }, 1); }
          finally { await admission.close(); }
        }
        expect(result, JSON.stringify({ mode, result, accesses, closed })).toMatchObject({ status: "ok", output: { kind: "render", blocks: [{ type: "table", rows: [[7]] }] }, provenance: { verified: true } });
        expect(children).toHaveLength(2); expect(children[0]).toEqual(children[1]);
        expect(children[0]).toMatchObject({ status: "ok", output: { kind: "value", value: { verified: true, rows: [{ n: 7 }] } } });
        expect(accesses).toEqual(["generate_dashboard", "answer_query"]);
        expect(queries).toBe(2); expect(persisted).toBe(1); expect(closed).toBe(2);
        const childStarts = events.filter((event) => event.kind === "call.start" && event.component === "answer_query");
        expect(childStarts).toHaveLength(2); expect(new Set(childStarts.map((event) => event.invocation)).size).toBe(2);
        expect(childStarts.every((event) => event.parent !== null)).toBe(true);
        summaries.push({ result, children, accesses, queries, persisted, closed, events: events.map(({ kind, component, step, depth, status }) => ({ kind, component, step, depth, status })) });
      }
      expect(summaries[1]).toEqual(summaries[0]); expect(summaries[2]).toEqual(summaries[0]);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
