/**
 * Native-session Save to Artifacts boundary.  The MCP route is deliberately
 * thin: this service owns every validation and persistence decision so a
 * future typed HTTP caller cannot drift from the agent-facing contract.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { newId, type NativeSessionRow, type NativeStructuredAnswerRow, type Store } from "./db.js";
import type { EnrichmentBinding } from "./enrichment.js";

const MAX_DASHBOARD_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 120;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const ANSWER_REFERENCE_PATTERN = /^answer-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const NATIVE_MCP_CREDENTIAL_ENV_VAR = "WARBLE_MCP_CONNECTION_CREDENTIAL";
export const NATIVE_MCP_TOOL_NAME = "save_dashboard";
export const NATIVE_MCP_PERSIST_ANSWER_TOOL_NAME = "persist_answer";
export const NATIVE_MCP_SERVER_LABEL = "GenBI MCP";
export const NATIVE_MCP_ARTIFACTS_LABEL = "GenBI Artifacts";

// Keep this JSON Schema compatible with the ECMA-262 regular-expression
// dialect required by JSON Schema: JavaScript has no inline case-insensitive
// flag, so the executable-text fence is spelled out with character classes.
const EXECUTABLE_TEXT_PATTERN = "<\\s*\\/?(?:[sS][cC][rR][iI][pP][tT]|[hH][tT][mM][lL])\\b|[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]\\s*:";
const SAFE_TEXT_SCHEMA = { type: "string", not: { pattern: EXECUTABLE_TEXT_PATTERN } } as const;
const NULLABLE_SAFE_TEXT_SCHEMA = { anyOf: [SAFE_TEXT_SCHEMA, { type: "null" }] } as const;
const SAFE_TEXT_OR_NUMBER_SCHEMA = { anyOf: [SAFE_TEXT_SCHEMA, { type: "number" }] } as const;
const SCALAR_SCHEMA = { anyOf: [SAFE_TEXT_SCHEMA, { type: "number" }, { type: "boolean" }, { type: "null" }] } as const;

/**
 * Rules that relate sibling fields and therefore cannot be expressed by the
 * JSON Schema vocabulary used by MCP. These descriptions and the executable
 * helpers below form the advertised second validation layer.
 */
export const NATIVE_SAVE_DASHBOARD_SEMANTIC_CONSTRAINTS = {
  table: {
    positionalRows: "Positional scalar rows in columns order. Each row must contain exactly one cell per columns entry.",
  },
  chart: {
    x: "The x field must not also appear in series.",
    series: "Each series item must differ from x.",
    positionalRows: "Positional scalar rows in [x, ...series] order. Each row must contain exactly one x cell plus one cell per series entry.",
  },
} as const;

/**
 * The canonical row transport form is a positional scalar array. A standard
 * JSON Schema cannot make an item-array's length depend on sibling `columns`
 * or `[x, ...series]`, so object-keyed rows are deliberately not advertised.
 * The host still enforces that positional lengths exactly match those sibling
 * fields before persistence.
 * The host continues to accept its previous, exactly bound object-row form
 * for stored-client compatibility.
 */
const POSITIONAL_ROWS_SCHEMA = {
  type: "array",
  items: { type: "array", items: SCALAR_SCHEMA },
} as const;

/** The exact public MCP shape advertised to native clients and accepted by the host. */
export const NATIVE_SAVE_DASHBOARD_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "name", "idempotency_key"],
  oneOf: [
    { required: ["envelope"], not: { required: ["answer_ref"] } },
    { required: ["answer_ref"], not: { required: ["envelope"] } },
  ],
  properties: {
    version: { anyOf: [{ const: "1" }, { const: 1 }], description: "Use the canonical string literal \"1\". Numeric 1 is accepted for Claude Code compatibility and is canonicalized before persistence." },
    name: { ...SAFE_TEXT_SCHEMA, minLength: 1, maxLength: MAX_NAME_LENGTH, pattern: "\\S" },
    idempotency_key: { ...SAFE_TEXT_SCHEMA, minLength: 8, maxLength: MAX_IDEMPOTENCY_KEY_LENGTH, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]+$" },
    answer_ref: { ...SAFE_TEXT_SCHEMA, pattern: "^answer-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", description: "Opaque reference returned by persist_answer for this native session." },
    envelope: {
      type: "object", additionalProperties: false, required: ["blocks", "verified"],
      properties: {
        verified: { const: true }, summary: NULLABLE_SAFE_TEXT_SCHEMA, estimate: { type: ["boolean", "null"] },
        blocks: {
          type: "array", minItems: 1,
          items: { oneOf: [
            { type: "object", additionalProperties: false, required: ["type", "label", "value"], properties: { type: { const: "kpi_card" }, label: SAFE_TEXT_SCHEMA, value: SAFE_TEXT_OR_NUMBER_SCHEMA, unit: NULLABLE_SAFE_TEXT_SCHEMA, delta: { type: ["number", "null"] } } },
            { type: "object", additionalProperties: false, required: ["type", "columns", "rows"], properties: { type: { const: "table" }, columns: { type: "array", minItems: 1, uniqueItems: true, items: { ...SAFE_TEXT_SCHEMA, minLength: 1 } }, rows: { ...POSITIONAL_ROWS_SCHEMA, description: NATIVE_SAVE_DASHBOARD_SEMANTIC_CONSTRAINTS.table.positionalRows } } },
            { type: "object", additionalProperties: false, required: ["type", "chart_type", "x", "series", "rows"], properties: { type: { const: "chart" }, chart_type: { enum: ["bar", "line", "pie", "area", "scatter"] }, x: { ...SAFE_TEXT_SCHEMA, minLength: 1, description: NATIVE_SAVE_DASHBOARD_SEMANTIC_CONSTRAINTS.chart.x }, series: { type: "array", minItems: 1, uniqueItems: true, description: NATIVE_SAVE_DASHBOARD_SEMANTIC_CONSTRAINTS.chart.series, items: { ...SAFE_TEXT_SCHEMA, minLength: 1 } }, rows: { ...POSITIONAL_ROWS_SCHEMA, description: NATIVE_SAVE_DASHBOARD_SEMANTIC_CONSTRAINTS.chart.positionalRows } } },
            { type: "object", additionalProperties: false, required: ["type", "sql", "source_tables", "filters"], properties: { type: { const: "definition" }, sql: { ...SAFE_TEXT_SCHEMA, minLength: 1 }, source_tables: { type: "array", minItems: 1, items: { ...SAFE_TEXT_SCHEMA, minLength: 1 } }, filters: { type: "array", items: SAFE_TEXT_SCHEMA } } },
            { type: "object", additionalProperties: false, required: ["type", "text"], properties: { type: { const: "narrative" }, text: { ...SAFE_TEXT_SCHEMA, minLength: 1 }, title: NULLABLE_SAFE_TEXT_SCHEMA } },
          ] },
        },
      },
    },
  },
} as const;

const NATIVE_STRUCTURED_ANSWER_BLOCK_SCHEMA = {
  oneOf: [
    NATIVE_SAVE_DASHBOARD_INPUT_SCHEMA.properties.envelope.properties.blocks.items.oneOf[1],
    NATIVE_SAVE_DASHBOARD_INPUT_SCHEMA.properties.envelope.properties.blocks.items.oneOf[3],
  ],
} as const;

const NATIVE_STRUCTURED_ANSWER_ENVELOPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocks", "verified"],
  properties: {
    verified: { const: true },
    blocks: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: NATIVE_STRUCTURED_ANSWER_BLOCK_SCHEMA,
      allOf: [
        { contains: { type: "object", properties: { type: { const: "table" } }, required: ["type"] } },
      ],
    },
  },
} as const;

/**
 * The producer persists only the existing answer_query result blocks. The
 * semantic validator below requires exactly one table and allows at most one
 * definition block. It rejects summary/chart/raw/transcript-shaped additions.
 */
export const NATIVE_PERSIST_ANSWER_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "idempotency_key", "envelope"],
  properties: {
    version: { const: "1" },
    idempotency_key: { ...SAFE_TEXT_SCHEMA, minLength: 8, maxLength: MAX_IDEMPOTENCY_KEY_LENGTH, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]+$", description: "Caller retry key only; the host mints canonical answer provenance." },
    envelope: NATIVE_STRUCTURED_ANSWER_ENVELOPE_SCHEMA,
  },
} as const;

export interface NativeMcpDescriptor {
  readonly version: "1";
  readonly url: string;
  readonly credential: string;
}

export interface NativeMcpReadiness {
  readonly available: boolean;
  readonly reason?: string;
}

/** Browser-safe health projection; credentials and binding details stay server-side. */
export interface NativeMcpHealth extends NativeMcpReadiness {
  readonly server: typeof NATIVE_MCP_SERVER_LABEL;
  readonly tool: typeof NATIVE_MCP_TOOL_NAME;
  readonly destination: typeof NATIVE_MCP_ARTIFACTS_LABEL;
}

interface NativeArtifactContext {
  readonly session: NativeSessionRow;
  readonly binding: EnrichmentBinding | undefined;
}

function sameBinding(a: EnrichmentBinding, b: EnrichmentBinding | undefined): boolean {
  return b !== undefined && a.path === b.path && a.identity === b.identity && a.generation === b.generation && a.revision === b.revision;
}

export interface SaveDashboardPayloadInput {
  readonly version: "1";
  readonly name: string;
  readonly envelope: unknown;
  readonly idempotency_key: string;
}

export interface SaveDashboardReferenceInput {
  readonly version: "1";
  readonly name: string;
  readonly answer_ref: string;
  readonly idempotency_key: string;
}

export type SaveDashboardInput = SaveDashboardPayloadInput | SaveDashboardReferenceInput;

export interface PersistStructuredAnswerInput {
  readonly version: "1";
  readonly idempotency_key: string;
  readonly envelope: unknown;
}

export interface PersistedStructuredAnswer {
  readonly answer_ref: string;
  readonly digest: string;
  readonly persisted_at: string;
}

export interface SavedNativeArtifact {
  readonly artifact_id: string;
  readonly saved_at: string;
  readonly source_href: string;
}

export class NativeArtifactError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function scalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Shared executable counterpart of the advertised positional-row rules. */
export function hasExactNativePositionalRow(row: unknown, expectedLength: number): boolean {
  return Array.isArray(row) && row.length === expectedLength && row.every(scalar);
}

/** Shared executable counterpart of the advertised chart x/series rule. */
export function hasDistinctNativeChartSeries(x: unknown, series: unknown): series is string[] {
  return typeof x === "string" && x.length > 0 && Array.isArray(series) && series.length > 0 && series.every((item) => typeof item === "string" && item.length > 0 && item !== x) && new Set(series).size === series.length;
}

/** The complete MCP contract: mechanically checked schema plus semantic rules. */
export const NATIVE_SAVE_DASHBOARD_CONTRACT = {
  inputSchema: NATIVE_SAVE_DASHBOARD_INPUT_SCHEMA,
  semanticConstraints: NATIVE_SAVE_DASHBOARD_SEMANTIC_CONSTRAINTS,
  hasExactPositionalRow: hasExactNativePositionalRow,
  hasDistinctChartSeries: hasDistinctNativeChartSeries,
} as const;

export const NATIVE_PERSIST_ANSWER_CONTRACT = {
  inputSchema: NATIVE_PERSIST_ANSWER_INPUT_SCHEMA,
  semanticConstraint: "The envelope contains exactly one typed table block and at most one typed definition block, with no presentation-only fields.",
} as const;

function rejectsExecutableText(value: unknown): boolean {
  if (typeof value === "string") return /<\s*\/?(?:script|html)\b|javascript\s*:/i.test(value);
  if (Array.isArray(value)) return value.some(rejectsExecutableText);
  return isRecord(value) && Object.entries(value).some(([key, child]) => /(?:^|_)(?:path|file|html)(?:$|_)/i.test(key) || rejectsExecutableText(child));
}

function validRows(value: unknown, columns: readonly string[]): boolean {
  return Array.isArray(value) && value.every((row) =>
    Array.isArray(row)
      // JSON Schema cannot bind length to sibling `columns`, but the host must:
      // ignored trailing cells would weaken the persistence boundary.
      ? NATIVE_SAVE_DASHBOARD_CONTRACT.hasExactPositionalRow(row, columns.length)
      // Object rows remain a private backward-compatible input form and keep
      // the original exact column binding.
      : isRecord(row) && columns.every((column) => scalar(row[column])) && Object.keys(row).every((key) => columns.includes(key)),
  );
}

function validBlock(block: unknown): boolean {
  if (!isRecord(block) || typeof block.type !== "string") return false;
  switch (block.type) {
    case "kpi_card":
      return onlyKeys(block, ["type", "label", "value"]) || onlyKeys(block, ["type", "label", "value", "unit"]) || onlyKeys(block, ["type", "label", "value", "delta"]) || onlyKeys(block, ["type", "label", "value", "unit", "delta"])
        ? typeof block.label === "string" && (typeof block.value === "string" || typeof block.value === "number") && (block.unit === undefined || block.unit === null || typeof block.unit === "string") && (block.delta === undefined || block.delta === null || typeof block.delta === "number")
        : false;
    case "table":
      return onlyKeys(block, ["type", "columns", "rows"]) && Array.isArray(block.columns) && block.columns.length > 0 && block.columns.every((column) => typeof column === "string" && column.length > 0) && new Set(block.columns).size === block.columns.length && validRows(block.rows, block.columns as string[]);
    case "chart":
      if (!onlyKeys(block, ["type", "chart_type", "x", "series", "rows"])) return false;
      const x = block.x;
      const series = block.series;
      const rows = block.rows;
      return ["bar", "line", "pie", "area", "scatter"].includes(String(block.chart_type)) && typeof x === "string" && NATIVE_SAVE_DASHBOARD_CONTRACT.hasDistinctChartSeries(x, series) && Array.isArray(rows) && rows.every((row) => Array.isArray(row)
        // JSON Schema cannot bind length to sibling x + series, but the host
        // must keep the persisted row exact (never silently ignore a cell).
        ? NATIVE_SAVE_DASHBOARD_CONTRACT.hasExactPositionalRow(row, series.length + 1)
        // Existing object rows remain exactly bound to x + series.
        : isRecord(row) && scalar(row[x]) && series.every((item) => scalar(row[item])) && Object.keys(row).every((key) => key === x || series.includes(key)));
    case "definition":
      return onlyKeys(block, ["type", "sql", "source_tables", "filters"]) && typeof block.sql === "string" && block.sql.length > 0 && Array.isArray(block.source_tables) && block.source_tables.length > 0 && block.source_tables.every((source) => typeof source === "string" && source.length > 0) && Array.isArray(block.filters) && block.filters.every((filter) => typeof filter === "string");
    case "narrative":
      return (onlyKeys(block, ["type", "text"]) || onlyKeys(block, ["type", "text", "title"])) && typeof block.text === "string" && block.text.length > 0 && (block.title === undefined || block.title === null || typeof block.title === "string");
    default:
      return false;
  }
}

function validateDashboardEnvelope(envelope: unknown): void {
  if (!isRecord(envelope) || !Object.hasOwn(envelope, "blocks") || !Object.hasOwn(envelope, "verified") || !Object.keys(envelope).every((key) => ["blocks", "summary", "verified", "estimate"].includes(key))) throw new NativeArtifactError("invalid dashboard render envelope: expected blocks and verified with optional summary or estimate");
  if (envelope.verified !== true) throw new NativeArtifactError("invalid dashboard render envelope: verified must be true");
  if (!Array.isArray(envelope.blocks) || envelope.blocks.length === 0) throw new NativeArtifactError("invalid dashboard render envelope: blocks must be a non-empty array");
  const invalidBlock = envelope.blocks.findIndex((block) => !validBlock(block));
  if (invalidBlock !== -1) throw new NativeArtifactError(`invalid dashboard render envelope: block ${invalidBlock + 1} has an unsupported type, field, or row shape`);
  if (envelope.summary !== undefined && envelope.summary !== null && typeof envelope.summary !== "string") throw new NativeArtifactError("invalid dashboard render envelope: summary must be a string or null");
  if (envelope.estimate !== undefined && envelope.estimate !== null && typeof envelope.estimate !== "boolean") throw new NativeArtifactError("invalid dashboard render envelope: estimate must be a boolean or null");
}

function validateInput(value: unknown): SaveDashboardInput {
  if (!isRecord(value) || !Object.keys(value).every((key) => ["version", "name", "envelope", "answer_ref", "idempotency_key"].includes(key))) throw new NativeArtifactError("invalid Save to Artifacts payload: expected version, name, idempotency_key, and exactly one of envelope or answer_ref");
  // Claude Code 2.1.227 was observed coercing the schema's const "1" to numeric
  // 1. Accept that one semantically identical wire alias, then canonicalize it;
  // every other version remains a loud fail.
  if (value.version !== "1" && value.version !== 1) throw new NativeArtifactError("invalid Save to Artifacts payload: version must be the string \"1\" or numeric 1");
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > MAX_NAME_LENGTH) throw new NativeArtifactError("invalid Save to Artifacts payload: name must be a non-empty string of at most 120 characters");
  if (typeof value.idempotency_key !== "string" || value.idempotency_key.length < 8 || value.idempotency_key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(value.idempotency_key)) throw new NativeArtifactError("invalid Save to Artifacts payload: idempotency_key is invalid");
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > MAX_DASHBOARD_BYTES) throw new NativeArtifactError("invalid Save to Artifacts payload: payload exceeds 256 KiB");
  if (rejectsExecutableText(value)) throw new NativeArtifactError("invalid Save to Artifacts payload: executable content or file fields are not allowed");
  const hasEnvelope = Object.hasOwn(value, "envelope");
  const hasReference = Object.hasOwn(value, "answer_ref");
  if (hasEnvelope === hasReference) throw new NativeArtifactError("invalid Save to Artifacts payload: provide exactly one of envelope or answer_ref");
  if (hasEnvelope) {
    validateDashboardEnvelope(value.envelope);
    return { version: "1", name: value.name, envelope: value.envelope, idempotency_key: value.idempotency_key };
  }
  if (typeof value.answer_ref !== "string" || !ANSWER_REFERENCE_PATTERN.test(value.answer_ref)) throw new NativeArtifactError("invalid Save to Artifacts payload: answer_ref is invalid");
  return { version: "1", name: value.name, answer_ref: value.answer_ref, idempotency_key: value.idempotency_key };
}

function validatePersistedStructuredAnswer(value: unknown): PersistStructuredAnswerInput {
  if (!isRecord(value) || !onlyKeys(value, ["version", "idempotency_key", "envelope"])) throw new NativeArtifactError("invalid structured answer payload: expected exactly version, idempotency_key, and envelope");
  if (value.version !== "1") throw new NativeArtifactError("invalid structured answer payload: version must be the string \"1\"");
  if (typeof value.idempotency_key !== "string" || value.idempotency_key.length < 8 || value.idempotency_key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(value.idempotency_key)) throw new NativeArtifactError("invalid structured answer payload: idempotency_key is invalid");
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_DASHBOARD_BYTES) throw new NativeArtifactError("invalid structured answer payload: payload exceeds 256 KiB");
  if (rejectsExecutableText(value)) throw new NativeArtifactError("invalid structured answer payload: executable content or file fields are not allowed");
  validateDashboardEnvelope(value.envelope);
  if (!isRecord(value.envelope) || !onlyKeys(value.envelope, ["blocks", "verified"]) || !Array.isArray(value.envelope.blocks) || value.envelope.blocks.length < 1 || value.envelope.blocks.length > 2 || value.envelope.blocks.filter((block) => isRecord(block) && block.type === "table").length !== 1 || value.envelope.blocks.filter((block) => isRecord(block) && block.type === "definition").length > 1 || value.envelope.blocks.some((block) => !isRecord(block) || (block.type !== "table" && block.type !== "definition"))) {
    throw new NativeArtifactError("invalid structured answer payload: envelope must contain exactly one table and at most one definition block");
  }
  return { version: "1", idempotency_key: value.idempotency_key, envelope: value.envelope };
}

function structuredAnswerDigest(envelopeJson: string): string {
  return `sha256:${createHash("sha256").update(envelopeJson).digest("hex")}`;
}

function validateStoredStructuredAnswer(source: NativeStructuredAnswerRow, nativeSessionId: string): void {
  if (source.nativeSessionId !== nativeSessionId) throw new NativeArtifactError("persisted answer reference does not belong to this native session", 409);
  if (structuredAnswerDigest(source.envelopeJson) !== source.digest) throw new NativeArtifactError("persisted answer reference failed integrity validation", 409);
  try {
    const envelope = JSON.parse(source.envelopeJson) as unknown;
    validatePersistedStructuredAnswer({ version: "1", idempotency_key: "stored-answer-validation", envelope });
  } catch (error) {
    if (error instanceof NativeArtifactError && error.message === "persisted answer reference failed integrity validation") throw error;
    throw new NativeArtifactError("persisted answer reference failed integrity validation", 409);
  }
}

export interface NativeArtifactServiceOptions {
  readonly store: Store;
  readonly artifactsRoot: string;
  /** Canonical local BFF endpoint derived from its actual listener port. */
  readonly expectedMcpUrl: string;
  /** Optional override, accepted only when it is the expected local endpoint. */
  readonly mcpUrl: string;
  readonly getBinding: () => EnrichmentBinding | undefined;
  /** Test-only seam; production writes one contained JSON file atomically. */
  readonly writeAtomic?: (target: string, contents: string) => void;
  /** Test-only seam for a persistence outage; production uses the typed Store method. */
  readonly persistStructuredAnswer?: (input: {
    readonly id: string; readonly nativeSessionId: string; readonly idempotencyKey: string;
    readonly envelopeJson: string; readonly digest: string;
  }) => { readonly row: NativeStructuredAnswerRow; readonly created: boolean };
}

export class NativeArtifactService {
  private readonly credentials = new Map<string, NativeArtifactContext>();
  constructor(private readonly options: NativeArtifactServiceOptions) {}

  /** Validate the exact local BFF endpoint before advertising or issuing it. */
  readiness(): NativeMcpReadiness {
    try {
      const url = new URL(this.options.mcpUrl);
      const expected = new URL(this.options.expectedMcpUrl);
      const validLocalEndpoint = (candidate: URL): boolean => candidate.protocol === "http:" && candidate.hostname === "127.0.0.1" && !candidate.username && !candidate.password && candidate.pathname === "/api/native-sessions/mcp" && !candidate.search && !candidate.hash;
      if (!validLocalEndpoint(url) || !validLocalEndpoint(expected) || url.href !== expected.href) {
        return { available: false, reason: "native MCP URL is invalid" };
      }
      return { available: true };
    } catch {
      return { available: false, reason: "native MCP URL is invalid" };
    }
  }

  issue(session: NativeSessionRow, binding: EnrichmentBinding | undefined): NativeMcpDescriptor {
    if (!this.readiness().available) throw new NativeArtifactError("native MCP URL is invalid", 500);
    const credential = randomUUID();
    // Vendor discovery material contains this opaque credential and cannot be
    // patched in a live terminal. Keep it valid for the owning live session;
    // every terminal/runtime/binding lifecycle edge revokes it explicitly.
    this.credentials.set(credential, { session, binding });
    return { version: "1", url: this.options.mcpUrl, credential };
  }

  revoke(credential: string | undefined): void {
    if (!credential) return;
    this.credentials.delete(credential);
  }

  /** Releases opaque credentials when the owning BFF service shuts down. */
  dispose(): void { for (const credential of [...this.credentials.keys()]) this.revoke(credential); }

  hasCredential(credential: string | undefined): boolean { return credential !== undefined && this.credentials.has(credential); }

  health(): NativeMcpHealth {
    return {
      server: NATIVE_MCP_SERVER_LABEL,
      tool: NATIVE_MCP_TOOL_NAME,
      destination: NATIVE_MCP_ARTIFACTS_LABEL,
      ...this.readiness(),
    };
  }

  /**
   * Resolves the live session behind an opaque MCP credential without exposing
   * its secret or binding. The generic MCP route uses this before purpose/tool
   * allowlisting; artifact persistence applies its stricter bound-project
   * fence below.
   */
  authorize(credential: string | undefined): NativeSessionRow {
    const context = credential === undefined ? undefined : this.credentials.get(credential);
    if (!context) throw new NativeArtifactError("GenBI MCP bearer credential is invalid. Restart this native session to refresh its GenBI MCP connection.", 401);
    const current = this.options.store.getNativeSession(context.session.id);
    const original = context.session;
    const liveBinding = this.options.getBinding();
    const bindingCurrent = context.binding === undefined
      ? original.projectIdentity === null && original.bindingGeneration === null && original.projectRevision === null
      : sameBinding(context.binding, liveBinding);
    const liveRuntime = this.options.store.getNativeRuntimeBinding();
    const runtimeCurrent = original.runtimeGeneration === null && original.dispatchTarget === null
      ? true
      : liveRuntime.configured && original.runtimeGeneration === liveRuntime.generation && original.dispatchTarget === liveRuntime.target;
    if (!current || (current.status !== "running" && current.status !== "detached") ||
      current.purpose !== original.purpose || current.vendor !== original.vendor || current.agent !== original.agent ||
      current.scopeKind !== original.scopeKind || current.scopeId !== original.scopeId ||
      current.projectIdentity !== original.projectIdentity || current.bindingGeneration !== original.bindingGeneration || current.projectRevision !== original.projectRevision ||
      !bindingCurrent || !runtimeCurrent) {
      this.revoke(credential);
      throw new NativeArtifactError("GenBI MCP session is no longer active or is stale. Start a new native session.", 409);
    }
    return current;
  }

  /**
   * Retains the exact typed answer before conversational presentation. This
   * contract is intentionally independent of dashboard naming/save intent so
   * a later follow-up can only reference this stored result, never recompute.
   */
  persistAnswer(credential: string | undefined, input: unknown): PersistedStructuredAnswer {
    const session = this.authorize(credential);
    if (session.purpose !== "analysis") throw new NativeArtifactError("structured answer persistence is unavailable for this native session", 409);
    const payload = validatePersistedStructuredAnswer(input);
    const envelopeJson = JSON.stringify(payload.envelope);
    const digest = structuredAnswerDigest(envelopeJson);
    const existing = this.options.store.getNativeStructuredAnswerByIdempotency(session.id, payload.idempotency_key);
    if (existing) {
      if (existing.digest !== digest || existing.envelopeJson !== envelopeJson) {
        throw new NativeArtifactError("structured answer idempotency key is already bound to a different answer", 409);
      }
      return { answer_ref: existing.id, digest: existing.digest, persisted_at: existing.createdAt };
    }
    try {
      const persisted = (this.options.persistStructuredAnswer ?? ((params) => this.options.store.createNativeStructuredAnswer(params)))({
        id: newId("answer"), nativeSessionId: session.id, idempotencyKey: payload.idempotency_key, envelopeJson, digest,
      });
      if (persisted.row.digest !== digest || persisted.row.envelopeJson !== envelopeJson) {
        throw new NativeArtifactError("structured answer idempotency key is already bound to a different answer", 409);
      }
      return { answer_ref: persisted.row.id, digest: persisted.row.digest, persisted_at: persisted.row.createdAt };
    } catch (error) {
      if (error instanceof NativeArtifactError) throw error;
      // This safe, explicit message is part of the driver contract: it can
      // present the already-computed answer while truthfully warning that a
      // later reference save is unavailable. No save path may recompute it.
      throw new NativeArtifactError("structured answer persistence failed; this answer cannot be saved by reference", 500);
    }
  }

  save(credential: string | undefined, input: unknown): SavedNativeArtifact {
    const context = credential === undefined ? undefined : this.credentials.get(credential);
    if (!context) throw new NativeArtifactError("GenBI MCP bearer credential is invalid. Restart this native session to refresh its GenBI MCP connection.", 401);
    const { session, binding } = context;
    const currentSession = this.authorize(credential);
    if (!binding || currentSession.projectIdentity !== binding.identity || currentSession.bindingGeneration !== binding.generation || currentSession.projectRevision !== binding.revision) {
      this.revoke(credential);
      throw new NativeArtifactError("GenBI MCP session binding is stale. Start a new native session.", 409);
    }
    const payload = validateInput(input);
    const referenceSave = "answer_ref" in payload;
    const source = referenceSave
      ? this.options.store.getNativeStructuredAnswer(payload.answer_ref)
      : undefined;
    if (referenceSave && !source) throw new NativeArtifactError("persisted answer reference was not found", 404);
    if (source) validateStoredStructuredAnswer(source, session.id);
    const contents = referenceSave ? source!.envelopeJson : JSON.stringify(payload.envelope);
    const digest = referenceSave ? source!.digest : structuredAnswerDigest(contents);
    const sameSaveRequest = (artifact: ReturnType<Store["getNativeArtifactByIdempotency"]>): boolean => artifact !== undefined &&
      artifact.name === payload.name.trim() &&
      artifact.projectIdentity === binding.identity && artifact.bindingGeneration === binding.generation && artifact.projectRevision === binding.revision &&
      artifact.nativeVendor === session.vendor && artifact.nativeAgent === session.agent &&
      artifact.contentDigest === digest && artifact.sourceAnswerId === (source?.id ?? null);
    const existing = this.options.store.getNativeArtifactByIdempotency(session.id, payload.idempotency_key);
    if (existing) {
      if (!sameSaveRequest(existing)) throw new NativeArtifactError("artifact idempotency key is already bound to a different save request", 409);
      return { artifact_id: existing.id, saved_at: existing.savedAt!, source_href: `/sessions/${session.id}` };
    }
    const id = newId("artifact");
    const location = path.posix.join("native", `${id}.json`);
    const target = path.resolve(this.options.artifactsRoot, location);
    try {
      const safeTarget = assertSafeContainedTarget(this.options.artifactsRoot, target);
      (this.options.writeAtomic ?? writeContainedAtomically)(safeTarget, contents);
      const inserted = this.options.store.createNativeArtifact({ id, sessionId: session.id, nativeSessionId: session.id, name: payload.name.trim(), location, projectIdentity: binding.identity, bindingGeneration: binding.generation, projectRevision: binding.revision, vendor: session.vendor, agent: session.agent, digest, idempotencyKey: payload.idempotency_key, ...(source ? { sourceAnswerId: source.id } : {}) });
      if (!inserted.created && !sameSaveRequest(inserted.row)) {
        rmSync(target, { force: true });
        throw new NativeArtifactError("artifact idempotency key is already bound to a different save request", 409);
      }
      if (!inserted.created) rmSync(target, { force: true });
      return { artifact_id: inserted.row.id, saved_at: inserted.row.savedAt!, source_href: `/sessions/${session.id}` };
    } catch (error) {
      rmSync(target, { force: true });
      if (error instanceof NativeArtifactError) throw error;
      throw new NativeArtifactError("artifact persistence failed", 500);
    }
  }
}

function artifactStorageError(): NativeArtifactError { return new NativeArtifactError("artifact storage is unavailable", 500); }

/**
 * Makes every directory from the filesystem root to `directory` explicit and
 * refuses symlinks before creating a temporary or final artifact file. The
 * artifact root is host configuration, but this still prevents a pre-existing
 * `native` directory (or an ancestor) from redirecting an agent write.
 */
function ensureDirectoriesWithoutSymlinks(directory: string): void {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw artifactStorageError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        mkdirSync(current, { mode: 0o700 });
        const created = lstatSync(current);
        if (!created.isDirectory() || created.isSymbolicLink()) throw artifactStorageError();
      } catch (createError) {
        if (createError instanceof NativeArtifactError) throw createError;
        throw artifactStorageError();
      }
    }
  }
}

function canonicalStorageRoot(root: string): string {
  const absolute = path.resolve(root);
  try {
    if (lstatSync(absolute).isSymbolicLink()) throw artifactStorageError();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let ancestor = absolute;
  const tail: string[] = [];
  while (true) {
    try {
      lstatSync(ancestor);
      return tail.length === 0 ? realpathSync(ancestor) : path.join(realpathSync(ancestor), ...tail);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw artifactStorageError();
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw artifactStorageError();
      tail.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function assertSafeContainedTarget(root: string, target: string): string {
  const absoluteRoot = path.resolve(root);
  const relative = path.relative(absoluteRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw artifactStorageError();
  const safeRoot = canonicalStorageRoot(absoluteRoot);
  const safeTarget = path.resolve(safeRoot, relative);
  ensureDirectoriesWithoutSymlinks(safeRoot);
  ensureDirectoriesWithoutSymlinks(path.dirname(safeTarget));
  try {
    // IDs are host-created and targets must be brand new. Reject every
    // pre-existing final component, including a symlink, rather than allowing
    // rename() to replace it.
    lstatSync(safeTarget);
    throw artifactStorageError();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return safeTarget;
}

function writeContainedAtomically(target: string, contents: string): void {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
