import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathTraversalError } from "../exec/index.js";
import { InvalidProfileShapeError } from "./errors.js";

/**
 * Copies `profileSource` into `destDir`, then rewrites its context binding's `project:` field to
 * point at `userProject` (absolute path) instead of the profile's own fixture binding. Returns the
 * composed profile's directory (safe to pass straight to `warble compile`).
 *
 * The binding file to rewrite is *not* hardcoded to `context/binding.yml` — it's read from the
 * copied `profile.yml`'s own `context: project: <path>` pointer (the documented Warble mechanism:
 * "profile mounts context via `context: project: <path-to-binding.yml>`"), so this works for any
 * profile following that shape, not just `genbi-default`. The resolved binding path is confined to
 * the composed directory: a `../`-laden pointer that escapes it is a loud {@link PathTraversalError}
 * (reusing the exec module's shared traversal error rather than reading/overwriting an arbitrary
 * host file).
 *
 * Both `profile.yml` and the binding file are small, flat YAML where only a single scalar matters
 * here — regex extraction/rewrite is used deliberately instead of pulling in a full YAML parser
 * dependency for that. Both the pointer lookup and the `project:` rewrite assert *exactly one*
 * match and loud-fail on zero or multiple (a duplicate top-level `project:` would otherwise leave a
 * stale line that last-key-wins YAML parsing could silently bind to the wrong project). If a Warble
 * profile ever grows a more elaborate `context:` block (e.g. multiple context sources), this needs
 * revisiting.
 */
export async function composeUserProfile(options: {
  readonly profileSource: string;
  readonly userProject: string;
  readonly destDir: string;
}): Promise<string> {
  const profileSourceAbs = path.resolve(options.profileSource);
  const userProjectAbs = path.resolve(options.userProject);
  const composedDir = path.join(options.destDir, "profile");

  await cp(profileSourceAbs, composedDir, { recursive: true });

  const profileYamlPath = path.join(composedDir, "profile.yml");
  const profileYamlText = await readFile(profileYamlPath, "utf-8");
  const bindingRelPath = extractContextBindingPath(profileYamlText, profileYamlPath);
  const bindingPath = resolveWithinComposedDir(composedDir, bindingRelPath);

  const bindingText = await readFile(bindingPath, "utf-8");
  const rewritten = rewriteContextBindingProject(bindingText, userProjectAbs, bindingPath);
  await writeFile(bindingPath, rewritten, "utf-8");

  return composedDir;
}

/**
 * Resolves `bindingRelPath` against `composedDir` and rejects anything that escapes it. Mirrors the
 * containment check `harness/exec/local.ts`'s (private) `resolveWithinScope` performs, reusing its
 * exported {@link PathTraversalError} — kept as a local check here so the fix stays within this
 * module rather than widening the exec module's public surface.
 */
function resolveWithinComposedDir(composedDir: string, bindingRelPath: string): string {
  const targetAbs = path.resolve(composedDir, bindingRelPath);
  const relative = path.relative(composedDir, targetAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathTraversalError(bindingRelPath, composedDir);
  }
  return targetAbs;
}

/** Extracts the single `context: project: <path>` pointer from a profile.yml's text. */
export function extractContextBindingPath(profileYamlText: string, sourcePath: string): string {
  const pattern = /^context:[ \t]*\r?\n[ \t]+project:[ \t]*(\S+)[ \t]*$/gm;
  const matches = [...profileYamlText.matchAll(pattern)];
  if (matches.length === 0) {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" has no "context:\\n  project: <path>" block — cannot locate its context binding file`,
    );
  }
  if (matches.length > 1) {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" has ${matches.length} "context:\\n  project:" blocks — expected exactly one`,
    );
  }
  const captured = matches[0]?.[1];
  if (captured === undefined) {
    throw new InvalidProfileShapeError(`"${sourcePath}" has a malformed "context: project:" pointer`);
  }
  const unquoted = stripSurroundingQuotes(captured);
  if (unquoted.length === 0) {
    throw new InvalidProfileShapeError(`"${sourcePath}" has an empty "context: project:" pointer`);
  }
  return unquoted;
}

/**
 * Replaces the single top-level `project:` line in a context-binding YAML's text, preserving
 * surrounding comments. Asserts exactly one top-level `project:` — a second one would survive the
 * rewrite as a stale line and could win under last-key-wins YAML parsing (silent misbind).
 */
export function rewriteContextBindingProject(bindingText: string, newProjectPath: string, sourcePath: string): string {
  const pattern = /^project:[ \t]*.*$/gm;
  const matches = [...bindingText.matchAll(pattern)];
  if (matches.length === 0) {
    throw new InvalidProfileShapeError(`"${sourcePath}" has no top-level "project:" field to rewrite`);
  }
  if (matches.length > 1) {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" has ${matches.length} top-level "project:" fields — expected exactly one (ambiguous binding)`,
    );
  }
  // Function replacement so a project path containing `$` isn't interpreted as a replacement token.
  return bindingText.replace(/^project:[ \t]*.*$/m, () => `project: ${newProjectPath}`);
}

/** Strips a single matching pair of surrounding single/double quotes, if present. */
function stripSurroundingQuotes(value: string): string {
  const match = value.match(/^(['"])(.*)\1$/);
  return match?.[2] ?? value;
}
