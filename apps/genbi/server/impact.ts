/**
 * Blast-radius/impact computed live from the REAL bound
 * project's relationship + cube graph (`wren context show`, see
 * `server/context-source.ts`), replacing the earlier seeded-fixture join
 * (`Store.getBlastRadius`/`getVerifiedPairs`).
 *
 * There is no live verified-pair (Q-SQL) source over a real project yet, so
 * `brokenPairs` is always empty here — an honest gap, not a silently-dropped
 * feature (see `KnowledgeStatus.verifiedPairCount`, also forced to 0 for the
 * same reason).
 */
import type { WrenContextShow } from "./context-source.js";
import type { BrokenPair, ImpactNode, ImpactResponse, ImpactSeverity } from "./wire-types.js";

export class EntityKeyNotFoundError extends Error {
  constructor(readonly entityKey: string) {
    super(`no such entity in the bound project's semantic layer: ${entityKey}`);
  }
}

/** A measure's wire key is `"<cube>.<measure>"` (see `mapCubesToMeasures`, `server/context-map.ts`) — look up the owning cube by splitting on the first `.`. */
function findSeed(contextShow: WrenContextShow, entityKey: string): ImpactNode | undefined {
  const model = contextShow.models.find((m) => m.name === entityKey);
  if (model) return { key: model.name, name: model.name, kind: "model" };

  const relationship = contextShow.relationships.find((r) => r.name === entityKey);
  if (relationship) return { key: relationship.name, name: relationship.name, kind: "relationship" };

  for (const cube of contextShow.cubes) {
    const measure = cube.measures.find((m) => `${cube.name}.${m.name}` === entityKey);
    if (measure) return { key: entityKey, name: measure.name, kind: "measure" };
  }

  return undefined;
}

/**
 * One hop of dependents from the seed: a model's downstream is every
 * relationship touching it plus the model on the other side of each, and
 * every cube whose `baseObject` is this model (as its measures); a
 * relationship's downstream is the two models it joins; a measure's
 * downstream is its cube's base model.
 */
function computeDownstream(contextShow: WrenContextShow, seed: ImpactNode): ImpactNode[] {
  const downstream: ImpactNode[] = [];
  const seen = new Set<string>([seed.key]);
  const add = (node: ImpactNode): void => {
    if (seen.has(node.key)) return;
    seen.add(node.key);
    downstream.push(node);
  };

  if (seed.kind === "model") {
    for (const rel of contextShow.relationships) {
      if (!rel.models.includes(seed.key)) continue;
      add({ key: rel.name, name: rel.name, kind: "relationship" });
      const otherModel = rel.models[0] === seed.key ? rel.models[1] : rel.models[0];
      add({ key: otherModel, name: otherModel, kind: "model" });
    }
    for (const cube of contextShow.cubes) {
      if (cube.baseObject !== seed.key) continue;
      for (const measure of cube.measures) {
        add({ key: `${cube.name}.${measure.name}`, name: measure.name, kind: "measure" });
      }
    }
  } else if (seed.kind === "relationship") {
    const relationship = contextShow.relationships.find((r) => r.name === seed.key);
    for (const modelName of relationship?.models ?? []) {
      add({ key: modelName, name: modelName, kind: "model" });
    }
  } else if (seed.kind === "measure") {
    const cubeName = seed.key.slice(0, seed.key.lastIndexOf("."));
    const cube = contextShow.cubes.find((c) => c.name === cubeName);
    if (cube) add({ key: cube.baseObject, name: cube.baseObject, kind: "model" });
  }

  return downstream;
}

/** Any relationship/model downstream means a shape change would ripple structurally; downstream limited to measures is a narrower compatibility risk; no downstream at all is "none". Heuristic, not a computed compatibility analysis. */
function computeSeverity(downstream: readonly ImpactNode[]): ImpactSeverity {
  if (downstream.some((n) => n.kind === "model" || n.kind === "relationship")) return "structural";
  if (downstream.some((n) => n.kind === "measure")) return "compatibility";
  return "none";
}

export function computeImpact(contextShow: WrenContextShow, entityKey: string): ImpactResponse {
  const seed = findSeed(contextShow, entityKey);
  if (!seed) throw new EntityKeyNotFoundError(entityKey);

  const downstream = computeDownstream(contextShow, seed);
  const severity = computeSeverity(downstream);
  const brokenPairs: BrokenPair[] = [];

  return { blastRadius: { seed, downstream, severity }, brokenPairs };
}
