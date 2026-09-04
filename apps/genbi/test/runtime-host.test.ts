import { describe, expect, it } from "vitest";
import { RuntimeHost } from "../server/runtime-host/local.js";
import { runtimeNotReady, runtimeReady } from "../server/runtime-host/policy.js";

describe("RuntimeHost readiness", () => {
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
