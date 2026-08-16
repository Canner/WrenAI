/**
 * Refutes an enrichment proposal before a human is asked to approve it.
 *
 * Everything capable of refuting a proposal — `wren context validate`, `wren
 * context build`, planning its references through the MDL — used to run inside
 * apply, downstream of the approval. So the person was asked to approve
 * something no machine had checked, and the machine checked it afterwards.
 * That ordering does not scale: enrichment output is routinely larger than
 * anyone will read, so approval degrades into a rubber stamp — which is worse
 * than no gate, because it looks like review happened.
 *
 * The checks here need no correct answer to compare against. The engine is the
 * ground truth: a measure over a column that does not exist cannot be planned,
 * whatever anyone believes about it.
 *
 * MECHANISM. A proposal is not on disk, and must not be written into the bound
 * project to find out whether it is sound. The host copies the project to a
 * temporary directory, writes the proposal there, runs the ladder, and discards
 * the copy. The bound project is never touched, so there is nothing to roll
 * back — not even when a check throws.
 *
 * The shadow is host-owned. Giving the agent write access to a project copy is
 * giving it write access that can leak to the real one.
 *
 * WHY THE HOST RUNS THESE ITSELF. The agent holds read-only execution and can
 * run the same commands; it should, because doing so reduces the rounds needed
 * here. But its report is not evidence. "The model says validate passed" is the
 * same failure as the model-authored hashes a live draft once produced, which
 * is why proposal hashing is host-owned too.
 */
import { execFile } from "node:child_process";
import { cp, lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EnrichmentBinding, EnrichmentOperation, EnrichmentProposal } from "./enrichment.js";

/**
 * The ladder, cheapest first. Every step before `dry_run` is local: no
 * database, no credentials, no round trip. Ordering is the point — a proposal
 * refuted by grammar must never reach the warehouse.
 *
 * `dry_run` is not optional the way that phrasing might suggest. A `new_cube`
 * always reaches it, because nothing local resolves a cube's expressions; every
 * other change kind is refuted or verified before it.
 */
export type VerificationStep = "sink" | "grammar" | "validate" | "build" | "dry_plan" | "dry_run";

export const VERIFICATION_LADDER: readonly VerificationStep[] = ["sink", "grammar", "validate", "build", "dry_plan", "dry_run"];

export interface VerificationRefutation {
  readonly operationId: string;
  readonly step: VerificationStep;
  /** Readable by a person and consumable by a later repair step. Never raw source material. */
  readonly reason: string;
}

export type VerificationVerdict =
  | { readonly status: "verified"; readonly proposalHash: string; readonly projectRevision: string; readonly stepsRun: readonly VerificationStep[] }
  | { readonly status: "refuted"; readonly proposalHash: string; readonly projectRevision: string; readonly stepsRun: readonly VerificationStep[]; readonly refutation: VerificationRefutation }
  /**
   * The ladder could not be run at all. Deliberately distinct from `verified`:
   * "we could not check" and "we checked and it holds" must never collapse into
   * the same value, or an unrunnable checker silently becomes an approval.
   */
  | { readonly status: "unavailable"; readonly proposalHash: string; readonly projectRevision: string; readonly reason: string };

/**
 * The Wren keys each change kind's draft must be written in. The first live
 * draft to reach this stage used `model`/`columns`/`metrics`/`relationships` —
 * plausible-looking, and not Wren's grammar at all.
 */
const REQUIRED_KEYS: Partial<Record<string, readonly string[]>> = {
  new_cube: ["base_object"],
  new_view: ["statement"],
};

/** Keys that indicate a different product's grammar rather than Wren's. */
const FOREIGN_KEYS: Partial<Record<string, readonly string[]>> = {
  new_cube: ["columns", "metrics", "model"],
};

/**
 * The first path component of `sink` that is a symlink, if any. Checked inside
 * the shadow, where `cp` has already reproduced the bound project's own links.
 */
async function symlinkComponent(root: string, sink: string): Promise<string | undefined> {
  const parts = sink.split("/").filter((part) => part.length > 0);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) return path.relative(root, current);
    } catch {
      return undefined; // does not exist yet — nothing to follow
    }
  }
  return undefined;
}

/**
 * Every call below runs with `cwd` set to the shadow copy, but `wren` does
 * not resolve its project from cwd alone: `WREN_PROJECT_HOME`, when set,
 * wins over cwd-based discovery (see `discover_project_path()` in
 * `core/wren/src/wren/context.py`), and an explicit `--mdl`/`--path` would
 * win over both. If this process's own ambient environment ever carries
 * `WREN_PROJECT_HOME` — as GenBI itself sets it for native session children
 * (`server/native-sessions.ts`, `server/bin.ts`) — every step below would
 * silently validate/build/query the BOUND project instead of the shadow,
 * because `execFile` inherits the parent's env by default. Pin it here,
 * explicitly, to the one project this call is actually allowed to touch:
 * the shadow root passed in as `cwd`. This does not depend on whether the
 * BFF happens to run with `WREN_PROJECT_HOME` unset today.
 *
 * `WREN_HOME` (the `~/.wren` profile/config store, a different variable) is
 * deliberately left ambient rather than pinned: it is a read-only source of
 * real connection credentials, and `dry-run`/`cube query` need the real
 * profile to reach the real data source for the warehouse step — pointing
 * it at a throwaway location would break verification, not sandbox it, and
 * nothing in this ladder writes through it. Checked: `context validate`,
 * `context build`, `dry-plan`, `cube query --sql-only`, and `dry-run` take
 * no other ambient project-selecting input than `WREN_PROJECT_HOME`/cwd/
 * `~/.wren/config.yml`'s `default_project` (per the CLI's own `--path`
 * help text and `discover_project_path()`), and none of the five writes to
 * `WREN_HOME` or any other location outside the project directory it is
 * given.
 */
function runWren(args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string; error: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    execFile("wren", args, { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WREN_PROJECT_HOME: cwd } }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: error as NodeJS.ErrnoException | null });
    });
  });
}

/** Trims a command's output into something safe and readable to carry in a verdict. */
function firstMeaningfulLine(...streams: string[]): string {
  for (const stream of streams) {
    const line = stream
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);
    if (line !== undefined) return line.slice(0, 400);
  }
  return "no output";
}

/**
 * A cheap structural read of a YAML draft. Not a YAML parser: it only needs to
 * know which top-level keys are present, and pulling in a parser to answer that
 * would be most of a dependency spent on one question. Matches this package's
 * existing convention of small single-purpose scans (see `server/adopt.ts`).
 */
function topLevelKeys(draft: string): Set<string> {
  const keys = new Set<string>();
  for (const line of draft.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):/.exec(line);
    if (match) keys.add(match[1]!.toLowerCase());
  }
  return keys;
}

function checkGrammar(operation: EnrichmentOperation): string | undefined {
  const keys = topLevelKeys(operation.draft);
  if (keys.size === 0) return undefined; // not a keyed document (e.g. knowledge markdown)
  const foreign = (FOREIGN_KEYS[operation.changeKind] ?? []).filter((key) => keys.has(key));
  if (foreign.length > 0) {
    return `uses ${foreign.map((key) => `"${key}"`).join(", ")}, which is not Wren's grammar for ${operation.changeKind}; expected ${(REQUIRED_KEYS[operation.changeKind] ?? []).map((key) => `"${key}"`).join(", ")}`;
  }
  const missing = (REQUIRED_KEYS[operation.changeKind] ?? []).filter((key) => !keys.has(key));
  return missing.length > 0 ? `is missing required ${missing.map((key) => `"${key}"`).join(", ")} for ${operation.changeKind}` : undefined;
}

/**
 * How to make the engine resolve a proposed object's own references — the
 * defect a human reading YAML is least likely to catch, since an invented
 * column name reads exactly like a real one.
 *
 * Views and models are relations, so planning `SELECT *` over them through the
 * compiled MDL resolves their expressions with no database at all.
 *
 * A CUBE IS NOT. This was the first version's defect: it planned
 * `SELECT * FROM "<cube>"`, which fails with `table not found` for every cube —
 * sound or not — because cubes are not FROM-able relations in the catalog. It
 * therefore refuted every cube proposal while catching nothing. Verified
 * against a real project: `context validate` and `context build` both accept a
 * measure over a nonexistent column and compile it into `target/mdl.json`.
 *
 * A cube's expressions are resolved by generating its query and having the data
 * source parse it. `cube query --sql-only` alone is not enough — it emits
 * `SUM(quantity_on_hand)` happily — so the generated SQL goes to `dry-run`,
 * which parses and validates at the source without returning rows.
 */
type Probe =
  | { readonly kind: "relation"; readonly sql: string }
  | { readonly kind: "cube"; readonly cube: string; readonly measures: readonly string[] };

/** Measure names declared in a cube draft, for the generated query. */
function draftMeasureNames(draft: string): string[] {
  const names: string[] = [];
  let inMeasures = false;
  for (const line of draft.split(/\r?\n/)) {
    if (/^measures:\s*$/.test(line)) { inMeasures = true; continue; }
    if (/^[A-Za-z_]/.test(line)) { inMeasures = false; continue; }
    if (!inMeasures) continue;
    const name = /^\s*-?\s*name:\s*"?([A-Za-z_][\w-]*)"?\s*$/.exec(line)?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

function probeFor(operation: EnrichmentOperation): Probe | undefined {
  const name = /^(?:cubes|views|models)\/([a-z0-9_-]+)\//.exec(operation.sink)?.[1];
  if (name === undefined) return undefined;
  if (operation.changeKind === "new_cube") {
    const measures = draftMeasureNames(operation.draft);
    return measures.length > 0 ? { kind: "cube", cube: name, measures } : undefined;
  }
  return { kind: "relation", sql: `SELECT * FROM "${name}" LIMIT 0` };
}

export interface VerifyProposalOptions {
  /** Test seam. Defaults to running the real `wren` in the shadow directory. */
  readonly run?: (args: readonly string[], cwd: string) => Promise<{ stdout: string; stderr: string; error: NodeJS.ErrnoException | null }>;
}

/**
 * There is deliberately no opt-out for the data-source step.
 *
 * An earlier version carried an `includeWarehouseDryRun` flag documented as
 * "off by default". Once cubes had to be checked through `dry-run` — nothing
 * local resolves their expressions — the flag stopped being read while its
 * documentation went on promising a round trip could be avoided. An advertised
 * safety lever that does nothing is worse than none, so it is gone.
 *
 * What is true, in one place: verifying a `new_cube` always reaches the data
 * source, via `dry-run`, which parses and validates without returning rows.
 * Every other change kind is verified entirely locally. A caller that cannot
 * reach its source cannot verify a cube, and the honest report for that is a
 * refutation or `unavailable` from the attempt itself — not a flag that skips
 * the check and calls the result verified.
 */

/**
 * Runs the ladder against a shadow copy of the bound project. Stops at the
 * first refutation, so a proposal refuted locally never reaches the warehouse.
 *
 * The verdict carries the proposal hash and project revision it was earned
 * against: a verdict must not survive onto edited content or a moved project.
 */
export async function verifyProposal(
  proposal: EnrichmentProposal,
  binding: EnrichmentBinding,
  options: VerifyProposalOptions = {},
): Promise<VerificationVerdict> {
  const run = options.run ?? runWren;
  const bound = { proposalHash: proposal.hash, projectRevision: proposal.projectRevision };
  const stepsRun: VerificationStep[] = [];

  // Steps 1-2 need no project at all, so they run before paying for a copy.
  for (const operation of proposal.operations) {
    const grammar = checkGrammar(operation);
    if (grammar !== undefined) {
      return { status: "refuted", ...bound, stepsRun: ["sink", "grammar"], refutation: { operationId: operation.id, step: "grammar", reason: `draft ${grammar}` } };
    }
  }
  stepsRun.push("sink", "grammar");

  let shadow: string | undefined;
  try {
    shadow = await mkdtemp(path.join(tmpdir(), "wren-enrich-verify-"));
    const project = path.join(shadow, "project");
    // `.env` comes along: the ladder's later steps resolve the project's own
    // connection the way any other wren invocation in that directory would.
    await cp(binding.path, project, { recursive: true });

    for (const operation of proposal.operations) {
      const sinkPath = path.join(project, operation.sink);
      // `canonicalizeProposal` already constrained every sink to a fixed shape,
      // so this cannot escape; assert it anyway, because a path that escapes a
      // temp directory is not a failure worth discovering later.
      if (!path.resolve(sinkPath).startsWith(path.resolve(project) + path.sep)) {
        return { status: "refuted", ...bound, stepsRun, refutation: { operationId: operation.id, step: "sink", reason: `sink "${operation.sink}" resolves outside the project` } };
      }
      // The lexical check above never touches the filesystem, so it passes for a
      // path whose components are symlinks. `cp` does not dereference them, so a
      // symlink in the bound project is copied AS a symlink and a later write
      // would follow it out of the shadow — defeating the guarantee this module
      // states. Refuse rather than follow.
      const escaping = await symlinkComponent(project, operation.sink);
      if (escaping !== undefined) {
        return { status: "refuted", ...bound, stepsRun, refutation: { operationId: operation.id, step: "sink", reason: `sink "${operation.sink}" passes through a symlink ("${escaping}"), which a write would follow out of the project` } };
      }
      await mkdir(path.dirname(sinkPath), { recursive: true });
      await writeFile(sinkPath, operation.draft.endsWith("\n") ? operation.draft : `${operation.draft}\n`, "utf-8");
    }

    const validate = await run(["context", "validate"], project);
    stepsRun.push("validate");
    if (validate.error !== null) {
      if (validate.error.code === "ENOENT") return { status: "unavailable", ...bound, reason: "the wren CLI is not on PATH" };
      return { status: "refuted", ...bound, stepsRun, refutation: { operationId: proposal.operations[0]?.id ?? "", step: "validate", reason: firstMeaningfulLine(validate.stderr, validate.stdout) } };
    }

    const build = await run(["context", "build"], project);
    stepsRun.push("build");
    if (build.error !== null) {
      return { status: "refuted", ...bound, stepsRun, refutation: { operationId: proposal.operations[0]?.id ?? "", step: "build", reason: firstMeaningfulLine(build.stderr, build.stdout) } };
    }

    for (const operation of proposal.operations) {
      const probe = probeFor(operation);
      if (probe === undefined) continue; // nothing queryable (e.g. a knowledge append)

      if (probe.kind === "relation") {
        const plan = await run(["dry-plan", "--sql", probe.sql], project);
        if (!stepsRun.includes("dry_plan")) stepsRun.push("dry_plan");
        if (plan.error !== null) {
          return { status: "refuted", ...bound, stepsRun, refutation: { operationId: operation.id, step: "dry_plan", reason: firstMeaningfulLine(plan.stderr, plan.stdout) } };
        }
        continue;
      }

      // Cube: generate its query, then have the source parse it. Both steps are
      // needed — generation alone accepts an invented column.
      const generated = await run(["cube", "query", "--cube", probe.cube, "--measures", probe.measures.join(","), "--sql-only"], project);
      if (!stepsRun.includes("dry_plan")) stepsRun.push("dry_plan");
      if (generated.error !== null) {
        return { status: "refuted", ...bound, stepsRun, refutation: { operationId: operation.id, step: "dry_plan", reason: firstMeaningfulLine(generated.stderr, generated.stdout) } };
      }
      const sql = generated.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).pop();
      if (sql === undefined) {
        return { status: "unavailable", ...bound, reason: `could not generate a query for cube "${probe.cube}"` };
      }
      // Unlike the relation probe, this one reaches the data source: nothing
      // local resolves a cube's expressions, so the alternative is not checking
      // cubes at all. `dry-run` parses and validates without returning rows.
      const dry = await run(["dry-run", "--sql", sql], project);
      if (!stepsRun.includes("dry_run")) stepsRun.push("dry_run");
      if (dry.error !== null) {
        return { status: "refuted", ...bound, stepsRun, refutation: { operationId: operation.id, step: "dry_run", reason: firstMeaningfulLine(dry.stderr, dry.stdout) } };
      }
    }

    return { status: "verified", ...bound, stepsRun };
  } catch (error) {
    // An unrunnable ladder is reported as such, never as a pass.
    return { status: "unavailable", ...bound, reason: (error as Error).message };
  } finally {
    if (shadow !== undefined) await rm(shadow, { recursive: true, force: true }).catch(() => undefined);
  }
}
