#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const request = args[2] ?? "";
const componentIndex = args.indexOf("--component");
const component = componentIndex >= 0 ? args[componentIndex + 1] : "answer_query";
const capture = process.env.GENBI_FAKE_CODEX_ASK_CAPTURE;
if (capture) {
  writeFileSync(capture, JSON.stringify({
    args,
    billingEnvPresent: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY),
  }));
}

if (request === "hang") {
  setInterval(() => {}, 1_000);
} else if (request === "malformed") {
  process.stdout.write("not-json\n");
} else if (request === "partial") {
  process.stdout.write(`${JSON.stringify({ t: "session_started", session: { target: "codex:local", threadId: "parent" } })}\n`);
  process.stdout.write(`${JSON.stringify({ t: "turn_started", turn: { threadId: "parent", turnId: "turn", status: "in_progress" } })}\n`);
} else if (request === "child-failed") {
  process.stdout.write(`${JSON.stringify({ t: "session_started", session: { target: "codex:local", threadId: "parent" } })}\n`);
  process.stdout.write(`${JSON.stringify({ t: "session_failed", threadId: "parent", reason: "protocol_violation" })}\n`);
} else if (component === "generate_dashboard") {
  const degraded = request === "dashboard-degraded";
  const noRender = request === "dashboard-no-render";
  const wrongModel = request === "dashboard-wrong-model";
  const wrongTool = request === "dashboard-wrong-tool";
  const answerMismatch = request === "dashboard-answer-mismatch";
  const overlap = request === "dashboard-overlap";
  const missingPlanEvidence = request === "dashboard-missing-plan-evidence";
  const failedEvidenceSuccessfulStep = request === "dashboard-failed-evidence-successful-step";
  const contentMissingPanel = request === "dashboard-content-missing-panel";
  const contentMissingDefinition = request === "dashboard-content-missing-definition";
  const protocolBadVersion = request === "dashboard-protocol-bad-version";
  const envelope = degraded
    ? { blocks: [], summary: "degraded dashboard", verified: false }
    : contentMissingPanel
      ? {
          blocks: [
            { type: "definition", sql: "SELECT order_id, amount FROM orders", source_tables: ["orders"], filters: [] },
          ],
          summary: "content-only dashboard: missing panel",
          verified: true,
        }
      : contentMissingDefinition
        ? {
            blocks: [
              { type: "kpi_card", label: "Orders", value: 42, unit: "orders" },
            ],
            summary: "content-only dashboard: missing definition",
            verified: true,
          }
        : {
        blocks: [
          { type: "kpi_card", label: "Orders", value: 42, unit: "orders" },
          { type: "chart", chart_type: "bar", x: "order_id", series: ["amount"], rows: [{ order_id: 1, amount: 10 }] },
          { type: "table", columns: ["order_id", "amount"], rows: [{ order_id: 1, amount: 10 }] },
          { type: "definition", sql: "SELECT order_id, amount FROM orders", source_tables: ["orders"], filters: [] },
        ],
        summary: "Orders dashboard",
        verified: !answerMismatch,
      };
  const malformedBlock = {
    "dashboard-malformed-kpi": { type: "kpi_card", label: "Orders", value: [] },
    "dashboard-malformed-chart": { type: "chart", chart_type: "radar", x: "order_id", series: [1], rows: [] },
    "dashboard-malformed-table": { type: "table", columns: [1], rows: [[]] },
    "dashboard-malformed-definition": { type: "definition", sql: 42, source_tables: "orders", filters: [] },
  }[request];
  if (malformedBlock) {
    const index = envelope.blocks.findIndex((block) => block.type === malformedBlock.type);
    envelope.blocks[index] = malformedBlock;
  }
  const events = [
    { t: "session_started", session: { target: "codex:local", threadId: "parent" } },
    { t: "turn_started", turn: { threadId: "parent", turnId: "turn", status: "in_progress" } },
    { t: "agent_started", parentThreadId: "parent", parentTurnId: "turn", step: "plan_dashboard", agentRole: "warble_plan_dashboard", agentThreadId: "plan", model: wrongModel ? "cheap-model" : "strong-model" },
    ...(overlap ? [{ t: "agent_started", parentThreadId: "parent", parentTurnId: "turn", step: "compose_layout", agentRole: "warble_compose_layout", agentThreadId: "compose", model: "cheap-model" }] : []),
    ...(!missingPlanEvidence ? [{ t: "artifact", reference: { parentThreadId: "parent", parentTurnId: "turn", step: "plan_dashboard", agentRole: "warble_plan_dashboard", agentThreadId: "plan", itemId: "context-1", server: "wren", tool: wrongTool ? "run_sql" : "get_context", ok: true } }] : []),
    { t: "step_finished", parentThreadId: "parent", parentTurnId: "turn", step: "plan_dashboard", agentRole: "warble_plan_dashboard", agentThreadId: "plan", ok: true },
    ...(!overlap ? [{ t: "agent_started", parentThreadId: "parent", parentTurnId: "turn", step: "compose_layout", agentRole: "warble_compose_layout", agentThreadId: "compose", model: "cheap-model" }] : []),
    { t: "artifact", reference: { parentThreadId: "parent", parentTurnId: "turn", step: "compose_layout", agentRole: "warble_compose_layout", agentThreadId: "compose", itemId: "sql-1", server: "wren", tool: "run_sql", ok: !failedEvidenceSuccessfulStep } },
    { t: "step_finished", parentThreadId: "parent", parentTurnId: "turn", step: "compose_layout", agentRole: "warble_compose_layout", agentThreadId: "compose", ok: true },
    ...(noRender
      ? []
      : degraded
        ? [{ t: "render_degraded", parentThreadId: "parent", parentTurnId: "turn", reason: "invalid_render_envelope" }]
        : [{
            t: "render_artifact",
            reference: {
              version: protocolBadVersion ? "0.2" : "0.1",
              kind: "render_envelope",
              parentThreadId: "parent",
              parentTurnId: "turn",
              step: "compose_layout",
              agentRole: "warble_compose_layout",
              agentThreadId: "compose",
              verified: true,
              blockTypes: contentMissingPanel
                ? ["definition"]
                : contentMissingDefinition
                  ? ["kpi_card"]
                  : ["kpi_card", "chart", "table", "definition"],
            },
          }]),
    { t: "turn_completed", turn: { threadId: "parent", turnId: "turn", status: "completed" } },
    { t: "answer", text: JSON.stringify(envelope) },
  ];
  for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
} else {
  const repair = request === "repair";
  const events = [
    { t: "session_started", session: { target: "codex:local", threadId: "parent" } },
    { t: "turn_started", turn: { threadId: "parent", turnId: "turn", status: "in_progress" } },
    { t: "agent_started", parentThreadId: "parent", parentTurnId: "turn", step: "resolve_intent", agentRole: "warble_resolve_intent", agentThreadId: "resolve", model: "cheap-model" },
    { t: "step_finished", parentThreadId: "parent", parentTurnId: "turn", step: "resolve_intent", agentRole: "warble_resolve_intent", agentThreadId: "resolve", ok: true },
    { t: "agent_started", parentThreadId: "parent", parentTurnId: "turn", step: "generate_sql", agentRole: "warble_generate_sql", agentThreadId: "generate", model: "strong-model" },
    { t: "artifact", reference: { parentThreadId: "parent", parentTurnId: "turn", step: "generate_sql", agentRole: "warble_generate_sql", agentThreadId: "generate", itemId: "sql-1", server: "wren", tool: "run_sql", ok: !repair } },
    { t: "step_finished", parentThreadId: "parent", parentTurnId: "turn", step: "generate_sql", agentRole: "warble_generate_sql", agentThreadId: "generate", ok: !repair },
    ...(repair ? [
      { t: "agent_started", parentThreadId: "parent", parentTurnId: "turn", step: "repair_sql", agentRole: "warble_repair_sql", agentThreadId: "repair", model: "strong-model" },
      { t: "artifact", reference: { parentThreadId: "parent", parentTurnId: "turn", step: "repair_sql", agentRole: "warble_repair_sql", agentThreadId: "repair", itemId: "sql-2", server: "wren", tool: "run_sql", ok: true } },
      { t: "step_finished", parentThreadId: "parent", parentTurnId: "turn", step: "repair_sql", agentRole: "warble_repair_sql", agentThreadId: "repair", ok: true },
    ] : []),
    { t: "turn_completed", turn: { threadId: "parent", turnId: "turn", status: "completed" } },
    { t: "answer", text: JSON.stringify({ columns: ["orders"], rows: [[42]], verified: true }) },
  ];
  for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
}
