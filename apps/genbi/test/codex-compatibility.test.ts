import { describe, expect, it } from "vitest";
import { CODEX_BASELINE_VERSION, CODEX_CERTIFIED_ROWS, CODEX_REQUIRED_CONTRACTS, evaluateCodexIdentity, type CodexCertification, type CodexObservedIdentity } from "../server/runtime-host/codex-compatibility.js";

const row: CodexCertification = {
  state: "certified_row", platform: "darwin-arm64", version: CODEX_BASELINE_VERSION,
  executableSha256: "a".repeat(64), source: "https://example.invalid/codex-exact-fixture",
  protocolSha256: "b".repeat(64), contracts: [...CODEX_REQUIRED_CONTRACTS],
  evidence: { deterministicProbesSha256: "c".repeat(64), packedAcceptanceSha256: "d".repeat(64), releaseApprovalSha256: "e".repeat(64) },
};
const observed: CodexObservedIdentity = {
  platform: "darwin-arm64", versionOutput: `codex-cli ${CODEX_BASELINE_VERSION}\n`,
  executableSha256: row.executableSha256, source: row.source,
  protocolSha256: row.protocolSha256, contracts: row.contracts,
};
describe("Codex exact certification", () => {
  it("has no production grant even when the tested baseline version matches", () => {
    expect(CODEX_CERTIFIED_ROWS).toEqual([]);
    expect(evaluateCodexIdentity(observed).readiness).toMatchObject({ code: "codex_identity_uncertified" });
  });
  it("accepts only complete matching fixture evidence without mutating the production matrix", () => {
    expect(evaluateCodexIdentity(observed, [row]).readiness.state).toBe("ready");
    expect(evaluateCodexIdentity(observed).readiness.state).not.toBe("ready");
  });
  it.each([
    [{ platform: "linux-arm64" }, "runtime_platform_unsupported"],
    [{ versionOutput: "codex-cli 0.147.0" }, "codex_cli_version_unsupported"],
    [{ versionOutput: "secret /private/path 0.146.0" }, "codex_cli_version_malformed"],
    [{ executableSha256: "f".repeat(64) }, "codex_identity_uncertified"],
    [{ source: "https://example.invalid/other-source" }, "codex_identity_uncertified"],
    [{ protocolSha256: "f".repeat(64) }, "codex_app_server_protocol_incompatible"],
    [{ contracts: CODEX_REQUIRED_CONTRACTS.filter((name) => name !== "protected_read") }, "codex_sandbox_policy_unavailable"],
  ])("rejects mismatch with browser-safe diagnostics", (mutation, code) => {
    const result = evaluateCodexIdentity({ ...observed, ...mutation }, [row]);
    expect(result.readiness).toMatchObject({ code });
    expect(JSON.stringify(result)).not.toContain("/private");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain(row.source);
  });
  it.each([
    { ...row, state: "tested_baseline" },
    { ...row, evidence: undefined },
    { ...row, contracts: ["initialize"] },
    { ...row, executableSha256: "staged" },
    { ...row, source: "http://example.invalid/insecure" },
    { ...row, evidence: { ...row.evidence, releaseApprovalSha256: "pending" } },
  ])("rejects partial or unapproved certification", (invalid) => {
    expect(evaluateCodexIdentity(observed, [invalid]).readiness).toMatchObject({ code: "codex_identity_uncertified" });
  });
});
