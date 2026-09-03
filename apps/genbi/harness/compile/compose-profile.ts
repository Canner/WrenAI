import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathTraversalError } from "../exec/index.js";
import { generatePreparedContext } from "./context-loader.js";
import { InvalidProfileShapeError } from "./errors.js";

/**
 * Copies `profileSource` into `destDir` and rebinds its context to `userProject`, producing a
 * composed profile directory that is safe to pass straight to `warble compile`.
 *
 * The profile's context binding is a **prepared** binding (`kind: prepared`): Warble does not read
 * the user's semantic layer itself, it reads a JSON *document* that WrenAI's own generator
 * (`wren-context-loader`) produces. So rebinding is two writes, not one:
 *
 * 1. Run the generator over `userProject` and write its document over the profile's committed
 *    fixture document, at the path the binding's `document:` field already names.
 * 2. Rewrite the binding's `project:` line to `userProject` (absolute).
 *
 * `project:` stays the layer's **identity** and never becomes the document path. That exact
 * substitution shipped once in Warble and put the filename into every compiled prompt, telling the
 * agent it was working on a project called `context.json`; Warble now guards against it, and this
 * side must not hand it a binding that tries.
 *
 * Because the generated document is written *to the path the binding already declares*, `document:`
 * needs no rewriting at all — the composed binding differs from the committed one only in
 * `project:`. Note that `document:` (like `project:`) resolves relative to the **Warble project
 * root** (the composed directory), not relative to the binding file that declares it.
 *
 * The binding file to rewrite is *not* hardcoded to `context/binding.yml` — it's read from the
 * copied `profile.yml`'s own `context: project: <path>` pointer (the documented Warble mechanism:
 * "profile mounts context via `context: project: <path-to-binding.yml>`"), so this works for any
 * profile following that shape, not just `genbi-default`. Both the binding path and the resolved
 * document path are confined to the composed directory: a `../`-laden pointer that escapes it is a
 * loud {@link PathTraversalError} (reusing the exec module's shared traversal error rather than
 * reading/overwriting an arbitrary host file).
 *
 * Both `profile.yml` and the binding file are small, flat YAML where only a few scalars matter here
 * — regex extraction/rewrite is used deliberately instead of pulling in a full YAML parser
 * dependency for that. Every lookup asserts *exactly one* match and loud-fails on zero or multiple
 * (a duplicate top-level `project:` would otherwise leave a stale line that last-key-wins YAML
 * parsing could silently bind to the wrong project). If a Warble profile ever grows a more
 * elaborate `context:` block (e.g. multiple context sources), this needs revisiting.
 */
export async function composeUserProfile(options: {
  readonly profileSource: string;
  readonly userProject: string;
  readonly destDir: string;
  /**
   * The resolved `wren-context-loader` binary (see `resolveContextLoaderBinary`). Required, not
   * optional-with-a-default: there is no fallback path that skips the generator, and making the
   * caller supply it keeps that structural rather than a comment.
   */
  readonly contextLoaderBin: string;
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
  assertPreparedBindingKind(bindingText, bindingPath);

  const documentRelPath = extractBindingDocumentPath(bindingText, bindingPath);
  const documentPath = resolveWithinComposedDir(composedDir, documentRelPath);
  await mkdir(path.dirname(documentPath), { recursive: true });
  await generatePreparedContext(options.contextLoaderBin, userProjectAbs, documentPath);

  const rewritten = rewriteContextBindingProject(bindingText, userProjectAbs, bindingPath);
  await writeFile(bindingPath, rewritten, "utf-8");

  return composedDir;
}

/**
 * Resolves `relPath` against `composedDir` and rejects anything that escapes it. Mirrors the
 * containment check `harness/exec/local.ts`'s (private) `resolveWithinScope` performs, reusing its
 * exported {@link PathTraversalError} — kept as a local check here so the fix stays within this
 * module rather than widening the exec module's public surface.
 */
function resolveWithinComposedDir(composedDir: string, relPath: string): string {
  const targetAbs = path.resolve(composedDir, relPath);
  const relative = path.relative(composedDir, targetAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathTraversalError(relPath, composedDir);
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
 * Asserts the binding declares exactly one top-level `kind: prepared`.
 *
 * A **missing** `kind:` is rejected rather than tolerated. Omitting it selects Warble's serde
 * default (`wren_project`), i.e. Warble's own built-in MDL adapter — so a binding without the line
 * would compile perfectly well while quietly ignoring the document this function's caller just
 * generated. Since Warble emits neither `kind` nor `document` into the IR, that divergence is
 * invisible in the compiled artifact; the only place it can be caught is here.
 */
export function assertPreparedBindingKind(bindingText: string, sourcePath: string): void {
  const matches = [...bindingText.matchAll(/^kind:[ \t]*(\S+)[ \t]*$/gm)];
  if (matches.length === 0) {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" declares no top-level "kind:" — a context binding rebound to a user project must ` +
        `declare "kind: prepared" (omitting it selects Warble's built-in "wren_project" adapter, which ` +
        `would silently ignore the generated prepared-context document)`,
    );
  }
  if (matches.length > 1) {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" has ${matches.length} top-level "kind:" fields — expected exactly one (ambiguous binding)`,
    );
  }
  const kind = stripSurroundingQuotes(matches[0]?.[1] ?? "");
  if (kind !== "prepared") {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" declares "kind: ${kind}" — a context binding rebound to a user project must declare ` +
        `"kind: prepared"`,
    );
  }
}

/**
 * Extracts the single top-level `document: <path>` field naming where the prepared-context document
 * lives, relative to the Warble project root (NOT to the binding file's own directory).
 */
export function extractBindingDocumentPath(bindingText: string, sourcePath: string): string {
  const matches = [...bindingText.matchAll(/^document:[ \t]*(\S+)[ \t]*$/gm)];
  if (matches.length === 0) {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" has no top-level "document:" field — a "kind: prepared" binding must name the ` +
        `prepared-context document it reads`,
    );
  }
  if (matches.length > 1) {
    throw new InvalidProfileShapeError(
      `"${sourcePath}" has ${matches.length} top-level "document:" fields — expected exactly one (ambiguous binding)`,
    );
  }
  const unquoted = stripSurroundingQuotes(matches[0]?.[1] ?? "");
  if (unquoted.length === 0) {
    throw new InvalidProfileShapeError(`"${sourcePath}" has an empty "document:" field`);
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
