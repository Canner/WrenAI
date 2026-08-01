import { describe, expect, it } from "vitest";
import { detectAndPick, toAuthChoice } from "../harness/auth/detect.js";
import type { LoginProbe } from "../harness/auth/probe.js";
import type { AuthOption } from "../harness/auth/types.js";

function mockProbe(claudeLoggedIn: boolean, codexLoggedIn: boolean): LoginProbe {
  return {
    claudeLoggedIn: () => claudeLoggedIn,
    codexLoggedIn: () => codexLoggedIn,
  };
}

function hasSubscription(options: AuthOption[], provider: "claude" | "codex"): boolean {
  return options.some((option) => option.mode === "subscription" && option.provider === provider);
}

describe("detectAndPick (auth detect-and-pick, offline)", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("claude logged in=%s, codex logged in=%s", async (claudeLoggedIn, codexLoggedIn) => {
    const options = await detectAndPick(mockProbe(claudeLoggedIn, codexLoggedIn));

    expect(hasSubscription(options, "claude")).toBe(claudeLoggedIn);
    expect(hasSubscription(options, "codex")).toBe(codexLoggedIn);

    // api-key/local/gateway are unconditional regardless of probe state.
    expect(options.some((option) => option.mode === "api-key")).toBe(true);
    expect(options.some((option) => option.mode === "local")).toBe(true);
    expect(options.some((option) => option.mode === "gateway")).toBe(true);
  });

  it("supports an async LoginProbe (Promise<boolean> from both methods)", async () => {
    const probe: LoginProbe = {
      claudeLoggedIn: () => Promise.resolve(true),
      codexLoggedIn: () => Promise.resolve(false),
    };

    const options = await detectAndPick(probe);

    expect(hasSubscription(options, "claude")).toBe(true);
    expect(hasSubscription(options, "codex")).toBe(false);
  });

  it("never offers a subscription option when neither CLI is logged in", async () => {
    const options = await detectAndPick(mockProbe(false, false));

    expect(options.some((option) => option.mode === "subscription")).toBe(false);
    expect(options).toHaveLength(3);
  });

  it("toAuthChoice maps each AuthOption to its matching AuthChoice mode", () => {
    expect(toAuthChoice({ mode: "subscription", provider: "claude" })).toEqual({
      mode: "subscription",
      provider: "claude",
    });
    expect(toAuthChoice({ mode: "subscription", provider: "codex" })).toEqual({
      mode: "subscription",
      provider: "codex",
    });
    expect(toAuthChoice({ mode: "api-key" })).toMatchObject({ mode: "api-key" });
    expect(toAuthChoice({ mode: "local" })).toEqual({ mode: "local" });
    expect(toAuthChoice({ mode: "gateway" })).toMatchObject({ mode: "gateway" });
  });
});
