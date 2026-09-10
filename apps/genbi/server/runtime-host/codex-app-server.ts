import { execFileSync } from "node:child_process";
import { arch, platform } from "node:os";
import { ManagedWrenRuntimeError, resolveManagedWrenRuntime, type ManagedWrenRuntimeRecord } from "../managed-wren-runtime.js";
import { attestNativeExecutable, assertNativeExecutableIdentity, type NativeExecutableIdentity, type NativeRuntimeSpec } from "../native-runtime-spec.js";
import type { CodexWrenHome } from "../native-wren-home.js";
import { CODEX_CERTIFIED_ROWS, codexCertificationSchema, evaluateCodexIdentity } from "./codex-compatibility.js";
import { buildCodexSessionPolicy } from "./codex-policy.js";
import { spawnCodexTransport } from "./codex-process.js";
import { CodexSession } from "./codex-session.js";
import { CodexRpcError } from "./codex-rpc.js";
import type { CodexEvent } from "./codex-events.js";
import { runtimeNotReady } from "./policy.js";
import type { RuntimeBackendProbeResult, RuntimeBackendReasonCode } from "./types.js";

type Reason = RuntimeBackendReasonCode<"codex-app-server">;
export class CodexBackendError extends Error {
  constructor(readonly code: Reason) { super(runtimeNotReady("codex-app-server", "unavailable", code).message); }
}
export interface CodexBackendOptions {
  /** Captured at BFF composition, not discovered from command/session input. */
  readonly executable: string;
  readonly source: string;
  readonly packageRoot?: string;
  readonly runtimeRoot?: string;
}
export interface CodexLaunchPermit {
  readonly runtime: ManagedWrenRuntimeRecord;
  /** Recheck immediately before each host-side materialization/persistence step. */
  assertActive(): void;
  /** Abandon before materialization or open; never deletes any runtime bytes. */
  release(): void;
}
interface PermitState { vendor: NativeExecutableIdentity; runtime: ManagedWrenRuntimeRecord; consumed: boolean; released: boolean }

/** Disabled unless the package contains an approved runtime AND certified row. */
export class CodexAppServerBackend {
  private permits = new WeakMap<CodexLaunchPermit, PermitState>();
  private leases = new Set<PermitState>();
  private sessions = new Set<CodexSession>();
  private stopped = false;
  private shutdownPromise?: Promise<void>;
  private readonly options: CodexBackendOptions;
  constructor(options: CodexBackendOptions) { this.options = Object.freeze({ ...options }); }

  private resolve(): ManagedWrenRuntimeRecord {
    try { return resolveManagedWrenRuntime(this.options); }
    catch (error) { throw new CodexBackendError(error instanceof ManagedWrenRuntimeError ? error.code : "codex_wren_runtime_unprovisioned"); }
  }
  private inspect(): { runtime: ManagedWrenRuntimeRecord; vendor: NativeExecutableIdentity; result: RuntimeBackendProbeResult<"codex-app-server"> } {
    if (this.stopped) throw new CodexBackendError("codex_app_server_unreachable");
    if (platform() !== "darwin" || arch() !== "arm64") throw new CodexBackendError("runtime_platform_unsupported");
    const runtime = this.resolve(); // no fetch, install, mkdir, workspace or session side effects
    let vendor: NativeExecutableIdentity;
    try { vendor = attestNativeExecutable("vendor", this.options.executable); }
    catch { throw new CodexBackendError("codex_cli_missing"); }
    // Hash before executing --version. An unknown executable never gets a probe
    // process merely because the caller labels it Codex.
    const row = CODEX_CERTIFIED_ROWS.map((value) => codexCertificationSchema.safeParse(value))
      .find((value) => value.success && value.data.executableSha256 === vendor.digest.slice(7) && value.data.source === this.options.source);
    if (!row?.success) throw new CodexBackendError("codex_identity_uncertified");
    let versionOutput: string;
    try {
      versionOutput = execFileSync(vendor.executable, ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 1024,
        env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "ignore"] });
      assertNativeExecutableIdentity(vendor);
    } catch { throw new CodexBackendError("codex_app_server_unreachable"); }
    // The exact executable digest binds the generated protocol schema and
    // behavior evidence in its reviewed row; never generate schema files during
    // readiness or equate an initialize acknowledgement with certification.
    const result = evaluateCodexIdentity({ platform: "darwin-arm64", versionOutput,
      executableSha256: vendor.digest.slice(7), source: this.options.source,
      protocolSha256: row.data.protocolSha256, contracts: row.data.contracts }, CODEX_CERTIFIED_ROWS);
    if (result.readiness.state !== "ready") throw new CodexBackendError(result.readiness.code);
    return { runtime, vendor, result };
  }
  async probe(): Promise<RuntimeBackendProbeResult<"codex-app-server">> {
    try { return this.inspect().result; }
    catch (error) {
      const code = error instanceof CodexBackendError ? error.code : "runtime_probe_failed";
      return { readiness: runtimeNotReady("codex-app-server", code.startsWith("codex_wren_") ? "unprovisioned" : "incompatible", code), diagnostic: { phase: code.startsWith("codex_wren_") ? "provisioning" : "identity" } };
    }
  }
  /** Call BEFORE durable rows or workspace materialization in Phase 5. */
  prepareLaunch(): CodexLaunchPermit {
    const { runtime, vendor } = this.inspect();
    const state: PermitState = { runtime, vendor, consumed: false, released: false };
    const permit = Object.freeze({ runtime, assertActive: () => {
      if (state.released || state.consumed || this.stopped) throw new CodexBackendError("runtime_policy_unavailable");
      this.assertRecord(state);
    }, release: () => {
      if (state.consumed) return;
      state.released = true; this.leases.delete(state);
    } });
    this.permits.set(permit, state); this.leases.add(state);
    return permit;
  }
  /** Include these generations in the provisioner's cleanup retain set. */
  retainedManifestDigests(): readonly string[] { return Object.freeze([...new Set([...this.leases].map((state) => state.runtime.manifest_digest))]); }

  private assertRecord(state: PermitState): ManagedWrenRuntimeRecord {
    const current = this.resolve();
    if (JSON.stringify(current) !== JSON.stringify(state.runtime)) throw new CodexBackendError("codex_wren_closure_mismatch");
    try { assertNativeExecutableIdentity(state.vendor); }
    catch { throw new CodexBackendError("codex_identity_uncertified"); }
    return current;
  }

  async open(permit: CodexLaunchPermit, input: {
    readonly spec: NativeRuntimeSpec;
    readonly wrenHome: CodexWrenHome;
    /** Existing host-owned binding/generation guard, never a browser callback. */
    readonly assertScopeActive: () => void;
    readonly onEvent: (event: CodexEvent) => void;
  }): Promise<CodexSession> {
    const state = this.permits.get(permit);
    if (!state || state.consumed || state.released || this.stopped) throw new CodexBackendError("runtime_policy_unavailable");
    state.consumed = true;
    const revalidate = () => {
      const current = this.assertRecord(state);
      if (input.spec.executables.vendor?.digest !== state.vendor.digest || input.spec.executables.vendor?.executable !== state.vendor.executable) throw new CodexBackendError("codex_identity_uncertified");
      try { input.assertScopeActive(); }
      catch { throw new CodexBackendError("runtime_policy_unavailable"); }
      try { return buildCodexSessionPolicy(input.spec, current, input.wrenHome); }
      catch { throw new CodexBackendError("codex_wren_child_env_invalid"); }
    };
    let spawned = false;
    try {
      const policy = revalidate();
      const transport = spawnCodexTransport({ executable: state.vendor.executable, args: policy.args, cwd: policy.cwd, env: { ...policy.environment } });
      spawned = true;
      const session = await CodexSession.connect(transport, policy, () => {
        if (this.stopped || JSON.stringify(revalidate()) !== JSON.stringify(policy)) throw new CodexBackendError("runtime_policy_unavailable");
      }, input.onEvent, (opening) => {
        // Own the connection before initialization: shutdown must also cancel
        // a peer that never acknowledges the handshake.
        this.sessions.add(opening);
        const originalClose = opening.close.bind(opening);
        opening.close = async () => { await originalClose(); this.sessions.delete(opening); this.leases.delete(state); };
      });
      if (this.stopped) { await session.close(); this.leases.delete(state); throw new CodexBackendError("codex_app_server_unreachable"); }
      return session;
    } catch (error) {
      // Pre-spawn failures have no process to retain. A post-spawn cleanup
      // failure conservatively pins the generation for operator reconciliation.
      if (!spawned || !(error instanceof CodexRpcError && error.reason === "cleanup")) this.leases.delete(state);
      if (error instanceof CodexBackendError) throw error;
      if (error instanceof CodexRpcError && error.reason === "cleanup") throw new CodexBackendError("codex_app_server_cleanup_failed");
      if (error instanceof CodexRpcError && error.reason === "permission") throw new CodexBackendError("codex_permission_profile_unavailable");
      throw new CodexBackendError("codex_app_server_protocol_incompatible");
    }
  }
  shutdown(): Promise<void> {
    this.stopped = true;
    this.shutdownPromise ??= (async () => {
      const results = await Promise.allSettled([...this.sessions].map((session) => session.close()));
      for (const state of this.leases) if (!state.consumed) { state.released = true; this.leases.delete(state); }
      if (results.some((result) => result.status === "rejected")) throw new CodexBackendError("codex_app_server_cleanup_failed");
    })();
    return this.shutdownPromise;
  }
}
