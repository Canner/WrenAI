import { describe, expect, it } from "vitest";
import { RuntimeHost } from "../server/runtime-host/local.js";
import { runtimeNotReady, runtimeReady } from "../server/runtime-host/policy.js";

describe("RuntimeHost readiness", () => {
  it("projects every decision-93 Codex Wren failure independently from a ready Claude backend", async () => {
    const decision93Reasons = {
      codex_wren_manifest_missing: "The managed Wren runtime manifest is unavailable.",
      codex_wren_manifest_invalid: "The managed Wren runtime manifest is invalid.",
      codex_wren_platform_unsupported: "The managed Wren runtime does not support this platform.",
      codex_wren_runtime_unprovisioned: "The managed Wren runtime has not been provisioned.",
      codex_wren_provision_failed: "The managed Wren runtime could not be provisioned.",
      codex_wren_interpreter_mismatch: "The managed Wren interpreter identity does not match this GenBI release.",
      codex_wren_launcher_mismatch: "The managed Wren launcher identity does not match this GenBI release.",
      codex_wren_package_mismatch: "The managed Wren package identity does not match this GenBI release.",
      codex_wren_closure_mismatch: "The managed Wren runtime closure does not match this GenBI release.",
      codex_wren_profile_unavailable: "The bound Wren profile is unavailable to this session.",
      codex_wren_secret_unavailable: "A secret required by the bound Wren profile is unavailable.",
      codex_wren_session_home_unavailable: "The private Wren session home is unavailable.",
      codex_wren_child_env_invalid: "The managed Wren child environment is invalid.",
    } as const;

    for (const [code, message] of Object.entries(decision93Reasons) as Array<[keyof typeof decision93Reasons, string]>) {
      const host = new RuntimeHost({
        selected: "claude-sandbox-runtime",
        deployment: "development",
        localAvailable: () => true,
        vendorProbes: {
          "codex-app-server": async () => ({
            readiness: runtimeNotReady("codex-app-server", "unavailable", code),
            diagnostic: { phase: "provisioning" },
          }),
          "claude-sandbox-runtime": async () => ({
            readiness: runtimeReady("2.1.259", ["sandbox_policy", "filesystem_isolation", "network_isolation"]),
            diagnostic: { phase: "identity", observedVersion: "2.1.259" },
          }),
        },
      });

      const readiness = await host.probe();
      expect(readiness.backends["codex-app-server"]).toEqual({ state: "unavailable", code, message });
      expect(readiness.backends["claude-sandbox-runtime"]).toMatchObject({ state: "ready", version: "2.1.259" });
      expect(readiness.selectedReadiness).toBe(readiness.backends["claude-sandbox-runtime"]);
    }
  });

  it("keeps backend outcomes independent and derives selected readiness from only the selected backend", async () => {
    const host = new RuntimeHost({
      selected: "claude-sandbox-runtime",
      deployment: "development",
      localAvailable: () => true,
      vendorProbes: {
        "codex-app-server": async () => ({
          readiness: runtimeNotReady("codex-app-server", "incompatible", "codex_app_server_protocol_incompatible"),
          diagnostic: { phase: "capability", requiredCapability: "app_server_rpc" },
        }),
        "claude-sandbox-runtime": async () => ({
          readiness: runtimeReady("2.1.259", ["sandbox_policy", "filesystem_isolation", "network_isolation"]),
          diagnostic: { phase: "identity", observedVersion: "2.1.259", attestedIdentity: `sha256:${"a".repeat(64)}` },
        }),
      },
    });

    const readiness = await host.probe();
    expect(readiness.backends["codex-app-server"]).toEqual({
      state: "incompatible",
      code: "codex_app_server_protocol_incompatible",
      message: "The Codex app-server protocol is incompatible with this GenBI release.",
    });
    expect(readiness.backends["claude-sandbox-runtime"]).toMatchObject({ state: "ready", version: "2.1.259" });
    expect(readiness.selectedReadiness).toBe(readiness.backends["claude-sandbox-runtime"]);
  });

  it("fails closed for local selection in production and never falls back from an unavailable vendor", async () => {
    const productionLocal = new RuntimeHost({ selected: "local", deployment: "production", localAvailable: () => true });
    await expect(productionLocal.probe()).resolves.toMatchObject({
      selected: "local",
      selectedReadiness: { state: "unavailable", code: "local_runtime_production_forbidden" },
    });

    const vendor = new RuntimeHost({ selected: "codex-app-server", deployment: "development", localAvailable: () => true });
    await expect(vendor.probe()).resolves.toMatchObject({
      backends: { local: { state: "ready" }, "codex-app-server": { state: "unprovisioned", code: "codex_app_server_unprovisioned" } },
      selectedReadiness: { state: "unprovisioned", code: "codex_app_server_unprovisioned" },
    });
  });

  it("projects fixed reasons only while retaining sanitized support evidence server-side", async () => {
    const raw = "/private/runtime/bin --token=do-not-send";
    const host = new RuntimeHost({
      selected: "claude-sandbox-runtime",
      deployment: "development",
      localAvailable: () => true,
      vendorProbes: {
        "claude-sandbox-runtime": async () => ({
          readiness: {
            state: "unavailable",
            code: "claude_cli_missing",
            // A future adapter cannot make its own diagnostic text browser-visible.
            message: raw,
          },
          diagnostic: {
            phase: "version",
            observedVersion: raw,
            requiredCapability: "sandbox_policy",
            attestedIdentity: `sha256:${"b".repeat(64)}`,
          },
        }),
      },
    });

    const readiness = await host.probe();
    expect(readiness.selectedReadiness).toEqual({
      state: "unavailable",
      code: "claude_cli_missing",
      message: "The required Claude CLI is not available.",
    });
    expect(JSON.stringify(readiness)).not.toContain(raw);
    expect(host.serverDiagnostics()?.["claude-sandbox-runtime"]).toEqual({
      phase: "version",
      requiredCapability: "sandbox_policy",
      attestedIdentity: `sha256:${"b".repeat(64)}`,
    });
  });
});
