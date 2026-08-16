/**
 * Makes the selected data source's Python driver available before the connect
 * turn starts, rather than letting the agent discover it is missing.
 *
 * wren ships connectors for twenty-one sources but installs almost none of
 * their drivers: each lives behind an optional extra. Picking a source whose
 * extra is absent used to fail deep inside the turn with whatever the connector
 * happened to raise — a bare `ModuleNotFoundError` for most, and for Oracle an
 * `AttributeError: 'NoneType' object has no attribute 'connect'`, since that
 * module binds its driver to `None` on ImportError.
 *
 * Provisioning happens here, in the BFF, and not in the agent's turn: the
 * agent-run `pip install` that the onboarding skill's Preflight used to perform
 * was removed precisely because it could consume the whole turn. A deterministic
 * step costs no turn budget, is testable, and does not depend on the model
 * choosing to run it.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { realpathSync, statSync } from "node:fs";

/**
 * Sources that need no extra: their dependencies are wren's core ones. The four
 * file sources and `duckdb` all route to wren's duckdb connector, whose driver
 * is a core dependency; `datafusion` runs in-process on wren-core. Note wren's
 * own `_INSTALL_EXTRA` maps the file sources to a `duckdb` extra that does not
 * exist in its pyproject — harmless there because nothing needs installing,
 * but a reason not to derive the extra name blindly.
 */
const NO_EXTRA_SOURCES = new Set(["duckdb", "local_file", "s3_file", "minio_file", "gcs_file", "datafusion", "connection_url"]);

/** Sources whose driver ships under a differently-named extra (wren's `_INSTALL_EXTRA`). */
const EXTRA_ALIASES: Readonly<Record<string, string>> = { doris: "mysql", canner: "postgres" };

/** The driver extras wren's pyproject actually declares. */
const DRIVER_EXTRAS = new Set([
  "postgres", "mysql", "bigquery", "snowflake", "clickhouse", "trino",
  "mssql", "databricks", "redshift", "spark", "athena", "oracle",
]);

export type DriverProvisionStatus = "not_needed" | "ready" | "installed" | "failed" | "unavailable";

export interface DriverProvisionResult {
  readonly status: DriverProvisionStatus;
  /** The extra that was (or would be) installed; absent when the source needs none. */
  readonly extra?: string;
  /** Human-readable reason, always set for `failed` and `unavailable`. */
  readonly detail?: string;
}

/** The extra a source's driver ships under, or undefined when it needs none. */
export function driverExtraFor(sourceKey: string): string | undefined {
  if (NO_EXTRA_SOURCES.has(sourceKey)) return undefined;
  const extra = EXTRA_ALIASES[sourceKey] ?? sourceKey;
  return DRIVER_EXTRAS.has(extra) ? extra : undefined;
}

/**
 * The interpreter of the wren install on PATH. `wren` is a console script inside
 * its environment's `bin/`, so its realpath's sibling `python` is that
 * environment — the one whose site-packages a connector import will search.
 */
export function resolveWrenVenvPython(): string | undefined {
  const found = process.env["PATH"]
    ?.split(path.delimiter)
    .map((dir) => path.join(dir, "wren"))
    .find((candidate) => {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  if (found === undefined) return undefined;
  try {
    const interpreter = path.join(path.dirname(realpathSync(found)), "python");
    const stat = statSync(interpreter);
    return stat.isFile() && (stat.mode & 0o111) !== 0 ? interpreter : undefined;
  } catch {
    return undefined;
  }
}

function runUv(args: readonly string[]): Promise<{ stdout: string; stderr: string; error: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    execFile("uv", args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: error as NodeJS.ErrnoException | null });
    });
  });
}

/**
 * Installs the source's driver extra into the wren environment. Idempotent:
 * `uv pip install` on an already-satisfied extra makes no changes, so this is
 * safe to run before every connect turn without probing first.
 *
 * Installs the extra (`wrenai[postgres]`) rather than the driver package
 * directly, so the pins come from wren rather than from a second list here.
 * uv resolves the already-installed editable `wrenai` as satisfying itself, so
 * this adds the driver without disturbing a local editable checkout.
 */
export async function provisionSourceDriver(
  sourceKey: string,
  options: { readonly run?: (args: readonly string[]) => Promise<{ stdout: string; stderr: string; error: NodeJS.ErrnoException | null }> } = {},
): Promise<DriverProvisionResult> {
  const extra = driverExtraFor(sourceKey);
  if (extra === undefined) return { status: "not_needed" };

  const interpreter = resolveWrenVenvPython();
  if (interpreter === undefined) {
    return { status: "unavailable", extra, detail: "could not locate the wren environment's interpreter from PATH" };
  }

  const run = options.run ?? runUv;
  const { stdout, stderr, error } = await run(["pip", "install", "--python", interpreter, `wrenai[${extra}]`]);
  if (error !== null) {
    const detail = error.code === "ENOENT" ? "uv is not on PATH" : (stderr.trim() || error.message);
    return { status: error.code === "ENOENT" ? "unavailable" : "failed", extra, detail };
  }
  // uv prints "Installed N packages" only when it changed something; an
  // already-satisfied extra makes no changes.
  const changed = /^\s*(Installed|Prepared)\s+\d+\s+package/m.test(stdout) || /^\s*\+ /m.test(stdout);
  return changed ? { status: "installed", extra } : { status: "ready", extra };
}

/** One line describing the outcome for the composed prompt — verifiable, never a promise. */
export function driverProvisionNote(sourceKey: string, result: DriverProvisionResult): string {
  switch (result.status) {
    case "not_needed":
      return `The "${sourceKey}" connector needs no optional driver: its dependencies ship with wren.`;
    case "installed":
      return `The "${sourceKey}" driver (wren's "${result.extra}" extra) was just installed into the wren environment.`;
    case "ready":
      return `The "${sourceKey}" driver (wren's "${result.extra}" extra) is present in the wren environment.`;
    default:
      // Say what is actually known. The agent can check this in one command, so
      // claiming the driver is available when provisioning did not succeed would
      // be disproved immediately.
      return (
        `The "${sourceKey}" driver (wren's "${result.extra}" extra) could NOT be provisioned: ${result.detail ?? "unknown reason"}. ` +
        `Do not attempt to install it yourself. If a wren command fails because the driver is missing, stop and report exactly that — do not work around it.`
      );
  }
}
