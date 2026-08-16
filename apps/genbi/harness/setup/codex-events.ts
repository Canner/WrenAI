import { readFileSync } from "node:fs";
import type { AgentEventInput } from "../events/index.js";

type CodexSetupEvent =
  | { t: "step_start"; id: string; name: string }
  | { t: "tool_call"; id: string; name: string }
  | { t: "tool_result"; id: string; ok: boolean; error?: string }
  | { t: "answer"; text: string }
  | { t: "step_finish"; id: string; ok: boolean; detail?: string };

export class CodexSetupEventMapper {
  private readonly tools = new Map<string, { stepId: string; name: string }>();
  private activeStep = "";
  private finalText: string | undefined;
  private traceCursor = 0;

  constructor(private readonly tracePath?: string) {}

  nextLine(line: string): AgentEventInput | undefined {
    let event: CodexSetupEvent;
    try {
      event = JSON.parse(line) as CodexSetupEvent;
    } catch {
      throw new Error("warble-codex-local emitted non-JSON output");
    }
    switch (event.t) {
      case "step_start":
        this.activeStep = event.id;
        return { kind: "step.start", stepId: event.id, name: event.name, tier: "strong", depth: 0 };
      case "tool_call":
        if (!this.activeStep) throw new Error("Codex tool call arrived before step start");
        this.tools.set(event.id, { stepId: this.activeStep, name: event.name });
        return {
          kind: "tool.call",
          stepId: this.activeStep,
          callId: event.id,
          tool: event.name,
          depth: 0,
          status: "running",
        };
      case "tool_result": {
        const tool = this.tools.get(event.id);
        if (!tool) throw new Error("Codex tool result arrived without a matching call");
        this.tools.delete(event.id);
        const trace = this.nextTraceRecord();
        return {
          kind: "tool.result",
          stepId: tool.stepId,
          callId: event.id,
          tool: tool.name,
          status: event.ok ? "success" : "error",
          ...(trace ? { input: trace.input } : {}),
          ...(event.ok && trace ? { summary: trace.detail } : {}),
          ...(event.error ? { error: event.error } : {}),
        };
      }
      case "answer":
        this.finalText = event.text;
        return { kind: "answer", text: event.text };
      case "step_finish":
        return {
          kind: "step.finish",
          stepId: event.id,
          name: event.id,
          status: event.ok ? "ok" : "error",
          ...(event.detail ? { detail: event.detail } : {}),
        };
      default:
        throw new Error("warble-codex-local emitted an unknown event");
    }
  }

  result(): string {
    if (this.tools.size > 0) throw new Error("warble-codex-local ended with an unfinished tool call");
    if (this.finalText === undefined || this.finalText.trim().length === 0) {
      throw new Error("warble-codex-local ended without a final answer");
    }
    return this.finalText;
  }

  private nextTraceRecord(): CodexSetupTraceRecord | undefined {
    if (!this.tracePath) return undefined;
    const lines = readFileSync(this.tracePath, "utf8").split("\n").filter((line) => line.trim().length > 0);
    const line = lines[this.traceCursor];
    if (line === undefined) throw new Error("Codex setup MCP completed without a matching bridge trace record");
    this.traceCursor += 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("Codex setup MCP wrote an invalid bridge trace record");
    }
    if (!isTraceRecord(value)) throw new Error("Codex setup MCP wrote a malformed bridge trace record");
    return value;
  }
}

interface CodexSetupTraceRecord {
  readonly input: {
    readonly action: "exec" | "write";
    readonly command?: string;
    readonly cwd?: string;
    readonly path?: string;
  };
  readonly detail: string;
}

function isTraceRecord(value: unknown): value is CodexSetupTraceRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record["detail"] !== "string") return false;
  const input = record["input"];
  if (typeof input !== "object" || input === null) return false;
  const fields = input as Record<string, unknown>;
  if (fields["action"] !== "exec" && fields["action"] !== "write") return false;
  return ["command", "cwd", "path"].every((key) => fields[key] === undefined || typeof fields[key] === "string");
}
