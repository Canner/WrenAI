import { z } from "zod";

const stepRealizationSchema = z.object({
  kind: z.enum(["independent", "repair_fold"]),
  fold_into: z.string().optional(),
  max_attempts: z.number().int().nonnegative().optional(),
});

const stepGuardSchema = z.object({
  guard: z.string(),
  target: z.string(),
});

const stepSchema = z.object({
  name: z.string(),
  tier: z.string(),
  consumes: z.array(z.string()),
  produces: z.string(),
  prompt: z.string(),
  realization: stepRealizationSchema,
  when: stepGuardSchema.optional(),
});

const guardrailSchema = z.object({
  enforcement: z.string(),
  locked: z.boolean(),
  threshold: z.number().optional(),
  scope: z.string().optional(),
});

const toolSchema = z.object({
  name: z.string(),
  source: z.string(),
});

const capabilitySchema = z.object({
  capability: z.string(),
  outcome: z.string(),
  provided_by: z.string(),
  criticality: z.string(),
});

// output_schema is a nested JSON Schema document. The harness stores it as-is
// and does not interpret it until a later milestone validates output against it.
const outputSchemaSchema = z.record(z.string(), z.unknown());

// Keep these variants strict. In particular, an available component must not
// silently discard an `availability` marker: doing so would turn a redacted
// unavailable declaration into an executable-looking component downstream.
//
// Strictness has a cost worth naming, because it has already been paid once.
// IR 0.5 added an optional component-level `brief`, and no key for it is
// declared below. Warble omits the field entirely while no profile sets one, so
// nothing fails today — but the first time a profile author writes `brief:` on a
// component, the next dispatch emits that key, `loadBundle` rejects the bundle,
// and `GET /api/harness` starts returning 500 for a reason that has nothing to
// do with the annotation someone just added. That is a deliberate deferral, not
// an oversight: adding a key for a field nothing populates would be guessing at
// its shape. Declare it here when a profile first needs it.
const availableAgentSchema = z.object({
  id: z.string(),
  verb: z.string(),
  component_type: z.string(),
  realization_kind: z.string(),
  trigger: z.string(),
  outcome: z.string(),
  steps: z.array(stepSchema),
  guardrails: z.record(z.string(), guardrailSchema),
  tools: z.array(toolSchema),
  output_schema: outputSchemaSchema,
  capabilities: z.array(capabilitySchema),
}).strict();

/** Read-only manifest variant for a declared component this target cannot execute. */
const unavailableAgentSchema = z.object({
  id: z.string(),
  verb: z.string(),
  component_type: z.string(),
  realization_kind: z.string(),
  trigger: z.string(),
  outcome: z.string(),
  // Fixed empty executable surfaces: display may name the declaration, never
  // carry an executable step, tool, capability, guardrail, or output contract.
  steps: z.tuple([]),
  guardrails: z.object({}).strict(),
  tools: z.tuple([]),
  output_schema: z.object({}).strict(),
  capabilities: z.tuple([]),
  availability: z.object({
    status: z.literal("unavailable"),
    reason: z.literal("component is unavailable on the configured runtime"),
  }).strict(),
}).strict();

// The strict variants make this union a closed discriminator boundary: an
// `availability` field cannot be stripped by the available branch, and only
// the unavailable branch accepts the one supported status/reason pair.
const agentSchema = z.union([availableAgentSchema, unavailableAgentSchema]);

// The bundle's top-level format-version field is target-dependent: `warble
// dispatch --target vercel` names it `vercel_bundle_version`, while the
// claude-agent-sdk dispatcher's `manifest` command (otherwise structurally
// identical — see its doc comment in `repos/warble/dispatcher/claude-agent-sdk`)
// names the same field `manifest_version`. Both are accepted here (the
// `.refine` below requires exactly one to be present) so `loadBundle` works
// for whichever back-end actually produced the bundle; read the field back
// through `bundleFormatVersion` rather than either name directly.
export const bundleSchema = z
  .object({
    vercel_bundle_version: z.string().optional(),
    manifest_version: z.string().optional(),
    compat: z.object({
      min_ir_version: z.string(),
      max_ir_version: z.string(),
    }),
    profile: z.string(),
    target: z.string(),
    agents: z.array(agentSchema),
  })
  .refine((bundle) => bundle.vercel_bundle_version !== undefined || bundle.manifest_version !== undefined, {
    message: 'bundle must include either "vercel_bundle_version" (vercel target) or "manifest_version" (claude-agent-sdk target)',
  });

export type StepRealization = z.infer<typeof stepRealizationSchema>;
export type StepGuard = z.infer<typeof stepGuardSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Guardrail = z.infer<typeof guardrailSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type OutputSchema = z.infer<typeof outputSchemaSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Bundle = z.infer<typeof bundleSchema>;

/**
 * A loaded bundle's format-version, regardless of which top-level key it
 * arrived under (see `bundleSchema`'s doc comment) — the accessor `server/harness.ts`'s
 * `HarnessProfile.bundleVersion` (and any other "what version is this bundle"
 * caller) should use instead of reading either field name directly. Never
 * throws in practice: `bundleSchema`'s `.refine` already guarantees at least
 * one of the two fields is present on any `Bundle` that made it through
 * `loadBundle`.
 */
export function bundleFormatVersion(bundle: Bundle): string {
  const version = bundle.vercel_bundle_version ?? bundle.manifest_version;
  if (version === undefined) {
    throw new Error("bundle has neither vercel_bundle_version nor manifest_version");
  }
  return version;
}
