import type { AgentEventInput } from "../events/index.js";
import type { CodexAskComponent, CodexManifestModels } from "./codex-local-manifest.js";

const COMPONENT_STEPS = {
  answer_query: [
    { name: "resolve_intent", tier: "cheap", tool: "get_context" },
    { name: "generate_sql", tier: "strong", tool: "run_sql" },
    { name: "repair_sql", tier: "strong", tool: "run_sql" },
  ],
  generate_dashboard: [
    { name: "plan_dashboard", tier: "strong", tool: "get_context" },
    { name: "compose_layout", tier: "cheap", tool: "run_sql" },
  ],
} as const;

type AskStep = (typeof COMPONENT_STEPS)[CodexAskComponent][number]["name"];

interface SessionReference {
  readonly target: "codex:local";
  readonly threadId: string;
}

interface TurnReference {
  readonly threadId: string;
  readonly turnId: string;
  readonly status: string;
}

interface McpArtifactReference {
  readonly parentThreadId: string;
  readonly parentTurnId: string;
  readonly step: string;
  readonly agentRole: string;
  readonly agentThreadId: string;
  readonly itemId: string;
  readonly server: string;
  readonly tool: string;
  readonly ok: boolean;
}

interface RenderArtifactReference {
  readonly version: "0.1";
  readonly kind: "render_envelope";
  readonly parentThreadId: string;
  readonly parentTurnId: string;
  readonly step: "compose_layout";
  readonly agentRole: "warble_compose_layout";
  readonly agentThreadId: string;
  readonly verified: boolean;
  readonly blockTypes: readonly string[];
}

type CodexAskEvent =
  | { readonly t: "session_started"; readonly session: SessionReference }
  | { readonly t: "turn_started" | "turn_completed"; readonly turn: TurnReference }
  | {
      readonly t: "agent_started";
      readonly parentThreadId: string;
      readonly parentTurnId: string;
      readonly step: string;
      readonly agentRole: string;
      readonly agentThreadId: string;
      readonly model: string;
    }
  | {
      readonly t: "step_finished";
      readonly parentThreadId: string;
      readonly parentTurnId: string;
      readonly step: string;
      readonly agentRole: string;
      readonly agentThreadId: string;
      readonly ok: boolean;
    }
  | { readonly t: "artifact"; readonly reference: McpArtifactReference }
  | { readonly t: "render_artifact"; readonly reference: RenderArtifactReference }
  | {
      readonly t: "render_degraded";
      readonly parentThreadId: string;
      readonly parentTurnId: string;
      readonly reason: "invalid_render_envelope";
    }
  | { readonly t: "answer"; readonly text: string }
  | { readonly t: "session_recoverable" | "session_failed"; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(line: string): CodexAskEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("warble-codex-local Ask emitted non-JSON output");
  }
  if (!isRecord(value) || typeof value["t"] !== "string") {
    throw new Error("warble-codex-local Ask emitted a malformed event");
  }
  return value as CodexAskEvent;
}

function expectedRole(step: AskStep): string {
  return `warble_${step}`;
}

export class CodexAskEventMapper {
  private sessionStarted = false;
  private parentThreadId = "";
  private parentTurnId = "";
  private turnStarted = false;
  private turnCompleted = false;
  private finalText: string | undefined;
  private readonly started: AskStep[] = [];
  private readonly finished = new Map<AskStep, boolean>();
  private readonly agentThreads = new Map<AskStep, string>();
  private readonly mcpEvidence = new Map<AskStep, { count: number; allOk: boolean }>();
  private renderState: "artifact" | "degraded" | undefined;
  private renderArtifact: RenderArtifactReference | undefined;

  constructor(
    private readonly models: CodexManifestModels,
    private readonly component: CodexAskComponent = "answer_query",
  ) {}

  nextLine(line: string): AgentEventInput[] {
    const event = parseEvent(line);
    switch (event.t) {
      case "session_started":
        if (this.sessionStarted || event.session?.target !== "codex:local" || !event.session.threadId) {
          throw new Error("warble-codex-local Ask emitted an invalid session start");
        }
        this.sessionStarted = true;
        this.parentThreadId = event.session.threadId;
        return [];
      case "turn_started":
        if (
          !this.sessionStarted ||
          this.turnStarted ||
          event.turn?.status !== "in_progress" ||
          event.turn.threadId !== this.parentThreadId ||
          !event.turn.turnId
        ) {
          throw new Error("warble-codex-local Ask emitted an invalid turn start");
        }
        this.turnStarted = true;
        this.parentTurnId = event.turn.turnId;
        return [];
      case "agent_started": {
        const step = this.stepContract(event.step);
        if (!this.turnStarted || this.turnCompleted || step === undefined) {
          throw new Error("warble-codex-local Ask emitted an invalid agent start");
        }
        const expected = COMPONENT_STEPS[this.component][this.started.length];
        const previous = COMPONENT_STEPS[this.component][this.started.length - 1];
        if (
          event.step !== expected?.name ||
          (previous !== undefined && !this.finished.has(previous.name)) ||
          (step.name === "repair_sql"
            ? this.finished.get("generate_sql") !== false
            : previous !== undefined && this.finished.get(previous.name) !== true) ||
          event.agentRole !== expectedRole(step.name) ||
          !event.agentThreadId ||
          event.parentThreadId !== this.parentThreadId ||
          event.parentTurnId !== this.parentTurnId
        ) {
          throw new Error("warble-codex-local Ask agent order or attribution did not match the IR");
        }
        if (event.model !== this.models[step.tier]) {
          throw new Error(`warble-codex-local Ask step "${event.step}" ran on the wrong model`);
        }
        this.started.push(step.name);
        this.agentThreads.set(step.name, event.agentThreadId);
        return [{
          kind: "step.start",
          stepId: step.name,
          name: step.name,
          tier: step.tier,
          parent: event.parentThreadId,
          depth: 1,
        }];
      }
      case "artifact": {
        const reference = event.reference;
        const step = this.stepContract(reference?.step);
        if (
          step === undefined ||
          this.finished.has(step.name)
        ) {
          throw new Error("warble-codex-local Ask emitted an artifact outside an active step");
        }
        const threadId = this.agentThreads.get(step.name);
        if (
          threadId === undefined ||
          reference.agentThreadId !== threadId ||
          reference.parentThreadId !== this.parentThreadId ||
          reference.parentTurnId !== this.parentTurnId ||
          reference.agentRole !== expectedRole(step.name) ||
          reference.server !== "wren" ||
          !reference.itemId ||
          reference.tool !== step.tool
        ) {
          throw new Error("warble-codex-local Ask artifact attribution did not match the allowed Wren MCP surface");
        }
        if (this.component === "generate_dashboard") {
          const previousEvidence = this.mcpEvidence.get(step.name);
          this.mcpEvidence.set(step.name, {
            count: (previousEvidence?.count ?? 0) + 1,
            allOk: (previousEvidence?.allOk ?? true) && reference.ok,
          });
        }
        const callId = `${reference.step}:${reference.itemId}`;
        const tool = `${reference.server}.${reference.tool}`;
        return [
          {
            kind: "tool.call",
            stepId: reference.step,
            callId,
            tool,
            parent: reference.agentThreadId,
            depth: 2,
            status: "running",
          },
          {
            kind: "tool.result",
            stepId: reference.step,
            callId,
            tool,
            status: reference.ok ? "success" : "error",
            ...(!reference.ok ? { error: "allowlisted Wren MCP tool failed" } : {}),
          },
        ];
      }
      case "render_artifact": {
        const reference = event.reference;
        const composeThread = this.agentThreads.get("compose_layout");
        const allowedBlockTypes = new Set(["kpi_card", "chart", "table", "definition"]);
        // Protocol shape: a violation here means warble-codex-local emitted
        // something structurally wrong (bad envelope-protocol fields, or a
        // `verified` claim unsupported by tool evidence) -- always a target
        // bug, so it stays loud.
        if (
          this.component !== "generate_dashboard" ||
          this.renderState !== undefined ||
          this.finished.get("compose_layout") !== true ||
          reference?.version !== "0.1" ||
          reference.kind !== "render_envelope" ||
          reference.parentThreadId !== this.parentThreadId ||
          reference.parentTurnId !== this.parentTurnId ||
          reference.step !== "compose_layout" ||
          reference.agentRole !== expectedRole("compose_layout") ||
          reference.agentThreadId !== composeThread ||
          typeof reference.verified !== "boolean" ||
          (reference.verified && !this.hasSuccessfulDashboardEvidence()) ||
          !Array.isArray(reference.blockTypes) ||
          reference.blockTypes.length === 0 ||
          reference.blockTypes.some((type) => !allowedBlockTypes.has(type))
        ) {
          throw new Error("warble-codex-local Ask emitted an invalid dashboard render artifact");
        }
        // Dashboard CONTENT requirement (decision-56): genbi owns the product
        // shape of a dashboard -- a rendered dashboard must carry at least
        // one data panel (`kpi_card`/`chart`/`table`) and one `definition`.
        // This is the guarantee's owner now that warble-codex-local no
        // longer enforces it in `render_contract.ts`. A shortfall here is a
        // genbi-product-shape problem, not a protocol bug, so it degrades
        // exactly like a `render_degraded` event (terminal answer retained,
        // artifact suppressed) instead of failing the whole Ask request.
        const blockTypes = new Set(reference.blockTypes);
        const hasDataPanel = reference.blockTypes.some((type) =>
          ["kpi_card", "chart", "table"].includes(type),
        );
        if (!hasDataPanel || !blockTypes.has("definition")) {
          this.renderState = "degraded";
          return [];
        }
        this.renderState = "artifact";
        this.renderArtifact = reference;
        return [];
      }
      case "render_degraded":
        if (
          this.component !== "generate_dashboard" ||
          this.renderState !== undefined ||
          this.finished.get("compose_layout") !== true ||
          event.parentThreadId !== this.parentThreadId ||
          event.parentTurnId !== this.parentTurnId ||
          event.reason !== "invalid_render_envelope"
        ) {
          throw new Error("warble-codex-local Ask emitted an invalid dashboard render degradation");
        }
        this.renderState = "degraded";
        return [];
      case "step_finished": {
        const step = this.stepContract(event.step);
        if (step === undefined || this.finished.has(step.name)) {
          throw new Error("warble-codex-local Ask emitted an invalid step finish");
        }
        const expected = COMPONENT_STEPS[this.component][this.finished.size];
        if (
          event.step !== expected?.name ||
          !this.started.includes(step.name) ||
          event.agentRole !== expectedRole(step.name) ||
          event.agentThreadId !== this.agentThreads.get(step.name) ||
          event.parentThreadId !== this.parentThreadId ||
          event.parentTurnId !== this.parentTurnId
        ) {
          throw new Error("warble-codex-local Ask step completion order or attribution did not match the IR");
        }
        if (this.component === "generate_dashboard") {
          const evidence = this.mcpEvidence.get(step.name);
          if (evidence === undefined || evidence.count === 0) {
            throw new Error(`warble-codex-local Ask step "${step.name}" finished without required Wren MCP evidence`);
          }
          if (event.ok !== evidence.allOk) {
            throw new Error(`warble-codex-local Ask step "${step.name}" outcome contradicted its Wren MCP evidence`);
          }
        }
        this.finished.set(step.name, event.ok);
        return [{
          kind: "step.finish",
          stepId: event.step,
          name: event.step,
          status: event.ok ? "ok" : "error",
          ...(!event.ok ? { detail: `${event.step} failed` } : {}),
        }];
      }
      case "turn_completed":
        if (
          !this.turnStarted ||
          this.turnCompleted ||
          event.turn?.status !== "completed" ||
          event.turn.threadId !== this.parentThreadId ||
          event.turn.turnId !== this.parentTurnId ||
          this.finished.size !== this.started.length
        ) {
          throw new Error("warble-codex-local Ask emitted an invalid turn completion");
        }
        this.validateStepOutcome();
        this.turnCompleted = true;
        return [];
      case "answer":
        if (!this.turnCompleted || this.finalText !== undefined || typeof event.text !== "string" || !event.text.trim()) {
          throw new Error("warble-codex-local Ask emitted an invalid terminal answer");
        }
        if (this.component === "generate_dashboard" && this.renderState === "artifact") {
          this.validateDashboardAnswer(event.text);
        }
        this.finalText = this.component === "generate_dashboard" && this.renderState === "degraded"
          ? degradedDashboardText(event.text)
          : event.text;
        return [{ kind: "answer", text: this.finalText }];
      case "session_recoverable":
      case "session_failed":
        throw new Error(`warble-codex-local Ask session failed: ${event.reason}`);
      default:
        throw new Error("warble-codex-local Ask emitted an unknown event");
    }
  }

  result(): string {
    if (!this.sessionStarted || !this.turnStarted || !this.turnCompleted) {
      throw new Error("warble-codex-local Ask ended with a partial lifecycle");
    }
    if (this.finalText === undefined) {
      throw new Error("warble-codex-local Ask ended without a final answer");
    }
    return this.finalText;
  }

  private validateStepOutcome(): void {
    if (this.component === "generate_dashboard") {
      if (
        this.finished.get("plan_dashboard") !== true ||
        this.finished.get("compose_layout") !== true ||
        this.started.length !== 2 ||
        !this.hasSuccessfulDashboardEvidence() ||
        this.renderState === undefined
      ) {
        throw new Error("warble-codex-local Ask did not complete the required dashboard steps and render contract");
      }
      return;
    }
    const resolveOk = this.finished.get("resolve_intent");
    const generateOk = this.finished.get("generate_sql");
    const repairOk = this.finished.get("repair_sql");
    if (resolveOk !== true || generateOk === undefined) {
      throw new Error("warble-codex-local Ask did not complete the required resolve/generate steps");
    }
    if (generateOk) {
      if (repairOk !== undefined || this.started.length !== 2) {
        throw new Error("warble-codex-local Ask ran repair after successful generation");
      }
      return;
    }
    if (repairOk !== true || this.started.length !== 3) {
      throw new Error("warble-codex-local Ask did not complete its single bounded repair");
    }
  }

  private stepContract(value: string | undefined) {
    return COMPONENT_STEPS[this.component].find((step) => step.name === value);
  }

  private validateDashboardAnswer(text: string): void {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("warble-codex-local Ask dashboard answer was not valid JSON");
    }
    if (!isDashboardEnvelope(value)) {
      throw new Error("warble-codex-local Ask dashboard answer did not match its render artifact");
    }
    const blockTypes = value["blocks"].map((block) =>
      isRecord(block) && typeof block["type"] === "string" ? block["type"] : "",
    );
    if (
      this.renderArtifact === undefined ||
      (value["verified"] && !this.hasSuccessfulDashboardEvidence()) ||
      value["verified"] !== this.renderArtifact.verified ||
      JSON.stringify(blockTypes) !== JSON.stringify(this.renderArtifact.blockTypes)
    ) {
      throw new Error("warble-codex-local Ask dashboard answer did not match its render artifact");
    }
  }

  private hasSuccessfulDashboardEvidence(): boolean {
    return this.mcpEvidence.size === 2 &&
      this.mcpEvidence.get("plan_dashboard")?.allOk === true &&
      this.mcpEvidence.get("compose_layout")?.allOk === true;
  }
}

function isDashboardEnvelope(value: unknown): value is Record<string, unknown> & {
  readonly blocks: Record<string, unknown>[];
  readonly verified: boolean;
} {
  if (
    !isRecord(value) ||
    !Array.isArray(value["blocks"]) ||
    value["blocks"].length === 0 ||
    typeof value["verified"] !== "boolean" ||
    ("summary" in value && typeof value["summary"] !== "string")
  ) {
    return false;
  }

  let hasDataPanel = false;
  let hasDefinition = false;
  for (const block of value["blocks"]) {
    if (!isRecord(block) || typeof block["type"] !== "string") return false;
    switch (block["type"]) {
      case "kpi_card":
        if (
          typeof block["label"] !== "string" ||
          (typeof block["value"] !== "string" && typeof block["value"] !== "number") ||
          ("unit" in block && typeof block["unit"] !== "string") ||
          ("delta" in block && typeof block["delta"] !== "number")
        ) return false;
        hasDataPanel = true;
        break;
      case "table":
        if (!isStringArray(block["columns"]) || !isObjectArray(block["rows"])) return false;
        hasDataPanel = true;
        break;
      case "chart":
        if (
          !["bar", "line", "pie", "area", "scatter"].includes(String(block["chart_type"])) ||
          typeof block["x"] !== "string" ||
          !isStringArray(block["series"]) ||
          !isObjectArray(block["rows"])
        ) return false;
        hasDataPanel = true;
        break;
      case "definition":
        if (
          typeof block["sql"] !== "string" ||
          !isStringArray(block["source_tables"]) ||
          !isStringArray(block["filters"])
        ) return false;
        hasDefinition = true;
        break;
      default:
        return false;
    }
  }
  return hasDataPanel && hasDefinition;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function degradedDashboardText(text: string): string {
  try {
    const value = JSON.parse(text) as unknown;
    if (isRecord(value) && typeof value["summary"] === "string" && value["summary"].trim()) {
      return value["summary"].trim();
    }
  } catch {
    // A degraded renderer may already have emitted a plain-text best effort.
  }
  return text;
}
