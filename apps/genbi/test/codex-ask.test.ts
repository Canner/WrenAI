import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../harness/events/index.js";
import { buildCodexAskArgs, runCodexAskDefault } from "../harness/route/codex-ask.js";
import type { CodexAskOptions } from "../harness/route/types.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "fake-codex-ask-dispatcher.mjs");
const scratch: string[] = [];

afterEach(() => {
  delete process.env.GENBI_FAKE_CODEX_ASK_CAPTURE;
  delete process.env.OPENAI_API_KEY;
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temp(label: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), `genbi-codex-ask-${label}-`));
  scratch.push(directory);
  return directory;
}

function options(
  question: string,
  onEvent?: (event: AgentEvent) => void,
  agentId?: string,
): CodexAskOptions {
  const directory = temp("run");
  const irPath = path.join(directory, "ir.json");
  writeFileSync(irPath, "{}");
  return {
    authChoice: { mode: "subscription", provider: "codex" },
    profileSource: "/unused/profile",
    userProject: directory,
    question,
    irPath,
    codexHome: temp("home"),
    codexModels: { orchestrator: "driver-model", cheap: "cheap-model", strong: "strong-model" },
    codexLocalCli: { command: process.execPath, prefixArgs: [FIXTURE] },
    mcpServer: { command: "/usr/bin/true", prefixArgs: [] },
    timeoutMs: 250,
    ...(onEvent ? { onEvent } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

describe("Codex Ask CLI contract", () => {
  it("fails before compile or spawn when session home or tier models are missing", async () => {
    const { codexHome: _home, ...withoutHome } = options("success");
    await expect(runCodexAskDefault(withoutHome)).rejects.toThrow(
      /WREN_HARNESS_CODEX_HOME/,
    );
    const { codexModels: _models, ...withoutModels } = options("success");
    await expect(runCodexAskDefault(withoutModels)).rejects.toThrow(
      /orchestrator, cheap, and strong/,
    );
  });

  it("builds exact tier, project, session-home, and Wren MCP bindings", () => {
    const args = buildCodexAskArgs(
      { command: "warble-codex-local", prefixArgs: [] },
      {
        irPath: "/tmp/ir.json",
        question: "top customers",
        userProject: "/tmp/project",
        codexHome: "/tmp/codex-home",
        models: { orchestrator: "driver", cheap: "cheap", strong: "strong" },
        mcpServer: { command: "/opt/wren", prefixArgs: [] },
        timeoutMs: 123,
      },
    );
    expect(args).toEqual([
      "dispatch", "/tmp/ir.json", "top customers",
      "--component", "answer_query", "--project", "/tmp/project",
      "--codex-home", "/tmp/codex-home",
      "--orchestrator-model", "driver", "--cheap-model", "cheap", "--strong-model", "strong",
      "--server", "wren", "--server-command", "/opt/wren",
      "--server-arg", "serve", "--server-arg", "mcp", "--server-arg=--project",
      "--server-arg", "/tmp/project", "--server-arg=--quiet",
      "--inspect-tool", "get_context", "--query-tool", "run_sql",
      "--timeout", "123", "--stream-json",
    ]);
  });

  it("binds the routed dashboard component without changing dispatcher identity", () => {
    const args = buildCodexAskArgs(
      { command: "warble-codex-local", prefixArgs: [] },
      {
        irPath: "/tmp/ir.json",
        question: "build a dashboard",
        userProject: "/tmp/project",
        codexHome: "/tmp/codex-home",
        models: { orchestrator: "driver", cheap: "cheap", strong: "strong" },
        mcpServer: { command: "/opt/wren", prefixArgs: [] },
        timeoutMs: 123,
        component: "generate_dashboard",
      },
    );
    expect(args.slice(0, 6)).toEqual([
      "dispatch", "/tmp/ir.json", "build a dashboard",
      "--component", "generate_dashboard", "--project",
    ]);
  });

  it("streams ordered cheap/strong steps, skips repair on success, and returns the answer", async () => {
    const events: AgentEvent[] = [];
    const capture = path.join(temp("capture"), "capture.json");
    process.env.GENBI_FAKE_CODEX_ASK_CAPTURE = capture;
    process.env.OPENAI_API_KEY = "must-not-leak";
    const result = await runCodexAskDefault(options("success", (event) => events.push(event)));
    expect(JSON.parse(result.finalText)).toEqual({ columns: ["orders"], rows: [[42]], verified: true });
    expect(events.filter((event) => event.kind === "step.start").map((event) =>
      event.kind === "step.start" ? [event.name, event.tier] : [])).toEqual([
      ["resolve_intent", "cheap"],
      ["generate_sql", "strong"],
    ]);
    expect(events.some((event) => event.kind === "step.start" && event.name === "repair_sql")).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: "run.finish", status: "answer" });
    expect(JSON.parse(readFileSync(capture, "utf8"))).toMatchObject({ billingEnvPresent: false });
  });

  it("runs one strong repair after generation failure", async () => {
    const events: AgentEvent[] = [];
    await runCodexAskDefault(options("repair", (event) => events.push(event)));
    expect(events.filter((event) => event.kind === "step.start").map((event) =>
      event.kind === "step.start" ? [event.name, event.tier] : [])).toEqual([
      ["resolve_intent", "cheap"],
      ["generate_sql", "strong"],
      ["repair_sql", "strong"],
    ]);
  });

  it("streams the strong/cheap dashboard graph and returns its render envelope", async () => {
    const events: AgentEvent[] = [];
    const capture = path.join(temp("dashboard-capture"), "capture.json");
    process.env.GENBI_FAKE_CODEX_ASK_CAPTURE = capture;
    const result = await runCodexAskDefault(
      options("dashboard-success", (event) => events.push(event), "generate_dashboard"),
    );
    expect(JSON.parse(result.finalText)).toMatchObject({
      summary: "Orders dashboard",
      verified: true,
      blocks: [
        { type: "kpi_card" },
        { type: "chart" },
        { type: "table" },
        { type: "definition" },
      ],
    });
    expect(events.filter((event) => event.kind === "step.start").map((event) =>
      event.kind === "step.start" ? [event.name, event.tier] : [])).toEqual([
      ["plan_dashboard", "strong"],
      ["compose_layout", "cheap"],
    ]);
    expect(events.filter((event) => event.kind === "tool.call").map((event) =>
      event.kind === "tool.call" ? event.tool : "")).toEqual([
      "wren.get_context",
      "wren.run_sql",
    ]);
    expect(JSON.parse(readFileSync(capture, "utf8")).args).toContain("generate_dashboard");
  });

  it("preserves best-effort dashboard render degradation without fallback", async () => {
    const events: AgentEvent[] = [];
    const result = await runCodexAskDefault(
      options("dashboard-degraded", (event) => events.push(event), "generate_dashboard"),
    );
    expect(result.finalText).toBe("degraded dashboard");
    expect(events.filter((event) => event.kind === "step.start")).toHaveLength(2);
    expect(events.some((event) => event.kind === "error")).toBe(false);
  });

  it("degrades a dashboard render artifact that is short a data panel or a definition, same as today's render_degraded", async () => {
    // decision-56: genbi host owns the "at least one data panel + one
    // definition" content guarantee now that warble-codex-local no longer
    // enforces it. Before (dashboard-degraded, above) and after (these two
    // scenarios simulate a target that no longer rejects short content)
    // must produce the same user-visible outcome: terminal answer retained,
    // no artifact exposed, and the Ask request does not fail.
    for (const request of ["dashboard-content-missing-panel", "dashboard-content-missing-definition"]) {
      const events: AgentEvent[] = [];
      const result = await runCodexAskDefault(
        options(request, (event) => events.push(event), "generate_dashboard"),
      );
      expect(result.finalText).toBe(
        request === "dashboard-content-missing-panel"
          ? "content-only dashboard: missing panel"
          : "content-only dashboard: missing definition",
      );
      expect(events.filter((event) => event.kind === "step.start")).toHaveLength(2);
      expect(events.some((event) => event.kind === "error")).toBe(false);
    }
  });

  it("still loud-fails a protocol violation on the render artifact even when its content is complete", async () => {
    await expect(
      runCodexAskDefault(options("dashboard-protocol-bad-version", undefined, "generate_dashboard")),
    ).rejects.toThrow(/invalid dashboard render artifact/);
  });

  it("dashboard mapping loud-fails wrong models, tools, and missing render state", async () => {
    await expect(
      runCodexAskDefault(options("dashboard-wrong-model", undefined, "generate_dashboard")),
    ).rejects.toThrow(/wrong model/);
    await expect(
      runCodexAskDefault(options("dashboard-wrong-tool", undefined, "generate_dashboard")),
    ).rejects.toThrow(/allowed Wren MCP surface/);
    await expect(
      runCodexAskDefault(options("dashboard-no-render", undefined, "generate_dashboard")),
    ).rejects.toThrow(/required dashboard steps and render contract/);
    await expect(
      runCodexAskDefault(options("dashboard-answer-mismatch", undefined, "generate_dashboard")),
    ).rejects.toThrow(/answer did not match its render artifact/);
    await expect(
      runCodexAskDefault(options("dashboard-overlap", undefined, "generate_dashboard")),
    ).rejects.toThrow(/agent order or attribution/);
    await expect(
      runCodexAskDefault(options("child-failed", undefined, "generate_dashboard")),
    ).rejects.toThrow(/session failed/);
    await expect(
      runCodexAskDefault(options("partial", undefined, "generate_dashboard")),
    ).rejects.toThrow(/partial lifecycle/);
  });

  it("requires successful MCP evidence for every dashboard step", async () => {
    await expect(
      runCodexAskDefault(options("dashboard-missing-plan-evidence", undefined, "generate_dashboard")),
    ).rejects.toThrow(/without required Wren MCP evidence/);
    await expect(
      runCodexAskDefault(options("dashboard-failed-evidence-successful-step", undefined, "generate_dashboard")),
    ).rejects.toThrow(/outcome contradicted its Wren MCP evidence/);
  });

  it.each([
    "dashboard-malformed-kpi",
    "dashboard-malformed-chart",
    "dashboard-malformed-table",
    "dashboard-malformed-definition",
  ])("rejects rich dashboard blocks with malformed fields: %s", async (request) => {
    await expect(
      runCodexAskDefault(options(request, undefined, "generate_dashboard")),
    ).rejects.toThrow(/answer did not match its render artifact/);
  });

  it("dashboard timeout and cancellation terminate without another backend", async () => {
    const timed = {
      ...options("hang", undefined, "generate_dashboard"),
      timeoutMs: 20,
      processTimeoutMs: 30,
    };
    await expect(runCodexAskDefault(timed)).rejects.toThrow(/timed out/);
    const controller = new AbortController();
    const cancelled = runCodexAskDefault({
      ...options("hang", undefined, "generate_dashboard"),
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/);
  });

  it("rejects unsupported Codex components before compile or spawn", async () => {
    await expect(runCodexAskDefault(options("success", undefined, "explore_model"))).rejects.toThrow(
      /does not support the "explore_model" component/,
    );
  });

  it("loud-fails malformed output, timeout, and cancellation without fallback", async () => {
    await expect(runCodexAskDefault(options("malformed"))).rejects.toThrow(/non-JSON/);
    await expect(runCodexAskDefault(options("partial"))).rejects.toThrow(/partial lifecycle/);
    await expect(runCodexAskDefault(options("child-failed"))).rejects.toThrow(/protocol_violation/);
    const timed = { ...options("hang"), timeoutMs: 20, processTimeoutMs: 30 };
    await expect(runCodexAskDefault(timed)).rejects.toThrow(/timed out/);
    const controller = new AbortController();
    const cancelled = runCodexAskDefault({ ...options("hang"), signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/);
  });
});
