import { describe, expect, it } from "vitest";
import { foldTrace, LiveWorkLog } from "../server/fold.js";
import type { AgentEvent, StepTrace } from "../harness/index.js";

/**
 * `foldTrace` (floor path) and `LiveWorkLog` (live path) must both
 * carry a `TraceStep`/`AgentEvent`'s `input`/`detail` (or `summary`/`error`)
 * onto the produced `ToolStep`, so the UI's work log can expand a step to
 * show what a tool call ran and what happened. The collapsed fields
 * (id/label/state/kind/depth) must stay exactly as before.
 */
describe("foldTrace (floor path): carries input/detail onto ToolStep", () => {
  it("carries a success step's input and detail through untouched", () => {
    const trace: StepTrace = {
      steps: [
        {
          id: "call-1",
          tool: "query",
          outcome: "success",
          ordinal: 0,
          input: { sql: "select * from customers" },
          detail: "3 rows",
        },
      ],
    };

    expect(foldTrace(trace)).toEqual([
      { id: "call-1", label: "query", state: "done", kind: "tool", input: { sql: "select * from customers" }, detail: "3 rows" },
    ]);
  });

  it("carries an error step's input and detail (the error message) through untouched", () => {
    const trace: StepTrace = {
      steps: [
        {
          id: "call-1",
          tool: "query",
          outcome: "error",
          ordinal: 0,
          input: { sql: "select * from bogus_table" },
          detail: 'relation "bogus_table" does not exist',
        },
      ],
    };

    expect(foldTrace(trace)).toEqual([
      {
        id: "call-1",
        label: "query",
        state: "error",
        kind: "tool",
        input: { sql: "select * from bogus_table" },
        detail: 'relation "bogus_table" does not exist',
      },
    ]);
  });

  it("omits input/detail entirely when the TraceStep has neither (backward compatible)", () => {
    const trace: StepTrace = { steps: [{ id: "call-1", tool: "query", outcome: "success", ordinal: 0 }] };

    const [step] = foldTrace(trace);
    expect(step).toEqual({ id: "call-1", label: "query", state: "done", kind: "tool" });
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
  });
});

describe("LiveWorkLog (live path): captures input from tool.call and detail from tool.result", () => {
  it("captures input at tool.call time, then success detail (summary) at tool.result time", () => {
    const log = new LiveWorkLog();

    log.ingest({
      kind: "tool.call",
      runId: "r",
      seq: 1,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      input: { sql: "select * from customers" },
      depth: 0,
      status: "running",
    } as AgentEvent);

    let snapshot = log.snapshot();
    expect(snapshot).toEqual([
      { id: "call-1", label: "query", state: "running", kind: "tool", depth: 0, input: { sql: "select * from customers" } },
    ]);

    log.ingest({
      kind: "tool.result",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      status: "success",
      summary: "3 rows",
    } as AgentEvent);

    snapshot = log.snapshot();
    expect(snapshot).toEqual([
      { id: "call-1", label: "query", state: "done", kind: "tool", depth: 0, input: { sql: "select * from customers" }, detail: "3 rows" },
    ]);
  });

  it("captures the error message as detail when tool.result reports status: error", () => {
    const log = new LiveWorkLog();

    log.ingest({
      kind: "tool.call",
      runId: "r",
      seq: 1,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      input: { sql: "select * from bogus_table" },
      depth: 0,
      status: "running",
    } as AgentEvent);

    log.ingest({
      kind: "tool.result",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      status: "error",
      error: 'relation "bogus_table" does not exist',
    } as AgentEvent);

    expect(log.snapshot()).toEqual([
      {
        id: "call-1",
        label: "query",
        state: "error",
        kind: "tool",
        depth: 0,
        input: { sql: "select * from bogus_table" },
        detail: 'relation "bogus_table" does not exist',
      },
    ]);
  });

  it("leaves detail unset when tool.call has no input and tool.result has no summary/error (backward compatible)", () => {
    const log = new LiveWorkLog();

    log.ingest({
      kind: "tool.call",
      runId: "r",
      seq: 1,
      stepId: "s1",
      callId: "call-1",
      tool: "write_artifact",
      depth: 0,
      status: "running",
    } as AgentEvent);

    log.ingest({
      kind: "tool.result",
      runId: "r",
      seq: 2,
      stepId: "s1",
      callId: "call-1",
      tool: "write_artifact",
      status: "success",
    } as AgentEvent);

    const [step] = log.snapshot();
    expect(step).toEqual({ id: "call-1", label: "write_artifact", state: "done", kind: "tool", depth: 0 });
    expect(step).not.toHaveProperty("input");
    expect(step).not.toHaveProperty("detail");
  });

  it("step.start produces kind \"step\" (not \"subagent\" — Mode A has no sub-agent mechanism), and step.finish with no detail leaves it unset", () => {
    const log = new LiveWorkLog();

    log.ingest({ kind: "step.start", runId: "r", seq: 1, stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 } as AgentEvent);
    log.ingest({ kind: "step.finish", runId: "r", seq: 2, stepId: "generate_sql", name: "generate_sql", status: "ok" } as AgentEvent);

    expect(log.snapshot()).toEqual([{ id: "generate_sql", label: "generate_sql", state: "done", kind: "step", depth: 0 }]);
  });

  it("step.finish carries its detail (the step's own reasoning/output) onto the ToolStep", () => {
    const log = new LiveWorkLog();

    log.ingest({ kind: "step.start", runId: "r", seq: 1, stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 } as AgentEvent);
    log.ingest({
      kind: "step.finish",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      name: "generate_sql",
      status: "ok",
      detail: "Top customer by revenue is Acme.",
    } as AgentEvent);

    expect(log.snapshot()).toEqual([
      { id: "generate_sql", label: "generate_sql", state: "done", kind: "step", depth: 0, detail: "Top customer by revenue is Acme." },
    ]);
  });

  it("an errored step.finish's detail (the error description) is carried through too", () => {
    const log = new LiveWorkLog();

    log.ingest({ kind: "step.start", runId: "r", seq: 1, stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 } as AgentEvent);
    log.ingest({
      kind: "step.finish",
      runId: "r",
      seq: 2,
      stepId: "generate_sql",
      name: "generate_sql",
      status: "error",
      detail: "model unavailable",
    } as AgentEvent);

    expect(log.snapshot()).toEqual([
      { id: "generate_sql", label: "generate_sql", state: "error", kind: "step", depth: 0, detail: "model unavailable" },
    ]);
  });
});
