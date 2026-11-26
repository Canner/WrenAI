import test from "node:test";
import assert from "node:assert/strict";
import {
  runPlannerCase,
  CloudModelPlannerTransport,
  checkOutputContract,
} from "../cloud-model-planner.mjs";

function portFor(tables) {
  let revision = 0;
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      if (name === "capabilities")
        return { capabilities: [], metadata_documents: [] };
      if (name === "open_session") return { session_id: "s", revision: 0 };
      if (name === "close_session") return { status: "closed" };
      if (name === "ask_data") {
        assert.equal(args.request.expected_revision, revision);
        const result = tables[revision++];
        return {
          status: "completed",
          revision,
          result_ref: "r" + revision,
          evidence_ref: "e" + revision,
          result,
        };
      }
      if (name === "get_evidence")
        return {
          result: tables[Number(args.request.evidence_ref.slice(1)) - 1],
          evidence: { checks: {} },
        };
      throw Error(name);
    },
  };
}
const table = (values) => ({
  kind: "table",
  columns: values.map((_, i) => ({ key: "c" + i })),
  rows: [Object.fromEntries(values.map((v, i) => ["c" + i, v]))],
});
const delegate = (columns) => ({
  name: "delegate_data",
  args: {
    request: "Count active products. Return only the count.",
    output_columns: columns,
  },
});
const finish = (ref) => ({
  name: "finish_result",
  args: { result_ref: ref, assessment: "Answers the question" },
});
function script(actions) {
  let i = 0;
  return {
    async decide({ input }) {
      const action = actions[i++];
      assert.ok(action, "script exhausted");
      const call = { ...action, call_id: "call" + i };
      return {
        output: [
          {
            type: "function_call",
            name: call.name,
            arguments: JSON.stringify(call.args),
            call_id: call.call_id,
          },
        ],
        call,
      };
    },
  };
}
const run = (port, actions) =>
  runPlannerCase({
    port,
    planner: script(actions),
    question: "How many products are active?",
  });
test("extra verification column is rejected, corrected result keeps its original evidence", async () => {
  const p = portFor([table([527, "2026-06-30"]), table([527])]);
  const r = await run(p, [
    delegate(["count"]),
    finish("r1"),
    delegate(["count"]),
    finish("r2"),
  ]);
  assert.equal(r.status, "completed");
  assert.equal(r.steps[1].rejected, "output_contract_mismatch");
  assert.equal(r.worker_requests, 2);
  assert.equal(r.selected.response.result_ref, "r2");
  assert.deepEqual(r.selected.response.result, table([527]));
  assert.equal(r.first_completed.response.result.columns.length, 2);
});
test("planner cannot widen frozen contract to fit an extra column", async () => {
  const p = portFor([table([527, "date"]), table([527])]);
  const r = await run(p, [
    delegate(["count"]),
    delegate(["count", "date"]),
    delegate(["count"]),
    finish("r2"),
  ]);
  assert.equal(r.status, "completed");
  assert.equal(r.steps[1].rejected, "output_contract_changed");
  assert.equal(p.calls.filter((c) => c.name === "ask_data").length, 2);
});
test("repeated invalid finishes exhaust existing turn budget without delivering a bad table", async () => {
  const p = portFor([table([527, "date"])]);
  const r = await run(p, [
    delegate(["count"]),
    ...Array.from({ length: 5 }, () => finish("r1")),
  ]);
  assert.equal(r.status, "planner_turn_limit");
  assert.equal(r.selected, undefined);
  assert.equal(p.calls.at(-1).name, "close_session");
});
test("requested two-column grouping passes; checker does not mutate or numerically grade cells", () => {
  const t = table(["Camping", -999]);
  const before = structuredClone(t);
  assert.equal(checkOutputContract(t, ["category", "count"]).pass, true);
  assert.deepEqual(t, before);
});
test("unknown result reference still rejected", async () => {
  const p = portFor([]);
  await assert.rejects(
    run(p, [finish("invented")]),
    /planner_unknown_result_ref/,
  );
  assert.equal(p.calls.at(-1).name, "close_session");
});
test("Responses transport accepts typed contract and rejects malformed contracts", async () => {
  for (const [columns, valid] of [
    [["count"], true],
    [[], false],
    [[""], false],
    ["count", false],
  ]) {
    const t = new CloudModelPlannerTransport({
      apiKey: "offline",
      fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body);
        assert.ok(body.tools[0].parameters.properties.output_columns);
        return Response.json({
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "delegate_data",
              call_id: "c",
              arguments: JSON.stringify({
                request: "Count products",
                output_columns: columns,
              }),
            },
          ],
        });
      },
    });
    const result = t.decide({ input: [], instructions: "test" });
    if (valid)
      assert.deepEqual((await result).call.args.output_columns, ["count"]);
    else await assert.rejects(result, /planner_invalid_arguments/);
  }
});

test("contract repair retains the three-request budget", async () => {
  const p = portFor([
    table([527, "date"]),
    table([527, "date"]),
    table([527, "date"]),
  ]);
  const r = await run(
    p,
    Array.from({ length: 4 }, () => delegate(["count"])),
  );
  assert.equal(r.status, "planner_worker_budget");
  assert.equal(r.worker_requests, 3);
  assert.equal(p.calls.filter((c) => c.name === "ask_data").length, 3);
  assert.equal(r.selected, undefined);
});
test("clarification and denial remain terminal without fabricated continuation", async () => {
  for (const status of ["needs_clarification", "denied"]) {
    const p = portFor([]),
      original = p.call.bind(p);
    p.call = async (name, args) =>
      name === "ask_data"
        ? { status, revision: status === "needs_clarification" ? 1 : 0 }
        : original(name, args);
    const r = await run(p, [delegate(["count"])]);
    assert.equal(r.status, "worker_" + status);
    assert.equal(r.worker_requests, 1);
    assert.equal(p.calls.at(-1).name, "close_session");
  }
});

test("mismatched worker evidence is rejected before a result can finish", async () => {
  const port = portFor([table([527])]);
  const original = port.call.bind(port);
  port.call = async (name, args) =>
    name === "get_evidence"
      ? { result: table([999]), evidence: { checks: {} } }
      : original(name, args);
  await assert.rejects(
    run(port, [delegate(["count"])]),
    /evidence_binding_mismatch/,
  );
  assert.equal(port.calls.at(-1).name, "close_session");
});

test("evidence is checked again at delivery, even for a valid output width", async () => {
  const port = portFor([table([527])]);
  const original = port.call.bind(port);
  let evidenceReads = 0;
  port.call = async (name, args) =>
    name === "get_evidence" && ++evidenceReads === 2
      ? { result: table([999]), evidence: { checks: {} } }
      : original(name, args);
  await assert.rejects(
    run(port, [delegate(["count"]), finish("r1")]),
    /evidence_changed/,
  );
  assert.equal(evidenceReads, 2);
  assert.equal(port.calls.at(-1).name, "close_session");
});

test("transport records usage with strict serial tools and without its credential", async () => {
  const transport = new CloudModelPlannerTransport({
    apiKey: "offline-test-secret",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const payload = JSON.parse(options.body);
      assert.equal(payload.store, false);
      assert.equal(payload.parallel_tool_calls, false);
      assert.ok(payload.tools.every((tool) => tool.strict));
      return Response.json({
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 5 },
        output: [
          {
            type: "function_call",
            name: "delegate_data",
            call_id: "c",
            arguments: JSON.stringify({
              request: "Count products",
              output_columns: ["count"],
            }),
          },
        ],
      });
    },
  });
  await transport.decide({ input: [], instructions: "test" });
  assert.equal(transport.calls[0].usage.input_tokens, 10);
  assert.equal(
    JSON.stringify(transport.calls).includes("offline-test-secret"),
    false,
  );
});

test("provider authorization failure has no retry or credential in call records", async () => {
  let calls = 0;
  const transport = new CloudModelPlannerTransport({
    apiKey: "offline-test-secret",
    fetchImpl: async () => {
      calls++;
      return new Response("offline-test-secret", { status: 401 });
    },
  });
  await assert.rejects(
    transport.decide({ input: [], instructions: "test" }),
    /planner_http_401/,
  );
  assert.equal(calls, 1);
  assert.equal(
    JSON.stringify(transport.calls).includes("offline-test-secret"),
    false,
  );
});
