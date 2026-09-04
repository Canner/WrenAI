import {
  runtimeNotReady,
  runtimeReady,
  sanitizeRuntimeDiagnostic,
  sanitizeRuntimeReadiness,
} from "./policy.js";
import type {
  RuntimeBackendDiagnostic,
  RuntimeBackendId,
  RuntimeBackendProbeResult,
  RuntimeBackendReadiness,
  RuntimeDiagnostics,
  RuntimeReadiness,
} from "./types.js";

export type RuntimeDeployment = "development" | "production";

export interface VendorRuntimeProbes {
  readonly "codex-app-server"?: () => Promise<RuntimeBackendProbeResult<"codex-app-server">>;
  readonly "claude-sandbox-runtime"?: () => Promise<RuntimeBackendProbeResult<"claude-sandbox-runtime">>;
}

export interface RuntimeHostOptions {
  /** Server-owned selection. Browser input is deliberately absent from this type. */
  readonly selected: RuntimeBackendId;
  readonly deployment: RuntimeDeployment;
  readonly localAvailable: () => boolean | Promise<boolean>;
  /** Internal test/adaptor seam. Future vendor adapters must supply this server-side. */
  readonly vendorProbes?: VendorRuntimeProbes;
}

const fixedCodexProbe = (): RuntimeBackendProbeResult<"codex-app-server"> => ({
  readiness: runtimeNotReady("codex-app-server", "unprovisioned", "codex_app_server_unprovisioned"),
  diagnostic: { phase: "provisioning" },
});

const fixedClaudeProbe = (): RuntimeBackendProbeResult<"claude-sandbox-runtime"> => ({
  readiness: runtimeNotReady("claude-sandbox-runtime", "unprovisioned", "claude_sandbox_runtime_unprovisioned"),
  diagnostic: { phase: "provisioning" },
});

/**
 * Phase 1 read-only runtime boundary. It does not launch vendor processes;
 * production adapters will replace only their own probe seam in later phases.
 */
export class RuntimeHost {
  private diagnostics?: RuntimeDiagnostics;

  constructor(private readonly options: RuntimeHostOptions) {}

  private async probeLocal(): Promise<RuntimeBackendProbeResult<"local">> {
    if (this.options.deployment === "production") {
      return {
        readiness: runtimeNotReady("local", "unavailable", "local_runtime_production_forbidden"),
        diagnostic: { phase: "policy" },
      };
    }
    try {
      if (await this.options.localAvailable()) {
        return {
          readiness: runtimeReady("development-local", ["pty", "terminal_replay", "terminal_resize", "terminal_terminate"]),
          diagnostic: { phase: "capability", requiredCapability: "pty" },
        };
      }
    } catch {
      // The browser gets the same fixed result as a false host probe.
    }
    return {
      readiness: runtimeNotReady("local", "unavailable", "local_runtime_host_unavailable"),
      diagnostic: { phase: "capability", requiredCapability: "pty" },
    };
  }

  private async probeCodex(): Promise<RuntimeBackendProbeResult<"codex-app-server">> {
    try {
      return await (this.options.vendorProbes?.["codex-app-server"]?.() ?? Promise.resolve(fixedCodexProbe()));
    } catch {
      return {
        readiness: runtimeNotReady("codex-app-server", "unavailable", "runtime_probe_failed"),
        diagnostic: { phase: "probe" },
      };
    }
  }

  private async probeClaude(): Promise<RuntimeBackendProbeResult<"claude-sandbox-runtime">> {
    try {
      return await (this.options.vendorProbes?.["claude-sandbox-runtime"]?.() ?? Promise.resolve(fixedClaudeProbe()));
    } catch {
      return {
        readiness: runtimeNotReady("claude-sandbox-runtime", "unavailable", "runtime_probe_failed"),
        diagnostic: { phase: "probe" },
      };
    }
  }

  async probe(): Promise<RuntimeReadiness> {
    const [local, codex, claude] = await Promise.all([
      this.probeLocal(),
      this.probeCodex(),
      this.probeClaude(),
    ]);
    const backends: Readonly<Record<RuntimeBackendId, RuntimeBackendReadiness>> = {
      local: sanitizeRuntimeReadiness("local", local.readiness),
      "codex-app-server": sanitizeRuntimeReadiness("codex-app-server", codex.readiness),
      "claude-sandbox-runtime": sanitizeRuntimeReadiness("claude-sandbox-runtime", claude.readiness),
    };
    this.diagnostics = {
      local: sanitizeRuntimeDiagnostic(local.diagnostic),
      "codex-app-server": sanitizeRuntimeDiagnostic(codex.diagnostic),
      "claude-sandbox-runtime": sanitizeRuntimeDiagnostic(claude.diagnostic),
    };
    return { selected: this.options.selected, selectedReadiness: backends[this.options.selected], backends };
  }

  /** Host-only support evidence; never include this object in an API response. */
  serverDiagnostics(): RuntimeDiagnostics | undefined {
    return this.diagnostics;
  }
}
