import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { planDigest } from "../harness/components/plan.js";
import type { RunnerHost } from "../harness/components/runner.js";
import { prepareNativeComponentHost } from "../server/native-component-preparation.js";
import { NativeComponentAdmission, nativeComponentHostContract, readNativeComponentPlans, type NativeComponentReceipt } from "../server/native-components.js";

/** Emission and admission only: neither a vendor process nor a model is started. */
async function fixture(vendor: "claude" | "codex", test: (text: string, launch: unknown, receipt: NativeComponentReceipt) => Promise<void>) {
  const binary = await resolveWarbleBinary(process.env.WARBLE_TEST_CLI);
  const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "genbi-native-components-")));
  try {
    const out = path.join(temp, "out"); mkdirSync(out);
    const irPath = path.resolve("profiles/genbi-default/ir.golden.json");
    const irDocument = readFileSync(irPath, "utf8");
    const ir = JSON.parse(irDocument);
    const components = ir.components.filter((node: { id: string }) => ["generate_dashboard", "answer_query"].includes(node.id));
    const identity = { session_id: "synthetic-session", vendor, auth_identity: "approved-synthetic-account", runtime_generation: "7",
      binding: { project_identity: "synthetic-project", generation: "2", revision: "revision" } };
    const contexts = Object.fromEntries(components.map((node: { id: string }) => [node.id, { context_version: 2, parseable: true }]));
    const scopeDocument = JSON.stringify({ version: "3", kind: "bound_project", scope_id: "scope", cwd: out,
      entry: vendor === "claude" ? { kind: "scope", prompt: "Offline synthetic request" } : { kind: "agent", verb: "generate_dashboard", prompt: "Offline synthetic request" }, binding: identity.binding });
    const prepared = prepareNativeComponentHost(irDocument, JSON.parse(scopeDocument), {
      identity, contexts: Object.fromEntries(components.map((node: { id: string; context_binding: Record<string, unknown> }) => [node.id, { binding: node.context_binding, snapshot: contexts[node.id] }])),
      verifierBinary: binary, currentIdentity: () => identity, assertCurrent() {},
      async prepare() { throw new Error("not executed"); }, async step() { throw new Error("not executed"); }, async normalize() { throw new Error("not executed"); },
    });
    expect(prepared).toBeDefined();
    const hostRoots = prepared!.hostRoots;
    const host = nativeComponentHostContract(prepared!);
    const scopePath = path.join(temp, "scope.json"); writeFileSync(scopePath, scopeDocument);
    const hostPath = path.join(temp, "host.json"); writeFileSync(hostPath, JSON.stringify(host));
    const mcpPath = path.join(temp, "mcp.json"); writeFileSync(mcpPath, JSON.stringify({ version: "1", url: "http://127.0.0.1:0/api/native-sessions/mcp", credential: "synthetic-only" }));
    execFileSync(binary, ["dispatch", irPath, "--target", vendor === "claude" ? "claude-code:interactive" : "codex:interactive", "--purpose", "analysis",
      "--native-scope", scopePath, "--native-mcp", mcpPath, "--native-host", hostPath, "--out", out], { stdio: "pipe", timeout: 30_000 });
    const launch = JSON.parse(readFileSync(path.join(out, ".warble/interactive-launch.json"), "utf8"));
    expect(launch.version).toBe("5");
    await test(readFileSync(path.join(out, ".warble/component-plans.json"), "utf8"), launch.component_host, { identity, contexts, hostRoots, irDocument, scopeDocument });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

describe("native fixed-root admission", () => {
  it.each(["claude", "codex"] as const)("correlates the actual %s producer, isolates children and rejects replay", async (vendor) => fixture(vendor, async (text, launch, receipt) => {
    const plans = readNativeComponentPlans(text, launch, receipt);
    let current: typeof receipt.identity | undefined = receipt.identity;
    let children = 0;
    let persisted = 0;
    const host: RunnerHost = {
      async prepare(node) { return { isCurrent: () => current !== undefined, async close() {},
        tools: [...new Map(node.steps.flatMap((step) => step.tools).map((tool) => [tool.name, tool])).values()].map((tool) => ({ ...tool, async execute() { return { rows: [{ n: 1 }] }; } })),
        async normalize() { return { status: "ok", output: { kind: "value", value: { rows: [{ n: 1 }] } }, provenance: { verified: true } }; },
      }; },
      async runStep(step) {
        if (step.tools.answer) {
          expect(Object.keys(step.tools)).toEqual(["answer"]);
          await step.tools.answer({ request: "first" }); await step.tools.answer({ request: "second" });
        } else if (step.request !== "overview") { children++; expect(step.tools.query_read_only).toBeDefined(); }
        return { value: "synthetic" };
      }, async persistRoot() { persisted++; },
    };
    const admission = new NativeComponentAdmission(plans, () => current, async () => host);
    const tool = admission.list()[0]!.name;
    expect(admission.list()).toHaveLength(1);
    await expect(admission.call(tool, { request: "overview", step: "child" }, "forged")).rejects.toThrow();
    expect(await admission.call(tool, { request: "overview" }, 1)).toMatchObject({ status: "ok" });
    expect(children).toBeGreaterThan(1); expect(persisted).toBe(1);
    await expect(admission.call(tool, { request: "again" }, 1)).rejects.toThrow("replayed");
    current = undefined;
    expect(() => admission.list()).toThrow("expired");
    await admission.close();
    for (const field of ["session_id", "vendor", "auth_identity", "runtime_generation", "binding"] as const) {
      expect(() => readNativeComponentPlans(text, launch, { ...receipt, identity: { ...receipt.identity, [field]: "forged" } as never })).toThrow();
    }
    expect(() => readNativeComponentPlans(text, launch, { ...receipt, irDocument: receipt.irDocument + " " })).toThrow();
    expect(() => readNativeComponentPlans(text, launch, { ...receipt, scopeDocument: JSON.stringify({ ...JSON.parse(receipt.scopeDocument), scope_id: "forged" }) })).toThrow();
    expect(() => readNativeComponentPlans(text, launch, { ...receipt, contexts: {} })).toThrow();
    const altered = JSON.parse(text); altered.plans.generate_dashboard.entry = "answer_query";
    const { host_plan_sha256: _, ...payload } = altered;
    altered.host_plan_sha256 = planDigest(payload);
    expect(() => readNativeComponentPlans(JSON.stringify(altered), launch, receipt)).toThrow();
  }));

  it("cancels an active subtree on detach and discards late completion", async () => fixture("claude", async (text, launch, receipt) => {
    const plans = readNativeComponentPlans(text, launch, receipt);
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let persisted = 0;
    const admission = new NativeComponentAdmission(plans, () => receipt.identity, async () => ({
      async prepare(node) { return { isCurrent: () => true, async close() {},
        tools: [...new Map(node.steps.flatMap((step) => step.tools).map((tool) => [tool.name, tool])).values()].map((tool) => ({ ...tool, async execute() {} })),
        async normalize() { return { status: "ok", output: { kind: "value", value: "late" } }; } }; },
      async runStep() { start(); await pending; return { value: "late" }; }, async persistRoot() { persisted++; },
    }));
    const call = admission.call(admission.list()[0]!.name, { request: "overview" }, 1);
    await started; admission.cancelActive();
    await expect(call).rejects.toThrow();
    finish(); await admission.close(); expect(persisted).toBe(0);
  }));
  it("retains required cleanup failures after an invocation settles", async () => fixture("claude", async (text, launch, receipt) => {
    const admission = new NativeComponentAdmission(readNativeComponentPlans(text, launch, receipt), () => receipt.identity, async () => ({
      async prepare(node) { return { isCurrent: () => true,
        tools: [...new Map(node.steps.flatMap((step) => step.tools).map((tool) => [tool.name, tool])).values()].map((tool) => ({ ...tool, async execute() {} })),
        async normalize() { return { status: "ok", output: { kind: "value", value: "result" } }; },
        async close() { throw new Error("synthetic cleanup failure"); },
      }; },
      async runStep() { return { value: "result" }; },
    }));
    await expect(admission.call(admission.list()[0]!.name, { request: "go" }, "cleanup")).resolves.toMatchObject({ status: "error" });
    await expect(admission.close()).rejects.toThrow("cleanup failed");
    await expect(admission.close()).rejects.toThrow("cleanup failed");
  }));

});
