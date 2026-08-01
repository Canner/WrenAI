import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ExecutionEnv, ExecutionPolicy } from "../exec/index.js";
import {
  UnknownNativeToolError,
  WrenBinaryNotFoundError,
  WrenIntrospectExecutionError,
  WrenQueryExecutionError,
} from "./errors.js";

/** Builds a fresh AI SDK tool instance for a registered native tool name. */
export type NativeToolFactory = () => Tool;

/**
 * Injectable registry mapping a harness-native tool name (open string, e.g.
 * `write_artifact`) to a factory that builds the AI SDK `Tool` for it.
 * Mirrors the shape of `ProviderRegistry` (harness/providers/registry.ts):
 * an empty registry callers populate, plus a default-populated convenience
 * constructor.
 */
export interface NativeToolRegistry {
  register(name: string, factory: NativeToolFactory): void;
  has(name: string): boolean;
  create(name: string): Tool;
}

export function createNativeToolRegistry(): NativeToolRegistry {
  const factories = new Map<string, NativeToolFactory>();

  return {
    register(name, factory) {
      factories.set(name, factory);
    },
    has(name) {
      return factories.has(name);
    },
    create(name) {
      const factory = factories.get(name);
      if (!factory) {
        throw new UnknownNativeToolError(name);
      }
      return factory();
    },
  };
}

export const WRITE_ARTIFACT_TOOL_NAME = "write_artifact";

/**
 * `write_artifact`: routes the write through the injected `ExecutionEnv`,
 * confined to `policy.artifactWriteScope`. The policy is the
 * `deriveEnforcement`-computed `EnforcementPolicy` for the owning
 * agent — a locked `scoped_write` guardrail is what grants
 * `artifactWriteScope` in the first place, so an agent with no such
 * guardrail gets a policy with no scope and every call fails closed with
 * `WriteScopeNotGrantedError` (thrown by the `ExecutionEnv`, not here).
 * This coexists with a locked `read_only_execution` guardrail by design:
 * `readOnly` gates *data-access* execution (`exec`/non-allowlisted
 * `fetch`), never the scoped artifact write.
 */
export function createWriteArtifactTool(env: ExecutionEnv, policy: ExecutionPolicy): Tool {
  return tool({
    description: "Write an artifact to the agent's scoped workspace.",
    inputSchema: z.object({
      path: z.string(),
      content: z.string(),
    }),
    execute: async (input) => {
      await env.writeFile(input.path, input.content, policy);
      return {
        written: true as const,
        path: input.path,
        bytes: input.content.length,
      };
    },
  });
}

/** A native-tool registry pre-populated with the built-in `write_artifact` and `build_dashboard` tools, bound to `env`/`policy`. */
export function createDefaultNativeToolRegistry(env: ExecutionEnv, policy: ExecutionPolicy): NativeToolRegistry {
  const registry = createNativeToolRegistry();
  registry.register(WRITE_ARTIFACT_TOOL_NAME, () => createWriteArtifactTool(env, policy));
  registry.register(BUILD_DASHBOARD_TOOL_NAME, () => createBuildDashboardTool());
  return registry;
}

export const BUILD_DASHBOARD_TOOL_NAME = "build_dashboard";

/**
 * A dashboard row, as the model may hand it in: either a column-keyed object
 * (the shape `generate_dashboard`'s `chart`/`table` render blocks require),
 * or a positional array aligned to that panel's known key order (`columns`
 * for a table, `[x, ...series]` for a chart). Accepting both keeps the
 * schema forgiving of how a model naturally emits rows it just queried,
 * while `normalizeDashboardRow` below deterministically reshapes either
 * form into the object shape the output contract needs.
 */
const dashboardRowSchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

const kpiCardInputSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  delta: z.number().optional(),
});

const chartInputSchema = z.object({
  chart_type: z.enum(["bar", "line", "pie", "area", "scatter"]),
  x: z.string(),
  series: z.array(z.string()),
  rows: z.array(dashboardRowSchema),
});

const tableInputSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(dashboardRowSchema),
});

const definitionInputSchema = z.object({
  sql: z.string(),
  source_tables: z.array(z.string()).optional(),
  filters: z.array(z.string()).optional(),
});

export const buildDashboardInputSchema = z.object({
  kpi_cards: z.array(kpiCardInputSchema).optional(),
  chart: chartInputSchema.optional(),
  table: tableInputSchema.optional(),
  definition: definitionInputSchema.optional(),
  summary: z.string().optional(),
});

export type BuildDashboardInput = z.infer<typeof buildDashboardInputSchema>;

/** The deterministically-assembled `{blocks}` payload `build_dashboard` returns — already the render-envelope shape `generate_dashboard`'s `output_schema` expects. */
export interface BuildDashboardResult {
  readonly blocks: Record<string, unknown>[];
  readonly summary?: string;
  /**
   * CAVEAT: `verified` here is SELF-DECLARED by the tool's structured input,
   * NOT earned from a real successful `query` call the way the `toolTable`
   * path's `verified` is (that one is tied to `run.ts`'s
   * `sawSuccessfulDataAccessCall`). This is inert today because
   * `generate_dashboard` declares NO locked `gated_check` guardrail, so the
   * deterministic gate never inspects it. If a future profile ever adds a
   * `gated_check` to `generate_dashboard`, this capture path must ALSO be
   * updated to earn `verified` from the real per-panel `query` calls —
   * otherwise the gate would be trivially satisfiable by any `build_dashboard`
   * call carrying hallucinated panel data.
   */
  readonly verified: true;
}

/** Reshapes a row into a plain object: passes an already-object row through; zips a positional array row against `keys`. */
function normalizeDashboardRow(row: Record<string, unknown> | unknown[], keys: readonly string[]): Record<string, unknown> {
  if (!Array.isArray(row)) return row;
  return Object.fromEntries(keys.map((key, index) => [key, row[index]]));
}

/**
 * Deterministically assembles the typed panels the model composed
 * (`kpi_cards`/`chart`/`table`/`definition`) into `generate_dashboard`'s
 * `{blocks}` render contract — one `kpi_card` block per KPI, then `chart`,
 * then `table`, then `definition` (this is the "sensible dashboard order":
 * headline numbers first, then the visual trend/breakdown, then the
 * supporting detail, then the query provenance), each only when the
 * corresponding panel is present in `input`. No LLM call, no I/O — pure
 * reshaping of model-supplied, schema-validated structure, which is what
 * makes this safe to trust as `verified: true` (see `WrenQueryResult`'s own
 * reasoning for why a real, non-erroring data-access result earns
 * `verified`): every panel here was composed by the model from its own
 * queried results, not fabricated by this function.
 */
export function assembleDashboardBlocks(input: BuildDashboardInput): BuildDashboardResult {
  const blocks: Record<string, unknown>[] = [];

  for (const kpi of input.kpi_cards ?? []) {
    blocks.push({
      type: "kpi_card",
      label: kpi.label,
      value: kpi.value,
      ...(kpi.unit !== undefined ? { unit: kpi.unit } : {}),
      ...(kpi.delta !== undefined ? { delta: kpi.delta } : {}),
    });
  }

  if (input.chart) {
    const keys = [input.chart.x, ...input.chart.series];
    blocks.push({
      type: "chart",
      chart_type: input.chart.chart_type,
      x: input.chart.x,
      series: input.chart.series,
      rows: input.chart.rows.map((row) => normalizeDashboardRow(row, keys)),
    });
  }

  if (input.table) {
    const { columns } = input.table;
    blocks.push({
      type: "table",
      columns,
      rows: input.table.rows.map((row) => normalizeDashboardRow(row, columns)),
    });
  }

  if (input.definition) {
    blocks.push({
      type: "definition",
      sql: input.definition.sql,
      source_tables: input.definition.source_tables ?? [],
      filters: input.definition.filters ?? [],
    });
  }

  return {
    blocks,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    verified: true,
  };
}

/**
 * `build_dashboard` (native realization): a schema-enforced, purely
 * deterministic assembly tool. The zod `inputSchema` is what makes the model
 * reliably supply *structured* panels (typed kpi/chart/table/definition
 * shapes) instead of prose it would otherwise have to be trusted to format
 * correctly; `execute` then just reshapes that already-validated input into
 * the render contract — no LLM call, no I/O, so it can never itself fail
 * non-deterministically the way a render-LLM synthesis step can.
 */
export function createBuildDashboardTool(): Tool {
  return tool({
    description:
      "Assemble queried dashboard panels (KPI cards, a chart, a table, and/or the query definition) " +
      "into the final dashboard's render blocks, in dashboard order.",
    inputSchema: buildDashboardInputSchema,
    execute: async (input) => assembleDashboardBlocks(input),
  });
}

export const WREN_QUERY_TOOL_NAME = "query";

export interface WrenQueryToolOptions {
  /** Backend the CLI invocation runs through — never a direct child_process call (mirrors write_artifact's own routing through the injected `ExecutionEnv`). */
  readonly env: ExecutionEnv;
  readonly policy: ExecutionPolicy;
  /** Directory containing `wren_project.yml` + a built `target/mdl.json`; becomes the CLI invocation's cwd. */
  readonly projectDir: string;
}

/** The parsed result of a `query` tool call: `wren -o json`'s JSONL stdout, reshaped into columns + row objects. */
export interface WrenQueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

/**
 * Clamps the model-volunteered `requestedLimit` to the guardrail-derived
 * `policyLimit` (`EnforcementPolicy.rowLimit`), always preferring the
 * smaller. When the model volunteers nothing, the policy limit itself
 * becomes the applied `-l` — a locked-in cap, not just a ceiling on a value
 * the model chose not to supply. When there is no policy limit at all (an
 * agent whose guardrails carry no `row_limit` threshold), the model's
 * requested limit (if any) passes through unclamped.
 */
function clampRowLimit(policyLimit: number | undefined, requestedLimit: number | undefined): number | undefined {
  if (policyLimit === undefined) return requestedLimit;
  if (requestedLimit === undefined) return policyLimit;
  return Math.min(policyLimit, requestedLimit);
}

/**
 * `query` (native realization): runs a read-only SQL query through the real
 * `wren` CLI — `wren -q -o json [-l <limit>] -s '<sql>'` — executed via the
 * injected `ExecutionEnv` with `cwd: projectDir`, exactly like
 * `write_artifact` routes through `env.writeFile` instead of touching the
 * filesystem directly. Declared `mode: "read"` so a locked
 * `read_only_execution` guardrail (which `answer_query` always carries)
 * never blocks it — only `mode: "write"` commands are rejected by a
 * read-only policy (see `ExecutionEnv.exec`'s doc comment).
 *
 * `policy.rowLimit` (guardrail-enforcement fix): clamps `input.limit` via
 * `clampRowLimit`, so a locked `row_limit` guardrail actually bounds `-l`
 * instead of being derived and then ignored. `policy.statementTimeoutSec`
 * becomes `ExecCommand.timeoutMs` on the `wren` invocation, so a locked
 * `statement_timeout` guardrail actually kills a runaway query instead of
 * letting it run unbounded.
 *
 * `wren -o json` prints one JSON object per result row (JSONL, not a JSON
 * array) — this parses that into `{ columns, rows }`, where `columns` are
 * the first row's keys (an empty result set yields `columns: []`).
 */
export function createWrenQueryTool(options: WrenQueryToolOptions): Tool {
  const { env, policy, projectDir } = options;

  return tool({
    description: "Run a read-only SQL query against the wren semantic layer via the native `wren` CLI.",
    inputSchema: z.object({
      sql: z.string(),
      limit: z.number().int().positive().optional(),
    }),
    execute: async (input) => {
      const limit = clampRowLimit(policy.rowLimit, input.limit);
      const args = ["-q", "-o", "json", ...(limit !== undefined ? ["-l", String(limit)] : []), "-s", input.sql];
      const timeoutMs = policy.statementTimeoutSec !== undefined ? policy.statementTimeoutSec * 1000 : undefined;
      const result = await env.exec(
        { mode: "read", command: "wren", args, cwd: projectDir, ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
        policy,
      );
      // A mid-run disappearance of the `wren` binary (e.g.
      // uninstalled/moved after `resolveWrenBinary`'s preflight passed)
      // surfaces here as `ExecResult.notFound`, not just a nonzero
      // `exitCode` — checked first so it throws the specific
      // `WrenBinaryNotFoundError` instead of the generic
      // `WrenQueryExecutionError`, which the repair-fold loop treats as a
      // retryable tool error even though retrying can never help.
      if (result.notFound) {
        throw new WrenBinaryNotFoundError(`"wren" was not found while running this query (spawn ENOENT)`);
      }
      if (result.exitCode !== 0) {
        throw new WrenQueryExecutionError(input.sql, result.exitCode, result.stderr);
      }
      return parseWrenJsonl(result.stdout);
    },
  });
}

function parseWrenJsonl(stdout: string): WrenQueryResult {
  const rows = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return { columns, rows };
}

export const SEMANTIC_INTROSPECT_TOOL_NAME = "semantic_introspect";

/** The parsed result of a `semantic_introspect` tool call: `wren context show -o json`'s single JSON object, passed through as-is (models/relationships/views/cubes/dataSource — the model reads it directly, this tool does no reshaping). */
export type WrenSemanticIntrospectResult = Record<string, unknown>;

/**
 * `semantic_introspect` (native realization): introspects the bound
 * semantic layer via the real `wren` CLI — `wren context show -o json` —
 * executed via the injected `ExecutionEnv` with `cwd: projectDir`, the same
 * shape as {@link createWrenQueryTool}. Declared `mode: "read"` for the same
 * reason `query` is: `explore_model` always carries a locked
 * `read_only_execution` guardrail, and this must never be blocked by it.
 *
 * Unlike `query`, `wren context show -o json` prints a SINGLE JSON object
 * (not JSONL), so this parses with a plain `JSON.parse` rather than
 * `parseWrenJsonl`, and takes no per-call input (introspection covers the
 * whole project, not one statement) — `inputSchema` is deliberately empty.
 *
 * NOTE: `wren cube list` enrichment (cubes/metrics, "if available" per the
 * component's step prompt) is intentionally deferred — it prints plain,
 * non-JSON text (e.g. "No cubes defined.") rather than structured output,
 * which would need its own ad hoc parser for a v1 that's optional per the
 * step prompt anyway.
 */
export function createWrenSemanticIntrospectTool(options: WrenQueryToolOptions): Tool {
  const { env, policy, projectDir } = options;

  return tool({
    description: "Introspect the wren semantic layer's models, columns, relationships, and metrics via the native `wren` CLI.",
    inputSchema: z.object({}),
    execute: async () => {
      const timeoutMs = policy.statementTimeoutSec !== undefined ? policy.statementTimeoutSec * 1000 : undefined;
      const result = await env.exec(
        {
          mode: "read",
          command: "wren",
          args: ["context", "show", "-o", "json"],
          cwd: projectDir,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        },
        policy,
      );
      // Same reasoning as `query`: a mid-run disappearance of the
      // `wren` binary surfaces as `notFound`, checked first so it throws the
      // specific `WrenBinaryNotFoundError` rather than the generic
      // `WrenIntrospectExecutionError`.
      if (result.notFound) {
        throw new WrenBinaryNotFoundError(`"wren" was not found while introspecting the semantic layer (spawn ENOENT)`);
      }
      if (result.exitCode !== 0) {
        throw new WrenIntrospectExecutionError(`exit code ${result.exitCode}\n${result.stderr}`);
      }
      try {
        return JSON.parse(result.stdout) as WrenSemanticIntrospectResult;
      } catch (error) {
        throw new WrenIntrospectExecutionError(
          `could not parse "wren context show -o json" output as JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });
}

/** Options for {@link createWrenNativeToolRegistry} — the `query` tool's options, reused as the registry's binding. */
export type WrenNativeToolOptions = WrenQueryToolOptions;

/**
 * A native-tool registry carrying both the built-in `write_artifact` tool
 * (bound to `options.env`/`options.policy`, same as
 * `createDefaultNativeToolRegistry`) and the real `query` tool wired to
 * `options.projectDir`. Pass this as `RunAgentContext.nativeTools` to
 * resolve an `answer_query` agent whose `query` tool declares
 * `source: "native"` to a real `wren` CLI invocation instead of an MCP
 * server.
 */
export function createWrenNativeToolRegistry(options: WrenNativeToolOptions): NativeToolRegistry {
  const registry = createDefaultNativeToolRegistry(options.env, options.policy);
  registry.register(WREN_QUERY_TOOL_NAME, () => createWrenQueryTool(options));
  registry.register(SEMANTIC_INTROSPECT_TOOL_NAME, () => createWrenSemanticIntrospectTool(options));
  return registry;
}
