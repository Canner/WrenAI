import { describe, expect, it } from "vitest";
import {
  buildApiKeyConfig,
  buildExplicitAuthChoice,
  buildGatewayConfig,
  buildTierBindingFromFlags,
  CliUsageError,
  determineExitCode,
  EXIT_OK,
  EXIT_REFUSAL,
  parseChatTimeoutMs,
  parseSetupMaxTurns,
  parseTierAdapterFlag,
  resolveAuthChoice,
  resolveDeployment,
  validateRequiredInputs,
} from "../harness/cli-args.js";
import type { CliFlags } from "../harness/cli-args.js";
import { ComplianceError, enforceCompliance } from "../harness/compliance/index.js";
import { deriveAdapterSpec } from "../harness/route/index.js";
import type { RouteResult } from "../harness/route/index.js";
import type { LoginProbe } from "../harness/auth/index.js";

function probe(overrides: Partial<Record<"claude" | "codex", boolean>> = {}): LoginProbe {
  return {
    claudeLoggedIn: async () => overrides.claude ?? false,
    codexLoggedIn: async () => overrides.codex ?? false,
  };
}

const NONE = probe();

describe("validateRequiredInputs", () => {
  it("rejects an undefined, empty, or whitespace-only project", () => {
    expect(() => validateRequiredInputs(undefined, "q")).toThrow(CliUsageError);
    expect(() => validateRequiredInputs("", "q")).toThrow(/--project/);
    expect(() => validateRequiredInputs("   ", "q")).toThrow(/--project/);
  });

  it("rejects an empty or whitespace-only question", () => {
    expect(() => validateRequiredInputs("/proj", "")).toThrow(/question/);
    expect(() => validateRequiredInputs("/proj", "   ")).toThrow(/question/);
  });

  it("returns the project when both are non-empty", () => {
    expect(validateRequiredInputs("/proj", "who is our top customer?")).toBe("/proj");
  });
});

describe("resolveAuthChoice default policy (no --mode)", () => {
  it("prefers api-key when --adapter is given", async () => {
    const flags: CliFlags = { adapter: "anthropic", apiKey: "sk-test", model: "claude-x" };
    await expect(resolveAuthChoice(flags, probe({ claude: true }))).resolves.toEqual({
      mode: "api-key",
      adapter: "anthropic",
      config: { apiKey: "sk-test", model: "claude-x" },
    });
  });

  it("prefers local when --endpoint is given (and no --adapter)", async () => {
    const flags: CliFlags = { endpoint: "http://localhost:11434/v1" };
    await expect(resolveAuthChoice(flags, probe({ claude: true }))).resolves.toEqual({
      mode: "local",
      endpoint: "http://localhost:11434/v1",
    });
  });

  it("falls back to a detected subscription (claude before codex) when nothing is configured", async () => {
    await expect(resolveAuthChoice({}, probe({ claude: true, codex: true }))).resolves.toEqual({
      mode: "subscription",
      provider: "claude",
    });
    await expect(resolveAuthChoice({}, probe({ codex: true }))).resolves.toEqual({
      mode: "subscription",
      provider: "codex",
    });
  });

  it("loud-fails when nothing is configured and no subscription is detected", async () => {
    await expect(resolveAuthChoice({}, NONE)).rejects.toThrow(CliUsageError);
    await expect(resolveAuthChoice({}, NONE)).rejects.toThrow(/pass --mode explicitly/);
  });

  it("loud-fails on --api-key without --adapter or an explicit --mode, even with a subscription detected", async () => {
    const flags: CliFlags = { apiKey: "sk-test" };
    await expect(resolveAuthChoice(flags, probe({ claude: true }))).rejects.toThrow(CliUsageError);
    await expect(resolveAuthChoice(flags, probe({ claude: true }))).rejects.toThrow(
      /--api-key\/--model given without --adapter/,
    );
  });

  it("loud-fails on --model without --adapter or an explicit --mode, even with a subscription detected", async () => {
    const flags: CliFlags = { model: "claude-x" };
    await expect(resolveAuthChoice(flags, probe({ claude: true }))).rejects.toThrow(
      /--api-key\/--model given without --adapter/,
    );
  });

  it("--api-key together with --adapter still resolves to api-key mode (unaffected)", async () => {
    const flags: CliFlags = { adapter: "anthropic", apiKey: "sk-test" };
    await expect(resolveAuthChoice(flags, probe({ claude: true }))).resolves.toEqual({
      mode: "api-key",
      adapter: "anthropic",
      config: { apiKey: "sk-test" },
    });
  });

  it("--api-key together with an explicit --mode still honors that mode (unaffected)", async () => {
    const flags: CliFlags = { apiKey: "sk-test", mode: "gateway", endpoint: "http://gw/v1", model: "m" };
    await expect(resolveAuthChoice(flags, probe({ claude: true }))).resolves.toEqual({
      mode: "gateway",
      config: { baseURL: "http://gw/v1", model: "m", apiKey: "sk-test" },
    });
  });
});

describe("buildExplicitAuthChoice", () => {
  it("subscription defaults provider to claude and rejects unknown providers", () => {
    expect(buildExplicitAuthChoice("subscription", {})).toEqual({ mode: "subscription", provider: "claude" });
    expect(buildExplicitAuthChoice("subscription", { provider: "codex" })).toEqual({
      mode: "subscription",
      provider: "codex",
    });
    expect(() => buildExplicitAuthChoice("subscription", { provider: "gemini" })).toThrow(/claude.*codex/);
  });

  it("api-key requires --adapter", () => {
    expect(() => buildExplicitAuthChoice("api-key", {})).toThrow(/requires --adapter/);
    expect(buildExplicitAuthChoice("api-key", { adapter: "anthropic" })).toEqual({
      mode: "api-key",
      adapter: "anthropic",
    });
  });

  it("local carries endpoint only when set", () => {
    expect(buildExplicitAuthChoice("local", {})).toEqual({ mode: "local" });
    expect(buildExplicitAuthChoice("local", { endpoint: "http://host/v1" })).toEqual({
      mode: "local",
      endpoint: "http://host/v1",
    });
  });

  it("gateway builds config from endpoint/model/api-key", () => {
    expect(buildExplicitAuthChoice("gateway", { endpoint: "http://gw/v1", model: "m" })).toEqual({
      mode: "gateway",
      config: { baseURL: "http://gw/v1", model: "m" },
    });
    expect(buildExplicitAuthChoice("gateway", {})).toEqual({ mode: "gateway" });
  });

  it("rejects an unknown mode", () => {
    expect(() => buildExplicitAuthChoice("nope", {})).toThrow(/subscription\|api-key\|local\|gateway/);
  });
});

describe("config builders", () => {
  it("buildApiKeyConfig returns undefined when neither api-key nor model is set", () => {
    expect(buildApiKeyConfig({})).toBeUndefined();
    expect(buildApiKeyConfig({ model: "m" })).toEqual({ model: "m" });
  });

  it("buildGatewayConfig maps endpoint to baseURL, or undefined when nothing set", () => {
    expect(buildGatewayConfig({})).toBeUndefined();
    expect(buildGatewayConfig({ endpoint: "http://gw/v1", model: "m", apiKey: "k" })).toEqual({
      baseURL: "http://gw/v1",
      model: "m",
      apiKey: "k",
    });
  });
});

describe("resolveDeployment", () => {
  it("defaults to personal when --deployment is omitted", () => {
    expect(resolveDeployment({})).toBe("personal");
  });

  it("accepts personal and hosted", () => {
    expect(resolveDeployment({ deployment: "personal" })).toBe("personal");
    expect(resolveDeployment({ deployment: "hosted" })).toBe("hosted");
  });

  it("rejects an unknown value", () => {
    expect(() => resolveDeployment({ deployment: "cloud" })).toThrow(CliUsageError);
    expect(() => resolveDeployment({ deployment: "cloud" })).toThrow(/--deployment must be "personal" or "hosted"/);
  });
});

describe("CLI-level compliance wiring (resolveDeployment + enforceCompliance composed, as cli.ts does)", () => {
  it("--deployment hosted --mode subscription: rejects with a clean, actionable error", () => {
    const flags: CliFlags = { mode: "subscription", deployment: "hosted" };
    const authChoice = buildExplicitAuthChoice(flags.mode ?? "", flags);
    const deployment = resolveDeployment(flags);
    expect(() => enforceCompliance(authChoice, { deployment })).toThrow(ComplianceError);
    expect(() => enforceCompliance(authChoice, { deployment })).toThrow(/personal-use only/);
  });

  it("--deployment personal (default) --mode subscription: allowed with a ToS warning", () => {
    const flags: CliFlags = { mode: "subscription" };
    const authChoice = buildExplicitAuthChoice(flags.mode ?? "", flags);
    const deployment = resolveDeployment(flags);
    const { warnings } = enforceCompliance(authChoice, { deployment });
    expect(warnings).toHaveLength(1);
  });

  it("--deployment hosted --mode api-key: allowed, no warning", () => {
    const flags: CliFlags = { mode: "api-key", adapter: "anthropic", deployment: "hosted" };
    const authChoice = buildExplicitAuthChoice(flags.mode ?? "", flags);
    const deployment = resolveDeployment(flags);
    const { warnings } = enforceCompliance(authChoice, { deployment });
    expect(warnings).toEqual([]);
  });
});

describe("gateway loud-fail (deriveAdapterSpec)", () => {
  it("throws a clear error naming both missing fields when config is empty", () => {
    expect(() => deriveAdapterSpec({ mode: "gateway" })).toThrow(/gateway mode requires baseURL and model/);
  });

  it("names only the missing field", () => {
    expect(() => deriveAdapterSpec({ mode: "gateway", config: { baseURL: "http://gw/v1" } })).toThrow(
      /requires model in config/,
    );
    expect(() => deriveAdapterSpec({ mode: "gateway", config: { model: "m" } })).toThrow(
      /requires baseURL in config/,
    );
  });

  it("rejects whitespace-only values as missing", () => {
    expect(() => deriveAdapterSpec({ mode: "gateway", config: { baseURL: "  ", model: "  " } })).toThrow(
      /baseURL and model/,
    );
  });

  it("passes through a complete config", () => {
    expect(deriveAdapterSpec({ mode: "gateway", config: { baseURL: "http://gw/v1", model: "m" } })).toEqual({
      adapter: "openai-compatible",
      config: { baseURL: "http://gw/v1", model: "m" },
    });
  });
});

describe("hybrid: parseTierAdapterFlag", () => {
  it("parses a bare <tier>=<mode> entry with no fields", () => {
    expect(parseTierAdapterFlag("cheap=local")).toEqual({ tier: "cheap", mode: "local", fields: {} });
  });

  it("parses fields after the mode, in key=value,key=value form", () => {
    expect(parseTierAdapterFlag("strong=api-key:adapter=anthropic,model=claude-opus-4-6")).toEqual({
      tier: "strong",
      mode: "api-key",
      fields: { adapter: "anthropic", model: "claude-opus-4-6" },
    });
  });

  it("rejects a missing tier or mode separator", () => {
    expect(() => parseTierAdapterFlag("no-equals-sign")).toThrow(CliUsageError);
    expect(() => parseTierAdapterFlag("=local")).toThrow(CliUsageError);
  });

  it("rejects subscription as a per-tier mode (a hybrid tier has no subscription adapter)", () => {
    expect(() => parseTierAdapterFlag("cheap=subscription")).toThrow(/api-key\|local\|gateway/);
  });

  it("rejects an unknown field name", () => {
    expect(() => parseTierAdapterFlag("cheap=local:bogus=x")).toThrow(/unknown field "bogus"/);
  });

  it("rejects a malformed field (no =value)", () => {
    expect(() => parseTierAdapterFlag("cheap=local:endpointonly")).toThrow(/malformed field/);
  });
});

describe("hybrid: buildTierBindingFromFlags", () => {
  it("builds an AdapterSpec per tier, reusing buildExplicitAuthChoice + deriveAdapterSpec", () => {
    const tiers = buildTierBindingFromFlags([
      "cheap=local:endpoint=http://localhost:11434/v1,model=llama3.1",
      "strong=api-key:adapter=anthropic,model=claude-opus-4-6",
    ]);

    expect(tiers).toEqual({
      cheap: {
        adapter: "openai-compatible",
        config: { baseURL: "http://localhost:11434/v1", model: "llama3.1" },
      },
      strong: { adapter: "anthropic", config: { model: "claude-opus-4-6" } },
    });
  });

  it("returns an empty map for an empty flag list", () => {
    expect(buildTierBindingFromFlags([])).toEqual({});
  });

  it("loud-fails on a duplicate tier name", () => {
    expect(() => buildTierBindingFromFlags(["cheap=local", "cheap=api-key:adapter=anthropic"])).toThrow(
      /names tier "cheap" more than once/,
    );
  });

  it("rewraps a delegated validation error (e.g. api-key without --adapter) as a CliUsageError", () => {
    expect(() => buildTierBindingFromFlags(["cheap=api-key"])).toThrow(CliUsageError);
    expect(() => buildTierBindingFromFlags(["cheap=api-key"])).toThrow(/requires --adapter/);
  });

  it("rewraps a gateway loud-fail (missing baseURL/model) as a CliUsageError", () => {
    expect(() => buildTierBindingFromFlags(["cheap=gateway"])).toThrow(CliUsageError);
    expect(() => buildTierBindingFromFlags(["cheap=gateway"])).toThrow(/gateway mode requires baseURL and model/);
  });
});

describe("determineExitCode (refusal exit-code contract)", () => {
  it("maps a in-process refusal to EXIT_REFUSAL (2), not EXIT_OK", () => {
    const refusal: RouteResult = {
      backend: "agent",
      warnings: [],
      kind: "refusal",
      reason: "gated_check not satisfied",
      envelope: { blocks: [] },
    };
    expect(determineExitCode(refusal)).toBe(EXIT_REFUSAL);
    expect(EXIT_REFUSAL).toBe(2);
  });

  it("maps a in-process answer to EXIT_OK (0)", () => {
    const answer: RouteResult = {
      backend: "agent",
      warnings: [],
      kind: "answer",
      envelope: { blocks: [] },
    };
    expect(determineExitCode(answer)).toBe(EXIT_OK);
    expect(EXIT_OK).toBe(0);
  });

  it("maps a dispatched result (no `kind` field at all) to EXIT_OK — dispatched has no refusal state", () => {
    const dispatchedResult: RouteResult = {
      backend: "agent-sdk",
      warnings: [],
      finalText: "Acme is the top customer by revenue.",
    };
    expect(determineExitCode(dispatchedResult)).toBe(EXIT_OK);
  });

  it("a subscription ToS warning on the result does not affect the exit code either way", () => {
    const withWarning: RouteResult = {
      backend: "agent-sdk",
      warnings: ["some ToS warning"],
      finalText: "ok",
    };
    expect(determineExitCode(withWarning)).toBe(EXIT_OK);
  });
});

describe("parseChatTimeoutMs", () => {
  it("returns undefined when the flag/env is absent", () => {
    expect(parseChatTimeoutMs(undefined)).toBeUndefined();
  });

  it("parses a positive integer of milliseconds", () => {
    expect(parseChatTimeoutMs("600000")).toBe(600000);
    expect(parseChatTimeoutMs("  120000  ")).toBe(120000);
  });

  it("rejects non-positive, non-integer, or garbage values", () => {
    for (const bad of ["0", "-5", "5.5", "abc", "NaN", "Infinity", ""]) {
      expect(() => parseChatTimeoutMs(bad)).toThrow(CliUsageError);
    }
  });
});

describe("parseSetupMaxTurns", () => {
  it("returns undefined when the env is absent (setup runner default applies)", () => {
    expect(parseSetupMaxTurns(undefined)).toBeUndefined();
  });

  it("parses a positive integer", () => {
    expect(parseSetupMaxTurns("120")).toBe(120);
    expect(parseSetupMaxTurns("  250  ")).toBe(250);
  });

  it("rejects non-positive, non-integer, hex/exponent, or garbage values", () => {
    for (const bad of ["0", "-5", "5.5", "abc", "NaN", "Infinity", "", "0x10", "1e3"]) {
      expect(() => parseSetupMaxTurns(bad)).toThrow(CliUsageError);
    }
  });
});
