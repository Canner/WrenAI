/**
 * Pure remap from `wren context show`'s output
 * (`server/context-source.ts`) to the frozen UI wire contract
 * (`server/wire-types.ts`). No I/O here; `server/app.ts`'s context routes are
 * the only caller.
 *
 * `wren context show` carries no `key: pk/fk` on columns, no additivity flag
 * on measures, and no ER layout positions — those are inferred/omitted
 * heuristics, not authoritative facts from the semantic layer. Keep the
 * inference simple and readable rather than over-fitting to one project's
 * naming.
 */
import type { WrenContextCube, WrenContextModel, WrenContextRelationship, WrenContextShow } from "./context-source.js";
import type {
  ContextOverview,
  KnowledgeStatus,
  MeasureAdditivity,
  RelationshipType,
  SemanticColumn,
  SemanticColumnKey,
  SemanticMeasure,
  SemanticModel,
  SemanticRelationship,
} from "./wire-types.js";

const JOIN_TYPE_MAP: Record<string, RelationshipType> = {
  ONE_TO_ONE: "one-to-one",
  ONE_TO_MANY: "one-to-many",
  MANY_TO_ONE: "many-to-one",
  MANY_TO_MANY: "many-to-many",
};

/** `wren`'s `joinType` is an upper-snake enum (`"MANY_TO_ONE"`, ...) — falls back to `"one-to-many"` for anything unrecognized rather than throwing, since this is display-only. */
function mapJoinType(joinType: string): RelationshipType {
  return JOIN_TYPE_MAP[joinType] ?? "one-to-many";
}

/**
 * A column is inferred `pk` when it matches the model's declared
 * `primaryKey`, or `fk` when some relationship's `condition` string
 * references `<model.name>.<column.name>` on either side of the join
 * predicate (e.g. `"orders.customer_id = customers.id"` marks
 * `orders.customer_id` as an fk). Both are heuristics over plain-text data —
 * not something `wren context show` asserts directly.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferColumnKey(modelName: string, columnName: string, primaryKey: string | undefined, relationships: readonly WrenContextRelationship[]): SemanticColumnKey | undefined {
  if (primaryKey !== undefined && columnName === primaryKey) return "pk";
  // Match `<model>.<column>` as a whole identifier reference, not a loose
  // substring: the boundaries stop a model whose name is a suffix of another
  // (e.g. `old_customer.id` must NOT satisfy a lookup for `customer.id`) or a
  // column that is a prefix of another (`id` vs `identifier`) from matching.
  const ref = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(modelName)}\\.${escapeRegExp(columnName)}(?![A-Za-z0-9_])`);
  if (relationships.some((rel) => ref.test(rel.condition))) return "fk";
  return undefined;
}

/** Maps `models[]` to `SemanticModel[]`, omitting `position` (no ER layout in `wren context show` — the UI's `ErDiagram` must lay itself out when position is absent). */
export function mapModelsToWire(models: readonly WrenContextModel[], relationships: readonly WrenContextRelationship[]): SemanticModel[] {
  return models.map((model) => {
    const columns: SemanticColumn[] = model.columns.map((col) => {
      const key = inferColumnKey(model.name, col.name, model.primaryKey, relationships);
      return key !== undefined ? { name: col.name, type: col.type, key } : { name: col.name, type: col.type };
    });
    return { key: model.name, name: model.name, columns };
  });
}

/** Maps `relationships[]` (unordered `models:[a,b]` pair) to `SemanticRelationship[]` (`fromModel`/`toModel`). The wire type has no slot for the raw `condition` predicate — it's only consumed internally for fk inference above. */
export function mapRelationshipsToWire(relationships: readonly WrenContextRelationship[]): SemanticRelationship[] {
  return relationships.map((rel) => ({
    key: rel.name,
    name: rel.name,
    fromModel: rel.models[0],
    toModel: rel.models[1],
    type: mapJoinType(rel.joinType),
  }));
}

/**
 * `SUM`/`COUNT` aggregates are additive (safely re-summable across any
 * dimension) — UNLESS the expression is itself a ratio of two such
 * aggregates (e.g. `"SUM(revenue) / SUM(cost)"`), which is never additive
 * regardless of what its parts are made of. `AVG` and anything else default
 * to non-additive — the safer assumption when additivity can't be confirmed
 * from the expression text alone.
 */
export function inferAdditivity(expression: string): MeasureAdditivity {
  const trimmedUpper = expression.trim().toUpperCase();
  if (trimmedUpper.includes("/")) return "non-additive";
  if (/^(SUM|COUNT)\s*\(/.test(trimmedUpper)) return "additive";
  return "non-additive";
}

/** Maps `cubes[]` to `SemanticMeasure[]` — one entry per measure (a cube can declare several), keyed `"<cube>.<measure>"` so measures with the same name in different cubes don't collide. */
export function mapCubesToMeasures(cubes: readonly WrenContextCube[]): SemanticMeasure[] {
  const measures: SemanticMeasure[] = [];
  for (const cube of cubes) {
    for (const measure of cube.measures) {
      measures.push({
        key: `${cube.name}.${measure.name}`,
        name: measure.name,
        baseModel: cube.baseObject,
        expression: measure.expression,
        additivity: inferAdditivity(measure.expression),
      });
    }
  }
  return measures;
}

export function mapContextShowToOverview(contextShow: WrenContextShow, projectName: string, projectPath: string, knowledge: KnowledgeStatus): ContextOverview {
  return {
    models: mapModelsToWire(contextShow.models, contextShow.relationships),
    relationships: mapRelationshipsToWire(contextShow.relationships),
    measures: mapCubesToMeasures(contextShow.cubes),
    knowledge,
    projectName,
    projectPath,
  };
}
