import { z } from "zod";
const ref = z.object({ owner: z.string().min(1), name: z.string().min(1) }).strict();
export const querySemantics = z.object({ version: z.literal("1"), sql: z.string(), metrics: z.array(ref).min(1), dimensions: z.array(ref), temporal_dimensions: z.array(ref) }).strict();
export type QuerySemantics = z.infer<typeof querySemantics>;
const key = (value: z.infer<typeof ref>) => JSON.stringify([value.owner, value.name]);
const prepared = z.object({ context_version: z.literal(2), parseable: z.literal(true),
  metrics: z.array(ref.extend({ declared: z.boolean(), additivity: z.string().nullable() })),
  dimensions: z.array(ref.extend({ is_temporal: z.boolean() })),
});

/** Guard evidence originates in the bound query host; model products cannot satisfy it. */
export function checkSemanticGuards(guards: readonly Record<string, unknown>[], proofs: readonly QuerySemantics[], context: unknown): boolean {
  const additive = guards.some((guard) => guard.name === "additivity_guard" && guard.locked === true);
  const drill = guards.find((guard) => guard.name === "drill_depth_limit");
  if (!additive && !drill) return true;
  const snapshot = prepared.safeParse(context);
  if (!snapshot.success || proofs.length === 0) return false;
  const limit = drill ? z.number().int().nonnegative().safeParse(drill.threshold) : undefined;
  if (limit && !limit.success) return false;
  const dimensions = new Set<string>();
  let temporal = false;
  for (const proof of proofs) {
    for (const metric of proof.metrics) {
      const matches = snapshot.data.metrics.filter((member) => key(member) === key(metric));
      if (matches.length !== 1 || !matches[0]!.declared || (additive && matches[0]!.additivity !== "additive")) return false;
    }
    for (const [members, isTemporal] of [[proof.dimensions, false], [proof.temporal_dimensions, true]] as const) {
      for (const dimension of members) {
        const matches = snapshot.data.dimensions.filter((member) => key(member) === key(dimension));
        if (matches.length !== 1 || matches[0]!.is_temporal !== isTemporal) return false;
        if (isTemporal) temporal = true;
        else dimensions.add(key(dimension));
      }
    }
  }
  return temporal && (!limit?.success || dimensions.size <= limit.data);
}
