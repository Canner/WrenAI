import { describe, expect, it } from "vitest";
import { inferAdditivity, mapCubesToMeasures, mapContextShowToOverview, mapModelsToWire, mapRelationshipsToWire } from "../server/context-map.js";
import type { WrenContextCube, WrenContextModel, WrenContextRelationship } from "../server/context-source.js";

const customers: WrenContextModel = {
  name: "customers",
  primaryKey: "id",
  columns: [
    { name: "id", type: "INTEGER" },
    { name: "name", type: "VARCHAR" },
  ],
};

const orders: WrenContextModel = {
  name: "orders",
  primaryKey: "id",
  columns: [
    { name: "id", type: "INTEGER" },
    { name: "customer_id", type: "INTEGER" },
    { name: "amount", type: "DOUBLE" },
  ],
};

const relationships: readonly WrenContextRelationship[] = [
  { name: "orders_customers", models: ["orders", "customers"], joinType: "MANY_TO_ONE", condition: "orders.customer_id = customers.id" },
];

describe("mapModelsToWire (pk/fk inference)", () => {
  it("marks the model's primaryKey column pk", () => {
    const [wireCustomers] = mapModelsToWire([customers], relationships);
    expect(wireCustomers!.columns.find((c) => c.name === "id")?.key).toBe("pk");
  });

  it("marks a column fk when a relationship condition references <model>.<column>", () => {
    const [wireOrders] = mapModelsToWire([orders], relationships);
    expect(wireOrders!.columns.find((c) => c.name === "customer_id")?.key).toBe("fk");
  });

  it("leaves an unrelated column with no key", () => {
    const [wireOrders] = mapModelsToWire([orders], relationships);
    expect(wireOrders!.columns.find((c) => c.name === "amount")?.key).toBeUndefined();
  });

  it("omits position entirely (no ER layout source)", () => {
    const [wireCustomers] = mapModelsToWire([customers], relationships);
    expect(wireCustomers).not.toHaveProperty("position");
  });

  it("prefers pk over a coincidental fk-shaped match on the same column", () => {
    const selfReferential: WrenContextModel = { name: "employees", primaryKey: "id", columns: [{ name: "id", type: "INTEGER" }] };
    const selfRel: WrenContextRelationship = { name: "employees_manager", models: ["employees", "employees"], joinType: "MANY_TO_ONE", condition: "employees.id = employees.id" };
    const [wireEmployees] = mapModelsToWire([selfReferential], [selfRel]);
    expect(wireEmployees!.columns[0]!.key).toBe("pk");
  });

  it("does not fk-match across a model whose name is a suffix of another (boundary-anchored)", () => {
    // A condition referencing `old_customer.id` must NOT mark `customer.id` as fk.
    const customer: WrenContextModel = { name: "customer", columns: [{ name: "id", type: "INTEGER" }] };
    const rel: WrenContextRelationship = { name: "r", models: ["orders", "old_customer"], joinType: "MANY_TO_ONE", condition: "orders.old_customer_ref = old_customer.id" };
    const [wireCustomer] = mapModelsToWire([customer], [rel]);
    expect(wireCustomer!.columns[0]!.key).toBeUndefined();
  });

  it("does not fk-match a column that is a prefix of another (boundary-anchored)", () => {
    // A condition referencing `x.identifier` must NOT mark `x.id` as fk.
    const model: WrenContextModel = { name: "x", columns: [{ name: "id", type: "INTEGER" }] };
    const rel: WrenContextRelationship = { name: "r", models: ["y", "x"], joinType: "MANY_TO_ONE", condition: "y.ref = x.identifier" };
    const [wireX] = mapModelsToWire([model], [rel]);
    expect(wireX!.columns[0]!.key).toBeUndefined();
  });
});

describe("mapRelationshipsToWire", () => {
  it("maps the unordered models pair to fromModel/toModel and normalizes the upper-snake joinType", () => {
    const [wire] = mapRelationshipsToWire(relationships);
    expect(wire).toEqual({ key: "orders_customers", name: "orders_customers", fromModel: "orders", toModel: "customers", type: "many-to-one" });
  });

  it("falls back to one-to-many for an unrecognized joinType rather than throwing", () => {
    const weird: WrenContextRelationship = { name: "weird", models: ["a", "b"], joinType: "SOMETHING_ELSE", condition: "a.x = b.y" };
    const [wire] = mapRelationshipsToWire([weird]);
    expect(wire!.type).toBe("one-to-many");
  });
});

describe("inferAdditivity", () => {
  it("SUM(...) is additive", () => expect(inferAdditivity("SUM(orders.amount)")).toBe("additive"));
  it("COUNT(*) is additive", () => expect(inferAdditivity("COUNT(*)")).toBe("additive"));
  it("AVG(...) is non-additive", () => expect(inferAdditivity("AVG(orders.amount)")).toBe("non-additive"));
  it("a ratio expression is non-additive", () => expect(inferAdditivity("SUM(revenue) / SUM(cost)")).toBe("non-additive"));
});

describe("mapCubesToMeasures", () => {
  const cubes: readonly WrenContextCube[] = [
    {
      name: "order_metrics",
      baseObject: "orders",
      measures: [
        { name: "total_revenue", expression: "SUM(orders.amount)" },
        { name: "avg_order_value", expression: "AVG(orders.amount)" },
      ],
    },
  ];

  it("emits one SemanticMeasure per measure, keyed <cube>.<measure>, carrying expression + baseObject", () => {
    const measures = mapCubesToMeasures(cubes);
    expect(measures).toEqual([
      { key: "order_metrics.total_revenue", name: "total_revenue", baseModel: "orders", expression: "SUM(orders.amount)", additivity: "additive" },
      { key: "order_metrics.avg_order_value", name: "avg_order_value", baseModel: "orders", expression: "AVG(orders.amount)", additivity: "non-additive" },
    ]);
  });
});

describe("mapContextShowToOverview", () => {
  it("assembles models/relationships/measures/knowledge/projectName/projectPath from a full context-show payload", () => {
    const overview = mapContextShowToOverview(
      { models: [customers, orders], relationships: [...relationships], cubes: [], views: [] },
      "driftwood",
      "/tmp/driftwood",
      { instructionsPresent: true, verifiedPairCount: 0 },
    );
    expect(overview.projectName).toBe("driftwood");
    expect(overview.projectPath).toBe("/tmp/driftwood");
    expect(overview.models.map((m) => m.key)).toEqual(["customers", "orders"]);
    expect(overview.relationships).toHaveLength(1);
    expect(overview.measures).toEqual([]);
    expect(overview.knowledge).toEqual({ instructionsPresent: true, verifiedPairCount: 0 });
  });
});
