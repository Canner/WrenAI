import { readFileSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePreparedContext } from "../harness/compile/context-loader.js";
import { hashDirectory } from "../harness/compile/fingerprint.js";
import { captureWrenAccessIdentity, openWrenComponentAccess } from "../harness/components/wren-access.js";
import { prepareCapturedNativeComponentHost, type NativeComponentContextOptions } from "../server/native-component-context.js";
vi.mock("../harness/compile/context-loader.js", () => ({ generatePreparedContext: vi.fn() }));
vi.mock("../harness/compile/fingerprint.js", () => ({ hashDirectory: vi.fn() }));
vi.mock("../harness/components/wren-access.js", () => ({ captureWrenAccessIdentity: vi.fn(), openWrenComponentAccess: vi.fn() }));
const document = JSON.parse(readFileSync(new URL("../profiles/genbi-default/ir.golden.json", import.meta.url), "utf8"));
const project = "/synthetic/project";
function setup(vendor: "claude" | "codex" = "codex") {
  const ir = structuredClone(document);
  for (const node of ir.components) node.context_binding.project = project;
  const controller = new AbortController();
  const identity = { session_id: "synthetic", vendor, auth_identity: "approved", runtime_generation: "1", binding: { project_identity: "project", generation: "1", revision: "revision" } };
  const options: NativeComponentContextOptions = {
    identity, verifierBinary: "unused", currentIdentity: vi.fn(() => identity), assertCurrent: vi.fn(),
    vendor: { vendor: "claude", authIdentity: "approved", accountEmail: "approved@example.test", generation: "1", models: { strong: "approved" }, assertCurrent: vi.fn(), open: vi.fn(async () => { throw Error("must not open"); }) },
    contextLoaderBinary: "/synthetic/loader", wrenBinary: "/synthetic/wren", project, signal: controller.signal,
  };
  if (vendor === "codex") Object.assign(options.vendor, { vendor });
  const scope = { binding: identity.binding, entry: vendor === "codex" ? { kind: "agent", verb: "generate_dashboard", prompt: "synthetic" } : { kind: "scope", prompt: "synthetic" } };
  return { ir, scope, options, controller };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hashDirectory).mockResolvedValue("fingerprint");
  vi.mocked(captureWrenAccessIdentity).mockResolvedValue({ digest: "digest", environment: {}, assertCurrent: vi.fn(async () => {}) });
  vi.mocked(generatePreparedContext).mockImplementation(async (_bin, _project, output) => { await writeFile(output, JSON.stringify({ context_version: 2, parseable: true })); });
});
async function expectScratchRemoved() {
  const output = vi.mocked(generatePreparedContext).mock.calls[0]![2];
  await expect(access(output)).rejects.toThrow();
}
describe("native captured context preparation", () => {
  it.each(["claude", "codex"] as const)("captures %s closure and removes scratch without opening model or query processes", async (vendor) => {
    const { ir, scope, options } = setup(vendor);
    const result = (await prepareCapturedNativeComponentHost(JSON.stringify(ir), scope, options))!;
    expect(Object.keys(result.contexts)).toEqual(["answer_query", "generate_dashboard"]);
    expect(result.contexts.answer_query).toEqual({ context_version: 2, parseable: true });
    expect(Object.isFrozen(result.contexts.answer_query)).toBe(true);
    expect(generatePreparedContext).toHaveBeenCalledExactlyOnceWith(options.contextLoaderBinary, project, expect.any(String), options.signal);
    expect(options.vendor.open).not.toHaveBeenCalled(); expect(openWrenComponentAccess).not.toHaveBeenCalled();
    await expectScratchRemoved();
  });
  it.each(["old-context", "unparseable", "other-project", "project-change", "identity-change", "credentials", "cancel", "generator-failure"])("refuses %s and cleans generated files", async (failure) => {
    const { ir, scope, options, controller } = setup();
    if (failure === "other-project") ir.components.find((node: { id: string }) => node.id === "answer_query").context_binding.project = "/other";
    vi.mocked(generatePreparedContext).mockImplementation(async (_bin, _project, output) => {
      await writeFile(output, JSON.stringify({ context_version: failure === "old-context" ? 1 : 2, parseable: failure !== "unparseable" }));
      if (failure === "project-change") vi.mocked(hashDirectory).mockResolvedValue("changed");
      if (failure === "identity-change") vi.mocked(options.currentIdentity).mockReturnValue({ ...options.identity, runtime_generation: "2" });
      if (failure === "credentials") (await captureWrenAccessIdentity(project)).assertCurrent = async () => { throw Error("rotated"); };
      if (failure === "cancel") controller.abort();
      if (failure === "generator-failure") throw Error("failed");
    });
    await expect(prepareCapturedNativeComponentHost(JSON.stringify(ir), scope, options)).rejects.toThrow();
    expect(options.vendor.open).not.toHaveBeenCalled(); await expectScratchRemoved();
  });
  it("does not start capture after cancellation", async () => {
    const { ir, scope, options, controller } = setup(); controller.abort();
    await expect(prepareCapturedNativeComponentHost(JSON.stringify(ir), scope, options)).rejects.toThrow();
    expect(generatePreparedContext).not.toHaveBeenCalled();
  });
});
