/**
 * Integration tests for the wren-core-wasm TypeScript wrapper.
 *
 * These tests load the actual WASM binary and exercise the full SDK API.
 * Run with: `npm test` (or `node --test sdk/tests/index.test.mjs`)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../../dist");
const wasmBytes = readFileSync(resolve(distDir, "wren_core_wasm_bg.wasm"));

/** Dynamic import of the built SDK (must exist in dist/) */
const { WrenEngine } = await import(resolve(distDir, "index.js"));

// =========================================================================
// Helpers
// =========================================================================

function minimalMDL(modelName, physicalTable) {
  return {
    catalog: "wren",
    schema: "public",
    models: [
      {
        name: modelName,
        tableReference: { table: physicalTable },
        columns: [
          { name: "id", type: "INTEGER" },
          { name: "amount", type: "DOUBLE" },
        ],
        primaryKey: "id",
      },
    ],
    relationships: [],
    metrics: [],
    views: [],
  };
}

// =========================================================================
// WrenEngine.init
// =========================================================================

describe("WrenEngine.init", () => {
  it("creates an engine instance from WASM bytes", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    assert.ok(engine, "engine should be truthy");
    assert.equal(typeof engine.query, "function");
    assert.equal(typeof engine.loadMDL, "function");
    assert.equal(typeof engine.registerJson, "function");
    assert.equal(typeof engine.registerParquet, "function");
    assert.equal(typeof engine.free, "function");
    engine.free();
  });

  it("creates multiple independent engine instances", async () => {
    const engine1 = await WrenEngine.init({ wasmUrl: wasmBytes });
    const engine2 = await WrenEngine.init({ wasmUrl: wasmBytes });

    await engine1.registerJson("t1", [{ v: 10 }]);
    await engine2.registerJson("t2", [{ v: 20 }]);

    // engine1 cannot see engine2's tables and vice versa
    const rows1 = await engine1.query("SELECT v FROM t1");
    assert.deepEqual(rows1, [{ v: 10 }]);

    await assert.rejects(
      () => engine1.query("SELECT v FROM t2"),
      /table.*not found|does not exist|t2/i,
      "engine1 should not see engine2's table"
    );

    engine1.free();
    engine2.free();
  });
});

// =========================================================================
// registerJson + query
// =========================================================================

describe("registerJson + query", () => {
  it("registers JSON data and returns parsed records", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await engine.registerJson("users", [
      { id: 1, name: "Alice", amount: 100.0 },
      { id: 2, name: "Bob", amount: 200.0 },
      { id: 3, name: "Charlie", amount: 150.0 },
    ]);

    const rows = await engine.query(
      "SELECT count(*) as cnt, sum(amount) as total FROM users"
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].cnt, 3);
    assert.equal(rows[0].total, 450.0);
    engine.free();
  });

  it("handles empty result set", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await engine.registerJson("items", [{ id: 1, val: 10 }]);

    const rows = await engine.query("SELECT * FROM items WHERE id = 999");
    assert.ok(Array.isArray(rows), "result should be an array");
    assert.equal(rows.length, 0);
    engine.free();
  });

  it("preserves column types (int, float, string)", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await engine.registerJson("typed", [
      { int_col: 42, float_col: 3.14, str_col: "hello" },
    ]);

    const rows = await engine.query("SELECT * FROM typed");
    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0].int_col, "number");
    assert.equal(typeof rows[0].float_col, "number");
    assert.equal(typeof rows[0].str_col, "string");
    assert.equal(rows[0].int_col, 42);
    assert.ok(Math.abs(rows[0].float_col - 3.14) < 0.001);
    assert.equal(rows[0].str_col, "hello");
    engine.free();
  });

  it("supports aggregation queries", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    const data = [];
    for (let i = 1; i <= 100; i++) {
      data.push({ id: i, group: i % 3 === 0 ? "A" : "B", value: i * 10 });
    }
    await engine.registerJson("large", data);

    const rows = await engine.query(
      'SELECT "group", count(*) as cnt, sum(value) as total FROM large GROUP BY "group" ORDER BY "group"'
    );

    assert.equal(rows.length, 2);
    assert.equal(rows[0].group, "A");
    assert.equal(rows[1].group, "B");
    assert.equal(rows[0].cnt + rows[1].cnt, 100);
    engine.free();
  });
});

// =========================================================================
// loadMDL (semantic layer)
// =========================================================================

describe("loadMDL", () => {
  it("loads MDL and queries via model name (local mode)", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await engine.registerJson("orders", [
      { id: 1, amount: 50.0 },
      { id: 2, amount: 75.0 },
    ]);

    const mdl = minimalMDL("Orders", "orders");
    await engine.loadMDL(mdl, { source: "./data/" });

    const rows = await engine.query(
      'SELECT sum(amount) AS total FROM "Orders"'
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total, 125.0);
    engine.free();
  });

  it("loads MDL with fallback mode (empty source)", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await engine.registerJson("customers", [
      { id: 1, amount: 100.0 },
      { id: 2, amount: 50.0 },
    ]);

    const mdl = minimalMDL("Customers", "customers");
    await engine.loadMDL(mdl, { source: "" });

    const rows = await engine.query(
      'SELECT count(*) AS cnt FROM "Customers"'
    );
    assert.equal(rows[0].cnt, 2);
    engine.free();
  });

  it("rejects MDL with missing tables in local mode", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    const mdl = {
      catalog: "wren",
      schema: "public",
      models: [
        {
          name: "Ghost",
          tableReference: { table: "nonexistent" },
          columns: [{ name: "id", type: "INTEGER" }],
        },
      ],
      relationships: [],
      metrics: [],
      views: [],
    };

    await assert.rejects(
      () => engine.loadMDL(mdl, { source: "./local/" }),
      /Unresolved models.*nonexistent/,
      "should report unresolved models"
    );
    engine.free();
  });

  it("rejects invalid MDL JSON structure", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await assert.rejects(
      () => engine.loadMDL({ not: "a valid MDL" }, { source: "" }),
      /Failed to parse MDL|missing field/i,
      "should reject invalid MDL"
    );
    engine.free();
  });
});

// =========================================================================
// query error handling
// =========================================================================

describe("query error handling", () => {
  it("rejects invalid SQL syntax", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await assert.rejects(
      () => engine.query("SELEKT * FORM nothing"),
      /SQL error|syntax/i,
      "should reject invalid SQL"
    );
    engine.free();
  });

  it("rejects query on non-existent table", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });

    await assert.rejects(
      () => engine.query("SELECT * FROM does_not_exist"),
      /not found|does not exist|does_not_exist/i,
      "should reject query on missing table"
    );
    engine.free();
  });
});

// =========================================================================
// registerParquet
// =========================================================================

describe("registerParquet", () => {
  // Minimal valid Parquet file with one row: { "x": 1 } (int32, no compression).
  // Generated by: pyarrow.parquet.write_table(pa.table({"x": pa.array([1], pa.int32())}), buf, compression="NONE")
  // prettier-ignore
  const MINIMAL_PARQUET = new Uint8Array([
    0x50, 0x41, 0x52, 0x31, 0x15, 0x04, 0x15, 0x08, 0x15, 0x08, 0x4c, 0x15,
    0x02, 0x15, 0x00, 0x12, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x15, 0x00,
    0x15, 0x12, 0x15, 0x12, 0x2c, 0x15, 0x02, 0x15, 0x10, 0x15, 0x06, 0x15,
    0x06, 0x1c, 0x18, 0x04, 0x01, 0x00, 0x00, 0x00, 0x18, 0x04, 0x01, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x28, 0x04, 0x01, 0x00, 0x00, 0x00, 0x18, 0x04,
    0x01, 0x00, 0x00, 0x00, 0x11, 0x11, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00,
    0x00, 0x02, 0x01, 0x01, 0x02, 0x00, 0x15, 0x04, 0x19, 0x2c, 0x35, 0x00,
    0x18, 0x06, 0x73, 0x63, 0x68, 0x65, 0x6d, 0x61, 0x15, 0x02, 0x00, 0x15,
    0x02, 0x25, 0x02, 0x18, 0x01, 0x78, 0x00, 0x16, 0x02, 0x19, 0x1c, 0x19,
    0x1c, 0x26, 0x00, 0x1c, 0x15, 0x02, 0x19, 0x35, 0x00, 0x06, 0x10, 0x19,
    0x18, 0x01, 0x78, 0x15, 0x00, 0x16, 0x02, 0x16, 0x94, 0x01, 0x16, 0x94,
    0x01, 0x26, 0x2c, 0x26, 0x08, 0x1c, 0x18, 0x04, 0x01, 0x00, 0x00, 0x00,
    0x18, 0x04, 0x01, 0x00, 0x00, 0x00, 0x16, 0x00, 0x28, 0x04, 0x01, 0x00,
    0x00, 0x00, 0x18, 0x04, 0x01, 0x00, 0x00, 0x00, 0x11, 0x11, 0x00, 0x19,
    0x2c, 0x15, 0x04, 0x15, 0x00, 0x15, 0x02, 0x00, 0x15, 0x00, 0x15, 0x10,
    0x15, 0x02, 0x00, 0x3c, 0x29, 0x06, 0x19, 0x26, 0x00, 0x02, 0x00, 0x00,
    0x00, 0x16, 0x94, 0x01, 0x16, 0x02, 0x26, 0x08, 0x16, 0x94, 0x01, 0x00,
    0x19, 0x1c, 0x18, 0x0c, 0x41, 0x52, 0x52, 0x4f, 0x57, 0x3a, 0x73, 0x63,
    0x68, 0x65, 0x6d, 0x61, 0x18, 0xac, 0x01, 0x2f, 0x2f, 0x2f, 0x2f, 0x2f,
    0x33, 0x67, 0x41, 0x41, 0x41, 0x41, 0x51, 0x41, 0x41, 0x41, 0x41, 0x41,
    0x41, 0x41, 0x4b, 0x41, 0x41, 0x77, 0x41, 0x42, 0x67, 0x41, 0x46, 0x41,
    0x41, 0x67, 0x41, 0x43, 0x67, 0x41, 0x41, 0x41, 0x41, 0x41, 0x42, 0x42,
    0x41, 0x41, 0x4d, 0x41, 0x41, 0x41, 0x41, 0x43, 0x41, 0x41, 0x49, 0x41,
    0x41, 0x41, 0x41, 0x42, 0x41, 0x41, 0x49, 0x41, 0x41, 0x41, 0x41, 0x42,
    0x41, 0x41, 0x41, 0x41, 0x41, 0x45, 0x41, 0x41, 0x41, 0x41, 0x55, 0x41,
    0x41, 0x41, 0x41, 0x45, 0x41, 0x41, 0x55, 0x41, 0x41, 0x67, 0x41, 0x42,
    0x67, 0x41, 0x48, 0x41, 0x41, 0x77, 0x41, 0x41, 0x41, 0x41, 0x51, 0x41,
    0x42, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x45, 0x43, 0x45,
    0x41, 0x41, 0x41, 0x41, 0x42, 0x77, 0x41, 0x41, 0x41, 0x41, 0x45, 0x41,
    0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x45, 0x41, 0x41,
    0x41, 0x42, 0x34, 0x41, 0x41, 0x41, 0x41, 0x43, 0x41, 0x41, 0x4d, 0x41,
    0x41, 0x67, 0x41, 0x42, 0x77, 0x41, 0x49, 0x41, 0x41, 0x41, 0x41, 0x41,
    0x41, 0x41, 0x41, 0x41, 0x53, 0x41, 0x41, 0x41, 0x41, 0x41, 0x3d, 0x00,
    0x18, 0x20, 0x70, 0x61, 0x72, 0x71, 0x75, 0x65, 0x74, 0x2d, 0x63, 0x70,
    0x70, 0x2d, 0x61, 0x72, 0x72, 0x6f, 0x77, 0x20, 0x76, 0x65, 0x72, 0x73,
    0x69, 0x6f, 0x6e, 0x20, 0x32, 0x33, 0x2e, 0x30, 0x2e, 0x31, 0x19, 0x1c,
    0x1c, 0x00, 0x00, 0x00, 0x66, 0x01, 0x00, 0x00, 0x50, 0x41, 0x52, 0x31,
  ]);

  it("registers Parquet from ArrayBuffer and queries", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    await engine.registerParquet("pq", MINIMAL_PARQUET.buffer);

    const rows = await engine.query("SELECT x FROM pq");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].x, 1);
    engine.free();
  });
});

// =========================================================================
// free
// =========================================================================

describe("free", () => {
  it("can be called without error", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    engine.free();
    // No assertion needed — just verify it doesn't throw
  });
});

// =========================================================================
// cubeQuery + listCubes
// =========================================================================

function cubeMDL() {
  return {
    catalog: "wren",
    schema: "public",
    models: [
      {
        name: "orders",
        tableReference: { table: "orders" },
        columns: [
          { name: "amount", type: "DOUBLE" },
          { name: "status", type: "VARCHAR" },
        ],
      },
    ],
    relationships: [],
    metrics: [],
    views: [],
    cubes: [
      {
        name: "order_metrics",
        baseObject: "orders",
        measures: [
          { name: "total", expression: "SUM(amount)", type: "DOUBLE" },
          { name: "order_count", expression: "COUNT(*)", type: "BIGINT" },
        ],
        dimensions: [
          { name: "status", expression: "status", type: "VARCHAR" },
        ],
        timeDimensions: [],
        hierarchies: {},
      },
    ],
  };
}

describe("cubeQuery + listCubes", () => {
  it("listCubes returns cubes from the loaded MDL", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    await engine.registerJson("orders", [{ amount: 10, status: "open" }]);
    await engine.loadMDL(cubeMDL(), { source: "" });

    const cubes = engine.listCubes();
    assert.equal(cubes.length, 1);
    assert.equal(cubes[0].name, "order_metrics");
    assert.equal(cubes[0].baseObject, "orders");
    assert.equal(cubes[0].measures.length, 2);
    assert.equal(cubes[0].measures[0].name, "total");
    assert.equal(cubes[0].dimensions[0].name, "status");
    engine.free();
  });

  it("cubeQuery aggregates by dimension", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    await engine.registerJson("orders", [
      { amount: 10, status: "open" },
      { amount: 25, status: "open" },
      { amount: 7, status: "closed" },
    ]);
    await engine.loadMDL(cubeMDL(), { source: "" });

    const rows = await engine.cubeQuery({
      cube: "order_metrics",
      measures: ["total", "order_count"],
      dimensions: ["status"],
    });

    assert.equal(rows.length, 2);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r]));
    assert.equal(byStatus.open.total, 35);
    assert.equal(byStatus.open.order_count, 2);
    assert.equal(byStatus.closed.total, 7);
    assert.equal(byStatus.closed.order_count, 1);
    engine.free();
  });

  it("cubeQuery rejects an unknown cube", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    await engine.registerJson("orders", [{ amount: 10, status: "open" }]);
    await engine.loadMDL(cubeMDL(), { source: "" });

    await assert.rejects(
      () => engine.cubeQuery({ cube: "nonexistent", measures: ["total"] }),
      /not found/i,
    );
    engine.free();
  });

  it("cubeQuery without loadMDL fails clearly", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    await assert.rejects(
      () => engine.cubeQuery({ cube: "order_metrics", measures: ["total"] }),
      /No MDL loaded/i,
    );
    engine.free();
  });

  it("listCubes without loadMDL fails clearly", async () => {
    const engine = await WrenEngine.init({ wasmUrl: wasmBytes });
    assert.throws(
      () => engine.listCubes(),
      /No MDL loaded/i,
    );
    engine.free();
  });
});
