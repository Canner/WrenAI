/**
 * The set of data sources Setup may offer, read from the one place that
 * actually decides it: the wren CLI's own connector registry, via
 * `wren docs connection-info --format json`.
 *
 * Before this module the same list existed in four hand-maintained copies —
 * the Setup picker (4 entries), this package's connect/adopt allowlist (8),
 * a duplicate of that allowlist in the adopt tests (8), and wren's registry
 * (21) — and they had drifted apart. `app.ts` said so itself: "No canonical
 * connector-type list is currently exported anywhere in this repo (or in
 * warble) to import instead — extend this list as wren gains connectors."
 * There is one now, and it is not a copy.
 *
 * The catalog is descriptive, never prescriptive: it reports what wren
 * supports and what each source's connection needs. Whether a given source's
 * driver is installed is a separate question, answered by `driver.ts`.
 */
import { execFile } from "node:child_process";

/** One connection field, as wren's own JSON-Schema-shaped output describes it. */
export interface SourceField {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  /** wren marks credential fields with `format: "password"`, including inside an `anyOf`. */
  readonly secret: boolean;
  /** wren's own prose for the field, e.g. BigQuery's "Base64 encode `credentials.json`". */
  readonly description?: string;
  /** wren's first worked example, shown as the input's placeholder. */
  readonly example?: string;
  /**
   * A value wren fixes for this field. Variant discriminators carry one —
   * `bigquery_type` is `const: "dataset"` on the dataset variant — so asking
   * the user to type it is asking them to guess a value that is already known.
   */
  readonly fixedValue?: string;
  /** wren's default, when it has one and the field is not fixed. */
  readonly defaultValue?: string;
}

/**
 * A source's connection shape. `bigquery`, `redshift` and `databricks` each
 * publish several — one per authentication style — under `variants`; every
 * other source publishes exactly one, which we normalize to a single unnamed
 * variant so consumers need no special case.
 */
export interface SourceVariant {
  readonly name?: string;
  readonly fields: readonly SourceField[];
  /**
   * How wren tells this variant apart: the field it fixes and the value it
   * fixes it to — `bigquery_type: "dataset"`, `redshift_type: "redshift_iam"`.
   * The value is the stable, human-meaningful handle for the variant (the
   * schema's own name is a Python class name), so it is what the UI offers and
   * what travels on the wire.
   */
  readonly discriminator?: { readonly field: string; readonly value: string };
}

export interface CatalogSource {
  readonly key: string;
  readonly label: string;
  readonly variants: readonly SourceVariant[];
}

export interface SourceCatalog {
  readonly sources: readonly CatalogSource[];
  /**
   * True when this came from the wren CLI. False means the CLI could not be
   * read and `sources` is the built-in floor below — a state the API reports
   * rather than hides, because silently offering four sources when wren
   * supports twenty-one is the bug this module exists to remove.
   */
  readonly fromCli: boolean;
  /** Why the CLI read failed, when `fromCli` is false. */
  readonly degradedReason?: string;
}

export class SourceCatalogError extends Error {}

/**
 * The floor used only when the CLI cannot be read. Deliberately the four the
 * picker shipped before this module, not a guess at the full set: if wren is
 * unreachable we have no basis for claiming more, and under-offering is
 * recoverable where offering a source that cannot exist is not.
 */
const FALLBACK_SOURCE_KEYS = ["postgres", "bigquery", "snowflake", "duckdb"] as const;

/** Display names for the sources whose registry key does not read well raw. */
const DISPLAY_LABELS: Readonly<Record<string, string>> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mssql: "SQL Server",
  bigquery: "BigQuery",
  clickhouse: "ClickHouse",
  duckdb: "Local file (CSV / DuckDB)",
  local_file: "Local file",
  s3_file: "S3 files",
  gcs_file: "Google Cloud Storage files",
  minio_file: "MinIO files",
  datafusion: "DataFusion (in-process files)",
  canner: "Canner Enterprise",
  doris: "Apache Doris",
  spark: "Apache Spark",
  trino: "Trino",
  athena: "Amazon Athena",
  redshift: "Amazon Redshift",
  databricks: "Databricks",
  snowflake: "Snowflake",
  oracle: "Oracle",
  // Not a database: a raw connection string that bypasses per-source field
  // validation. Named so nobody reads it as "some product called Connection URL".
  connection_url: "Other — connection URL",
};

function labelFor(key: string): string {
  return DISPLAY_LABELS[key] ?? key;
}

/** `format: "password"` may sit on the property or inside its `anyOf` branches. */
function isSecret(property: unknown): boolean {
  if (typeof property !== "object" || property === null) return false;
  const record = property as Record<string, unknown>;
  if (record["format"] === "password") return true;
  const anyOf = record["anyOf"];
  return Array.isArray(anyOf) && anyOf.some((branch) => isSecret(branch));
}

function stringOf(property: unknown, key: string): string | undefined {
  if (typeof property !== "object" || property === null) return undefined;
  const value = (property as Record<string, unknown>)[key];
  if (typeof value === "string" && value.length > 0) return value;
  return typeof value === "number" ? String(value) : undefined;
}

function firstExample(property: unknown): string | undefined {
  if (typeof property !== "object" || property === null) return undefined;
  const examples = (property as Record<string, unknown>)["examples"];
  if (!Array.isArray(examples) || examples.length === 0) return undefined;
  const [first] = examples;
  return typeof first === "string" ? first : typeof first === "number" ? String(first) : undefined;
}

function titleOf(property: unknown, name: string): string {
  if (typeof property === "object" && property !== null) {
    const title = (property as Record<string, unknown>)["title"];
    if (typeof title === "string" && title.length > 0) return title;
  }
  return name;
}

function parseVariant(schema: Record<string, unknown>, name?: string): SourceVariant {
  const properties = schema["properties"];
  const requiredRaw = schema["required"];
  const required = new Set(Array.isArray(requiredRaw) ? requiredRaw.filter((entry): entry is string => typeof entry === "string") : []);
  const fields: SourceField[] = [];
  if (typeof properties === "object" && properties !== null) {
    for (const [fieldName, property] of Object.entries(properties as Record<string, unknown>)) {
      const description = stringOf(property, "description");
      const example = firstExample(property);
      const fixedValue = stringOf(property, "const");
      const defaultValue = fixedValue === undefined ? stringOf(property, "default") : undefined;
      fields.push({
        name: fieldName,
        label: titleOf(property, fieldName),
        required: required.has(fieldName),
        secret: isSecret(property),
        ...(description !== undefined ? { description } : {}),
        ...(example !== undefined ? { example } : {}),
        ...(fixedValue !== undefined ? { fixedValue } : {}),
        ...(defaultValue !== undefined ? { defaultValue } : {}),
      });
    }
  }
  const discriminatorField = fields.find((field) => field.fixedValue !== undefined);
  const discriminator =
    discriminatorField?.fixedValue !== undefined ? { field: discriminatorField.name, value: discriminatorField.fixedValue } : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    fields,
    ...(discriminator !== undefined ? { discriminator } : {}),
  };
}

/** Parses the CLI's JSON. Exported so its edge cases are testable without a wren install. */
export function parseSourceCatalog(raw: string): readonly CatalogSource[] {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new SourceCatalogError(`wren docs connection-info did not return JSON: ${(error as Error).message}`);
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new SourceCatalogError("wren docs connection-info returned a non-object document");
  }
  const sources: CatalogSource[] = [];
  for (const [key, value] of Object.entries(document as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    const variantsRaw = entry["variants"];
    if (typeof variantsRaw === "object" && variantsRaw !== null) {
      const variants = Object.entries(variantsRaw as Record<string, unknown>)
        .filter((pair): pair is [string, Record<string, unknown>] => typeof pair[1] === "object" && pair[1] !== null)
        .map(([variantName, schema]) => parseVariant(schema, variantName));
      if (variants.length > 0) sources.push({ key, label: labelFor(key), variants });
      continue;
    }
    sources.push({ key, label: labelFor(key), variants: [parseVariant(entry)] });
  }
  if (sources.length === 0) throw new SourceCatalogError("wren docs connection-info listed no data sources");
  return sources;
}

function runWrenDocs(): Promise<{ stdout: string; stderr: string; error: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    execFile("wren", ["docs", "connection-info", "--format", "json"], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: error as NodeJS.ErrnoException | null });
    });
  });
}

function fallbackCatalog(reason: string): SourceCatalog {
  return {
    sources: FALLBACK_SOURCE_KEYS.map((key) => ({ key, label: labelFor(key), variants: [] })),
    fromCli: false,
    degradedReason: reason,
  };
}

let cached: SourceCatalog | undefined;

/**
 * Reads the catalog once per process. The registry only changes when the wren
 * install does, which cannot happen under a running BFF, so a cache costs
 * nothing in freshness and saves a subprocess on every Setup page load.
 */
export async function loadSourceCatalog(options: { readonly refresh?: boolean } = {}): Promise<SourceCatalog> {
  if (cached !== undefined && options.refresh !== true) return cached;
  const { stdout, stderr, error } = await runWrenDocs();
  if (error !== null) {
    const detail = error.code === "ENOENT" ? "the wren CLI is not on PATH" : (stderr.trim() || error.message);
    cached = fallbackCatalog(`could not read wren's connector registry (${detail})`);
    return cached;
  }
  try {
    cached = { sources: parseSourceCatalog(stdout), fromCli: true };
  } catch (parseError) {
    cached = fallbackCatalog((parseError as Error).message);
  }
  return cached;
}

/** Test seam: drops the per-process cache. */
export function resetSourceCatalogCache(): void {
  cached = undefined;
}

/** The keys Setup will accept for `sourceType`, replacing the old hardcoded allowlist. */
export async function supportedSourceTypes(): Promise<ReadonlySet<string>> {
  const catalog = await loadSourceCatalog();
  return new Set(catalog.sources.map((source) => source.key));
}

/**
 * The `.env` variable names a source's chosen connection shape needs, in the
 * `<SOURCE>_<FIELD>` form the connect turn writes — with the prefix collapsed
 * where the field name already carries it (`bigquery_type` -> BIGQUERY_TYPE,
 * not BIGQUERY_BIGQUERY_TYPE).
 *
 * Naming them removes the guesswork that made the same source produce a
 * different credential form on different runs.
 */
export async function connectionVariableNames(sourceKey: string, variantValue: string): Promise<readonly string[] | undefined> {
  const catalog = await loadSourceCatalog();
  const source = catalog.sources.find((entry) => entry.key === sourceKey);
  const variant = source?.variants.find((entry) => entry.discriminator?.value === variantValue);
  if (variant === undefined) return undefined;
  const prefix = sourceKey.toUpperCase();
  return variant.fields.map((field) => {
    const upper = field.name.toUpperCase();
    return upper.startsWith(`${prefix}_`) || upper === prefix ? upper : `${prefix}_${upper}`;
  });
}
