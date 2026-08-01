import { describe, expect, it } from "vitest";
import { assembleDashboardBlocks, createBuildDashboardTool, createDefaultNativeToolRegistry } from "../harness/tools/native.js";
import { createLocalExecutionEnv, type ExecutionPolicy } from "../harness/exec/index.js";

/**
 * Blocker 1: `build_dashboard` didn't exist as a native tool at
 * all, so `generate_dashboard` (whose `wren.provider.yaml` mapping is
 * `genbi_build -> build_dashboard`, native) always failed tool resolution
 * with `McpToolNotExposedError`. These tests cover the tool's deterministic
 * assembly contract directly (`assembleDashboardBlocks`) and its
 * registration in `createDefaultNativeToolRegistry`.
 */
describe("assembleDashboardBlocks (deterministic panel -> {blocks} assembly)", () => {
  it("assembles kpi_cards, chart, table, and definition into blocks in dashboard order", () => {
    const result = assembleDashboardBlocks({
      kpi_cards: [
        { label: "Total revenue", value: 48231.5, unit: "USD" },
        { label: "New customers", value: 128, delta: 12 },
      ],
      chart: {
        chart_type: "bar",
        x: "month",
        series: ["revenue"],
        rows: [
          { month: "Jan", revenue: 1000 },
          { month: "Feb", revenue: 1500 },
        ],
      },
      table: {
        columns: ["customer", "lifetime_value"],
        rows: [
          { customer: "Acme", lifetime_value: 900 },
          { customer: "Globex", lifetime_value: 700 },
        ],
      },
      definition: {
        sql: "SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY month",
        source_tables: ["orders"],
        filters: [],
      },
      summary: "Revenue trended up through Q1.",
    });

    expect(result.verified).toBe(true);
    expect(result.summary).toBe("Revenue trended up through Q1.");
    expect(result.blocks).toEqual([
      { type: "kpi_card", label: "Total revenue", value: 48231.5, unit: "USD" },
      { type: "kpi_card", label: "New customers", value: 128, delta: 12 },
      {
        type: "chart",
        chart_type: "bar",
        x: "month",
        series: ["revenue"],
        rows: [
          { month: "Jan", revenue: 1000 },
          { month: "Feb", revenue: 1500 },
        ],
      },
      {
        type: "table",
        columns: ["customer", "lifetime_value"],
        rows: [
          { customer: "Acme", lifetime_value: 900 },
          { customer: "Globex", lifetime_value: 700 },
        ],
      },
      {
        type: "definition",
        sql: "SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY month",
        source_tables: ["orders"],
        filters: [],
      },
    ]);
  });

  it("only emits blocks for panels that are present", () => {
    const result = assembleDashboardBlocks({
      kpi_cards: [{ label: "Active users", value: 42 }],
    });

    expect(result.blocks).toEqual([{ type: "kpi_card", label: "Active users", value: 42 }]);
  });

  it("zips positional array rows against the panel's known key order (table columns, chart x+series)", () => {
    const result = assembleDashboardBlocks({
      chart: {
        chart_type: "line",
        x: "day",
        series: ["signups"],
        rows: [["Mon", 5], ["Tue", 9]],
      },
      table: {
        columns: ["id", "name"],
        rows: [[1, "Ada"], [2, "Grace"]],
      },
    });

    expect(result.blocks).toEqual([
      {
        type: "chart",
        chart_type: "line",
        x: "day",
        series: ["signups"],
        rows: [
          { day: "Mon", signups: 5 },
          { day: "Tue", signups: 9 },
        ],
      },
      {
        type: "table",
        columns: ["id", "name"],
        rows: [
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
        ],
      },
    ]);
  });

  it("defaults definition's source_tables/filters to empty arrays when omitted", () => {
    const result = assembleDashboardBlocks({ definition: { sql: "SELECT 1" } });

    expect(result.blocks).toEqual([{ type: "definition", sql: "SELECT 1", source_tables: [], filters: [] }]);
  });

  it("produces an empty blocks array (still verified) when no panels are supplied", () => {
    const result = assembleDashboardBlocks({});
    expect(result).toEqual({ blocks: [], verified: true });
  });
});

describe("createBuildDashboardTool (AI SDK tool wrapper)", () => {
  it("executes deterministically with no side effects, returning the assembled payload", async () => {
    const dashboardTool = createBuildDashboardTool();

    const output = await dashboardTool.execute!(
      { kpi_cards: [{ label: "Orders", value: 10 }] },
      { toolCallId: "call-1", messages: [], context: undefined },
    );

    expect(output).toEqual({ blocks: [{ type: "kpi_card", label: "Orders", value: 10 }], verified: true });
  });

  it("rejects an input that doesn't match the typed panel schema (e.g. an invalid chart_type)", async () => {
    const dashboardTool = createBuildDashboardTool();
    const parsed = dashboardTool.inputSchema as { safeParse?: (value: unknown) => { success: boolean } };
    expect(parsed.safeParse?.({ chart: { chart_type: "not-a-type", x: "a", series: [], rows: [] } }).success).toBe(
      false,
    );
  });
});

describe("createDefaultNativeToolRegistry (build_dashboard registration — blocker 1)", () => {
  it("resolves a `build_dashboard` factory, so generate_dashboard's tool resolution no longer throws", () => {
    const env = createLocalExecutionEnv();
    const policy: ExecutionPolicy = { readOnly: true, artifactWriteScope: "." };
    const registry = createDefaultNativeToolRegistry(env, policy);

    expect(registry.has("build_dashboard")).toBe(true);
    const tool = registry.create("build_dashboard");
    expect(tool.execute).toBeTypeOf("function");
  });
});
