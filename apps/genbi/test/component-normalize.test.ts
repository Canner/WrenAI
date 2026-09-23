import { describe, expect, it } from "vitest";
import { normalizeComponentEvidence } from "../harness/components/normalize.js";
import type { ComponentPlan } from "../harness/components/runner.js";

const definition = { sql: "SELECT n FROM orders WHERE n > 0", source_tables: ["orders"], filters: ["n > 0"] };
function normalize(block: Record<string, unknown>) {
  const component: ComponentPlan = { id: "dashboard", declaration: {
    required_capabilities: ["component_invocation"], effect: { render_blocks: [
      { type: "kpi_card", fields: { label: "string", value: "number|string", unit: "string?", delta: "number?" } },
      { type: "table", fields: { columns: "string[]", rows: "row[]" } },
      { type: "definition", fields: { sql: "string", source_tables: "string[]", filters: "string[]" } },
    ] },
  }, steps: [{ name: "layout", tier: "strong", prompt: "", consumes: [], produces: "result", tools: [], calls: [{ alias: "answer", component: "answer" }] }] };
  return normalizeComponentEvidence(component, { steps: { result: JSON.stringify({ blocks: [block] }) }, tools: [],
    children: [{ status: "ok", output: { kind: "value", value: { columns: ["n"], rows: [{ n: 7 }] } }, provenance: { verified: true, definition } }],
  });
}
describe("observed render provenance", () => {
  it("accepts only the observed KPI column and value", () => {
    expect(normalize({ type: "kpi_card", label: "n", value: 7 }).status).toBe("ok");
    for (const patch of [{ label: "invented" }, { value: 8 }, { unit: "USD" }, { delta: 2 }]) {
      expect(normalize({ type: "kpi_card", label: "n", value: 7, ...patch }).status).toBe("refused");
    }
  });
  it("requires the SQL, source tables and filters to match observed definitions", () => {
    expect(normalize({ type: "definition", ...definition }).status).toBe("ok");
    for (const patch of [{ sql: "SELECT invented" }, { source_tables: ["private"] }, { filters: [] }]) {
      expect(normalize({ type: "definition", ...definition, ...patch }).status).toBe("refused");
    }
  });
  it("rejects fabricated columns, empty rows and invented values", () => {
    expect(normalize({ type: "table", columns: ["n"], rows: [[7]] }).status).toBe("ok");
    for (const rows of [[], [{}], [[8]], [[7, 9]]]) expect(normalize({ type: "table", columns: ["n"], rows }).status).not.toBe("ok");
  });
});
