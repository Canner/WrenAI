import { z } from "zod";
import { randomUUID } from "node:crypto";
import { normalizeComponentRequest, type ComponentInvocationResult } from "@warble/claude-agent-sdk";

export interface ComponentTool { readonly name: string; readonly source: string }
export interface ComponentStep {
  readonly name: string;
  readonly tier: string;
  readonly prompt: string;
  readonly consumes: readonly string[];
  readonly produces: string;
  readonly tools: readonly ComponentTool[];
  readonly calls: readonly { readonly alias: string; readonly component: string }[];
  readonly repairOf?: string;
}
export interface ComponentPlan {
  readonly id: string;
  readonly brief?: string;
  readonly steps: readonly ComponentStep[];
  /** Preserved compiler declaration, for host context/guardrail/render validation. */
  readonly declaration: Readonly<Record<string, unknown>>;
}
export interface ExecutionPlan {
  readonly identity: string;
  readonly contextBinding?: Readonly<Record<string, unknown>>;
  readonly systemPrompt?: string;
  readonly entries: readonly string[];
  readonly components: Readonly<Record<string, ComponentPlan>>;
}
export const COMPONENT_LIMITS = Object.freeze({
  depth: 8, calls: 32, steps: 40, childSteps: 12,
  requestBytes: 65_536, resultBytes: 1_048_576, timeoutMs: 120_000,
});
export interface StepUsage { readonly inputTokens: number; readonly outputTokens: number }
export interface StepResponse {
  readonly value: unknown;
  readonly failed?: boolean;
  readonly usage?: StepUsage;
}
export interface BoundTool {
  readonly name: string;
  readonly source: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  execute(input: unknown, signal: AbortSignal): Promise<unknown>;
}
export interface ToolEvidence {
  readonly step: string;
  readonly tool: string;
  readonly input: unknown;
  readonly output: unknown;
}
export interface ComponentEvidence {
  readonly steps: Readonly<Record<string, unknown>>;
  readonly tools: readonly ToolEvidence[];
  readonly children: readonly ComponentInvocationResult[];
}
/** Host-created after exact context, model, account and tool authority validation. */
export interface ComponentBinding {
  readonly tools: readonly BoundTool[];
  /** Tests identity/revocation, including after close() has released step resources. */
  isCurrent(): boolean;
  /** Pure result validation/normalization; must never persist child artifacts. */
  normalize(evidence: ComponentEvidence, signal: AbortSignal): Promise<ComponentInvocationResult>;
  close(): Promise<void>;
}
/** Transport gets a fresh request each time; no previous component/step transcript. */
export interface StepRun {
  readonly terminal?: boolean;
  readonly tier: string;
  readonly request: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly brief?: string;
  readonly prompt: string;
  readonly consumes: Readonly<Record<string, unknown>>;
  readonly tools: Readonly<Record<string, (input: unknown) => Promise<unknown>>>;
  readonly toolSchemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly toolDescriptions: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}
export interface RunnerHost {
  prepare(component: ComponentPlan, signal: AbortSignal): Promise<ComponentBinding>;
  runStep(run: StepRun, binding: ComponentBinding): Promise<StepResponse>;
  /** Separate root-only sink, invoked once after successful closure execution. */
  persistRoot?(result: Extract<ComponentInvocationResult, { status: "ok" }>, binding: ComponentBinding, signal: AbortSignal): Promise<void>;
  onEvent?(event: ComponentEvent): void;
}
export interface ComponentEvent {
  readonly kind: "step.start" | "step.finish" | "call.start" | "call.finish" | "tool.start" | "tool.finish";
  readonly invocation: string;
  readonly parent: string | null;
  readonly component: string;
  readonly step?: string;
  readonly tool?: string;
  readonly callId?: string;
  readonly depth: number;
  readonly status?: "ok" | "error" | "cancelled";
}

const normalizedResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), output: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("value"), value: z.unknown() }).strict(),
    z.object({ kind: z.literal("render"), blocks: z.array(z.record(z.string(), z.unknown())), summary: z.string().optional() }).strict(),
  ]), provenance: z.object({ verified: z.boolean().optional(), definition: z.unknown().optional() }).strict().optional() }).strict(),
  z.object({ status: z.literal("refused"), code: z.literal("callee_refused"), message: z.string() }).strict(),
  z.object({ status: z.literal("error"), code: z.enum(["unsupported_callee", "invalid_request", "invalid_result", "budget_exhausted", "cancelled", "transient_transport", "callee_failed"]), message: z.string(), retryable: z.boolean() }).strict(),
]);

class ExecutionFailure extends Error {
  constructor(readonly code: "cancelled" | "budget_exhausted" | "invalid_result" | "callee_failed") {
    super(code);
  }
}
function safeError(error: unknown): ComponentInvocationResult {
  return { status: "error", code: error instanceof ExecutionFailure ? error.code : "callee_failed",
    message: "Component execution did not complete.", retryable: false };
}
function copy<T>(value: T, maxBytes: number): T {
  const text = JSON.stringify(value);
  if (text === undefined || Buffer.byteLength(text) > maxBytes) throw new ExecutionFailure("invalid_result");
  return JSON.parse(text) as T;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function object<T>(): Record<string, T> { return Object.create(null) as Record<string, T>; }
function unique(values: readonly string[]): boolean {
  return values.every((value) => /^[A-Za-z0-9_-]+$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value))
    && new Set(values).size === values.length;
}

/** Immutable, root-scoped execution. Constructed only from a validated producer adapter. */
export class ComponentRunner {
  private readonly plan: ExecutionPlan;
  private readonly controller = new AbortController();
  private readonly bindings = new Map<string, ComponentBinding>();
  private readonly releases = new WeakMap<ComponentBinding, Promise<void>>();
  private used = false;
  private cleanupFailure = false;
  get cleanupFailed(): boolean { return this.cleanupFailure; }
  private calls = 0;
  private steps = 0;
  private usage = { inputTokens: 0, outputTokens: 0 };
  private deadline = 0;
  constructor(plan: ExecutionPlan, private readonly host: RunnerHost) {
    this.plan = freeze(copy(plan, 4 * 1024 * 1024));
    this.validate();
  }
  cancel(): void { this.controller.abort(); }
  get observedUsage(): Readonly<StepUsage> { return { ...this.usage }; }

  async run(entry: string, request: unknown, signal?: AbortSignal): Promise<ComponentInvocationResult> {
    if (this.used) throw new Error("Component runner is single-use");
    this.used = true;
    const abort = () => this.cancel();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) this.cancel();
    this.deadline = Date.now() + COMPONENT_LIMITS.timeoutMs;
    const timer = setTimeout(abort, COMPONENT_LIMITS.timeoutMs);
    let result: ComponentInvocationResult;
    try {
      if (!this.plan.entries.includes(entry)) throw new ExecutionFailure("callee_failed");
      // Prepare the entire reachable closure before any model or tool execution.
      const closure = new Set<string>();
      const visit = (id: string): void => {
        if (closure.has(id)) return;
        closure.add(id);
        for (const step of this.plan.components[id]!.steps) for (const edge of step.calls) visit(edge.component);
      };
      visit(entry);
      for (const id of closure) {
        this.check();
        const pending = this.host.prepare(this.plan.components[id]!, this.controller.signal);
        // A late prepare owns resources too: close it if cancellation won the race.
        void pending.then(async (binding) => {
          if (this.controller.signal.aborted) await this.release(binding);
        }).catch(() => {});
        const binding = await this.wait(pending);
        this.bindings.set(id, binding);
        this.check();
        const tools = binding.tools;
        if (!unique(tools.map((tool) => tool.name))) throw new ExecutionFailure("callee_failed");
        for (const step of this.plan.components[id]!.steps) for (const tool of step.tools) {
          if (!tools.some((bound) => bound.name === tool.name && bound.source === tool.source)) {
            throw new ExecutionFailure("callee_failed");
          }
        }
      }
      result = await this.invoke(entry, request, null, 0);
      this.check();
    } catch (error) {
      result = safeError(error);
    }
    if (result.status !== "ok") this.cancel();
    try {
      // Persistence depends on successful required resource cleanup. Identity
      // checks remain valid after resources close; no more step work is admitted.
      const cleanup = await Promise.allSettled([...this.bindings.values()].map((binding) => this.release(binding)));
      if (cleanup.some((item) => item.status === "rejected")) return safeError(new ExecutionFailure("callee_failed"));
      if (result.status === "ok") {
        this.check();
        if (this.host.persistRoot) await this.wait(this.host.persistRoot(result, this.bindings.get(entry)!, this.controller.signal));
      }
      return result;
    } catch (error) {
      return safeError(error);
    } finally {
      this.cancel();
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  private release(binding: ComponentBinding): Promise<void> {
    let pending = this.releases.get(binding);
    if (!pending) { pending = Promise.resolve().then(() => binding.close()).catch(() => { this.cleanupFailure = true; throw new Error("Component cleanup failed"); }); this.releases.set(binding, pending); }
    return pending;
  }

  private check(): void {
    if (this.controller.signal.aborted || Date.now() >= this.deadline) throw new ExecutionFailure("cancelled");
    if ([...this.bindings.values()].some((binding) => !binding.isCurrent())) {
      this.cancel();
      throw new ExecutionFailure("cancelled");
    }
  }
  private async wait<T>(pending: Promise<T>): Promise<T> {
    this.check();
    let stop!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      stop = () => reject(new ExecutionFailure("cancelled"));
      this.controller.signal.addEventListener("abort", stop, { once: true });
    });
    try {
      const result = await Promise.race([pending, cancelled]);
      this.check();
      return result;
    } finally { this.controller.signal.removeEventListener("abort", stop); }
  }

  private async invoke(id: string, raw: unknown, parent: string | null, depth: number): Promise<ComponentInvocationResult> {
    this.check();
    const request = normalizeComponentRequest(raw, COMPONENT_LIMITS.requestBytes);
    if ("error" in request) return request.error;
    if (depth > COMPONENT_LIMITS.depth || (depth > 0 && ++this.calls > COMPONENT_LIMITS.calls)) {
      throw new ExecutionFailure("budget_exhausted");
    }
    const component = this.plan.components[id]!;
    const binding = this.bindings.get(id)!;
    const invocation = randomUUID();
    const event = { invocation, parent, component: id, depth };
    this.host.onEvent?.({ ...event, kind: "call.start" });
    const products = object<unknown>();
    const tools: ToolEvidence[] = [];
    const children: ComponentInvocationResult[] = [];
    let childSteps = 0;
    let failed: string | undefined;
    try {
      for (const step of component.steps) {
        if (step.repairOf && step.repairOf !== failed) continue;
        if (!step.repairOf && failed) throw new ExecutionFailure("callee_failed");
        this.check();
        if (++this.steps > COMPONENT_LIMITS.steps || (depth > 0 && ++childSteps > COMPONENT_LIMITS.childSteps)) {
          throw new ExecutionFailure("budget_exhausted");
        }
        const consumes = object<unknown>();
        for (const name of step.consumes) {
          if (!Object.hasOwn(products, name)) throw new ExecutionFailure("callee_failed");
          consumes[name] = products[name];
        }
        let active = true;
        let accepting = true;
        // Each invocation has its own queue: siblings serialize, nested children do not deadlock.
        let queue: Promise<unknown> = Promise.resolve();
        const queued: Promise<unknown>[] = [];
        const scoped = object<(input: unknown) => Promise<unknown>>();
        const schemas = object<Readonly<Record<string, unknown>>>();
        const descriptions = object<string>();
        const assertActive = (): void => {
          this.check();
          if (!active) throw new ExecutionFailure("cancelled");
        };
        const trackTool = async <T>(tool: string, execute: () => Promise<T>): Promise<T> => {
          const toolEvent = { ...event, step: step.name, tool, callId: randomUUID() };
          this.host.onEvent?.({ ...toolEvent, kind: "tool.start" });
          try {
            const value = await execute();
            this.host.onEvent?.({ ...toolEvent, kind: "tool.finish", status: "ok" });
            return value;
          } catch (error) {
            this.host.onEvent?.({ ...toolEvent, kind: "tool.finish", status: this.controller.signal.aborted ? "cancelled" : "error" });
            throw error;
          }
        };
        for (const grant of step.tools) {
          const tool = binding.tools.find((candidate) => candidate.name === grant.name && candidate.source === grant.source)!;
          if (tool.inputSchema) schemas[grant.name] = freeze(copy(tool.inputSchema, COMPONENT_LIMITS.requestBytes));
          scoped[grant.name] = (input) => {
            const pending = (async () => {
              assertActive();
              if (!accepting) throw new ExecutionFailure("cancelled");
              const saved = freeze(copy(input, COMPONENT_LIMITS.requestBytes));
              const output = copy(await trackTool(grant.name, () => this.wait(tool.execute(saved, this.controller.signal))), COMPONENT_LIMITS.resultBytes);
              assertActive();
              tools.push(freeze({ step: step.name, tool: grant.name, input: saved, output }));
              return copy(output, COMPONENT_LIMITS.resultBytes);
            })();
            queued.push(pending);
            void pending.catch(() => {});
            return pending;
          };
        }
        for (const edge of step.calls) {
          schemas[edge.alias] = { type: "object", additionalProperties: false, required: ["request"], properties: {
            request: { type: "string", minLength: 1 }, input: { type: "object", additionalProperties: true },
          } };
          descriptions[edge.alias] = String(this.plan.components[edge.component]!.declaration.description ?? "Invoke the bound component with a fresh request.");
          scoped[edge.alias] = (input) => {
            // Reject replay before placing anything in the invocation queue.
            try {
              assertActive();
              if (!accepting) throw new ExecutionFailure("cancelled");
            } catch (error) { return Promise.reject(error); }
            const savedInput = copy(input, COMPONENT_LIMITS.requestBytes);
            const pending = queue.then(() => trackTool(edge.alias, async () => {
              assertActive();
              const result = await this.invoke(edge.component, savedInput, invocation, depth + 1);
              assertActive();
              children.push(freeze(copy(result, COMPONENT_LIMITS.resultBytes)));
              // Tool transports may catch a rejection or ignore the returned value.
              // Retain failure in the host queue so root success cannot hide it.
              if (result.status !== "ok") throw new ExecutionFailure("callee_failed");
              return result;
            }));
            queue = pending.catch(() => {});
            queued.push(pending);
            return pending;
          };
        }
        this.host.onEvent?.({ ...event, kind: "step.start", step: step.name });
        try {
          const pending = this.host.runStep({
            tier: step.tier, request: request.value.request,
            terminal: component.steps.indexOf(step) >= component.steps.indexOf(component.steps.filter((candidate) => !candidate.repairOf).at(-1)!),
            input: freeze(copy(request.value.input, COMPONENT_LIMITS.requestBytes)),
            ...(component.brief !== undefined ? { brief: component.brief } : {}),
            prompt: step.prompt, consumes: freeze(copy(consumes, COMPONENT_LIMITS.resultBytes)),
            tools: Object.freeze(scoped), signal: this.controller.signal,
            toolSchemas: Object.freeze(schemas), toolDescriptions: Object.freeze(descriptions),
          }, binding);
          // Keep observed usage even if cancellation makes a completion unusable.
          void pending.then((result) => {
            if (result.usage) for (const key of ["inputTokens", "outputTokens"] as const) {
              const count = result.usage[key];
              if (Number.isSafeInteger(count) && count >= 0) this.usage[key] += count;
            }
          }).catch(() => {});
          const response = await this.wait(pending);
          accepting = false;
          // A transport cannot return while unobserved child calls still run.
          await this.wait(Promise.all(queued));
          if (response.failed) {
            products[step.produces] = { status: "error", code: "step_failed" };
            failed = step.name;
          } else {
            products[step.produces] = freeze(copy(response.value, COMPONENT_LIMITS.resultBytes));
            failed = undefined;
          }
          this.host.onEvent?.({ ...event, kind: "step.finish", step: step.name, status: response.failed ? "error" : "ok" });
        } catch (error) {
          this.host.onEvent?.({ ...event, kind: "step.finish", step: step.name, status: this.controller.signal.aborted ? "cancelled" : "error" });
          throw error;
        } finally { active = false; }
      }
      if (failed) throw new ExecutionFailure("callee_failed");
      const result = copy(await this.wait(binding.normalize(freeze({ steps: products, tools, children }), this.controller.signal)), COMPONENT_LIMITS.resultBytes);
      if (!normalizedResult.safeParse(result).success) throw new ExecutionFailure("invalid_result");
      this.host.onEvent?.({ ...event, kind: "call.finish", status: result.status === "ok" ? "ok" : "error" });
      return result;
    } catch (error) {
      this.host.onEvent?.({ ...event, kind: "call.finish", status: this.controller.signal.aborted ? "cancelled" : "error" });
      throw error;
    }
  }

  private validate(): void {
    const nodes = this.plan.components;
    if (!this.plan.identity || !this.plan.entries.length || Object.keys(nodes).length > 128 || !unique(this.plan.entries) || !unique(Object.keys(nodes))) throw new Error("Invalid component plan");
    const heights = new Map<string, number>();
    const visit = (id: string, active: ReadonlySet<string>, depth: number): void => {
      const node = nodes[id];
      if (!node || node.id !== id || active.has(id) || depth > COMPONENT_LIMITS.depth) throw new Error("Invalid component closure");
      const cached = heights.get(id);
      if (cached !== undefined) {
        if (depth + cached > COMPONENT_LIMITS.depth) throw new Error("Invalid component closure");
        return;
      }
      if (!node.steps.length || node.steps.length > 128 || !unique(node.steps.map((step) => step.name)) || !unique(node.steps.map((step) => step.produces))) throw new Error("Invalid component steps");
      const products = new Set<string>();
      const next = new Set(active).add(id);
      let height = 0;
      for (const [index, step] of node.steps.entries()) {
        if (!step.tier || !unique([...step.tools.map((tool) => tool.name), ...step.calls.map((edge) => edge.alias)])) throw new Error("Invalid step authority");
        const previous = node.steps[index - 1];
        if (step.repairOf && (!previous || previous.repairOf || previous.name !== step.repairOf || !step.consumes.includes(previous.produces))) throw new Error("Invalid repair");
        if (step.consumes.some((name) => !products.has(name))) throw new Error("Invalid dataflow");
        if (!step.repairOf) products.add(step.produces);
        for (const edge of step.calls) {
          visit(edge.component, next, depth + 1);
          height = Math.max(height, 1 + heights.get(edge.component)!);
        }
      }
      heights.set(id, height);
    };
    for (const entry of this.plan.entries) visit(entry, new Set(), 0);
  }
}
