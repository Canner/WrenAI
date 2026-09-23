import { z } from "zod";
import { bundleSchema, type Bundle } from "../bundle/schema.js";
import type { ExecutionPlan } from "./runner.js";

const plans = new WeakMap<Bundle, ExecutionPlan>();
const guard = z.object({ name: z.string(), locked: z.boolean(), threshold: z.number().optional(), scope: z.string().optional() }).passthrough();
const enforcement: Record<string, string> = { read_only_execution: "read_only", artifact_write: "scoped_write", deterministic_gate: "gated_check" };

/** Display projection only. Executable call edges remain in the separate host plan. */
export function describeComponentPlan(plan: ExecutionPlan, profile: string): Bundle {
  const bundle = bundleSchema.parse({ vercel_bundle_version: "0.2", compat: { min_ir_version: "0.8", max_ir_version: "0.8" },
    profile, target: "vercel:headless", agents: plan.entries.map((id) => {
      const node = plan.components[id]!;
      const declaration = node.declaration;
      return { id, entrypoint: true, dependencies: node.steps.flatMap((step) => step.calls.map((call) => ({ step: step.name, ...call }))), verb: declaration.verb, component_type: declaration.type, realization_kind: declaration.realization_kind,
        trigger: "one_shot", outcome: "none", ...(node.brief ? { brief: node.brief } : {}),
        steps: node.steps.map((step) => ({ name: step.name, tier: step.tier, prompt: step.prompt, consumes: step.consumes, produces: step.produces,
          realization: step.repairOf ? { kind: "repair_fold", fold_into: step.repairOf, max_attempts: 1 } : { kind: "independent" },
          ...(step.repairOf ? { when: { guard: "on_failure", target: step.repairOf } } : {}) })),
        tools: [...new Map(node.steps.flatMap((step) => step.tools).map((tool) => [tool.name, tool])).values()],
        guardrails: Object.fromEntries(z.array(guard).parse(declaration.guardrails).map(({ name, ...value }) => [name, { ...value, enforcement: enforcement[name] ?? name }])),
        output_schema: {}, capabilities: z.array(z.string()).parse(declaration.required_capabilities).map((capability) => ({
          capability, outcome: "realize-via", provided_by: "runtime", criticality: "required",
        })),
      };
    }),
  });
  plans.set(bundle, plan);
  return bundle;
}

/** Serialized or caller-invented display projections carry no execution authority. */
export function executionPlanFor(bundle: Bundle): ExecutionPlan | undefined { return plans.get(bundle); }
