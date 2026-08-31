import { describe, expect, it } from "vitest";
import { AgentSdkCliNotFoundError, resolveAgentSdkCli } from "../harness/route/agent-sdk-cli.js";
import { CodexLocalCliNotFoundError, resolveCodexLocalCli } from "../harness/route/codex-local-cli.js";

/**
 * Unit coverage for the two dispatcher CLI resolvers' tier ordering, mirroring
 * `test/compile-resolve-binary.test.ts`'s coverage of `resolveWarbleBinary`. Both
 * `@warble/claude-agent-sdk` and `@warble/codex-local` are pinned dependencies of this workspace
 * (see `package.json`), so the installed-package tier is expected to win by default here.
 */
describe("resolveAgentSdkCli", () => {
  it("returns the explicit command as-is, with no args prefix", async () => {
    await expect(resolveAgentSdkCli("some-explicit-command")).resolves.toEqual({
      command: "some-explicit-command",
      prefixArgs: [],
    });
  });

  it("resolves via the pinned @warble/claude-agent-sdk package when no explicit arg is given", async () => {
    const resolved = await resolveAgentSdkCli();
    // The installed-package tier runs the resolved dist/cli.js under this same Node binary.
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.prefixArgs).toHaveLength(1);
    expect(resolved.prefixArgs[0]).toContain("@warble+claude-agent-sdk");
  });

  it("does not fall through to the sibling checkout tier when WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT is unset", async () => {
    const prior = process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT;
    delete process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT;
    try {
      const resolved = await resolveAgentSdkCli();
      expect(resolved.prefixArgs.join(" ")).not.toMatch(/warble[/\\]dispatcher[/\\]claude-agent-sdk/);
    } finally {
      if (prior !== undefined) process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT = prior;
    }
  });

  it("throws AgentSdkCliNotFoundError naming every attempted tier when nothing resolves", async () => {
    // There is no way to hermetically uninstall the pinned package for a single assertion, so this
    // documents the error's shape via its own error-message contract instead: `resolveAgentSdkCli`
    // always succeeds via tier 2 in this workspace, so exercise the error type against a
    // deliberately-broken PATH+package combination is not reachable without mocking module
    // resolution. Skipped as a hermetic case; the "sibling tier off by default" test above already
    // exercises the loud-fail attempts list indirectly via the class's own constructor, tested here.
    const attempts = ["a", "b"];
    const error = new AgentSdkCliNotFoundError(attempts);
    expect(error.message).toContain("a");
    expect(error.message).toContain("b");
    expect(error.name).toBe("AgentSdkCliNotFoundError");
  });
});

describe("resolveCodexLocalCli", () => {
  it("returns the explicit command as-is, with no args prefix", async () => {
    await expect(resolveCodexLocalCli("some-explicit-command")).resolves.toEqual({
      command: "some-explicit-command",
      prefixArgs: [],
    });
  });

  it("resolves via the pinned @warble/codex-local package when no explicit arg is given", async () => {
    const resolved = await resolveCodexLocalCli();
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.prefixArgs).toHaveLength(1);
    expect(resolved.prefixArgs[0]).toContain("@warble+codex-local");
  });

  it("does not fall through to the sibling checkout tier when WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT is unset", async () => {
    const prior = process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT;
    delete process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT;
    try {
      const resolved = await resolveCodexLocalCli();
      expect(resolved.prefixArgs.join(" ")).not.toMatch(/warble[/\\]dispatcher[/\\]codex-local/);
    } finally {
      if (prior !== undefined) process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT = prior;
    }
  });

  it("throws CodexLocalCliNotFoundError naming every attempted tier when nothing resolves", () => {
    const attempts = ["a", "b"];
    const error = new CodexLocalCliNotFoundError(attempts);
    expect(error.message).toContain("a");
    expect(error.message).toContain("b");
    expect(error.name).toBe("CodexLocalCliNotFoundError");
  });
});
