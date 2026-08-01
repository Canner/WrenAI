/**
 * Resolves the REAL datasource + connection fields behind the Harness page's
 * connection panel — see `buildConnection` in `server/harness.ts` — and
 * describes them into a safe, non-secret display shape.
 *
 * `<project>/conn.yml` is NOT a persistent part of a wren project: the wren
 * CLI's onboarding wizard writes a *temporary* scratch file inside the
 * project directory (under a name deliberately not `conn.yml`, e.g.
 * `conn.profile.yml`) and feeds it to `wren profile add --from-file`, then
 * deletes it once the profile is created — so it never leaves a `conn.yml`
 * in the project directory itself. So `loadConnConfig` below only ever finds
 * something to read on hand-authored fixtures (or a project laid out that
 * way on purpose) — never on a project the CLI actually onboarded. The two
 * files that ARE always there:
 *   - `<project>/wren_project.yml` — its `data_source:` field is the real,
 *     always-present datasource, and its `profile:` field (if set) pins which
 *     stored profile the project actually connects through.
 *   - `~/.wren/profiles.yml` (or `$WREN_HOME/profiles.yml`) — the pinned
 *     profile's own field map (duckdb `url`, DB `host`/`port`/`database`, …),
 *     read via `server/wren-profiles.ts`'s shared parser.
 * `resolveConnectionSource` is the entry point every caller should use: it
 * prefers `conn.yml` when one happens to exist (kept only so a fixture/hand
 * laid out project isn't silently ignored), and otherwise resolves through
 * the manifest + profiles store above — WITHOUT ever falling back to the
 * profiles store's global `active:` profile when the project has no pin of
 * its own, since a project must never display a connection it isn't bound
 * to.
 *
 * `conn.yml`, when present, is a flat `key: value` file (no nesting) — e.g.
 * ```
 * datasource: duckdb
 * url: ${DUCKDB_URL}
 * format: ${DUCKDB_FORMAT}
 * ```
 * so a small line-based parser is enough here; pulling in a full YAML
 * library for one flat file would be overkill. `wren_project.yml` only ever
 * needs two scalar fields read out of it, so it gets the same small-parser
 * treatment (mirrors `server/adopt.ts`'s own `readYamlScalarField`).
 *
 * SECURITY: `describeConnection` only ever reads from a fixed ALLOWLIST of
 * non-secret field names (host/port/database/project id/…) when building the
 * displayed location string. It never touches or forwards arbitrary
 * `conn.yml`/`.env`/profile keys, so a field named
 * `password`/`user`/`token`/`credentials`/`private_key` etc. can never reach
 * the DTO even if present in the parsed config — there is no denylist to
 * keep in sync as new datasources are added.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadProfileStore } from "./wren-profiles.js";

export interface ConnConfig {
  readonly datasource?: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ConnectionDetail {
  readonly type: string;
  readonly location: string;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
  }
  return value;
}

/** Parses a flat `key: value` YAML file — one mapping per line, no nested structures. */
function parseFlatYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    result[key] = stripQuotes(line.slice(idx + 1).trim());
  }
  return result;
}

/** Parses a `.env` file — `KEY=value` per line, optional `export ` prefix, `#` comments. */
function parseDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
    const idx = withoutExport.indexOf("=");
    if (idx === -1) continue;
    const key = withoutExport.slice(0, idx).trim();
    if (!key) continue;
    result[key] = stripQuotes(withoutExport.slice(idx + 1).trim());
  }
  return result;
}

const TEMPLATE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Resolves `${VAR}` references via `lookup`; returns `undefined` (rather than a literal, broken `${VAR}`) if any reference can't be resolved. */
function resolveTemplate(value: string, lookup: (name: string) => string | undefined): string | undefined {
  let unresolved = false;
  const resolved = value.replace(TEMPLATE_RE, (_match, name: string) => {
    const resolvedValue = lookup(name);
    if (resolvedValue === undefined) {
      unresolved = true;
      return "";
    }
    return resolvedValue;
  });
  return unresolved ? undefined : resolved;
}

/**
 * Reads `<projectDir>/conn.yml`, resolving any `${VAR}` values against
 * `<projectDir>/.env` (a real environment variable of the same name, if set,
 * wins over the project's `.env` — mirroring the wren CLI's own dotenv
 * loading, so a shell-exported override still applies). Returns `undefined`
 * when there's no `conn.yml` to read (unbound project, or a project laid out
 * without one) rather than throwing — callers fall back to an honest "—".
 */
export function loadConnConfig(projectDir: string): ConnConfig | undefined {
  const connPath = path.join(projectDir, "conn.yml");
  if (!existsSync(connPath)) return undefined;

  let raw: Record<string, string>;
  try {
    raw = parseFlatYaml(readFileSync(connPath, "utf-8"));
  } catch {
    return undefined;
  }

  const dotenvPath = path.join(projectDir, ".env");
  let dotenv: Record<string, string> = {};
  if (existsSync(dotenvPath)) {
    try {
      dotenv = parseDotEnv(readFileSync(dotenvPath, "utf-8"));
    } catch {
      dotenv = {};
    }
  }
  const lookup = (name: string): string | undefined => process.env[name] ?? dotenv[name];

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "datasource") continue;
    const resolved = resolveTemplate(value, lookup);
    if (resolved !== undefined) fields[key] = resolved;
  }

  return raw.datasource !== undefined ? { datasource: raw.datasource, fields } : { fields };
}

export interface ProjectManifest {
  /** `wren_project.yml`'s `data_source:` — always present on a real wren project; this is the connection panel's `type`. */
  readonly dataSource?: string;
  /** `wren_project.yml`'s `profile:` pin, if the project has bound one — the key into `~/.wren/profiles.yml`'s `profiles:` map. */
  readonly profile?: string;
}

/**
 * Matches a `wren_project.yml` top-level `field: value` scalar line — a
 * second small instance of `server/adopt.ts`'s own `readYamlScalarField`
 * rather than an import from it: this module only ever needs the same two
 * fields (`data_source`, `profile`), and adopt.ts's function isn't exported
 * for reuse, so a four-line regex duplicated here is cheaper than adding a
 * cross-module export just for it.
 */
function readManifestScalar(content: string, field: string): string | undefined {
  const re = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m");
  const match = re.exec(content);
  return match ? stripQuotes(match[1]!.trim()) : undefined;
}

/** Reads `<projectDir>/wren_project.yml`'s persistent `data_source:`/`profile:` scalars. Unlike `conn.yml`, this file always exists on a bound wren project. Returns `undefined` only when the manifest itself is missing/unreadable — never throws. */
export function loadProjectManifest(projectDir: string): ProjectManifest | undefined {
  const manifestPath = path.join(projectDir, "wren_project.yml");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const content = readFileSync(manifestPath, "utf-8");
    const dataSource = readManifestScalar(content, "data_source");
    const profile = readManifestScalar(content, "profile");
    return { ...(dataSource !== undefined ? { dataSource } : {}), ...(profile !== undefined ? { profile } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * Resolves the `(datasource, fields)` pair `describeConnection` needs, per
 * the precedence documented in this module's doc comment: `conn.yml` first
 * if it happens to exist and declares a `datasource:`, otherwise
 * `wren_project.yml`'s `data_source:` for `type` plus its pinned `profile:`
 * (looked up in `~/.wren/profiles.yml`) for the location `fields`. A project
 * with no pin still reports its real `data_source`, with empty fields (→
 * `describeConnection` renders an honest "—" location) — it never
 * substitutes the profiles store's global `active:` profile.
 */
export function resolveConnectionSource(projectDir: string): ConnConfig {
  const connConfig = loadConnConfig(projectDir);
  if (connConfig?.datasource !== undefined) return connConfig;

  const manifest = loadProjectManifest(projectDir);
  if (!manifest?.dataSource) return { fields: {} };
  if (!manifest.profile) return { datasource: manifest.dataSource, fields: {} };

  const profileFields = loadProfileStore().profiles.get(manifest.profile);
  if (!profileFields) return { datasource: manifest.dataSource, fields: {} };

  const fields: Record<string, string> = {};
  for (const [key, value] of profileFields) {
    if (key === "datasource") continue; // the manifest's data_source is authoritative for `type`; profiles.yml's own field is redundant and excluded from `fields`.
    fields[key] = value;
  }
  return { datasource: manifest.dataSource, fields };
}

/** Filesystem-backed datasources — `url` IS the connection location (a local path, or a bucket/object URL with no embedded credentials in these connection info shapes). */
const FILE_DATASOURCES = new Set(["duckdb", "local_file", "gcs_file", "minio_file", "s3_file"]);

/**
 * ALLOWLIST of non-secret field names used to build the displayed location
 * string for DB-type datasources, in display order. Deliberately excludes
 * every credential-shaped field (password, user, credentials, token,
 * private_key, access_key/secret_key, client_id/client_secret, dsn, kwargs,
 * …) — those are simply never read here, regardless of datasource.
 */
const LOCATION_FIELD_ORDER = ["database", "project_id", "dataset_id", "account", "schema", "warehouse", "region_name", "schema_name"] as const;

/** Maps a resolved `(datasource, fields)` pair to the connection panel's `type`/`location` — never fabricates a label and never surfaces a secret field. */
export function describeConnection(datasource: string | undefined, fields: Readonly<Record<string, string>>): ConnectionDetail {
  if (!datasource) return { type: "—", location: "—" };

  if (FILE_DATASOURCES.has(datasource)) {
    return { type: datasource, location: fields.url ?? "—" };
  }

  const segments: string[] = [];
  if (fields.host) segments.push(fields.port ? `${fields.host}:${fields.port}` : fields.host);
  for (const key of LOCATION_FIELD_ORDER) {
    const value = fields[key];
    if (value) segments.push(value);
  }
  return { type: datasource, location: segments.length > 0 ? segments.join("/") : "—" };
}
