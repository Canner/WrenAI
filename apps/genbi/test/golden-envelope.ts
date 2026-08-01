/**
 * Shared golden fixture for cross-back-end (Mode A vs Mode B) parity: the
 * baseline question + its expected `answer_query` envelope over the
 * `jaffle-wren` sample project, plus a tolerant equivalence relation over
 * envelope-shaped objects.
 *
 * Used by:
 * - `test/parity-contract.test.ts` (hermetic, item B): Mode A driven by the
 *   mock adapter must produce an envelope that both conforms to
 *   `answer_query`'s `output_schema` and `matchesGolden`.
 * - `test/e2e-cross-backend-parity.test.ts` (opt-in live, item D): both real
 *   back-ends must each `matchesGolden` and match each other.
 */

export const PARITY_QUESTION = "who is our single highest-value customer by lifetime value?";

export interface GoldenDefinition {
  readonly sql: string;
  readonly source_tables: readonly string[];
  readonly filters: readonly unknown[];
}

export interface GoldenEnvelope {
  readonly columns: readonly string[];
  readonly rows: readonly unknown[][];
  readonly verified: boolean;
  readonly definition: GoldenDefinition;
}

export const GOLDEN_ENVELOPE: GoldenEnvelope = {
  columns: ["customer_id", "first_name", "last_name", "customer_lifetime_value"],
  rows: [[51, "Howard", "R.", 99.0]],
  verified: true,
  definition: {
    sql:
      "select customer_id, first_name, last_name, customer_lifetime_value " +
      "from customers order by customer_lifetime_value desc limit 1",
    source_tables: ["customers"],
    filters: [],
  },
};

/** Collapses whitespace and case so `definition.sql` may vary in formatting without breaking equivalence. */
function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, " ").toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * The cross-back-end equivalence relation: compares only the fields the
 * golden fixture cares about (`columns`, `rows`, `verified`, and
 * `definition.{source_tables,filters}` exactly, `definition.sql` tolerant of
 * whitespace/case) — ignoring prose (`summary`), rendering-only fields
 * (`blocks`), or any other back-end-specific extras on either side.
 */
export function envelopesMatch(a: unknown, b: unknown): boolean {
  const left = asRecord(a);
  const right = asRecord(b);
  if (!left || !right) return false;

  if (JSON.stringify(left["columns"]) !== JSON.stringify(right["columns"])) return false;
  if (JSON.stringify(left["rows"]) !== JSON.stringify(right["rows"])) return false;
  if (left["verified"] !== right["verified"]) return false;

  const leftDef = asRecord(left["definition"]);
  const rightDef = asRecord(right["definition"]);
  if (!leftDef || !rightDef) return false;
  if (typeof leftDef["sql"] !== "string" || typeof rightDef["sql"] !== "string") return false;
  if (normalizeSql(leftDef["sql"]) !== normalizeSql(rightDef["sql"])) return false;
  if (JSON.stringify(leftDef["source_tables"]) !== JSON.stringify(rightDef["source_tables"])) return false;
  if (JSON.stringify(leftDef["filters"]) !== JSON.stringify(rightDef["filters"])) return false;

  return true;
}

/** Convenience wrapper: does `envelope` match the fixed {@link GOLDEN_ENVELOPE} baseline? */
export function matchesGolden(envelope: unknown): boolean {
  return envelopesMatch(envelope, GOLDEN_ENVELOPE);
}
