import { describe, expect, it } from "vitest";
import { LiveWorkLog } from "../server/fold.js";
import {
  createChatEventMapperState,
  mapChatEventToAgentEvent,
  parseWarbleChatEventLine,
  type WarbleChatEventLike,
} from "../harness/route/chat-event-mapper.js";

describe("parseWarbleChatEventLine", () => {
  it("parses a step_start line", () => {
    const line = JSON.stringify({ t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 });
    expect(parseWarbleChatEventLine(line)).toEqual({
      t: "step_start",
      id: "answer_query",
      name: "answer_query",
      parent: null,
      depth: 0,
    });
  });

  it("parses a tool_call line, including its input", () => {
    const line = JSON.stringify({
      t: "tool_call",
      id: "tool_1",
      name: "wren_query",
      input: { sql: "select 1" },
      parent: null,
      depth: 0,
    });
    expect(parseWarbleChatEventLine(line)).toEqual({
      t: "tool_call",
      id: "tool_1",
      name: "wren_query",
      input: { sql: "select 1" },
      parent: null,
      depth: 0,
    });
  });

  it("parses a successful tool_result line (summary, no error)", () => {
    const line = JSON.stringify({ t: "tool_result", id: "tool_1", ok: true, summary: "3 rows" });
    expect(parseWarbleChatEventLine(line)).toEqual({ t: "tool_result", id: "tool_1", ok: true, summary: "3 rows" });
  });

  it("parses a failing tool_result line (error, no summary)", () => {
    const line = JSON.stringify({ t: "tool_result", id: "tool_1", ok: false, error: "syntax error" });
    expect(parseWarbleChatEventLine(line)).toEqual({ t: "tool_result", id: "tool_1", ok: false, error: "syntax error" });
  });

  it("parses a step_finish line", () => {
    const line = JSON.stringify({ t: "step_finish", id: "answer_query", ok: true });
    expect(parseWarbleChatEventLine(line)).toEqual({ t: "step_finish", id: "answer_query", ok: true });
  });

  it("parses the terminal answer line", () => {
    const line = JSON.stringify({ t: "answer", text: "Acme is the top customer." });
    expect(parseWarbleChatEventLine(line)).toEqual({ t: "answer", text: "Acme is the top customer." });
  });

  it("returns undefined for a blank line", () => {
    expect(parseWarbleChatEventLine("")).toBeUndefined();
    expect(parseWarbleChatEventLine("   \n")).toBeUndefined();
  });

  it("returns undefined for invalid JSON, rather than throwing", () => {
    expect(() => parseWarbleChatEventLine("{not json")).not.toThrow();
    expect(parseWarbleChatEventLine("{not json")).toBeUndefined();
  });

  it("returns undefined for a recognized 't' with a missing required field", () => {
    expect(parseWarbleChatEventLine(JSON.stringify({ t: "tool_call", id: "tool_1" }))).toBeUndefined();
  });

  it("returns undefined for an unrecognized 't' value", () => {
    expect(parseWarbleChatEventLine(JSON.stringify({ t: "something_new", id: "x" }))).toBeUndefined();
  });

  it("parses a session line with a real session id — the Plan A resume anchor", () => {
    const line = JSON.stringify({ t: "session", id: "sess_abc123" });
    expect(parseWarbleChatEventLine(line)).toEqual({ t: "session", id: "sess_abc123" });
  });

  it("parses a session line with id: null — the dispatcher reported no session id to resume", () => {
    const line = JSON.stringify({ t: "session", id: null });
    expect(parseWarbleChatEventLine(line)).toEqual({ t: "session", id: null });
  });

  it("returns undefined for a session line missing the required 'id' field", () => {
    expect(parseWarbleChatEventLine(JSON.stringify({ t: "session" }))).toBeUndefined();
  });
});

describe("mapChatEventToAgentEvent", () => {
  it("maps step_start to step.start, remembering the step id as the current enclosing step", () => {
    const state = createChatEventMapperState();
    const raw: WarbleChatEventLike = { t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 };

    expect(mapChatEventToAgentEvent(raw, state)).toEqual({
      kind: "step.start",
      stepId: "answer_query",
      name: "answer_query",
      tier: "unknown",
      depth: 0,
    });
    expect(state.currentStepId).toBe("answer_query");
  });

  it("carries a non-null parent through as AgentEvent's optional 'parent' field", () => {
    const state = createChatEventMapperState();
    const raw: WarbleChatEventLike = { t: "tool_call", id: "tool_2", name: "wren_query", parent: "task_1", depth: 1 };

    expect(mapChatEventToAgentEvent(raw, state)).toEqual({
      kind: "tool.call",
      stepId: "tool_2", // no step_start seen yet in this isolated case — defensive fallback to the raw id
      callId: "tool_2",
      tool: "wren_query",
      parent: "task_1",
      depth: 1,
      status: "running",
    });
  });

  it("step_finish looks up the step's name recorded at step_start time", () => {
    const state = createChatEventMapperState();
    mapChatEventToAgentEvent({ t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 }, state);

    expect(mapChatEventToAgentEvent({ t: "step_finish", id: "answer_query", ok: true }, state)).toEqual({
      kind: "step.finish",
      stepId: "answer_query",
      name: "answer_query",
      status: "ok",
    });
  });

  it("step_finish with ok: false and a detail maps to status: error with detail carried through", () => {
    const state = createChatEventMapperState();
    mapChatEventToAgentEvent({ t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 }, state);

    expect(
      mapChatEventToAgentEvent({ t: "step_finish", id: "answer_query", ok: false, detail: "agent run failed" }, state),
    ).toEqual({
      kind: "step.finish",
      stepId: "answer_query",
      name: "answer_query",
      status: "error",
      detail: "agent run failed",
    });
  });

  it("step_finish for a step id never seen at step_start falls back to the raw id as its name", () => {
    const state = createChatEventMapperState();
    expect(mapChatEventToAgentEvent({ t: "step_finish", id: "never_opened", ok: true }, state)).toEqual({
      kind: "step.finish",
      stepId: "never_opened",
      name: "never_opened",
      status: "ok",
    });
  });

  it("tool_call after step_start is nested under the current enclosing step's id", () => {
    const state = createChatEventMapperState();
    mapChatEventToAgentEvent({ t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 }, state);

    expect(
      mapChatEventToAgentEvent(
        { t: "tool_call", id: "tool_1", name: "wren_query", input: { sql: "select 1" }, parent: null, depth: 0 },
        state,
      ),
    ).toEqual({
      kind: "tool.call",
      stepId: "answer_query",
      callId: "tool_1",
      tool: "wren_query",
      input: { sql: "select 1" },
      depth: 0,
      status: "running",
    });
  });

  it("tool_result looks up the tool name recorded at tool_call time and reports success with summary", () => {
    const state = createChatEventMapperState();
    mapChatEventToAgentEvent({ t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 }, state);
    mapChatEventToAgentEvent({ t: "tool_call", id: "tool_1", name: "wren_query", parent: null, depth: 0 }, state);

    expect(mapChatEventToAgentEvent({ t: "tool_result", id: "tool_1", ok: true, summary: "3 rows" }, state)).toEqual({
      kind: "tool.result",
      stepId: "answer_query",
      callId: "tool_1",
      tool: "wren_query",
      status: "success",
      summary: "3 rows",
    });
  });

  it("tool_result with ok: false reports status: error with the error message, no summary", () => {
    const state = createChatEventMapperState();
    mapChatEventToAgentEvent({ t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 }, state);
    mapChatEventToAgentEvent({ t: "tool_call", id: "tool_1", name: "wren_query", parent: null, depth: 0 }, state);

    expect(mapChatEventToAgentEvent({ t: "tool_result", id: "tool_1", ok: false, error: "syntax error" }, state)).toEqual({
      kind: "tool.result",
      stepId: "answer_query",
      callId: "tool_1",
      tool: "wren_query",
      status: "error",
      error: "syntax error",
    });
  });

  it("tool_result for a call id never seen at tool_call falls back to the raw id as its tool name", () => {
    const state = createChatEventMapperState();
    expect(mapChatEventToAgentEvent({ t: "tool_result", id: "never_called", ok: true }, state)).toEqual({
      kind: "tool.result",
      stepId: "never_called",
      callId: "never_called",
      tool: "never_called",
      status: "success",
    });
  });

  it("answer maps to undefined — the caller captures the final text itself, not as an AgentEvent", () => {
    const state = createChatEventMapperState();
    expect(mapChatEventToAgentEvent({ t: "answer", text: "Acme is the top customer." }, state)).toBeUndefined();
  });

  it("session maps to undefined — spawnChat intercepts the resume-session-id line directly, not as an AgentEvent", () => {
    const state = createChatEventMapperState();
    expect(mapChatEventToAgentEvent({ t: "session", id: "sess_abc123" }, state)).toBeUndefined();
    expect(mapChatEventToAgentEvent({ t: "session", id: null }, state)).toBeUndefined();
  });
});

describe("mapped AgentEvents feeding LiveWorkLog produce a correct, expandable ToolStep[] (dispatched <-> in-process parity at the fold layer)", () => {
  it("a full step_start -> tool_call -> tool_result -> step_finish sequence folds to one step + one nested tool", () => {
    const state = createChatEventMapperState();
    const log = new LiveWorkLog();
    const lines: WarbleChatEventLike[] = [
      { t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 },
      { t: "tool_call", id: "tool_1", name: "wren_query", input: { sql: "select 1" }, parent: null, depth: 1 },
      { t: "tool_result", id: "tool_1", ok: true, summary: "1 row" },
      { t: "step_finish", id: "answer_query", ok: true },
    ];

    let snapshot: ReturnType<LiveWorkLog["snapshot"]> = [];
    for (const raw of lines) {
      const mapped = mapChatEventToAgentEvent(raw, state);
      if (mapped !== undefined) {
        const ingested = log.ingest({ ...mapped, runId: "r", seq: 0 } as Parameters<LiveWorkLog["ingest"]>[0]);
        if (ingested !== undefined) snapshot = ingested;
      }
    }

    expect(snapshot).toEqual([
      { id: "answer_query", label: "answer_query", state: "done", kind: "step", depth: 0 },
      {
        id: "tool_1",
        label: "wren_query",
        state: "done",
        kind: "tool",
        depth: 1,
        input: { sql: "select 1" },
        detail: "1 row",
      },
    ]);
  });

  it("an errored tool_result folds the tool step to state: error with the error text as detail", () => {
    const state = createChatEventMapperState();
    const log = new LiveWorkLog();
    const lines: WarbleChatEventLike[] = [
      { t: "step_start", id: "answer_query", name: "answer_query", parent: null, depth: 0 },
      { t: "tool_call", id: "tool_1", name: "wren_query", input: { sql: "select * from bogus" }, parent: null, depth: 1 },
      { t: "tool_result", id: "tool_1", ok: false, error: 'relation "bogus" does not exist' },
      { t: "step_finish", id: "answer_query", ok: false, detail: "agent run failed" },
    ];

    let snapshot: ReturnType<LiveWorkLog["snapshot"]> = [];
    for (const raw of lines) {
      const mapped = mapChatEventToAgentEvent(raw, state);
      if (mapped !== undefined) {
        const ingested = log.ingest({ ...mapped, runId: "r", seq: 0 } as Parameters<LiveWorkLog["ingest"]>[0]);
        if (ingested !== undefined) snapshot = ingested;
      }
    }

    expect(snapshot).toEqual([
      { id: "answer_query", label: "answer_query", state: "error", kind: "step", depth: 0, detail: "agent run failed" },
      {
        id: "tool_1",
        label: "wren_query",
        state: "error",
        kind: "tool",
        depth: 1,
        input: { sql: "select * from bogus" },
        detail: 'relation "bogus" does not exist',
      },
    ]);
  });
});
