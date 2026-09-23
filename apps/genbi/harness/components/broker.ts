import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ComponentBinding, ComponentEvidence, ComponentPlan, ExecutionPlan, RunnerHost, StepResponse, StepRun } from "./runner.js";
import type { ComponentInvocationResult } from "@warble/claude-agent-sdk";
import { planDigest } from "./plan.js";
import { verifyComponentContext } from "./context.js";

/** Captured by the host from its project, session and approved runtime records. */
export interface ComponentIdentity {
  readonly session: string;
  readonly vendor: string;
  readonly account: string;
  readonly generation: string;
  readonly project: string;
  readonly bindingRevision: string;
  readonly contextDigest: string;
  readonly planDigest: string;
}
export interface ComponentAccess {
  /** Must execute against the captured project and enforce read-only access. */
  query(input: { sql: string; limit: number }, signal: AbortSignal): Promise<unknown>;
  inspect(signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
export interface ComponentBrokerOptions {
  readonly plan: ExecutionPlan;
  /** Fresh snapshots captured from the same project binding used by prepare(). */
  readonly contexts: Readonly<Record<string, { binding: Readonly<Record<string, unknown>>; snapshot: unknown }>>;
  readonly verifierBinary: string;
  readonly identity: ComponentIdentity;
  readonly currentIdentity: () => ComponentIdentity | undefined;
  /** Opens the exact model/tool authority represented by the verified host context. */
  readonly prepare: (component: ComponentPlan, identity: ComponentIdentity, signal: AbortSignal) => Promise<ComponentAccess>;
  readonly step: (run: StepRun, component: ComponentPlan, identity: ComponentIdentity) => Promise<StepResponse>;
  readonly normalize: (component: ComponentPlan, evidence: ComponentEvidence, signal: AbortSignal, context: unknown) => Promise<ComponentInvocationResult>;
  readonly persistRoot?: RunnerHost["persistRoot"];
  readonly onEvent?: RunnerHost["onEvent"];
}
const queryInput = z.object({ sql: z.string().trim().min(1).max(65_536), limit: z.number().int().positive().optional() }).strict();
const emptyInput = z.object({}).strict();
const QUERY_SCHEMA = { type: "object", additionalProperties: false, required: ["sql"], properties: {
  sql: { type: "string", minLength: 1, maxLength: 65_536 }, limit: { type: "integer", minimum: 1 },
} } as const;
const INSPECT_SCHEMA = { type: "object", additionalProperties: false, properties: {} } as const;

/** Typed host access only: models cannot supply paths, connection config, identity or commands. */
export function createComponentBroker(options: ComponentBrokerOptions): RunnerHost {
  const identity = Object.freeze({ ...options.identity });
  if (Object.values(identity).some((value) => !value.trim())) throw new Error("Missing component execution identity");
  const plan = structuredClone(options.plan);
  const contexts = structuredClone(options.contexts);
  if (identity.planDigest !== plan.identity || identity.contextDigest !== planDigest(contexts)) throw new Error("Component plan/context identity mismatch");
  const owners = new WeakMap<ComponentBinding, ComponentPlan>();
  const current = () => isDeepStrictEqual(identity, options.currentIdentity());
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); if (!current()) throw new Error("Component binding expired"); };
  return {
    async prepare(component, signal) {
      check(signal);
      if (!isDeepStrictEqual(plan.components[component.id], component)) throw new Error("Component plan mismatch");
      const context = contexts[component.id];
      if (context && !isDeepStrictEqual(context.binding, component.declaration.context_binding)) throw new Error("Component context binding mismatch");
      const conditions = component.declaration.context_precondition;
      if (conditions !== undefined && !Array.isArray(conditions)) throw new Error("Invalid component preconditions");
      if (Array.isArray(conditions) && conditions.length > 0) {
        if (!context) throw new Error("Missing component context");
        await verifyComponentContext(options.verifierBinary, context.snapshot, conditions, signal);
      }
      check(signal);
      const guards = z.array(z.object({ name: z.string(), locked: z.boolean(), threshold: z.number().positive().optional() }).passthrough()).parse(component.declaration.guardrails);
      if (!guards.some((guard) => guard.name === "read_only_execution" && guard.locked)) throw new Error("Component read-only guard is required");
      const rowLimit = Math.min(10_000, guards.find((guard) => guard.name === "row_limit")?.threshold ?? 1000);
      const timeoutMs = Math.min(120_000, (guards.find((guard) => guard.name === "statement_timeout")?.threshold ?? 30) * 1000);
      const grants = [...new Map(component.steps.flatMap((step) => step.tools).map((grant) => [`${grant.source}:${grant.name}`, grant])).values()];
      const operations = grants.map((grant) => {
        if ((grant.source === "native" && grant.name === "query") || grant.source === "host:sql_execution:read_only") return "query" as const;
        if ((grant.source === "native" && grant.name === "semantic_introspect") || grant.source === "host:semantic_introspection") return "inspect" as const;
        throw new Error("Unsupported component tool binding");
      });
      const access = await options.prepare(component, identity, signal);
      let closed = false;
      let closing: Promise<void> | undefined;
      const close = () => { closed = true; return closing ??= access.close(); };
      try { check(signal); } catch (error) { await close(); throw error; }
      const binding: ComponentBinding = {
        isCurrent: current, close,
        tools: grants.map((grant, index) => ({ ...grant,
          inputSchema: operations[index] === "query" ? QUERY_SCHEMA : INSPECT_SCHEMA,
          async execute(input, parent) {
            check(parent);
            if (closed) throw new Error("Component access is closed");
            const bounded = AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
            let result: unknown;
            if (operations[index] === "query") {
              const parsed = queryInput.parse(input);
              result = await access.query({ sql: parsed.sql, limit: Math.min(rowLimit, parsed.limit ?? rowLimit) }, bounded);
            } else {
              emptyInput.parse(input);
              result = await access.inspect(bounded);
            }
            check(bounded);
            if (closed) throw new Error("Component access is closed");
            return result;
          },
        })),
        async normalize(evidence, parent) { check(parent); if (closed) throw new Error("Component access is closed"); return options.normalize(component, evidence, parent, structuredClone(context?.snapshot)); },
      };
      owners.set(binding, component);
      return binding;
    },
    async runStep(run, binding) {
      check(run.signal);
      const component = owners.get(binding);
      if (!component || !binding.isCurrent()) throw new Error("Invalid component binding");
      const context = contexts[component.id];
      const render = z.object({ render_blocks: z.array(z.object({ type: z.string(), fields: z.record(z.string(), z.string()) }).strict()).optional() }).passthrough().parse(component.declaration.effect ?? {}).render_blocks;
      const prompt = [run.prompt,
        context ? `Host semantic context:\n${JSON.stringify(context.snapshot)}` : "",
        run.terminal && render?.length ? `Render output: Return only one JSON object with a blocks array. Each block has a type and its declared fields. Use only these block contracts (a trailing ? means optional): ${JSON.stringify(render)}. Copy data and definitions only from successful host tool or child results. A KPI label must identify its returned column; do not invent units or deltas. If evidence is insufficient, return {"status":"refused","message":"Insufficient verified data"}.` : "",
      ].filter(Boolean).join("\n\n");
      return options.step({ ...run, prompt }, component, identity);
    },
    ...(options.persistRoot ? { persistRoot: options.persistRoot } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  };
}
