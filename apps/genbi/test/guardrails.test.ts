import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { deriveEnforcement } from "../harness/guardrails/index.js";
import { readFixture } from "./fixtures.js";

describe("deriveEnforcement (guardrail -> enforcement mapping)", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

  function agentPolicy(agentId: string) {
    const agent = bundle.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`fixture is missing agent "${agentId}"`);
    return deriveEnforcement(agent);
  }

  it("explore_model: read-only, no scope, no thresholds", () => {
    expect(agentPolicy("explore_model")).toEqual({ readOnly: true });
  });

  it("answer_query: read-only + row_limit/statement_timeout thresholds, gated_check ignored", () => {
    const policy = agentPolicy("answer_query");
    expect(policy.readOnly).toBe(true);
    expect(policy.rowLimit).toBe(1000);
    expect(policy.statementTimeoutSec).toBe(30);
    expect(policy.artifactWriteScope).toBeUndefined();
    expect(policy.drillDepthLimit).toBeUndefined();
  });

  it("generate_dashboard: read-only data access coexists with a locked scoped_write scope", () => {
    const policy = agentPolicy("generate_dashboard");
    expect(policy.readOnly).toBe(true);
    expect(policy.artifactWriteScope).toBe(".");
    expect(policy.rowLimit).toBeUndefined();
    expect(policy.statementTimeoutSec).toBeUndefined();
    expect(policy.drillDepthLimit).toBeUndefined();
  });

  it("explain_change: read-only + scoped_write + drill_depth_limit, gated_check (additivity_guard) ignored", () => {
    const policy = agentPolicy("explain_change");
    expect(policy.readOnly).toBe(true);
    expect(policy.artifactWriteScope).toBe(".");
    expect(policy.drillDepthLimit).toBe(3);
    expect(policy.rowLimit).toBeUndefined();
    expect(policy.statementTimeoutSec).toBeUndefined();
  });
});
