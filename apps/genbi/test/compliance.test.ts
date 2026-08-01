import { describe, expect, it } from "vitest";
import { ComplianceError, enforceCompliance, SUBSCRIPTION_TOS_WARNING } from "../harness/compliance/index.js";
import type { AuthChoice } from "../harness/auth/index.js";

const SUBSCRIPTION: AuthChoice = { mode: "subscription", provider: "claude" };
const NON_SUBSCRIPTION: readonly AuthChoice[] = [
  { mode: "api-key", adapter: "anthropic" },
  { mode: "local", endpoint: "http://localhost:11434/v1" },
  { mode: "gateway", config: { baseURL: "https://gateway.example.com/v1", model: "gpt-4o" } },
];

describe("enforceCompliance (compliance gate)", () => {
  it("subscription + personal (explicit): allows and returns the ToS warning", () => {
    const result = enforceCompliance(SUBSCRIPTION, { deployment: "personal" });
    expect(result.authChoice).toEqual(SUBSCRIPTION);
    expect(result.warnings).toEqual([SUBSCRIPTION_TOS_WARNING]);
  });

  it("subscription + personal (default, deployment omitted): allows and returns the ToS warning", () => {
    const result = enforceCompliance(SUBSCRIPTION);
    expect(result.warnings).toEqual([SUBSCRIPTION_TOS_WARNING]);
  });

  it("subscription + hosted: throws ComplianceError naming the rule, not a silent downgrade", () => {
    expect(() => enforceCompliance(SUBSCRIPTION, { deployment: "hosted" })).toThrow(ComplianceError);
    expect(() => enforceCompliance(SUBSCRIPTION, { deployment: "hosted" })).toThrow(
      /personal-use only.*hosted.*api-key.*gateway/s,
    );
  });

  it.each(NON_SUBSCRIPTION)("%o + personal: allowed, no subscription warning", (authChoice) => {
    const result = enforceCompliance(authChoice, { deployment: "personal" });
    expect(result.authChoice).toEqual(authChoice);
    expect(result.warnings).toEqual([]);
  });

  it.each(NON_SUBSCRIPTION)("%o + hosted: allowed, no subscription warning", (authChoice) => {
    const result = enforceCompliance(authChoice, { deployment: "hosted" });
    expect(result.authChoice).toEqual(authChoice);
    expect(result.warnings).toEqual([]);
  });

  it("the ToS warning covers ToS risk, backend volatility, and personal-only scope", () => {
    expect(SUBSCRIPTION_TOS_WARNING).toMatch(/Terms of Service/);
    expect(SUBSCRIPTION_TOS_WARNING).toMatch(/volatile/);
    expect(SUBSCRIPTION_TOS_WARNING).toMatch(/personal.*never multi-user or hosted/);
    expect(SUBSCRIPTION_TOS_WARNING).toMatch(/not legal advice/);
  });
});
