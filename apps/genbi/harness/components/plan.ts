import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ComponentPlan, ComponentStep, ExecutionPlan } from "./runner.js";

export const HOST_FEATURES = [
  "immutable_step_authority", "isolated_component_tools", "fresh_child_context",
  "verified_context_preconditions", "component_owned_bindings", "exact_step_tiers",
  "exact_dataflow", "bounded_repair", "shared_admission_ledger",
  "deadline_and_descendant_cancellation", "normalized_child_results",
  "root_only_persistence", "redacted_usage_trace",
] as const;
export const VERCEL_HOST_CONTRACT = Object.freeze({
  protocol: "warble-component-host/1", bundle_version: "0.2", features: HOST_FEATURES,
  guardrails: ["read_only_execution", "row_limit", "statement_timeout", "deterministic_gate", "artifact_write", "drill_depth_limit", "additivity_guard"],
  tool_authority: {
    query: { source: "native", capabilities: ["sql_execution:read_only"] },
    semantic_introspect: { source: "native", capabilities: ["semantic_introspection"] },
  },
});
const limits = z.object({
  max_depth: z.literal(8), max_attempts: z.literal(32), max_steps: z.literal(40),
  max_steps_per_child: z.literal(12), max_in_flight: z.literal(1),
  max_request_bytes: z.literal(65536), max_result_bytes: z.literal(1048576), timeout_ms: z.literal(120000),
}).strict();
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const strings = z.array(z.string());
const record = z.record(z.string(), z.unknown());
const calls = z.array(z.object({ alias: z.string(), component: z.string() }).strict());
const when = z.object({ guard: z.literal("on_failure"), target: z.string() }).strict();
const tool = z.object({ name: z.string(), source: z.string() }).strict();
const irStep = z.object({
  name: z.string(), tier: z.string(), consumes: strings, produces: z.string(),
  prompt: z.string(), conditional: z.boolean(), when: when.nullable().optional(),
  produces_exclusive: z.boolean().optional(), capabilities: strings.optional(),
  component_calls: calls.optional(),
}).strict();
const declaration = z.object({
  id: z.string(), verb: z.string(), type: z.literal("analytical"), realization_kind: z.literal("skill"),
  trigger: z.object({ kind: z.literal("one_shot") }).strict(),
  effect: z.object({ outcome: z.object({ kind: z.literal("none") }).strict(), render_blocks: z.array(record).optional() }).strict(),
  entrypoint: z.boolean().optional(), brief: z.string().optional(), description: z.string().optional(),
  llm_calls: z.array(irStep), required_capabilities: strings,
  guardrails: z.array(record), borrowed_actions: strings, context_binding: record,
  context_requirements: strings, context_precondition: z.array(record).optional(),
  precondition_result: record, params: z.array(record).optional(), binds: record.nullable().optional(),
  prompt_fragment: z.string().optional(), examples: strings.optional(), eval: record.optional(), eval_ref: z.string().optional(),
}).strict();
const realization = z.union([
  z.object({ kind: z.literal("independent") }).strict(),
  z.object({ kind: z.literal("repair_fold"), fold_into: z.string(), max_attempts: z.literal(1),
    failure_input: z.string().optional(), on_exhaustion: z.literal("fail").optional() }).strict(),
]);
const shared = {
  warble_ir_version: z.literal("0.8"), protocol: z.literal("warble-component-host/1"),
  execution_status: z.literal("not_executed"), profile: z.string(),
  input_ir_sha256: digest, context_binding: record, system_prompt: z.string().nullable().optional(),
  limits, model_turn_hard_limit: z.literal(false), monetary_hard_limit: z.literal(false),
};
const vercel = z.object({
  ...shared, vercel_bundle_version: z.literal("0.2"), target: z.literal("vercel:headless"),
  entries: strings, required_host: record, bundle_sha256: digest,
  components: z.record(z.string(), z.object({
    declaration,
    steps: z.array(z.object({ name: z.string(), effective_capabilities: strings, tools: z.array(tool), realization }).strict()),
    capabilities: z.unknown(),
  }).strict()),
}).strict();
const sessionComponent = z.object({
  session_plan_version: z.literal("2"), producer_version: z.string(), warble_ir_version: z.literal("0.8"),
  input_ir_sha256: digest, host_contract_sha256: digest, context_identity_sha256: digest, plan_sha256: digest,
  profile: z.string(), component: z.string(), declaration,
  instructions: z.object({ brief: z.string().nullable() }).strict(),
  steps: z.array(z.object({ name: z.string(), tier: z.string(), consumes: strings, produces: z.string(),
    produces_exclusive: z.boolean(), instructions: z.string(), capabilities: strings, tools: strings,
    when: when.nullable(), realization, product_availability: z.enum(["after_attempt", "if_executed"]), component_calls: calls }).strict()),
  slot_supply: record, capability_bindings: z.record(z.string(), z.object({ tool: z.string().optional() }).strict()),
  required_host_capabilities: strings, required_capabilities: strings, guardrails: z.array(record), borrowed_actions: strings,
  context_requirements: strings, context_precondition: z.array(record), precondition_result: record, render_blocks: z.array(record),
  required_execution: strings, authority: z.literal("host_owned"), execution_status: z.literal("not_executed"),
}).strict();
const session = z.object({
  ...shared, session_plan_version: z.literal("2"), producer_version: z.string(), authority: z.literal("host_owned"),
  host_contract_sha256: digest, entry: z.string(), required_execution: strings,
  components: z.record(z.string(), sessionComponent), plan_sha256: digest,
}).strict();

/** SHA over recursively sorted JSON, matching the producer's documented digest form. */
export function canonicalPlanJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])]));
    return item;
  };
  return JSON.stringify(sort(value));
}
export function planDigest(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalPlanJson(value)).digest("hex")}`; }
function checkDigest(value: Record<string, unknown>, key: string, expected?: string): void {
  const { [key]: claimed, ...payload } = value;
  if (claimed !== planDigest(payload) || (expected !== undefined && claimed !== expected)) throw new Error("Component plan identity mismatch");
}
function assertEqual(left: unknown, right: unknown): void {
  if (!isDeepStrictEqual(left, right)) throw new Error("Component plan projection mismatch");
}
function commonStep(source: z.infer<typeof irStep>, derived: z.infer<typeof realization>): ComponentStep {
  if (source.conditional !== (derived.kind === "repair_fold")) throw new Error("Unsupported step realization");
  if (derived.kind === "repair_fold" && (source.when?.target !== derived.fold_into || source.when.guard !== "on_failure")) throw new Error("Invalid repair target");
  return { name: source.name, tier: source.tier, prompt: source.prompt, consumes: source.consumes,
    produces: source.produces, tools: [], calls: source.component_calls ?? [],
    ...(derived.kind === "repair_fold" ? { repairOf: derived.fold_into } : {}) };
}
export interface PlanReceipt {
  /** Trusted host receipt captured from its successful producer invocation, never model input. */
  readonly digest: string;
  readonly inputIrDigest: string;
  readonly contextBinding: Readonly<Record<string, unknown>>;
  readonly declarations: Readonly<Record<string, unknown>>;
  /** Exact host contract bytes passed to the direct-session producer. */
  readonly directHostDocument?: string;
}

export function readExecutionPlan(document: string, receipt: PlanReceipt): ExecutionPlan {
  if (Buffer.byteLength(document) > 4 * 1024 * 1024) throw new Error("Component plan exceeds byte limit");
  const raw: unknown = JSON.parse(document);
  const components: Record<string, ComponentPlan> = Object.create(null) as Record<string, ComponentPlan>;
  if (raw && typeof raw === "object" && "vercel_bundle_version" in raw) {
    const bundle = vercel.parse(raw);
    checkDigest(raw as Record<string, unknown>, "bundle_sha256", receipt.digest);
    assertEqual(bundle.input_ir_sha256, receipt.inputIrDigest);
    assertEqual(bundle.context_binding, receipt.contextBinding);
    assertEqual(bundle.required_host, VERCEL_HOST_CONTRACT);
    for (const [id, node] of Object.entries(bundle.components)) {
      assertEqual(id, node.declaration.id);
      assertEqual(node.declaration, receipt.declarations[id]);
      assertEqual(node.steps.length, node.declaration.llm_calls.length);
      const steps = node.steps.map((step, index) => {
        const source = node.declaration.llm_calls[index]!;
        assertEqual(step.name, source.name);
        assertEqual(step.effective_capabilities, source.capabilities ?? node.declaration.required_capabilities);
        for (const grant of step.tools) {
          const authority = VERCEL_HOST_CONTRACT.tool_authority[grant.name as keyof typeof VERCEL_HOST_CONTRACT.tool_authority];
          if (!authority || authority.source !== grant.source || authority.capabilities.some((cap) => !step.effective_capabilities.includes(cap))) throw new Error("Unsupported tool authority");
        }
        return { ...commonStep(source, step.realization), tools: step.tools };
      });
      components[id] = { id, declaration: node.declaration, steps, ...(node.declaration.brief !== undefined ? { brief: node.declaration.brief } : {}) };
    }
    return { identity: bundle.bundle_sha256, entries: bundle.entries, components, contextBinding: bundle.context_binding,
      ...(bundle.system_prompt ? { systemPrompt: bundle.system_prompt } : {}) };
  }
  const plan = session.parse(raw);
  checkDigest(raw as Record<string, unknown>, "plan_sha256", receipt.digest);
  assertEqual(plan.input_ir_sha256, receipt.inputIrDigest);
  assertEqual(plan.context_binding, receipt.contextBinding);
  if (!receipt.directHostDocument) throw new Error("Missing direct host receipt");
  assertEqual(plan.host_contract_sha256, `sha256:${createHash("sha256").update(receipt.directHostDocument).digest("hex")}`);
  assertEqual(plan.required_execution, HOST_FEATURES);
  for (const [id, node] of Object.entries(plan.components)) {
    checkDigest((raw as z.infer<typeof session>).components[id]!, "plan_sha256");
    assertEqual(id, node.component);
    assertEqual(id, node.declaration.id);
    assertEqual(node.declaration, receipt.declarations[id]);
    assertEqual(node.input_ir_sha256, plan.input_ir_sha256);
    assertEqual(node.profile, plan.profile);
    assertEqual(node.context_identity_sha256, planDigest(receipt.contextBinding));
    assertEqual(node.context_precondition, node.declaration.context_precondition ?? []);
    assertEqual(node.precondition_result, node.declaration.precondition_result);
    assertEqual(node.guardrails, node.declaration.guardrails);
    assertEqual(node.render_blocks, node.declaration.effect.render_blocks ?? []);
    assertEqual(node.required_capabilities, node.declaration.required_capabilities);
    assertEqual(node.steps.length, node.declaration.llm_calls.length);
    const steps = node.steps.map((step, index) => {
      const source = node.declaration.llm_calls[index]!;
      assertEqual([step.name, step.tier, step.consumes, step.produces, step.instructions, step.component_calls],
        [source.name, source.tier, source.consumes, source.produces, source.prompt, source.component_calls ?? []]);
      assertEqual(step.capabilities, source.capabilities ?? node.declaration.required_capabilities);
      const tools = step.tools.map((name) => {
        const owners = Object.entries(node.capability_bindings).filter(([, binding]) => binding.tool === name);
        if (owners.length !== 1 || !step.capabilities.includes(owners[0]![0]) || !["semantic_introspection", "sql_execution:read_only"].includes(owners[0]![0])) throw new Error("Unsupported session tool authority");
        return { name, source: `host:${owners[0]![0]}` };
      });
      return { ...commonStep(source, step.realization), tools };
    });
    components[id] = { id, declaration: node.declaration, steps, ...(node.instructions.brief !== null ? { brief: node.instructions.brief } : {}) };
  }
  return { identity: plan.plan_sha256, entries: [plan.entry], components, contextBinding: plan.context_binding,
    ...(plan.system_prompt ? { systemPrompt: plan.system_prompt } : {}) };
}
