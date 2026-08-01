/**
 * Reads the REAL bound wren project's semantic layer by
 * shelling out to `wren context show -o json` in the project directory. This
 * is new plumbing: the BFF Node process does not shell out anywhere else
 * today (only an agent turn's own tool loop runs `wren`, via the
 * `ExecutionEnv`/`ExecutionPolicy` seam in `harness/exec/` — that seam is for
 * guardrail-gated tool calls inside a turn, not a plain route-level read, so
 * it isn't reused here).
 *
 * Honesty contract: never fabricate. A missing binary, an unbuilt project
 * (`target/mdl.json` absent), a non-zero exit, or unparseable stdout all
 * throw a typed error that the route surfaces to the caller — none of them
 * fall back to seed/mock data.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface WrenContextColumn {
  readonly name: string;
  readonly type: string;
  readonly properties?: { readonly description?: string };
}

export interface WrenContextModel {
  readonly name: string;
  readonly properties?: { readonly description?: string };
  readonly tableReference?: unknown;
  readonly primaryKey?: string;
  readonly columns: readonly WrenContextColumn[];
}

/** `models` is an unordered pair — `condition` is the raw join predicate, e.g. `"orders.customer_id = customers.id"`. */
export interface WrenContextRelationship {
  readonly name: string;
  readonly models: readonly [string, string];
  readonly joinType: string;
  readonly condition: string;
}

export interface WrenContextMeasure {
  readonly name: string;
  readonly expression: string;
  readonly type?: string;
}

export interface WrenContextCube {
  readonly name: string;
  readonly baseObject: string;
  readonly measures: readonly WrenContextMeasure[];
  readonly dimensions?: readonly unknown[];
  readonly timeDimensions?: readonly unknown[];
  readonly properties?: Record<string, unknown>;
}

/** The full `wren context show -o json` document — a single JSON object, NOT JSONL (unlike `wren -o json` query output). */
export interface WrenContextShow {
  readonly catalog?: string;
  readonly schema?: string;
  readonly models: readonly WrenContextModel[];
  readonly relationships: readonly WrenContextRelationship[];
  readonly views?: readonly unknown[];
  readonly cubes: readonly WrenContextCube[];
  readonly dataSource?: string;
  readonly layoutVersion?: number;
}

export class WrenBinaryNotFoundError extends Error {
  constructor(detail: string) {
    super(`could not find the "wren" binary: ${detail}\nfix: install wren and ensure it is on PATH.`);
    this.name = "WrenBinaryNotFoundError";
  }
}

/** Covers both "project not built yet" (missing `target/mdl.json`, checked up front) and a non-zero/unparseable `wren context show` run. */
export class WrenContextShowError extends Error {
  constructor(detail: string) {
    super(`"wren context show -o json" failed: ${detail}`);
    this.name = "WrenContextShowError";
  }
}

/** Small in-process cache keyed by resolved project path — off by default (per-request is fine for v1); callers opt in with `{ useCache: true }`. */
const cache = new Map<string, WrenContextShow>();

/** Evicts one cached project (or every entry, when called with no argument) — call after a context-changing operation (e.g. a setup "build context" turn). */
export function invalidateContextShowCache(projectDir?: string): void {
  if (projectDir === undefined) {
    cache.clear();
    return;
  }
  cache.delete(path.resolve(projectDir));
}

function execWren(cwd: string): Promise<{ stdout: string; stderr: string; error: (NodeJS.ErrnoException & { code?: string }) | null }> {
  return new Promise((resolve) => {
    execFile("wren", ["context", "show", "-o", "json"], { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: error as (NodeJS.ErrnoException & { code?: string }) | null });
    });
  });
}

/**
 * Runs `wren context show -o json` in `projectDir` and parses the single
 * resulting JSON object. Throws {@link WrenBinaryNotFoundError} when `wren`
 * isn't on PATH, or {@link WrenContextShowError} when the project hasn't
 * been built (`target/mdl.json` missing — checked up front so the error names
 * the real cause instead of a generic non-zero exit), the process exits
 * non-zero, or stdout isn't valid JSON. Never auto-builds and never falls
 * back to fabricated data.
 */
export async function loadContextShow(projectDir: string, options?: { readonly useCache?: boolean }): Promise<WrenContextShow> {
  const resolved = path.resolve(projectDir);
  const useCache = options?.useCache ?? false;
  if (useCache) {
    const cached = cache.get(resolved);
    if (cached) return cached;
  }

  if (!existsSync(path.join(resolved, "target", "mdl.json"))) {
    throw new WrenContextShowError(`project at "${resolved}" has not been built yet (missing target/mdl.json) — run "wren build" in the project first.`);
  }

  const { stdout, stderr, error } = await execWren(resolved);

  if (error && error.code === "ENOENT") {
    throw new WrenBinaryNotFoundError(`not found on PATH while running "wren context show -o json" in "${resolved}"`);
  }
  if (error) {
    throw new WrenContextShowError(`process error running in "${resolved}": ${error.message}${stderr ? `\n${stderr}` : ""}`);
  }

  let parsed: WrenContextShow;
  try {
    parsed = JSON.parse(stdout) as WrenContextShow;
  } catch (err) {
    throw new WrenContextShowError(`could not parse output as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (useCache) cache.set(resolved, parsed);
  return parsed;
}
