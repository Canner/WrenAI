/**
 * Render-envelope contract.
 *
 * The agent harness returns a structured answer envelope — `blocks[]` plus a
 * `verified` flag — and this UI renders it (it never assembles SQL itself). The
 * block shapes below mirror the genbi-default agent output_schema, which is the
 * single source of truth; field names are aligned with the reference HTML
 * renderer so both consumers (the static dashboard and this app) stay in sync.
 *
 * The block union is intentionally OPEN (`AnyBlock`) and discriminated by
 * `type`: unknown/future block types (including interactive input blocks the
 * agent may compose later) degrade gracefully instead of breaking the view.
 * This keeps the contract shaped compatibly with agent-driven UI standards
 * (abstract component types + a trusted catalog rendered by our own
 * components) without taking any such dependency now.
 */

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter';

/** A single table cell value (rows are positional arrays; see TableBlock). */
export type Cell = string | number | boolean | null;

/** A chart row: positional array (x first, then one value per series) or an
 * object keyed by the `x` field and each series name. Both are supported. */
export type ChartRow = Array<Cell> | Record<string, Cell>;

export interface KpiCardBlock {
  type: 'kpi_card';
  label: string;
  value: number | string;
  unit?: string | null;
  delta?: number | null;
}

export interface TableBlock {
  type: 'table';
  columns: string[];
  /** Each row is a positional array aligned to `columns` by index, OR an
   * object keyed by column name. Both are supported. */
  rows: Array<Cell[] | Record<string, Cell>>;
}

export interface ChartBlock {
  type: 'chart';
  chart_type: ChartType;
  /** Category / x-axis field. */
  x: string;
  /** One or more series (value) field names. */
  series: string[];
  rows: ChartRow[];
}

export interface DefinitionBlock {
  type: 'definition';
  sql: string;
  source_tables: string[];
  filters: string[];
}

export interface NarrativeBlock {
  type: 'narrative';
  text: string;
  title?: string | null;
}

/** The v1 typed block union (kpi_card / table / chart / definition / narrative). */
export type KnownBlock =
  | KpiCardBlock
  | TableBlock
  | ChartBlock
  | DefinitionBlock
  | NarrativeBlock;

/** Any block, known or not — the extension point for future/unknown types. */
export interface UnknownBlock {
  type: string;
  [key: string]: unknown;
}

export type AnyBlock = KnownBlock | UnknownBlock;

export const KNOWN_BLOCK_TYPES = [
  'kpi_card',
  'table',
  'chart',
  'definition',
  'narrative',
] as const;

export function isKnownBlock(block: AnyBlock): block is KnownBlock {
  return (KNOWN_BLOCK_TYPES as readonly string[]).includes(block.type);
}

/**
 * The answer envelope.
 *
 * `verified` and `summary` come straight from the harness contract. `estimate`
 * is a UI-forward field that is NOT (yet) in the bundle output_schema: it marks
 * an honestly-degraded answer such as a forecast ("projection · basis
 * verified") rather than a green Verified. It renders from fixtures today;
 * promoting it to live data would require widening the agent output_schema.
 */
export interface RenderEnvelope {
  blocks: AnyBlock[];
  summary?: string | null;
  verified?: boolean | null;
  estimate?: boolean | null;
}
