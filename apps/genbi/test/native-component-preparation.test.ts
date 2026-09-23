import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { prepareNativeComponentHost, type NativeComponentBindings } from "../server/native-component-preparation.js";

const document = readFileSync(new URL("../profiles/genbi-default/ir.golden.json", import.meta.url), "utf8");
function setup(vendor: "claude" | "codex" = "codex") {
  const ir = JSON.parse(document);
  const identity = { session_id: "synthetic", vendor, auth_identity: "approved", runtime_generation: "1", binding: { project_identity: "project", generation: "1", revision: "revision" } };
  const bindings: NativeComponentBindings = {
    identity, contexts: Object.fromEntries(ir.components.map((node: { id: string; context_binding: Record<string, unknown> }) => [node.id, { binding: node.context_binding, snapshot: { context_version: 2, parseable: true } }])),
    verifierBinary: "unused", currentIdentity: vi.fn(() => identity), assertCurrent: vi.fn(),
    prepare: vi.fn(async () => { throw Error("not invoked"); }), step: vi.fn(async () => { throw Error("not invoked"); }), normalize: vi.fn(async () => { throw Error("not invoked"); }),
  };
  const scope = { binding: identity.binding, entry: vendor === "codex" ? { kind: "agent", verb: "generate_dashboard", prompt: "synthetic" } : { kind: "scope", prompt: "synthetic" } };
  return { ir, bindings, scope };
}
describe("host-derived native component preparation", () => {
  it.each(["claude", "codex"] as const)("derives the exact %s composed closure without opening access", (vendor) => {
    const { bindings, scope } = setup(vendor); const result = prepareNativeComponentHost(document, scope, bindings)!;
    expect(Object.keys(result.hostRoots)).toEqual(["generate_dashboard"]);
    expect(Object.keys(result.contexts)).toEqual(["answer_query", "generate_dashboard"]);
    expect(bindings.prepare).not.toHaveBeenCalled(); expect(bindings.step).not.toHaveBeenCalled();
  });
  it("does not expand an answer-only pin to the dashboard", () => {
    const { bindings, scope } = setup(); scope.entry = { kind: "agent", verb: "answer_query", prompt: "synthetic" };
    expect(prepareNativeComponentHost(document, scope, bindings)).toBeUndefined();
  });
  it("rejects a Codex scope union", () => {
    const { bindings, scope } = setup(); scope.entry = { kind: "scope", prompt: "synthetic" };
    expect(() => prepareNativeComponentHost(document, scope, bindings)).toThrow("single pinned entry");
  });
  it.each(["cycle", "unknown-child", "context", "guard", "capability", "binding", "entry"])("fails closed on %s", (kind) => {
    const { ir, bindings, scope } = setup(); const child = ir.components.find((node: { id: string }) => node.id === "answer_query");
    if (kind === "cycle") child.llm_calls[0].component_calls = [{ alias: "again", component: "generate_dashboard" }];
    if (kind === "unknown-child") child.llm_calls[0].component_calls = [{ alias: "missing", component: "missing" }];
    if (kind === "context") Object.assign(bindings, { contexts: {} });
    if (kind === "guard") child.guardrails.push({ name: "unknown", locked: true });
    if (kind === "capability") child.required_capabilities.push("unbound:write");
    if (kind === "binding") scope.binding = { ...scope.binding, generation: "changed" };
    if (kind === "entry") scope.entry = { kind: "agent", verb: "missing", prompt: "synthetic" };
    expect(() => prepareNativeComponentHost(JSON.stringify(ir), scope, bindings)).toThrow(); expect(bindings.prepare).not.toHaveBeenCalled();
  });
  it("seals all returned authority and preserves the captured context against external mutation", () => {
    const { bindings, scope } = setup(); const prepared = prepareNativeComponentHost(document, scope, bindings)!;
    const snapshot = prepared.contexts.answer_query as Record<string, unknown>;
    expect(() => { snapshot.parseable = false; }).toThrow();
    expect(() => { prepared.identity.binding.revision = "forged"; }).toThrow();
    expect(() => { (prepared.hostRoots as Record<string, unknown>).forged = {}; }).toThrow();
    (bindings.contexts.answer_query!.snapshot as Record<string, unknown>).parseable = false;
    expect(snapshot.parseable).toBe(true);
    expect(prepared.contexts.answer_query).not.toBe(bindings.contexts.answer_query!.snapshot);
    expect(() => prepared.assertCurrent()).not.toThrow();
  });
  it("revokes the prepared receipt when the runtime identity changes", () => {
    const { bindings, scope } = setup(); const prepared = prepareNativeComponentHost(document, scope, bindings)!;
    vi.mocked(bindings.currentIdentity).mockReturnValue({ ...bindings.identity, runtime_generation: "changed" });
    expect(() => prepared.assertCurrent()).toThrow("expired");
  });
});
