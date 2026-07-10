import init, { WrenEngine as WasmEngine } from "./wren_core_wasm.js";

export interface WrenProfile {
  /** Data source root: URL prefix for remote Parquet, or any non-empty string for local mode. */
  source: string;
}

export type Granularity =
  | "year"
  | "quarter"
  | "month"
  | "week"
  | "day"
  | "hour"
  | "minute";

export type FilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "is_null"
  | "is_not_null";

export type FilterValue =
  | string
  | number
  | boolean
  | (string | number | boolean)[];

export interface TimeDimensionInput {
  dimension: string;
  granularity: Granularity;
  /** Inclusive start, exclusive end. */
  dateRange?: [string, string];
}

export interface CubeFilterInput {
  dimension: string;
  operator: FilterOperator;
  /** Omit for `is_null`/`is_not_null`. Use an array for `in`/`not_in`. */
  value?: FilterValue;
}

export interface CubeQueryInput {
  cube: string;
  measures: string[];
  dimensions?: string[];
  timeDimensions?: TimeDimensionInput[];
  filters?: CubeFilterInput[];
  limit?: number;
  offset?: number;
}

export interface CubeMeasureInfo {
  name: string;
  expression: string;
  type: string;
}

export interface CubeDimensionInfo {
  name: string;
  expression: string;
  type: string;
}

export interface CubeInfo {
  name: string;
  baseObject: string;
  measures: CubeMeasureInfo[];
  dimensions: CubeDimensionInfo[];
  timeDimensions: CubeDimensionInfo[];
  hierarchies: Record<string, string[]>;
}

/** Subset of Arrow types accepted by {@link CsvReadOptions.schema}. */
export type CsvColumnType =
  | "int8"
  | "int16"
  | "int32"
  | "int64"
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "float32"
  | "float64"
  | "boolean"
  | "string"
  | "utf8"
  | "varchar"
  | "text"
  | "date"
  | "date32"
  | "date64"
  | "timestamp"
  | "timestamp_s"
  | "timestamp_ms"
  | "timestamp_us"
  | "timestamp_ns"
  // Aliases accepted by the Rust side (case-insensitive).
  | "int"
  | "integer"
  | "bigint"
  | "long"
  | "float"
  | "double"
  | "real"
  | "number"
  | "bool";

export interface CsvSchemaColumn {
  name: string;
  type: CsvColumnType | string;
  /** Defaults to true. */
  nullable?: boolean;
}

/**
 * Optional configuration for {@link WrenEngine.registerCsv}. All fields are
 * optional; omit a field to take the arrow-csv default. Single-character
 * fields (delimiter/quote/escape/terminator) take only the first byte of the
 * supplied string and must be ASCII.
 */
export interface CsvReadOptions {
  /** First row is a header. Default: true. */
  header?: boolean;
  /** Field delimiter. Default: ",". */
  delimiter?: string;
  /** Quote character. Default: '"'. */
  quote?: string;
  /** Escape character. Default: unset (no escape). */
  escape?: string;
  /** Record terminator. Default: any of "\\n", "\\r\\n". */
  terminator?: string;
  /** RecordBatch size. Default: 8192. */
  batchSize?: number;
  /** Rows to read for schema inference. Default: 1000. Ignored when `schema` is supplied. */
  inferRows?: number;
  /** Explicit Arrow schema; when set, inference is skipped. */
  schema?: CsvSchemaColumn[];
}

export interface WrenEngineOptions {
  /**
   * WASM binary source. Accepts:
   * - URL string or URL object (fetched in browser)
   * - BufferSource such as ArrayBuffer or Node.js Buffer (instantiated directly)
   *
   * Defaults to sibling wren_core_wasm_bg.wasm resolved via import.meta.url.
   */
  wasmUrl?: string | URL | BufferSource;
}

export class WrenEngine {
  private engine: WasmEngine;

  private constructor(engine: WasmEngine) {
    this.engine = engine;
  }

  /**
   * Initialize engine, loading WASM binary.
   * Call once per page lifecycle.
   */
  static async init(options?: WrenEngineOptions): Promise<WrenEngine> {
    if (options?.wasmUrl) {
      await init({ module_or_path: options.wasmUrl });
    } else {
      await init();
    }
    const engine = new WasmEngine();
    return new WrenEngine(engine);
  }

  /**
   * Load MDL manifest with profile source.
   *
   * @param mdl - MDL manifest object (will be JSON-serialized)
   * @param profile - Profile with source path/URL
   *   - `{ source: "https://cdn/data/" }` — URL mode: auto-registers ListingTables from remote Parquet.
   *     ⚠ URL mode resolves files as `{source}/{bare_name}.parquet`, so models with the same bare
   *     name across different schemas (e.g., `raw.orders` and `staging.orders`) will silently collide.
   *     Use unique bare names or pre-register via local mode until schema-aware layout is supported.
   *   - `{ source: "./data/" }` — local mode: expects pre-registered tables via registerParquet/registerJson
   *   - `{ source: "" }` — fallback: auto-detect from tableReference fields in MDL
   */
  async loadMDL(mdl: object, profile: WrenProfile): Promise<void> {
    const mdlJson = JSON.stringify(mdl);
    await this.engine.loadMDL(mdlJson, profile.source);
  }

  /**
   * Register Parquet data as a named table.
   * Call before loadMDL when using local mode.
   *
   * Accepts any `BufferSource` — ArrayBuffer, TypedArray (e.g., `Uint8Array`), or Node.js Buffer.
   * For TypedArray inputs, the `byteOffset` and `byteLength` view metadata are preserved.
   */
  async registerParquet(name: string, data: BufferSource): Promise<void> {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    await this.engine.registerParquet(name, bytes);
  }

  /**
   * Register JSON data as a named table.
   * Call before loadMDL when using local mode.
   */
  async registerJson(name: string, data: object[]): Promise<void> {
    await this.engine.registerJson(name, JSON.stringify(data));
  }

  /**
   * Register CSV data as a named table.
   * Call before loadMDL when using local mode.
   *
   * `data` may be a CSV string (treated as UTF-8) or any BufferSource —
   * ArrayBuffer, TypedArray (e.g., `Uint8Array`), or Node.js Buffer.
   *
   * By default the first row is treated as a header and the column schema is
   * inferred from the first 1000 rows. Pass {@link CsvReadOptions.schema} to
   * skip inference.
   *
   * @example
   * ```ts
   * await engine.registerCsv("orders", "id,amount\n1,100\n2,200");
   *
   * await engine.registerCsv("metrics", csvBytes, {
   *   header: true,
   *   delimiter: ";",
   *   schema: [
   *     { name: "id", type: "int64" },
   *     { name: "amount", type: "float64" },
   *   ],
   * });
   * ```
   */
  async registerCsv(
    name: string,
    data: string | BufferSource,
    options?: CsvReadOptions,
  ): Promise<void> {
    let bytes: Uint8Array;
    if (typeof data === "string") {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    const optionsJson = options ? JSON.stringify(options) : "";
    await this.engine.registerCsv(name, bytes, optionsJson);
  }

  /**
   * Execute SQL query through the semantic layer.
   * Returns parsed result objects.
   */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    const jsonStr = await this.engine.query(sql);
    if (!jsonStr) return [];
    return JSON.parse(jsonStr);
  }

  /**
   * Execute a structured cube query against the loaded MDL.
   *
   * Translates the CubeQuery to SQL via wren-core, then executes the SQL
   * through the same path as `query()`. Requires `loadMDL` first.
   *
   * Prefer this over hand-written SQL for aggregation queries — the cube
   * layer assembles `GROUP BY`, `DATE_TRUNC`, and `WHERE` clauses for you.
   */
  async cubeQuery(query: CubeQueryInput): Promise<Record<string, unknown>[]> {
    const jsonStr = await this.engine.cubeQuery(JSON.stringify(query));
    if (!jsonStr) return [];
    return JSON.parse(jsonStr);
  }

  /**
   * List the cubes defined in the loaded MDL.
   *
   * Useful for an agent to discover what's queryable before calling
   * `cubeQuery`. Requires `loadMDL` first.
   */
  listCubes(): CubeInfo[] {
    const jsonStr = this.engine.listCubes();
    if (!jsonStr) return [];
    return JSON.parse(jsonStr);
  }

  /** Release WASM memory. */
  free(): void {
    this.engine.free();
  }
}
