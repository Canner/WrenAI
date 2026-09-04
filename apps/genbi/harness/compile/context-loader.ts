import { execFile } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ContextLoaderFailedError, ContextLoaderNotFoundError } from "./errors.js";
import { resolveInstalledPackageRoot } from "../npm-package-resolve.js";

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
const CONTEXT_LOADER_PACKAGE = "@wrenai/context-loader";
const CANONICAL_PACKAGE_BINARY = path.join("bin", "wren-context-loader");

export interface ResolvedContextLoader {
  readonly bin: string;
  readonly kind: "explicit" | "in-repo" | "package";
  /** Package resolution is already digest-verified. Development modes use the binary hash below. */
  readonly verifiedIdentity?: string;
}

/**
 * Resolves the `wren-context-loader` binary — the generator that renders a wren project as the
 * prepared-context document a `kind: prepared` binding reads.
 *
 * Three deterministic tiers, then a loud failure:
 *
 * 1. `explicit`, else the `WREN_HARNESS_CONTEXT_LOADER_BIN` environment variable. Either must
 *    exist on disk; neither falls through to a search.
 * 2. This repo's own build of the generator crate, found by walking up from this package looking
 *    for `core/wren-context-loader/target/{release,debug}/wren-context-loader`. `release` wins
 *    when both exist, so a stale `debug` build never shadows a deliberate release build.
 * 3. The verified package-local binary from the exact `@wrenai/context-loader` dependency. Its
 *    install record must match package version and target, name the canonical binary, and pass a
 *    fresh SHA-256 check. Resolution never downloads at runtime.
 *
 * There is deliberately **no** `PATH` tier and — more importantly — **no fallback to the old
 * `wren_project` binding**. A fallback would make the extraction unverifiable: a compiled IR is
 * byte-identical whichever path produced it (Warble emits neither `kind` nor `document` into the
 * IR), so a silent degrade would be undetectable from the artifact alone. Failing loudly is the
 * only way the caller can know which path ran.
 *
 * Throws {@link ContextLoaderNotFoundError} with the accumulated attempts when neither tier works.
 */
export function resolveContextLoader(explicit?: string): ResolvedContextLoader {
  const override = explicit ?? process.env[CONTEXT_LOADER_BIN_ENV];
  if (override !== undefined && override.length > 0) {
    if (!existsSync(override)) {
      const source = explicit !== undefined ? `explicit contextLoaderBin` : CONTEXT_LOADER_BIN_ENV;
      throw new ContextLoaderNotFoundError([`${source} "${override}" does not exist`]);
    }
    return { bin: override, kind: "explicit" };
  }

  const inRepo = findInRepoBuild();
  if (inRepo !== undefined) return { bin: inRepo, kind: "in-repo" };

  const packaged = resolveVerifiedPackageBinary();
  if (packaged !== undefined) return packaged;

  throw new ContextLoaderNotFoundError([
    `${CONTEXT_LOADER_BIN_ENV} is not set`,
    `no in-repo build found (searched ancestors of this package for ` +
      IN_REPO_BUILD_PATHS.map((segments) => `"${path.join(...segments)}"`).join(" and ") +
      `) — ${CONTEXT_LOADER_PACKAGE} is not installed with a verified ${targetForCurrentPlatform()} binary`,
  ]);
}

/** Backward-compatible path-only API for callers that do not need cache provenance. */
export function resolveContextLoaderBinary(explicit?: string): string {
  return resolveContextLoader(explicit).bin;
}

/** Stable cache identity: resolver kind plus either a verified package tuple or the dev binary's bytes. */
export function getContextLoaderIdentity(resolved: ResolvedContextLoader): string {
  if (resolved.verifiedIdentity !== undefined) return resolved.verifiedIdentity;
  return `${resolved.kind}:${createHash("sha256").update(readFileSync(resolved.bin)).digest("hex")}`;
}

function resolveVerifiedPackageBinary(): ResolvedContextLoader | undefined {
  const packageRoot = resolveInstalledPackageRoot(CONTEXT_LOADER_PACKAGE);
  if (packageRoot === undefined) return undefined;
  return readVerifiedContextLoaderPackage(packageRoot);
}

/** Validates a package-local installation record without resolving it from the host environment. */
export function readVerifiedContextLoaderPackage(packageRoot: string, target = targetForCurrentPlatform()): ResolvedContextLoader | undefined {
  try {
    const root = physicalPackageRoot(packageRoot);
    if (root === undefined) return undefined;
    const packageJson = readVerifiedJson(root, "package.json");
    const manifest = readVerifiedJson(root, "artifacts.json");
    const state = readVerifiedJson(root, "install-state.json");
    if (packageJson === undefined || manifest === undefined || state === undefined) return undefined;
    const artifacts = typeof manifest.artifacts === "object" && manifest.artifacts !== null ? manifest.artifacts as Record<string, unknown> : undefined;
    const artifact = artifacts?.[target];
    const bin = physicalRegularFile(root, CANONICAL_PACKAGE_BINARY);
    if (
      packageJson.name !== CONTEXT_LOADER_PACKAGE ||
      typeof packageJson.version !== "string" ||
      manifest.schema !== 1 ||
      manifest.package !== CONTEXT_LOADER_PACKAGE ||
      manifest.version !== packageJson.version ||
      !isArtifact(artifact) ||
      state.package !== CONTEXT_LOADER_PACKAGE ||
      state.version !== packageJson.version ||
      state.target !== target ||
      state.binaryPath !== CANONICAL_PACKAGE_BINARY ||
      state.archiveSha256 !== artifact.archiveSha256 ||
      state.binarySha256 !== artifact.binarySha256 ||
      bin === undefined ||
      createHash("sha256").update(readFileSync(bin)).digest("hex") !== artifact.binarySha256
    ) {
      return undefined;
    }
    return { bin, kind: "package", verifiedIdentity: `package:${CONTEXT_LOADER_PACKAGE}@${packageJson.version}:${target}:${artifact.binarySha256}` };
  } catch {
    return undefined;
  }
}

function readVerifiedJson(root: string, relativePath: string): Record<string, unknown> | undefined {
  const file = physicalRegularFile(root, relativePath);
  if (file === undefined) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isArtifact(value: unknown): value is { archiveSha256: string; binarySha256: string; binaryPath: string; url: string } {
  if (typeof value !== "object" || value === null) return false;
  const artifact = value as Record<string, unknown>;
  return (
    typeof artifact.url === "string" &&
    artifact.url.startsWith("https://") &&
    isSha256(artifact.archiveSha256) &&
    isSha256(artifact.binarySha256) &&
    typeof artifact.binaryPath === "string" &&
    !artifact.binaryPath.includes("..") &&
    !path.isAbsolute(artifact.binaryPath)
  );
}

/** Returns a package-owned physical root; package-root symlinks are never trusted. */
function physicalPackageRoot(packageRoot: string): string | undefined {
  try {
    if (!lstatSync(packageRoot).isDirectory()) return undefined;
    return realpathSync(packageRoot);
  } catch {
    return undefined;
  }
}

/** Refuses final-file links and any ancestor link that resolves outside the physical package root. */
function physicalRegularFile(root: string, relativePath: string): string | undefined {
  const lexical = path.resolve(root, relativePath);
  if (!lexical.startsWith(`${root}${path.sep}`)) return undefined;
  try {
    if (!lstatSync(lexical).isFile()) return undefined;
    const physical = realpathSync(lexical);
    return physical.startsWith(`${root}${path.sep}`) && statSync(physical).isFile() ? physical : undefined;
  } catch {
    return undefined;
  }
}

function targetForCurrentPlatform(): string {
  return `${process.platform}-${process.arch}`;
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
