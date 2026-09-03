import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ContextLoaderFailedError, ContextLoaderNotFoundError } from "./errors.js";

/** Environment override for {@link resolveContextLoaderBinary}, named like the other `WREN_HARNESS_*` binary overrides. */
const CONTEXT_LOADER_BIN_ENV = "WREN_HARNESS_CONTEXT_LOADER_BIN";

/** The generator's crate-relative build outputs, most-preferred first. */
const IN_REPO_BUILD_PATHS = [
  ["core", "wren-context-loader", "target", "release", "wren-context-loader"],
  ["core", "wren-context-loader", "target", "debug", "wren-context-loader"],
] as const;

/**
 * A generous ceiling for a step that reads a semantic layer off local disk and writes one JSON
 * document — guards against a hang, not meant to ever fire in normal operation.
 */
const CONTEXT_LOADER_TIMEOUT_MS = 60 * 1000;

/**
 * Resolves the `wren-context-loader` binary — the generator that renders a wren project as the
 * prepared-context document a `kind: prepared` binding reads.
 *
 * Two tiers, then a loud failure:
 *
 * 1. `explicit`, else the `WREN_HARNESS_CONTEXT_LOADER_BIN` environment variable. Either must
 *    exist on disk; neither falls through to a search.
 * 2. This repo's own build of the generator crate, found by walking up from this package looking
 *    for `core/wren-context-loader/target/{release,debug}/wren-context-loader`. `release` wins
 *    when both exist, so a stale `debug` build never shadows a deliberate release build.
 *
 * There is deliberately **no** `PATH` tier and — more importantly — **no fallback to the old
 * `wren_project` binding**. A fallback would make the extraction unverifiable: a compiled IR is
 * byte-identical whichever path produced it (Warble emits neither `kind` nor `document` into the
 * IR), so a silent degrade would be undetectable from the artifact alone. Failing loudly is the
 * only way the caller can know which path ran.
 *
 * Throws {@link ContextLoaderNotFoundError} with the accumulated attempts when neither tier works.
 */
export function resolveContextLoaderBinary(explicit?: string): string {
  const override = explicit ?? process.env[CONTEXT_LOADER_BIN_ENV];
  if (override !== undefined && override.length > 0) {
    if (!existsSync(override)) {
      const source = explicit !== undefined ? `explicit contextLoaderBin` : CONTEXT_LOADER_BIN_ENV;
      throw new ContextLoaderNotFoundError([`${source} "${override}" does not exist`]);
    }
    return override;
  }

  const inRepo = findInRepoBuild();
  if (inRepo !== undefined) return inRepo;

  throw new ContextLoaderNotFoundError([
    `${CONTEXT_LOADER_BIN_ENV} is not set`,
    `no in-repo build found (searched ancestors of this package for ` +
      IN_REPO_BUILD_PATHS.map((segments) => `"${path.join(...segments)}"`).join(" and ") +
      `) — build it with "cargo build --release --manifest-path core/wren-context-loader/Cargo.toml"`,
  ]);
}

/**
 * Walks up from this package's own directory (`harness/compile/` in source, `dist/compile/` once
 * built — either way two levels below the package root), returning the first existing generator
 * build. Mirrors the ancestor walk `resolveWarbleBinary`'s sibling-checkout tier uses, so this
 * works from the main checkout or from a git worktree nested several levels under it.
 */
function findInRepoBuild(): string | undefined {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    for (const segments of IN_REPO_BUILD_PATHS) {
      const candidate = path.join(dir, ...segments);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Runs the generator over `projectDir`, writing the prepared-context document to `outPath`.
 *
 * An *unreadable* project is not an error here: the generator writes `parseable: false` with the
 * assembly error attached and exits 0, because "this layer could not be assembled" is a fact about
 * the project that Warble's `mdl_parseable` precondition exists to report. Only a genuinely
 * unusable invocation (a path that is not a directory, an unwritable output) exits non-zero, and
 * that surfaces as {@link ContextLoaderFailedError}.
 *
 * Shells with `execFile` (argv array, no shell interpolation), matching the convention `runWarble`
 * and `harness/exec/local.ts` already use.
 */
export function generatePreparedContext(bin: string, projectDir: string, outPath: string): Promise<void> {
  const args = [projectDir, "-o", outPath];
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: CONTEXT_LOADER_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const exitCode = typeof error.code === "number" ? error.code : 1;
        const clarifiedStderr =
          stderr.length > 0
            ? stderr
            : error.killed === true
              ? `wren-context-loader timed out after ${CONTEXT_LOADER_TIMEOUT_MS}ms`
              : stderr;
        reject(new ContextLoaderFailedError(bin, args, exitCode, clarifiedStderr, stdout));
        return;
      }
      resolve();
    });
  });
}
