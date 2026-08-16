/**
 * Resolves the fixed Wren installation that a native Codex session may use.
 * This is BFF configuration, never a browser, request, PATH, or permission
 * input. The returned object is the closed scope shape consumed by Warble.
 */
import { accessSync, constants, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface NativeWrenRuntime {
  readonly version: "1";
  readonly shim: string;
  readonly launcher: string;
  readonly venv_python: string;
  readonly tool_root: string;
  readonly site_packages: string;
  readonly source_root: string;
  readonly interpreter: string;
  readonly interpreter_root: string;
}

export class NativeWrenRuntimeError extends Error {}

function unavailable(): never { throw new NativeWrenRuntimeError("native Wren runtime is unavailable"); }

function regularExecutable(file: string): string {
  try {
    const canonical = realpathSync(file);
    const stat = statSync(canonical);
    if (!stat.isFile() || (stat.mode & 0o111) === 0) unavailable();
    return canonical;
  } catch (error) {
    if (error instanceof NativeWrenRuntimeError) throw error;
    return unavailable();
  }
}

function directory(directory: string): string {
  try {
    const canonical = realpathSync(directory);
    if (!statSync(canonical).isDirectory()) unavailable();
    accessSync(canonical, constants.R_OK | constants.X_OK);
    return canonical;
  } catch (error) {
    if (error instanceof NativeWrenRuntimeError) throw error;
    return unavailable();
  }
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

interface StableFile {
  readonly canonical: string;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

/** Reject symlinks (including symlinked parents) and detect a replacement while reading. */
function stableRegularFile(file: string): StableFile {
  try {
    const stat = lstatSync(file);
    const canonical = realpathSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || canonical !== file) unavailable();
    return { canonical, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
  } catch (error) {
    if (error instanceof NativeWrenRuntimeError) throw error;
    return unavailable();
  }
}

function stableFileText(file: string): string {
  const before = stableRegularFile(file);
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return unavailable(); }
  const after = stableRegularFile(file);
  if (before.canonical !== after.canonical || before.dev !== after.dev || before.ino !== after.ino ||
    before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) unavailable();
  return text;
}

function gitCommonDirectory(repository: string): string {
  const gitEntry = path.join(repository, ".git");
  try {
    const entry = lstatSync(gitEntry);
    if (entry.isSymbolicLink()) unavailable();
    if (entry.isDirectory()) return directory(gitEntry);
    if (!entry.isFile()) unavailable();
    const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(stableFileText(gitEntry));
    if (!match) unavailable();
    const worktreeGitDir = directory(path.resolve(repository, match[1]!));
    const commonDirFile = path.join(worktreeGitDir, "commondir");
    try {
      const commonDir = stableFileText(commonDirFile).trim();
      if (!commonDir) unavailable();
      const commonDirectory = directory(path.resolve(worktreeGitDir, commonDir));
      if (!contained(path.join(commonDirectory, "worktrees"), worktreeGitDir)) unavailable();
      const declaredGitFile = path.resolve(worktreeGitDir, stableFileText(path.join(worktreeGitDir, "gitdir")).trim());
      if (declaredGitFile !== gitEntry) unavailable();
      return commonDirectory;
    } catch (error) {
      if (error instanceof NativeWrenRuntimeError) throw error;
      return worktreeGitDir;
    }
  } catch (error) {
    if (error instanceof NativeWrenRuntimeError) throw error;
    return unavailable();
  }
}

/** Finds the repository that shipped this BFF; it is never supplied by a request or environment variable. */
function serverRepositoryRoot(): string {
  let candidate = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const repository = directory(candidate);
      stableRegularFile(path.join(repository, "apps", "genbi", "package.json"));
      stableRegularFile(path.join(repository, "core", "wren", "pyproject.toml"));
      return repository;
    } catch (error) {
      if (error instanceof NativeWrenRuntimeError) {
        const parent = path.dirname(candidate);
        if (parent === candidate) return unavailable();
        candidate = parent;
        continue;
      }
      return unavailable();
    }
  }
}

/**
 * A runtime may use a sibling Git worktree, but never an arbitrary editable
 * directory. Only that worktree's exact core/wren/src root is granted.
 */
function approvedWrenSourceRoot(sourceRoot: string): string {
  try {
    const sourceEntry = lstatSync(sourceRoot);
    const canonical = realpathSync(sourceRoot);
    if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink() || canonical !== sourceRoot) unavailable();
    const runtimeRepository = directory(path.resolve(sourceRoot, "..", "..", ".."));
    if (sourceRoot !== path.join(runtimeRepository, "core", "wren", "src")) unavailable();
    stableRegularFile(path.join(runtimeRepository, "core", "wren", "pyproject.toml"));
    stableRegularFile(path.join(sourceRoot, "wren", "__init__.py"));
    if (gitCommonDirectory(runtimeRepository) !== gitCommonDirectory(serverRepositoryRoot())) unavailable();
    const after = lstatSync(sourceRoot);
    if (!after.isDirectory() || after.isSymbolicLink() || realpathSync(sourceRoot) !== canonical) unavailable();
    return canonical;
  } catch (error) {
    if (error instanceof NativeWrenRuntimeError) throw error;
    return unavailable();
  }
}

/** The documented server default; deployments can set an explicit absolute shim path. */
export function defaultNativeWrenShim(): string {
  return path.join(os.homedir(), ".local", "bin", "wren");
}

/**
 * Validates every launcher hop before serializing the exact read/execute
 * closure. The source root comes only from the one editable .pth entry.
 */
export function resolveNativeWrenRuntime(configuredShim = defaultNativeWrenShim()): NativeWrenRuntime {
  if (!path.isAbsolute(configuredShim)) unavailable();
  try {
    const shimEntry = lstatSync(configuredShim);
    if (!shimEntry.isSymbolicLink()) unavailable();
  } catch {
    unavailable();
  }
  const shim = path.resolve(configuredShim);
  const launcher = regularExecutable(shim);
  const toolRoot = directory(path.dirname(path.dirname(launcher)));
  const toolBin = path.join(toolRoot, "bin");
  const venvPython = path.join(toolBin, "python");
  if (launcher !== path.join(toolBin, "wren")) unavailable();
  try {
    if (!lstatSync(venvPython).isSymbolicLink()) unavailable();
  } catch {
    unavailable();
  }
  const interpreter = regularExecutable(venvPython);
  const interpreterRoot = directory(path.dirname(path.dirname(interpreter)));
  const interpreterBin = path.join(interpreterRoot, "bin");
  if (!contained(interpreterBin, interpreter) || interpreter === interpreterBin) unavailable();
  directory(path.join(interpreterRoot, "lib"));
  let hasVenvMetadata = false;
  try { hasVenvMetadata = statSync(path.join(toolRoot, "pyvenv.cfg")).isFile(); } catch { /* fail below */ }
  if (!hasVenvMetadata) unavailable();
  let launcherText: string | undefined;
  try { launcherText = readFileSync(launcher, "utf8"); } catch { /* fail below */ }
  if (launcherText === undefined || (!launcherText.startsWith(`#!${venvPython}\n`) && !launcherText.startsWith(`#!${venvPython}\r\n`))) unavailable();

  const toolLib = directory(path.join(toolRoot, "lib"));
  let sitePackages: string;
  try {
    const candidates = readdirSync(toolLib, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^python\d+(?:\.\d+)?$/.test(entry.name))
      .map((entry) => path.join(toolLib, entry.name, "site-packages"))
      .filter((candidate) => {
        try { return statSync(candidate).isDirectory() && stableRegularFile(path.join(candidate, "_editable_impl_wrenai.pth")) !== undefined; } catch { return false; }
      });
    if (candidates.length !== 1) unavailable();
    sitePackages = directory(candidates[0]!);
    if (!contained(toolLib, sitePackages)) unavailable();
  } catch (error) {
    if (error instanceof NativeWrenRuntimeError) throw error;
    return unavailable();
  }
  let sourceRoot: string;
  try {
    const lines = stableFileText(path.join(sitePackages, "_editable_impl_wrenai.pth"))
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 1 || !path.isAbsolute(lines[0]!)) unavailable();
    sourceRoot = approvedWrenSourceRoot(lines[0]!);
  } catch (error) {
    if (error instanceof NativeWrenRuntimeError) throw error;
    return unavailable();
  }
  return {
    version: "1", shim, launcher, venv_python: venvPython, tool_root: toolRoot,
    site_packages: sitePackages, source_root: sourceRoot, interpreter, interpreter_root: interpreterRoot,
  };
}
