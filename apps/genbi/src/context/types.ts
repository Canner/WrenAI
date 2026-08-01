/**
 * Context page domain types — the read-only status view over the semantic
 * layer (models, relationships, cubes/measures) and its knowledge base
 * (instructions + verified Question-SQL pairs). Phase 1 is fixture-driven and
 * read-only; see `src/context/fixtures.ts` for sample data and `README.md`
 * for scope.
 */

/** Which key role a column plays, for the ER diagram's key pill (`PK`/`FK`). */
export type SemanticColumnKey = 'pk' | 'fk';

export interface SemanticColumn {
  name: string;
  type: string;
  key?: SemanticColumnKey;
}

export interface SemanticModel {
  key: string;
  name: string;
  columns: SemanticColumn[];
  /**
   * Top-left position (px) of this model's card on the ER diagram canvas.
   * Optional: the live BFF has no ER layout source for a real project and
   * omits this entirely — `ErDiagram` computes a deterministic layout from
   * `relationships` when it's absent. Fixture data still supplies it.
   */
  position?: { x: number; y: number };
}

export type RelationshipType = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface SemanticRelationship {
  key: string;
  name: string;
  fromModel: string;
  toModel: string;
  type: RelationshipType;
}

export type MeasureAdditivity = 'additive' | 'non-additive';

export interface SemanticMeasure {
  key: string;
  name: string;
  baseModel: string;
  /** The measure's defining expression (mono-displayed in the Measures panel). */
  expression: string;
  additivity: MeasureAdditivity;
}

export interface KnowledgeStatus {
  /** Whether business/domain instructions have been authored for this project. */
  instructionsPresent: boolean;
  /** Count of verified Question-SQL pairs backing the knowledge base. */
  verifiedPairCount: number;
}

/**
 * Live overview fetch result: the full semantic layer (models, relationships,
 * measures) plus knowledge status — the BFF's `GET /api/context/overview`
 * response, mapped onto this module's own types. See `useContextStore`.
 */
export interface ContextOverviewData {
  /** The live project's name/slug, for orienting the Edit CLI prompt (see `EditDropdown`/`buildEditPrompt`). */
  projectName: string;
  /** Full filesystem path the context/project is bound to (empty if unbound). */
  projectPath: string;
  models: SemanticModel[];
  relationships: SemanticRelationship[];
  measures: SemanticMeasure[];
  knowledge: KnowledgeStatus;
}

export type ContextFileKind = 'model' | 'relationship' | 'cube' | 'knowledge' | 'view';

/**
 * A node in the `wren_project` file tree shown in the contextual sidebar.
 * Folders have `children`; files are leaves with `content` (read-only) and,
 * when the file corresponds to a semantic entity, an `entityKey` that maps it
 * to a `BlastRadius` and an editable project path.
 */
export interface ContextFileNode {
  key: string;
  title: string;
  children?: ContextFileNode[];
  kind?: ContextFileKind;
  /** Project-relative path, used for the Edit deep links and CLI prompt. */
  path?: string;
  content?: string;
  /** Key into `blastRadiusByKey`, when this file maps to a semantic entity. */
  entityKey?: string;
}

export type ImpactSeverity = 'none' | 'compatibility' | 'structural' | 'semantic';

export type ImpactNodeKind = 'model' | 'measure' | 'relationship' | 'view';

export interface ImpactNode {
  key: string;
  name: string;
  kind: ImpactNodeKind;
}

/**
 * The semantic layer's impact / blast-radius contract: for a changed entity
 * (`seed`), the set of downstream dependents and the worst-case severity of
 * the change if it were deployed.
 *
 * Severity scale, worst to best:
 * - `semantic`    — a silent downstream measure shift (no schema error, wrong
 *                    numbers). The worst case: nothing breaks loudly, but an
 *                    answer becomes quietly incorrect.
 * - `structural`  — a downstream relationship or join path changes shape.
 * - `compatibility` — a downstream reference still resolves but its meaning
 *                    narrows/widens (e.g. a column type widens).
 * - `none`        — no known downstream dependents.
 *
 * Phase 1 is read-only "depended-on-by" reporting only; deploy-time review
 * (blocking a deploy on severity) is deferred to a later phase.
 */
export interface BlastRadius {
  seed: ImpactNode;
  downstream: ImpactNode[];
  severity: ImpactSeverity;
}

/**
 * A verified Question-SQL pair from the knowledge base whose SQL references
 * the impact seed or one of its downstream dependents, and would therefore
 * start returning wrong (or erroring) answers if the change shipped.
 */
export interface BrokenPair {
  /** The verified natural-language question. */
  question: string;
  /** Semantic-layer entity keys/names the pair's SQL references. */
  refs: string[];
  /** Which of the seed's downstream dependents (by key) this pair actually hits. */
  hitDownstreamKeys: string[];
}

/** The live impact fetch result: the blast radius plus any verified pairs it breaks. */
export interface ImpactData {
  blastRadius: BlastRadius;
  brokenPairs: BrokenPair[];
}
