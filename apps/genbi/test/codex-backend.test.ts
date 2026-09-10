import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), attest: vi.fn(), assertIdentity: vi.fn(), version: vi.fn(), spawn: vi.fn(), policy: vi.fn(), rows: [] as any[], platform: "darwin", arch: "arm64" }));
vi.mock("node:os", () => ({ platform: () => mocks.platform, arch: () => mocks.arch }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.version }));
vi.mock("../server/managed-wren-runtime.js", () => ({ resolveManagedWrenRuntime: mocks.resolve, ManagedWrenRuntimeError: class extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock("../server/native-runtime-spec.js", () => ({ attestNativeExecutable: mocks.attest, assertNativeExecutableIdentity: mocks.assertIdentity }));
vi.mock("../server/runtime-host/codex-policy.js", () => ({ buildCodexSessionPolicy: mocks.policy }));
vi.mock("../server/runtime-host/codex-process.js", () => ({ spawnCodexTransport: mocks.spawn }));
vi.mock("../server/runtime-host/codex-compatibility.js", async (importOriginal) => ({ ...(await importOriginal<any>()), CODEX_CERTIFIED_ROWS: mocks.rows }));
import { CodexAppServerBackend } from "../server/runtime-host/codex-app-server.js";
import { ManagedWrenRuntimeError } from "../server/managed-wren-runtime.js";
import { CODEX_REQUIRED_CONTRACTS } from "../server/runtime-host/codex-compatibility.js";
import type { RpcTransport } from "../server/runtime-host/codex-rpc.js";
const runtime = { manifest_digest: "a".repeat(64), closure_digest: "b".repeat(64), generation_root: "/generation" };
const vendor = { name: "vendor", executable: "/codex", identity: `sha256:${"c".repeat(64)}`, digest: `sha256:${"c".repeat(64)}` };
const policy = { cwd: "/scope", codexHome: "/login", profile: "genbi-scoped", args: ["app-server"], environment: {}, commandEnvironment: {}, configuration: {} };
const row = { state: "certified_row", platform: "darwin-arm64", version: "0.146.0", executableSha256: "c".repeat(64), source: "https://example.invalid/codex", protocolSha256: "d".repeat(64), contracts: [...CODEX_REQUIRED_CONTRACTS], evidence: { deterministicProbesSha256: "a".repeat(64), packedAcceptanceSha256: "b".repeat(64), releaseApprovalSha256: "c".repeat(64) } };
class Peer implements RpcTransport {
  handlers!: Parameters<RpcTransport["listen"]>[0];
  close = vi.fn(async () => {});
  hang = false;
  listen(value: Parameters<RpcTransport["listen"]>[0]) { this.handlers = value; }
  write(line: string) {
    const message = JSON.parse(line); if (!message.id || this.hang) return;
    const result = message.method === "initialize" ? { codexHome: "/login", platformFamily: "unix", platformOs: "macos", userAgent: "codex_cli_rs/0.146.0 fixture" } : message.method === "config/read" ? { config: {} } : { data: [{ id: "genbi-scoped", allowed: true }], nextCursor: null };
    this.handlers.data(Buffer.from(JSON.stringify({ id: message.id, result }) + "\n"));
  }
}
const backends: CodexAppServerBackend[] = [];
function backend() { const value = new CodexAppServerBackend({ executable: "/codex", source: row.source }); backends.push(value); return value; }
const input = () => ({ spec: { executables: { vendor } } as any, wrenHome: {} as any, assertScopeActive: vi.fn(), onEvent: vi.fn() });
beforeEach(() => {
  mocks.rows.splice(0, mocks.rows.length, row); mocks.platform = "darwin"; mocks.arch = "arm64";
  mocks.resolve.mockReset().mockReturnValue(runtime); mocks.attest.mockReset().mockReturnValue(vendor); mocks.assertIdentity.mockReset();
  mocks.version.mockReset().mockReturnValue("codex-cli 0.146.0\n"); mocks.policy.mockReset().mockReturnValue(policy); mocks.spawn.mockReset().mockImplementation(() => new Peer());
});
afterEach(async () => { for (const value of backends.splice(0)) await value.shutdown().catch(() => {}); });
describe("Codex backend grants", () => {
  it.each(["codex_wren_runtime_unprovisioned", "codex_wren_manifest_missing", "codex_wren_closure_mismatch", "codex_wren_interpreter_mismatch", "codex_wren_package_mismatch"])("stops %s before vendor probe, materialization or spawn", async (code) => {
    mocks.resolve.mockImplementation(() => { throw new ManagedWrenRuntimeError(code as any); });
    const value = backend(); expect((await value.probe()).readiness).toMatchObject({ state: "unprovisioned", code });
    expect(() => value.prepareLaunch()).toThrow(); expect(mocks.version).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.policy).not.toHaveBeenCalled();
  });
  it("cannot promote an empty production registry using fixture success", async () => {
    mocks.rows.splice(0); const value = backend();
    expect((await value.probe()).readiness).toMatchObject({ code: "codex_identity_uncertified" });
    expect(() => value.prepareLaunch()).toThrow(); expect(mocks.version).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it.each(["linux", "win32"])("rejects platform %s before all effects", async (platform) => {
    mocks.platform = platform; expect((await backend().probe()).readiness).toMatchObject({ code: "runtime_platform_unsupported" }); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(["codex-cli 0.147.0", "SECRET credential output"])("refuses non-certified version output %s", async (version) => {
    mocks.version.mockReturnValue(version); const value = backend(); const result = await value.probe();
    expect(result.readiness.state).not.toBe("ready"); expect(JSON.stringify(result)).not.toContain(version); expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("resolve-only probe creates no lease or app-server", async () => {
    const value = backend(); expect((await value.probe()).readiness.state).toBe("ready"); expect(value.retainedManifestDigests()).toEqual([]); expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("revalidates exact generation before spawn; forged and reused grants fail", async () => {
    const value = backend(); const permit = value.prepareLaunch();
    expect(value.retainedManifestDigests()).toEqual([runtime.manifest_digest]);
    await expect(value.open({ ...permit }, input())).rejects.toMatchObject({ code: "runtime_policy_unavailable" });
    mocks.resolve.mockReturnValue({ ...runtime, closure_digest: "changed" });
    expect(() => permit.assertActive()).toThrow();
    await expect(value.open(permit, input())).rejects.toMatchObject({ code: "codex_wren_closure_mismatch" });
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(value.retainedManifestDigests()).toEqual([]);
    await expect(value.open(permit, input())).rejects.toMatchObject({ code: "runtime_policy_unavailable" });
  });
  it("does not let another backend use the permit, and honors pre-open release", async () => {
    const value = backend(); const permit = value.prepareLaunch();
    await expect(backend().open(permit, input())).rejects.toMatchObject({ code: "runtime_policy_unavailable" }); permit.release();
    expect(value.retainedManifestDigests()).toEqual([]); await expect(value.open(permit, input())).rejects.toMatchObject({ code: "runtime_policy_unavailable" });
    expect(() => permit.assertActive()).toThrow();
  });
  it("rejects stale binding and replaced executable before spawning", async () => {
    const value = backend(); const permit = value.prepareLaunch(); const i = input(); i.assertScopeActive.mockImplementation(() => { throw new Error("private path"); });
    await expect(value.open(permit, i)).rejects.toMatchObject({ code: "runtime_policy_unavailable" }); expect(mocks.spawn).not.toHaveBeenCalled();
    const second = value.prepareLaunch(); mocks.assertIdentity.mockImplementation(() => { throw new Error("digest changed"); });
    await expect(value.open(second, input())).rejects.toMatchObject({ code: "codex_identity_uncertified" }); expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("pins a live generation and releases only after confirmed close", async () => {
    const value = backend(); const permit = value.prepareLaunch(); const session = await value.open(permit, input());
    permit.release(); expect(value.retainedManifestDigests()).toEqual([runtime.manifest_digest]);
    await session.close(); expect(value.retainedManifestDigests()).toEqual([]);
  });
  it("retains a generation and reports cleanup failure", async () => {
    const peer = new Peer(); peer.close.mockRejectedValue(new Error("private cleanup detail")); mocks.spawn.mockReturnValue(peer);
    const value = backend(); const session = await value.open(value.prepareLaunch(), input());
    await expect(session.close()).rejects.toMatchObject({ reason: "cleanup" });
    expect(value.retainedManifestDigests()).toEqual([runtime.manifest_digest]); await expect(value.shutdown()).rejects.toMatchObject({ code: "codex_app_server_cleanup_failed" });
  });
  it("shutdown owns an opening handshake too", async () => {
    const peer = new Peer(); peer.hang = true; mocks.spawn.mockReturnValue(peer);
    const value = backend(); const opening = value.open(value.prepareLaunch(), input());
    await value.shutdown(); await expect(opening).rejects.toThrow(); expect(peer.close).toHaveBeenCalledOnce(); expect(value.retainedManifestDigests()).toEqual([]);
  });
});
