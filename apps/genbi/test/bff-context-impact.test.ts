import { describe, expect, it } from "vitest";
import type { WrenContextShow } from "../server/context-source.js";
import { computeImpact, EntityKeyNotFoundError } from "../server/impact.js";

/**
 * `computeImpact` now walks a real `wren context show`-shaped
 * relationship/cube graph instead of a seeded `Store` fixture. This small
 * graph deliberately mirrors the old seeded shape (customers/orders/products)
 * so the "structural vs. compatibility vs. none" severity heuristic is
 * exercised across all three outcomes, plus the not-found path.
 */
const fixture: WrenContextShow = {
  models: [
    { name: "customers", primaryKey: "id", columns: [{ name: "id", type: "bigint" }, { name: "name", type: "text" }] },
    {
      name: "orders",
      primaryKey: "id",
      columns: [
        { name: "id", type: "bigint" },
        { name: "customer_id", type: "bigint" },
        { name: "amount", type: "numeric" },
      ],
    },
    { name: "products", primaryKey: "id", columns: [{ name: "id", type: "bigint" }, { name: "name", type: "text" }] },
    { name: "warehouses", primaryKey: "id", columns: [{ name: "id", type: "bigint" }] },
  ],
  relationships: [
    { name: "orders_customers", models: ["orders", "customers"], joinType: "MANY_TO_ONE", condition: "orders.customer_id = customers.id" },
  ],
  cubes: [
    {
      name: "order_metrics",
      baseObject: "orders",
      measures: [
        { name: "total_revenue", expression: "SUM(orders.amount)" },
        { name: "avg_order_value", expression: "AVG(orders.amount)" },
      ],
    },
    {
      name: "product_metrics",
      baseObject: "products",
      measures: [{ name: "units_sold", expression: "COUNT(*)" }],
    },
  ],
};

describe("computeImpact (live relationship/cube graph)", () => {
  it("a model with relationships is structural, downstream includes the joined model, the relationship, and its own measures", () => {
    const impact = computeImpact(fixture, "customers");
    expect(impact.blastRadius.severity).toBe("structural");
    expect(impact.blastRadius.downstream.map((n) => n.key).sort()).toEqual(["orders", "orders_customers"]);
    expect(impact.brokenPairs).toEqual([]);
  });

  it("orders' downstream also picks up its own cube's measures alongside the relationship/model", () => {
    const impact = computeImpact(fixture, "orders");
    expect(impact.blastRadius.severity).toBe("structural");
    expect(impact.blastRadius.downstream.map((n) => n.key).sort()).toEqual([
      "customers",
      "order_metrics.avg_order_value",
      "order_metrics.total_revenue",
      "orders_customers",
    ]);
  });

  it("a model with no relationships but a measure base is compatibility, not structural", () => {
    const impact = computeImpact(fixture, "products");
    expect(impact.blastRadius.severity).toBe("compatibility");
    expect(impact.blastRadius.downstream.map((n) => n.key)).toEqual(["product_metrics.units_sold"]);
  });

  it("a model with no relationships and no measures has no downstream and severity none", () => {
    const impact = computeImpact(fixture, "warehouses");
    expect(impact.blastRadius.severity).toBe("none");
    expect(impact.blastRadius.downstream).toEqual([]);
  });

  it("a relationship's downstream is the two models it joins", () => {
    const impact = computeImpact(fixture, "orders_customers");
    expect(impact.blastRadius.downstream.map((n) => n.key).sort()).toEqual(["customers", "orders"]);
  });

  it("a measure's downstream is its cube's base model", () => {
    const impact = computeImpact(fixture, "order_metrics.total_revenue");
    expect(impact.blastRadius.downstream.map((n) => n.key)).toEqual(["orders"]);
  });

  it("throws EntityKeyNotFoundError for a key matching no model, relationship, or measure", () => {
    expect(() => computeImpact(fixture, "nonexistent")).toThrow(EntityKeyNotFoundError);
  });
});
