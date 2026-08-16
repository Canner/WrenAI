import { describe, expect, it, vi } from "vitest";
import { createSubscriptionModelCatalog, sanitizeSubscriptionModelCatalog, spawnJson } from "../server/subscription-model-catalog.js";

describe("subscription model catalog seam", () => {
  it("allowlists ready metadata and strips unknown/provider-sensitive fields", () => {
    const result = sanitizeSubscriptionModelCatalog("claude", {
      version: 1,
      status: "ready",
      provider: "claude",
      account: { email: "private@example.test" },
      models: [{
        model: "claude-sonnet",
        displayName: "Claude Sonnet",
        description: "Balanced",
        isDefault: true,
        secret: "not-public",
        reasoningEfforts: [{ value: "high", displayName: "High", raw: "discard" }],
      }],
    });
    expect(result).toEqual({
      version: 1,
      status: "ready",
      provider: "claude",
      models: [{
        model: "claude-sonnet",
        displayName: "Claude Sonnet",
        description: "Balanced",
        isDefault: true,
        reasoningEfforts: [{ value: "high", displayName: "High" }],
      }],
    });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain("not-public");
  });

  it("converts malformed and mismatched payloads into a sanitized protocol classification", () => {
    expect(sanitizeSubscriptionModelCatalog("codex", { version: 1, status: "ready", provider: "claude", models: [] }))
      .toEqual({ version: 1, status: "unavailable", provider: "codex", code: "protocol_error", retryable: false });
    expect(sanitizeSubscriptionModelCatalog("codex", { version: 1, status: "unavailable", provider: "codex", code: "raw stderr" }))
      .toEqual({ version: 1, status: "unavailable", provider: "codex", code: "protocol_error", retryable: false });
  });

  it("caches per provider and lets refresh bypass the cache", async () => {
    const execute = vi.fn(async (provider: "claude" | "codex") => ({ version: 1, status: "ready", provider, models: [] }));
    const list = createSubscriptionModelCatalog({ getUserProject: () => "/fixture/project", execute });
    await list("claude", false);
    await list("claude", false);
    await list("codex", false);
    await list("claude", true);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls.map(([provider]) => provider)).toEqual(["claude", "codex", "claude"]);
  });

  it("never surfaces thrown provider details", async () => {
    const list = createSubscriptionModelCatalog({
      getUserProject: () => undefined,
      execute: async () => { throw new Error("auth.json token=secret"); },
    });
    const result = await list("claude", true);
    expect(result).toEqual({ version: 1, status: "unavailable", provider: "claude", code: "runtime_unavailable", retryable: true });
    expect(JSON.stringify(result)).not.toMatch(/auth\.json|secret|token/);
  });

  it("keeps the newest refresh result when an older uncached request resolves afterwards", async () => {
    let resolveInitial: ((value: unknown) => void) | undefined;
    let resolveRefresh: ((value: unknown) => void) | undefined;
    const execute = vi.fn(() => new Promise<unknown>((resolve) => {
      if (execute.mock.calls.length === 1) resolveInitial = resolve;
      else resolveRefresh = resolve;
    }));
    const list = createSubscriptionModelCatalog({ getUserProject: () => undefined, execute });

    const initial = list("claude", false);
    const refresh = list("claude", true);
    resolveRefresh?.({ version: 1, status: "ready", provider: "claude", models: [{ model: "fresh", displayName: "Fresh" }] });
    await expect(refresh).resolves.toMatchObject({ status: "ready", models: [{ model: "fresh" }] });
    resolveInitial?.({ version: 1, status: "ready", provider: "claude", models: [{ model: "stale", displayName: "Stale" }] });
    await expect(initial).resolves.toMatchObject({ status: "ready", models: [{ model: "stale" }] });

    await expect(list("claude", false)).resolves.toMatchObject({ status: "ready", models: [{ model: "fresh" }] });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("kills a TERM-ignoring oversized-output child after returning a sanitized protocol failure", async () => {
    let pid: number | undefined;
    const childProgram = [
      "process.on('SIGTERM', () => {});",
      `process.stdout.write('x'.repeat(${1024 * 1024 + 1}));`,
      "setInterval(() => {}, 1_000);",
    ].join("");

    const list = createSubscriptionModelCatalog({
      getUserProject: () => undefined,
      execute: () => spawnJson(process.execPath, ["-e", childProgram], {
        env: process.env,
        onSpawn: (childPid) => { pid = childPid; },
      }),
    });
    await expect(list("claude", true)).resolves.toEqual({
      version: 1,
      status: "unavailable",
      provider: "claude",
      code: "protocol_error",
      retryable: false,
    });
    expect(pid).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    expect(() => process.kill(pid!, 0)).toThrow();
  });
});
