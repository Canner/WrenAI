import { describe, expect, it } from "vitest";
import { toAnswerOrRefusalEvent } from "../server/fold.js";
import type { AnswerEvent, ToolStep } from "../server/wire-types.js";
import type { RouteResult } from "../harness/index.js";

/**
 * Root cause: `toAnswerOrRefusalEvent` unconditionally emitted
 * `form: "text"`/`verified: false` for Mode B (`backend: "agent-sdk"`)
 * results, never attempting to recover the render envelope the dispatched
 * agent actually produced in its `finalText`. These tests cover the fix:
 * extracting that envelope (via `extractEnvelopeFromText`) into `form:
 * "rich"`, with `verified` coming from whatever the recovered envelope
 * actually carries — plus the flat `{columns, rows}` and MCP
 * `CallToolResult` shapes that must normalize into a `table` block instead
 * of falling back to raw-JSON text.
 */
function agentSdkResult(finalText: string): RouteResult {
  return { backend: "agent-sdk", warnings: [], finalText };
}

describe("toAnswerOrRefusalEvent (Mode B / agent-sdk backend): recovers a render envelope from finalText", () => {
  it("extracts a fenced ```json {blocks} envelope into form: 'rich', with verified from the envelope itself", () => {
    const envelope = {
      blocks: [
        { type: "kpi_card", label: "Revenue", value: 42000 },
        { type: "chart", chartType: "line", data: [] },
      ],
      summary: "Revenue grew 12% month over month.",
      verified: true,
    };
    const finalText = `Here is the dashboard:\n\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\`\n`;

    const event = toAnswerOrRefusalEvent("evt-1", agentSdkResult(finalText)) as AnswerEvent;

    expect(event.kind).toBe("answer");
    expect(event.answer.form).toBe("rich");
    if (event.answer.form !== "rich") throw new Error("expected rich form");
    expect(event.answer.envelope).toEqual(envelope);
    expect(event.answer.envelope.verified).toBe(true);
  });

  it("normalizes answer_query's flat {columns, rows, verified} tool-contract shape into a table block", () => {
    const flat = {
      columns: ["order_month", "total"],
      rows: [
        ["2024-01", 1000],
        ["2024-02", 1500],
      ],
      verified: true,
    };
    const finalText = JSON.stringify(flat);

    const event = toAnswerOrRefusalEvent("evt-2", agentSdkResult(finalText)) as AnswerEvent;

    expect(event.answer.form).toBe("rich");
    if (event.answer.form !== "rich") throw new Error("expected rich form");
    expect(event.answer.envelope.blocks).toEqual([{ type: "table", columns: flat.columns, rows: flat.rows }]);
    expect(event.answer.envelope.verified).toBe(true);
  });

  it("carries a flat shape's definition into a trailing definition block", () => {
    const flat = {
      columns: ["customer_count"],
      rows: [[7508]],
      verified: true,
      definition: { sql: "SELECT COUNT(*) FROM customers", source_tables: ["customers"], filters: [] },
    };

    const event = toAnswerOrRefusalEvent("evt-3", agentSdkResult(JSON.stringify(flat))) as AnswerEvent;

    if (event.answer.form !== "rich") throw new Error("expected rich form");
    expect(event.answer.envelope.blocks).toEqual([
      { type: "table", columns: flat.columns, rows: flat.rows },
      { type: "definition", sql: flat.definition.sql, source_tables: flat.definition.source_tables, filters: flat.definition.filters },
    ]);
  });

  it("unwraps the MCP query tool's real CallToolResult shape ({content:[{type:'text',text}]}), not just a flat {columns,rows}", () => {
    const flat = { columns: ["customer_count"], rows: [[7508]], verified: true };
    const callToolResult = {
      content: [{ type: "text", text: JSON.stringify(flat) }],
      isError: false,
    };

    const event = toAnswerOrRefusalEvent("evt-4", agentSdkResult(JSON.stringify(callToolResult))) as AnswerEvent;

    expect(event.answer.form).toBe("rich");
    if (event.answer.form !== "rich") throw new Error("expected rich form");
    expect(event.answer.envelope.blocks).toEqual([{ type: "table", columns: flat.columns, rows: flat.rows }]);
    expect(event.answer.envelope.verified).toBe(true);
  });

  it("unwraps an MCP CallToolResult's structuredContent field directly", () => {
    const envelope = { blocks: [{ type: "table", columns: ["n"], rows: [[1]] }], verified: true };
    const callToolResult = { content: [{ type: "text", text: "1 row" }], structuredContent: envelope, isError: false };

    const event = toAnswerOrRefusalEvent("evt-5", agentSdkResult(JSON.stringify(callToolResult))) as AnswerEvent;

    if (event.answer.form !== "rich") throw new Error("expected rich form");
    expect(event.answer.envelope).toEqual(envelope);
  });

  it("falls back to form: 'text', verified: false only when no envelope can be recovered at all", () => {
    const finalText = "Sorry, I'm not sure how to answer that — could you rephrase the question?";

    const event = toAnswerOrRefusalEvent("evt-6", agentSdkResult(finalText)) as AnswerEvent;

    expect(event.answer).toEqual({ form: "text", text: finalText, verified: false, dataAnswer: false });
  });

  // Mode B's `answer_query`/`generate_dashboard` components are only granted the SDK's built-in
  // `Bash` tool and run every data-access query through the `wren` CLI's read-path, always shaped
  // `wren -q -o json -s '<SQL>'` (see the warble hub components' generate_sql.md/repair_sql.md/
  // compose_layout.md steps) — a real Mode B worklog never carries the native "query"/
  // "build_dashboard" tool-name labels below, only "Bash". These cases exercise that real shape.

  it("sets dataAnswer: true on the text fallback when the worklog shows a Bash call that ran a query through the wren CLI", () => {
    const finalText = "The query ran but I couldn't render a chart from it.";
    const worklog: ToolStep[] = [
      { id: "call-1", label: "Bash", state: "done", kind: "tool", input: { command: "wren -q -o json -s 'SELECT 1'" } },
    ];

    const event = toAnswerOrRefusalEvent("evt-8", agentSdkResult(finalText), worklog) as AnswerEvent;

    expect(event.answer).toEqual({ form: "text", text: finalText, verified: false, dataAnswer: true });
  });

  it("sets dataAnswer: true on the text fallback when the wren CLI query Bash call failed", () => {
    const finalText = "I wasn't able to finish building that dashboard.";
    const worklog: ToolStep[] = [
      { id: "call-1", label: "Bash", state: "error", kind: "tool", input: { command: "wren -q -o json -s 'SELECT * FROM orders'" } },
    ];

    const event = toAnswerOrRefusalEvent("evt-9", agentSdkResult(finalText), worklog) as AnswerEvent;

    expect(event.answer).toEqual({ form: "text", text: finalText, verified: false, dataAnswer: true });
  });

  it("keeps dataAnswer: false when the worklog only shows wren CLI schema introspection (`wren context show`), not a real query", () => {
    const finalText = "I can help you explore your data model, dashboards, and metrics.";
    const worklog: ToolStep[] = [{ id: "call-1", label: "Bash", state: "done", kind: "tool", input: { command: "wren context show" } }];

    const event = toAnswerOrRefusalEvent("evt-10", agentSdkResult(finalText), worklog) as AnswerEvent;

    expect(event.answer).toEqual({ form: "text", text: finalText, verified: false, dataAnswer: false });
  });

  it("keeps dataAnswer: false when the worklog only shows wren CLI cube introspection (`wren cube list`), not a real query", () => {
    const finalText = "Here are the cubes available in this project.";
    const worklog: ToolStep[] = [{ id: "call-1", label: "Bash", state: "done", kind: "tool", input: { command: "wren cube list" } }];

    const event = toAnswerOrRefusalEvent("evt-11", agentSdkResult(finalText), worklog) as AnswerEvent;

    expect(event.answer).toEqual({ form: "text", text: finalText, verified: false, dataAnswer: false });
  });

  // `attemptedDataAccess` is a general-purpose helper (also correct for a hypothetical Mode A
  // caller) — these cover the native-tool-name branch, even though Mode A's own route() never
  // actually falls through to this text-fallback branch itself (it always returns a rich envelope
  // or a refusal).
  it("sets dataAnswer: true when the worklog shows a Mode A native query/build_dashboard tool-name call", () => {
    const finalText = "The query ran but I couldn't render a chart from it.";
    const worklog: ToolStep[] = [{ id: "call-1", label: "query", state: "done", kind: "tool" }];

    const event = toAnswerOrRefusalEvent("evt-12", agentSdkResult(finalText), worklog) as AnswerEvent;

    expect(event.answer).toEqual({ form: "text", text: finalText, verified: false, dataAnswer: true });
  });

  it("does not treat an envelope with verified: false (or absent) as verified — never forced true either", () => {
    const flat = { columns: ["n"], rows: [[1]] }; // no verified field at all
    const event = toAnswerOrRefusalEvent("evt-7", agentSdkResult(JSON.stringify(flat))) as AnswerEvent;

    if (event.answer.form !== "rich") throw new Error("expected rich form");
    expect(event.answer.envelope.verified).toBeUndefined();
  });
});
