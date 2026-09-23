import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createComponentBroker, type ComponentBrokerOptions } from "../harness/components/broker.js";
import { HOST_FEATURES, planDigest } from "../harness/components/plan.js";
import type { NativeComponentIdentity, NativeComponentPreparation } from "./native-components.js";

const nodeSchema = z.object({ id: z.string().min(1), verb: z.string().min(1), entrypoint: z.boolean().optional(),
  type: z.literal("analytical"), realization_kind: z.literal("skill"), trigger: z.object({ kind: z.literal("one_shot") }),
  required_capabilities: z.array(z.string()), guardrails: z.array(z.record(z.string(), z.unknown())),
  context_binding: z.record(z.string(), z.unknown()),
  llm_calls: z.array(z.object({ tier: z.string().min(1), component_calls: z.array(z.object({ alias: z.string(), component: z.string() })).optional() }).passthrough()),
}).passthrough();
const irSchema = z.object({ warble_ir_version: z.literal("0.8"), components: z.array(z.record(z.string(), z.unknown())) }).passthrough();
const supportedGuards = new Set(["read_only_execution", "row_limit", "statement_timeout", "deterministic_gate", "artifact_write", "additivity_guard", "drill_depth_limit"]);
const execution = ["ordered_steps", "isolated_step_tools", "artifact_provenance", "per_step_tiers", "bounded_repair", "render_contract"];

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The certified provisioner supplies bindings; this module derives scope/closure authority. */
export interface NativeComponentBindings {
  readonly identity: NativeComponentIdentity;
  readonly contexts: ComponentBrokerOptions["contexts"];
  readonly verifierBinary: string;
  readonly prepare: ComponentBrokerOptions["prepare"];
  readonly step: ComponentBrokerOptions["step"];
  readonly normalize: ComponentBrokerOptions["normalize"];
  readonly persistRoot?: ComponentBrokerOptions["persistRoot"];
  readonly onEvent?: ComponentBrokerOptions["onEvent"];
  currentIdentity(): NativeComponentIdentity | undefined;
  /** Includes exact executable/account/generation and context snapshot provenance. */
  assertCurrent(): void;
}

/** Select only composed eligible roots; direct non-composed vendor entries retain their path. */
export function prepareNativeComponentHost(irDocument: string, scope: Readonly<Record<string, unknown>>, bindings: NativeComponentBindings): NativeComponentPreparation | undefined {
  bindings.assertCurrent();
  const identity = freeze(structuredClone(bindings.identity));
  const contexts = freeze(structuredClone(bindings.contexts));
  const assertCurrent = bindings.assertCurrent.bind(bindings);
  const currentIdentity = bindings.currentIdentity.bind(bindings);
  const prepare = bindings.prepare, step = bindings.step, normalize = bindings.normalize;
  const persistRoot = bindings.persistRoot, onEvent = bindings.onEvent, verifierBinary = bindings.verifierBinary;
  const check = () => {
    assertCurrent();
    if (!isDeepStrictEqual(currentIdentity(), identity)) throw new Error("Native component binding expired");
  };
  check();
  const ir = irSchema.parse(JSON.parse(irDocument));
  const nodes = new Map(ir.components.map((node) => [z.string().min(1).parse(node.id), node]));
  if (nodes.size !== ir.components.length) throw new Error("Duplicate component identity");
  const entry = z.union([
    z.object({ kind: z.literal("scope"), prompt: z.string() }).strict(),
    z.object({ kind: z.literal("agent").default("agent"), verb: z.string(), prompt: z.string() }).strict(),
  ]).parse(scope.entry);
  if (identity.vendor === "codex" && entry.kind !== "agent") throw new Error("Codex requires a single pinned entry");
  if (!isDeepStrictEqual(scope.binding, identity.binding)) throw new Error("Native component scope binding mismatch");
  const eligible = [...nodes.values()].filter((node) => node.entrypoint !== false && (entry.kind === "scope" || node.verb === entry.verb));
  if (entry.kind === "agent" && eligible.length !== 1) throw new Error("Unknown or ambiguous pinned entry");
  const roots = eligible.filter((node) => z.array(z.object({ component_calls: z.array(z.unknown()).optional() }).passthrough()).parse(node.llm_calls)
    .some((step) => (step.component_calls?.length ?? 0) > 0));
  if (!roots.length) return undefined;
  const needed = new Set<string>();
  const hostRoots = Object.fromEntries(roots.map((root) => {
    const visited = new Set<string>(); const visiting = new Set<string>();
    const visit = (id: string, depth: number) => {
      if (depth > 8 || visiting.has(id)) throw new Error("Invalid component invocation closure");
      if (visited.has(id)) return;
      const node = nodeSchema.parse(nodes.get(id));
      visiting.add(id);
      for (const guard of node.guardrails) if (!supportedGuards.has(String(guard.name))) throw new Error("Unsupported native component guard");
      for (const call of node.llm_calls) for (const edge of call.component_calls ?? []) visit(edge.component, depth + 1);
      visiting.delete(id); visited.add(id); needed.add(id);
    };
    visit(String(root.id), 0);
    const components = Object.fromEntries([...visited].sort().map((id) => {
      const node = nodeSchema.parse(nodes.get(id));
      const context = contexts[id];
      if (!context || !isDeepStrictEqual(context.binding, node.context_binding)) throw new Error("Missing or mismatched component context");
      const capabilities = Object.fromEntries(node.required_capabilities.filter((capability) => !capability.startsWith("llm:")).map((capability) => {
        if (capability === "sql_execution:read_only") return [capability, { tool: "query_read_only" }];
        if (capability === "semantic_introspection") return [capability, { tool: "inspect_context" }];
        if (["component_invocation", "artifact_write", "render_contract"].includes(capability)) return [capability, {}];
        throw new Error("Unsupported native component capability");
      }));
      return [id, { version: "2", tiers: [...new Set(node.llm_calls.map((call) => call.tier))], guardrails: node.guardrails, capabilities, execution }];
    }));
    return [String(root.id), { version: "2", protocol: "warble-component-host/1", execution: HOST_FEATURES, components }];
  }));
  freeze(hostRoots);
  const selectedContexts = Object.fromEntries([...needed].sort().map((id) => [id, contexts[id]!]));
  const snapshots = Object.fromEntries(Object.entries(selectedContexts).map(([id, value]) => [id, value.snapshot]));
  return freeze<NativeComponentPreparation>({
    identity, hostRoots, contexts: freeze(snapshots), assertCurrent: check,
    async host(root, plan, signal) {
      check(); signal.throwIfAborted();
      const descriptor = hostRoots[root];
      if (!descriptor || plan.entries.length !== 1 || plan.entries[0] !== root || !isDeepStrictEqual(Object.keys(plan.components).sort(), Object.keys(descriptor.components).sort())) throw new Error("Native component root mismatch");
      const rootContexts = Object.fromEntries(Object.keys(plan.components).map((id) => [id, selectedContexts[id]!]));
      const brokerIdentity = { session: identity.session_id, vendor: identity.vendor, account: identity.auth_identity,
        generation: identity.runtime_generation, project: identity.binding.project_identity, bindingRevision: identity.binding.revision,
        contextDigest: planDigest(rootContexts), planDigest: plan.identity };
      return createComponentBroker({ plan, contexts: rootContexts, verifierBinary,
        identity: brokerIdentity, currentIdentity: () => { check(); return signal.aborted ? undefined : brokerIdentity; },
        prepare, step, normalize, ...(persistRoot ? { persistRoot } : {}), ...(onEvent ? { onEvent } : {}),
      });
    },
  });
}
