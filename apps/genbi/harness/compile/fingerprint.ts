import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Directories never worth fingerprinting: VCS metadata, package installs, prior compiler output. */
const IGNORED_DIR_NAMES = new Set([".git", "node_modules", ".warble"]);

/**
 * Bulk data files excluded from the fingerprint: their bytes are NOT compiled into the IR/bundle
 * (the context binding is a *path* to a wren project; row data is read at query time, not compile
 * time), so a data-only change doesn't invalidate the compiled artifact. Everything that DOES feed
 * the compiled artifact — profile.yml, components, and the user project's semantic-layer defs
 * (`wren_project.yml`, `mdl` under `target/`, `cubes.yml`, `relationships.yml`, `instructions.md`,
 * `models/`, `views/`) — is content-hashed. When in doubt a file is included, not excluded.
 */
const EXCLUDED_DATA_SUFFIXES = [".duckdb", ".duckdb.wal", ".wal", ".parquet", ".sqlite", ".db"];

/**
 * A content fingerprint for a directory tree: every included file's relative path plus a sha256 of
 * its *contents*, combined into a single sha256. This is the identity {@link CompileCache} keys on
 * for both the source profile and the user's wren project.
 *
 * Content (not size+mtime) is hashed deliberately: mtimes are unreliable (a fresh `git checkout`
 * normalizes them) and same-size edits (e.g. a column rename) collide on size — either would yield
 * a false cache HIT and silently serve a stale bundle, defeating the point of binding each user to
 * THEIR current semantic layer. Bulk data files are skipped (see {@link EXCLUDED_DATA_SUFFIXES}).
 * Symlinks are followed (via `stat`, not the `readdir` dirent type) so a symlinked semantic-layer
 * file is hashed rather than silently skipped; broken symlinks are ignored.
 */
export async function hashDirectory(rootDir: string): Promise<string> {
  const entries: string[] = [];
  await walk(rootDir, rootDir, entries);
  entries.sort();
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry).update("\n");
  return hash.digest("hex");
}

async function walk(rootDir: string, dir: string, out: string[]): Promise<void> {
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);

    // `stat` follows symlinks, so a symlink is classified by its target (not skipped the way the
    // `readdir` dirent's isDirectory()/isFile() would). A broken symlink / TOCTOU race throws → skip.
    let stats;
    try {
      stats = await stat(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(dirent.name)) continue;
      await walk(rootDir, fullPath, out);
      continue;
    }
    if (!stats.isFile()) continue;
    if (isExcludedDataFile(dirent.name)) continue;

    const content = await readFile(fullPath);
    const fileHash = createHash("sha256").update(content).digest("hex");
    const relPath = path.relative(rootDir, fullPath);
    out.push(`${relPath}:${fileHash}`);
  }
}

function isExcludedDataFile(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED_DATA_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * A content fingerprint for an ordered list of individual files (e.g. `--provider` fragment
 * paths) — order-sensitive, since dispatch merges multiple provider fragments and `[a, b]` can
 * compile to a different artifact than `[b, a]`. Path strings themselves are NOT part of the
 * hash — only each file's content — so a fragment copied to a different path with identical
 * bytes doesn't cause an unnecessary cache miss. An empty list hashes deterministically too, so
 * passing `[]` (no providers) is distinguishable from any non-empty set, including the default.
 */
export async function hashFiles(filePaths: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const filePath of filePaths) {
    const content = await readFile(path.resolve(filePath));
    hash.update(createHash("sha256").update(content).digest("hex")).update("\n");
  }
  return hash.digest("hex");
}
