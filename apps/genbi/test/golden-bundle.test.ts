import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { readFixture } from "./fixtures.js";

describe("loadBundle: golden genbi-default bundle", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

  it("gives typed access to every agent", () => {
    expect(bundle.agents).toHaveLength(4);
    expect(bundle.agents.map((agent) => agent.id)).toEqual([
      "explore_model",
      "answer_query",
      "generate_dashboard",
      "explain_change",
    ]);
  });

  it("resolves answer_query's steps and its repair_fold step", () => {
    const answerQuery = bundle.agents.find((agent) => agent.id === "answer_query");
    expect(answerQuery).toBeDefined();
    expect(answerQuery?.steps).toHaveLength(3);

    const repairSql = answerQuery?.steps.find((step) => step.name === "repair_sql");
    expect(repairSql).toBeDefined();
    expect(repairSql?.realization.kind).toBe("repair_fold");
    expect(repairSql?.realization.fold_into).toBe("generate_sql");
    expect(repairSql?.realization.max_attempts).toBe(1);
    expect(repairSql?.when?.guard).toBe("on_failure");
    expect(repairSql?.when?.target).toBe("generate_sql");
  });

  it("gives typed access to guardrails, tools, capabilities, and output_schema", () => {
    const generateDashboard = bundle.agents.find((agent) => agent.id === "generate_dashboard");
    expect(generateDashboard).toBeDefined();
    expect(generateDashboard?.guardrails.artifact_write).toEqual({
      enforcement: "scoped_write",
      locked: true,
      scope: ".",
    });
    expect(generateDashboard?.tools.map((tool) => tool.name)).toContain("query");
    expect(generateDashboard?.capabilities.map((capability) => capability.capability)).toContain(
      "artifact_write",
    );
    expect(generateDashboard?.output_schema).toHaveProperty("properties");
  });
});
