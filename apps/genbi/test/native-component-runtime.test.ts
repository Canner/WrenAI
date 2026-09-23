import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeComponentRuntimeBindings, type NativeComponentRuntimeOptions } from "../server/native-component-runtime.js";
import { runClaudeComponentStep } from "../server/runtime-host/claude-component-step.js";
import { runCodexComponentStep } from "../server/runtime-host/codex-component-step.js";
import { hashDirectory } from "../harness/compile/fingerprint.js";
import { openWrenComponentAccess } from "../harness/components/wren-access.js";
import type { StepRun, ComponentPlan } from "../harness/components/runner.js";
vi.mock("../server/runtime-host/claude-component-step.js", () => ({ runClaudeComponentStep: vi.fn(async () => ({ value: "synthetic" })) }));
vi.mock("../server/runtime-host/codex-component-step.js", () => ({ runCodexComponentStep: vi.fn(async () => ({ value: "synthetic" })) }));
vi.mock("../harness/components/wren-access.js", () => ({ openWrenComponentAccess: vi.fn(async () => { throw Error("Wren must not start in these tests"); }) }));
vi.mock("../harness/compile/fingerprint.js", () => ({ hashDirectory: vi.fn(async () => "fingerprint") }));
const component: ComponentPlan = { id: "root", declaration: {}, steps: [{ name: "layout", tier: "strong", prompt: "", produces: "result", consumes: [], tools: [], calls: [] }] };
const run = (signal = new AbortController().signal): StepRun => ({ tier: "strong", request: "synthetic", input: {}, prompt: "", consumes: {}, tools: {}, toolSchemas: {}, toolDescriptions: {}, signal });
function setup(vendor: "claude" | "codex" = "claude") {
  const identity = { session_id: "synthetic", vendor, auth_identity: "approved", runtime_generation: "1", binding: { project_identity: "project", generation: "1", revision: "revision" } };
  const close = vi.fn(async () => {});
  const resource = vendor === "claude" ? { cwd: "/synthetic/work", executable: "/synthetic/claude", model: "approved-model", account: { email: "approved@example.test", tokenSource: "oauth", subscriptionType: "max" }, environment: {}, query: vi.fn(), spawn: vi.fn(), assertCurrent: vi.fn(), close }
    : { transport: { write: vi.fn(), listen: vi.fn(), close }, policy: { model: "approved-model", accountEmail: "approved@example.test", assertCurrent: vi.fn() } };
  const open = vi.fn(async () => resource);
  const options = { identity, contexts: {}, verifierBinary: "unused", currentIdentity: vi.fn(() => identity), assertCurrent: vi.fn(),
    vendor: { vendor, authIdentity: "approved", accountEmail: "approved@example.test", generation: "1", models: { strong: "approved-model" }, assertCurrent: vi.fn(), open },
    wren: { executable: "/synthetic/wren", project: "/synthetic/project", fingerprint: "fingerprint", identity: { environment: { SECRET: "must-not-reach-vendor" }, digest: "digest", assertCurrent: vi.fn(async () => {}) } },
  } as unknown as NativeComponentRuntimeOptions;
  return { options, open, resource, close };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hashDirectory).mockResolvedValue("fingerprint"); });
describe("native component runtime binding", () => {
  it.each(["claude", "codex"] as const)("keeps %s caller access empty and opens only the captured model", async (vendor) => {
    const { options, open, close } = setup(vendor); const bindings = createNativeComponentRuntimeBindings(options);
    expect(open).not.toHaveBeenCalled();
    const access = await bindings.prepare(component, {} as never, run().signal);
    await expect(access.query({ sql: "select 1", limit: 1 }, run().signal)).rejects.toThrow("No component query grant");
    const step = run(); await expect(bindings.step(step, component, {} as never)).resolves.toEqual({ value: "synthetic" });
    expect(open).toHaveBeenCalledExactlyOnceWith("approved-model", step.signal);
    expect(close).toHaveBeenCalledTimes(1); expect(openWrenComponentAccess).not.toHaveBeenCalled();
    expect(vendor === "claude" ? runClaudeComponentStep : runCodexComponentStep).toHaveBeenCalledTimes(1);
    expect(vendor === "claude" ? runCodexComponentStep : runClaudeComponentStep).not.toHaveBeenCalled();
  });
  it.each(["model", "account", "generation", "binding", "wren", "project"])("refuses changed %s before opening a vendor", async (field) => {
    const { options, open } = setup(); const bindings = createNativeComponentRuntimeBindings(options);
    if (field === "model") Object.assign(options.vendor.models, { strong: "forged" });
    if (field === "account") Object.assign(options.vendor, { accountEmail: "forged@example.test" });
    if (field === "generation") Object.assign(options.vendor, { generation: "2" });
    if (field === "binding") vi.mocked(options.currentIdentity).mockReturnValue({ ...options.identity, runtime_generation: "2" });
    if (field === "project") vi.mocked(hashDirectory).mockResolvedValue("changed");
    if (field === "wren") vi.mocked(options.wren.identity.assertCurrent).mockRejectedValue(Error("rotated"));
    await expect(bindings.step(run(), component, {} as never)).rejects.toThrow(); expect(open).not.toHaveBeenCalled();
  });
  it.each(["claude", "codex"] as const)("closes mismatched %s resources before any model input", async (vendor) => {
    const { options, resource, close } = setup(vendor); const bindings = createNativeComponentRuntimeBindings(options);
    if ("policy" in resource) resource.policy!.accountEmail = "wrong@example.test";
    else resource.account!.email = "wrong@example.test";
    await expect(bindings.step(run(), component, {} as never)).rejects.toThrow("mismatch");
    expect(close).toHaveBeenCalledTimes(1); expect(runClaudeComponentStep).not.toHaveBeenCalled(); expect(runCodexComponentStep).not.toHaveBeenCalled();
  });
  it("closes a resource returned after cancellation without running it", async () => {
    const { options, open, resource, close } = setup(); const bindings = createNativeComponentRuntimeBindings(options);
    const controller = new AbortController(); open.mockImplementation(async () => { controller.abort(); return resource; });
    await expect(bindings.step(run(controller.signal), component, {} as never)).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1); expect(runClaudeComponentStep).not.toHaveBeenCalled();
  });
  it("rejects a reused vendor runtime", async () => {
    const { options } = setup(); const bindings = createNativeComponentRuntimeBindings(options);
    await bindings.step(run(), component, {} as never);
    await expect(bindings.step(run(), component, {} as never)).rejects.toThrow("fresh runtime");
    expect(runClaudeComponentStep).toHaveBeenCalledTimes(1);
  });
  it("does not turn cleanup failure into a successful component result", async () => {
    const { options, close } = setup(); const bindings = createNativeComponentRuntimeBindings(options);
    close.mockRejectedValue(Error("cleanup failed"));
    await expect(bindings.step(run(), component, {} as never)).rejects.toThrow("cleanup failed");
  });
});
