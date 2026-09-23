import { normalizeComponentResult, type ComponentInvocationResult, type RenderBlock } from "@warble/claude-agent-sdk";
import { z } from "zod";
import { checkSemanticGuards, querySemantics, type QuerySemantics } from "./semantic-guards.js";
import type { ComponentEvidence, ComponentPlan } from "./runner.js";

const definitionSchema = z.object({ sql: z.string(), source_tables: z.array(z.string()), filters: z.array(z.string()) }).strict();
const table = z.object({ columns: z.array(z.string()).min(1), rows: z.array(z.record(z.string(), z.unknown())) });
const blocks = z.array(z.object({ type: z.string(), fields: z.record(z.string(), z.string()) }).strict());
const capabilities = z.array(z.string());
function refused(): ComponentInvocationResult {
  return { status: "refused", code: "callee_refused", message: "The component did not produce a grounded result." };
}

/** Child normalization is pure. Data evidence comes from observed tools, never a verified flag. */
export function normalizeComponentEvidence(component: ComponentPlan, evidence: ComponentEvidence, context?: unknown): ComponentInvocationResult {
  const grants = component.steps.flatMap((step) => step.tools);
  const queryNames = new Set(grants.filter((grant) => grant.source === "host:sql_execution:read_only" || (grant.source === "native" && grant.name === "query")).map((grant) => grant.name));
  const observations = evidence.tools.filter((call) => queryNames.has(call.tool));
  const guards = z.array(z.record(z.string(), z.unknown())).parse(component.declaration.guardrails ?? []);
  const semanticGuard = guards.some((guard) => (guard.name === "additivity_guard" && guard.locked === true) || guard.name === "drill_depth_limit");
  const proofs: QuerySemantics[] = [];
  for (const call of observations) {
    const proof = querySemantics.safeParse((call.output as { semantics?: unknown } | null)?.semantics);
    if (proof.success && proof.data.sql === (call.input as { sql?: unknown } | null)?.sql) proofs.push(proof.data);
    else if (semanticGuard) return refused();
  }
  // The public child-result contract carries no semantic query proof. Do not infer
  // additivity from a child's generic verified flag or from its model-authored value.
  if (semanticGuard && evidence.children.length > 0) return refused();
  if (!checkSemanticGuards(guards, proofs, context)) return refused();
  const definitions: z.infer<typeof definitionSchema>[] = [];
  for (const call of observations) {
    const parsed = definitionSchema.safeParse((call.output as { definition?: unknown } | null)?.definition);
    if (parsed.success && parsed.data.sql === (call.input as { sql?: unknown })?.sql) definitions.push(parsed.data);
  }
  const data = observations.map((call) => table.safeParse(call.output)).filter((value) => value.success).map((value) => value.data!);
  const declared = capabilities.parse(component.declaration.required_capabilities);
  const render = blocks.parse((component.declaration.effect as { render_blocks?: unknown }).render_blocks ?? []) as RenderBlock[];
  const steps = component.steps.filter((step) => Object.hasOwn(evidence.steps, step.produces));
  const terminal = steps.at(-1);
  if (!terminal) return refused();
  const lastProduct = evidence.steps[terminal.produces];
  // Tool evidence cannot turn an explicit terminal refusal or error into success.
  let terminalValue: unknown = lastProduct;
  if (typeof lastProduct === "string") {
    try { terminalValue = JSON.parse(lastProduct); } catch { /* Ordinary prose is normalized below. */ }
  }
  if (terminalValue && typeof terminalValue === "object" && "status" in terminalValue
    && ["refused", "error"].includes(String(terminalValue.status))) return refused();
  if (declared.includes("sql_execution:read_only") && data.length === 0) return refused();
  if (render.length === 0 && data.length > 0) {
    const last = observations[observations.length - 1]!;
    const actual = table.safeParse(last.output);
    if (!actual.success) return refused();
    const parsedDefinition = definitionSchema.safeParse((last.output as { definition?: unknown })?.definition);
    const definition = parsedDefinition.success && parsedDefinition.data.sql === (last.input as { sql?: unknown }).sql
      ? parsedDefinition.data : { sql: (last.input as { sql?: unknown }).sql };
    return { status: "ok", output: { kind: "value", value: { ...actual.data, verified: true, summary: "Query completed.", definition } },
      provenance: { verified: true, definition } };
  }
  const result = normalizeComponentResult(typeof lastProduct === "string" ? lastProduct : JSON.stringify(lastProduct), render).value;
  if (result.status !== "ok") return result;
  const composed = component.steps.some((step) => step.calls.length > 0);
  if (composed) {
    if (evidence.children.length === 0 || evidence.children.some((child) => child.status !== "ok" || child.provenance?.verified !== true)) return refused();
    for (const child of evidence.children) {
      if (child.status !== "ok" || child.output.kind !== "value") return refused();
      const parsed = table.safeParse(child.output.value);
      if (!parsed.success) return refused();
      data.push(parsed.data);
      const definition = definitionSchema.safeParse(child.provenance?.definition);
      if (definition.success) definitions.push(definition.data);
    }
  }
  if (result.output.kind === "render" && data.length > 0 && !grounded(result.output.blocks, data, definitions)) return refused();
  // A render with data-bearing blocks cannot earn provenance from prose alone.
  if (result.output.kind === "render" && result.output.blocks.some((block) => ["table", "chart", "kpi_card"].includes(String(block.type))) && data.length === 0) return refused();
  return { ...result, provenance: { ...result.provenance, verified: data.length > 0 } };
}

function grounded(render: readonly Record<string, unknown>[], data: readonly z.infer<typeof table>[], definitions: readonly z.infer<typeof definitionSchema>[]): boolean {
  return render.every((block) => {
    if (block.type === "definition") return definitions.some((definition) => definition.sql === block.sql
      && JSON.stringify(definition.source_tables) === JSON.stringify(block.source_tables) && JSON.stringify(definition.filters) === JSON.stringify(block.filters));
    if (block.type === "kpi_card") return typeof block.label === "string" && data.some((source) => source.columns.includes(block.label as string)
      && source.rows.some((row) => row[block.label as string] === block.value
        && (block.unit === undefined || (Object.hasOwn(row, "unit") && row.unit === block.unit))
        && (block.delta === undefined || (Object.hasOwn(row, "delta") && row.delta === block.delta))));
    if (block.type !== "table" && block.type !== "chart") return true;
    if (!Array.isArray(block.rows)) return false;
    const columns = block.type === "table" ? block.columns : [block.x, ...(Array.isArray(block.series) ? block.series : [])];
    if (!Array.isArray(columns) || !columns.length || new Set(columns).size !== columns.length || !columns.every((value) => typeof value === "string")) return false;
    const sources = data.filter((source) => columns.every((name) => source.columns.includes(name)));
    if (!sources.length) return false;
    if (block.rows.length === 0) return sources.some((source) => source.rows.length === 0);
    return block.rows.every((row) => {
      if (Array.isArray(row) && row.length !== columns.length) return false;
      const values = Array.isArray(row) ? Object.fromEntries(columns.map((name, index) => [name, row[index]])) : row;
      if (!values || typeof values !== "object") return false;
      if (Object.keys(values).length !== columns.length || !columns.every((name) => Object.hasOwn(values, name))) return false;
      return sources.some((source) => source.rows.some((observed) => Object.entries(values).every(([name, value]) => Object.hasOwn(observed, name) && JSON.stringify(observed[name]) === JSON.stringify(value))));
    });
  });
}
