/**
 * The Setup form and the runtime validator each hold their own copy of the
 * Claude per-step tier union: the form cannot import from `server/`, and the
 * validator must not depend on the form. Two copies is the tradeoff; silent
 * drift between them is not, because it is invisible until a user picks an
 * option the UI offered and the save is rejected — which is exactly how this
 * pair broke in the first place (the tier field was fed the account model
 * catalog, so it recommended `default`, a value the validator rejects).
 */
import { describe, expect, it } from "vitest";
import { CLAUDE_AGENT_SDK_PER_STEP_MODELS, runtimeSettingsCorrection } from "../server/runtime-binding.js";
import { CLAUDE_TIER_MODELS } from "../src/setup/claude-tier-models.js";
import type { RuntimeSettings } from "../server/wire-types.js";

const claudeSettings = (model: string): RuntimeSettings => ({
  authMode: "subscription",
  subscriptionProvider: "claude",
  tierModels: [{ tier: "strong", model }],
  hybrid: false,
  deployment: "personal",
});

describe("Claude per-step tier union", () => {
  it("offers exactly what the validator accepts", () => {
    expect([...CLAUDE_TIER_MODELS].sort()).toEqual([...CLAUDE_AGENT_SDK_PER_STEP_MODELS].sort());
  });

  it("accepts every value the Setup form offers", () => {
    for (const model of CLAUDE_TIER_MODELS) {
      expect(runtimeSettingsCorrection(claudeSettings(model))).toBeUndefined();
    }
  });

  it("still rejects `default`, the catalog id that the tier field used to recommend", () => {
    // `default` is a legitimate value for the top-level driver model field and
    // is what the account catalog marks as recommended. It is not a member of
    // the SDK's `agents[].model` union, so a tier must never offer it.
    expect(CLAUDE_TIER_MODELS).not.toContain("default");
    expect(runtimeSettingsCorrection(claudeSettings("default"))).toMatch(/must use one of/);
  });
});
