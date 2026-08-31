import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ContextLifecyclePrefix } from "../harness/index.js";

/**
 * Multi-turn context composition. Bounded to the last 5
 * resolved turns in the session (see `Store.listRecentResolvedTurns`), using
 * only the verbatim prior question and the prior answer's *summary* — never
 * the full `RenderEnvelope` — to keep the composed input small and to avoid
 * leaking rich block structure into a plain-text agent prompt.
 */
export interface PriorTurnForCompose {
  readonly question: string;
  readonly answerSummary: string | undefined;
}

export function composeInput(priorTurns: readonly PriorTurnForCompose[], question: string): string {
  const bounded = priorTurns.slice(-5);
  const pairs = bounded.map((turn) => `User: ${turn.question}\nAssistant: ${turn.answerSummary ?? "(no answer)"}`);
  return [...pairs, question].join("\n\n");
}

/**
 * A follow-up that resolves a pending clarify (see `Store.updateSessionStatus`'s
 * `awaiting_clarify` state) combines the original stored question with the
 * short follow-up text into one effective question, which is then fed into
 * `composeInput` as `question` like any other turn. The caller is
 * responsible for clearing `pending_question` once this is consumed.
 */
export function composeClarifyFollowUp(pendingQuestion: string, followUp: string): string {
  return `${pendingQuestion} (${followUp})`;
}

/** Which turn of the agentic setup/connect flow is being dispatched (see `harness/setup/runner.ts`). */
export type SetupStepKey = "connect" | "connect_resume" | "context";

/** Values sourced from the setup wizard's connect form. Never a secret — see `composeSetupPrompt`'s doc comment. */
export interface SetupFormValues {
  readonly projectName: string;
  readonly sourceType: string;
  readonly workspaceRoot: string;
}

/**
 * Canonical schema discovery for a connected project before its first MDL
 * build. Kept shared with the explicit corrective-retry composer so a failed
 * pre-MDL `wren --sql` attempt cannot be prompted to repeat the same command.
 */
/** wren's file-backed sources: their `url` is a directory, not a database. */
const FILE_BACKED_SOURCES = new Set(["duckdb", "local_file", "s3_file", "minio_file", "gcs_file"]);

export function zeroMdlSchemaDiscoveryInstruction(sourceType?: string): string {
  return (
    `Before the first usable MDL exists, do NOT run "wren --sql" for schema discovery: that command queries through the semantic layer and requires target/mdl.json first. ` +
    `Use the project-pinned Wren profile and connector directly instead, without reading or printing .env or the expanded profile. From the bound project directory run this safe metadata query shape (you may add another metadata query in the same shape if needed): ` +
    `WREN_PYTHON="$(sed -n '1s/^#!//p' "$(command -v wren)")"; "$WREN_PYTHON" -c "from pathlib import Path; from wren.profile import resolve_profile_for_project, expand_profile_secrets; from wren.model.data_source import DataSource; from wren.connector import get_connector; _, p = resolve_profile_for_project(Path.cwd(), strict=True); ds = DataSource(p.pop(\'datasource\')); c = get_connector(ds, ds.get_connection_info(expand_profile_secrets(p))); print(c.query(\\"SELECT table_catalog, table_schema, table_name, column_name, ordinal_position, data_type, is_nullable FROM information_schema.columns WHERE table_schema NOT IN (\'information_schema\', \'pg_catalog\') ORDER BY table_catalog, table_schema, table_name, ordinal_position\\").to_pylist()); c.close()". ` +
    // `information_schema` is not universal: BigQuery exposes it only as
    // `<dataset>.INFORMATION_SCHEMA.COLUMNS`, and Oracle has no
    // `information_schema` at all. Presenting one literal SQL as the shape for
    // every connector would send the agent to run a query that cannot parse,
    // and the recipe used to say "run exactly this".
    `That query shape is written for connectors that expose a flat "information_schema.columns"; the read-only, metadata-only, no-credentials rules are what matter, not the literal SQL. ` +
    `If this connector's catalog is shaped differently, keep the same command scaffold and substitute that source's own metadata catalog rather than forcing this one. ` +
    // Only for the file-backed sources. Sent to every project before this, it
    // put DuckDB advice — and `DUCKDB_URL` — in front of an agent connecting to
    // Postgres.
    (sourceType === undefined || FILE_BACKED_SOURCES.has(sourceType)
      ? `For DuckDB/local-file profiles specifically, DUCKDB_URL is a DIRECTORY containing one or more .duckdb files; never pass that directory to duckdb.connect as though it were one database file. The Wren connector performs the required read-only attachment of every .duckdb file in that directory. `
      : "")
  );
}

/** Model subdirectory names already written under `<projectDir>/models` (one per model — see `wren generate-mdl`'s scaffold shape). Empty if `models/` doesn't exist yet, e.g. before the first model is written. */
function listModelNames(projectDir: string): string[] {
  try {
    return readdirSync(path.join(projectDir, "models"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Cube names already written under `<projectDir>/cubes` — either a `<name>/metadata.yml` subdirectory or a flat `<name>.yml` file (both shapes occur in practice). Empty if `cubes/` doesn't exist yet. */
function listCubeNames(projectDir: string): string[] {
  try {
    return readdirSync(path.join(projectDir, "cubes"), { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? entry.name : entry.name.replace(/\.ya?ml$/i, "")))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Counts top-level relationship entries already declared in
 * `<projectDir>/relationships.yml` via a plain `- name:` line scan, rather
 * than pulling in a YAML parser dependency for what is only a progress hint
 * in the resume prompt (never a source of truth the agent is told to trust
 * blindly). A commented-out example block (every line prefixed with `#`, the
 * shape `wren context init` scaffolds) never matches, since the pattern
 * anchors on a bare `-` at the start of the line. Returns `undefined` when
 * the file doesn't exist at all, distinct from `0` for an existing-but-empty
 * list, so the caller can omit the sentence entirely instead of asserting
 * "0 relationships" about a project that hasn't reached that step yet.
 */
function countRelationships(projectDir: string): number | undefined {
  try {
    const text = readFileSync(path.join(projectDir, "relationships.yml"), "utf-8");
    return (text.match(/^\s*-\s*name:/gm) ?? []).length;
  } catch {
    return undefined;
  }
}

/**
 * Builds the "already done" inventory sentence for the resume
 * prompt (`composeSetupPrompt`'s `resumeFromDisk` branch) — read straight off
 * disk at compose time, not from any agent self-report, so a resumed turn can
 * be told exactly what already exists instead of re-discovering it via `ls`
 * and re-reading files.
 */
function describeResumeInventory(projectDir: string): string {
  const modelNames = listModelNames(projectDir);
  const cubeNames = listCubeNames(projectDir);
  const relationshipCount = countRelationships(projectDir);

  const parts: string[] = [
    modelNames.length > 0
      ? `${modelNames.length} model(s) already written under "${projectDir}/models": ${modelNames.join(", ")}.`
      : `no model directories exist yet under "${projectDir}/models".`,
  ];
  if (cubeNames.length > 0) {
    parts.push(`${cubeNames.length} cube(s) already defined under "${projectDir}/cubes": ${cubeNames.join(", ")}.`);
  }
  if (relationshipCount !== undefined && relationshipCount > 0) {
    parts.push(`${relationshipCount} relationship(s) already declared in "${projectDir}/relationships.yml".`);
  }
  return parts.join(" ");
}

/**
 * Composes the single-line prompt for a setup/connect turn dispatched via
 * `DispatchedSetupRunner` (the `connect_source` warble component). Single-line
 * because dispatched's `chat` subcommand is a line-per-turn stdin protocol —
 * `buildAgentSdkChatArgs` rejects a question containing a newline.
 *
 * Credential boundary (load-bearing): this prompt
 * carries only the source TYPE plus the project name and workspace root —
 * NEVER a credential value. It explicitly instructs the agent to never ask
 * for or print any credential value, and to write only an EMPTY `.env`
 * template for the user to fill out-of-band.
 *
 * Terminal contract: the prompt itself is where the
 * SETUP_STATUS contract is defined — warble's `connect_source` component
 * carries no terminal-status convention of its own. The composed prompt
 * instructs the agent to end its final message with exactly one line of the
 * form `SETUP_STATUS: ok|needs_input|error` followed by a one-line human
 * reason; `parseSetupTerminal` (`harness/setup/runner.ts`) parses the LAST such
 * line out of the turn's finalText.
 */
export function composeSetupPrompt(
  stepKey: SetupStepKey,
  formValues: SetupFormValues,
  options?: {
    readonly resumeFromDisk?: boolean;
    /**
     * Plan A session resume: the caller is dispatching this turn with
     * `DispatchedOptions.resumeSessionId` set, so the agent-sdk conversation itself
     * (not just the on-disk project state) already carries everything the
     * prior attempt read/listed/fetched. When set, the `context` step composes
     * a short "continue in this same conversation" nudge instead of
     * `resumeFromDisk`'s disk-inventory prompt — there is no re-orientation
     * left to compensate for, so no inventory needs restating. Takes
     * precedence over `resumeFromDisk` if both are set (callers should only
     * ever set one).
     */
    readonly resumeSession?: boolean;
    /**
     * One bounded recovery after a context turn completed without recognised
     * schema discovery. This takes precedence over the disk-resume wording:
     * the recovery must discover the schema before it can finish, even if a
     * prior turn left partial files behind.
     */
    readonly schemaDiscoveryRecovery?: boolean;
    /** Host-verified ordered progress from matching earlier context attempts. */
    readonly contextLifecycleRecovery?: ContextLifecyclePrefix;
    /**
     * What the host actually did about this source's Python driver, from
     * `provisionSourceDriver`. Stated verbatim rather than assumed: this prompt
     * used to assert the driver was "already available — there is nothing to
     * install", which is false for most of wren's connectors and is disprovable
     * by the agent in a single command.
     */
    readonly driverNote?: string;
    /**
     * The exact `.env` variable names the user's chosen connection shape needs.
     * Several sources publish more than one shape — BigQuery dataset vs
     * project, Redshift password vs IAM — and with nothing naming the choice
     * the agent picked one, so the credential form differed between runs.
     */
    readonly variantFields?: readonly string[];
  },
): string {
  const { projectName, sourceType, workspaceRoot } = formValues;
  const projectDir = path.join(workspaceRoot, projectName);

  const credentialBoundary =
    "Never ask for, print, or read credential values (passwords, API keys, tokens, connection secrets, etc).";
  const emptyCredentialTemplateBoundary =
    "Write only an empty .env template with the required variable names and no values; the user fills it in themselves, out-of-band, and you must never read its values back.";

  const terminalContract =
    "End your final message with exactly one line of the form 'SETUP_STATUS: ok' or 'SETUP_STATUS: needs_input' or 'SETUP_STATUS: error', " +
    "followed on the same line by a short human-readable reason after a dash, e.g. 'SETUP_STATUS: needs_input - waiting for the user to fill in .env'.";

  // Parametrized over the skill name so the `context` step can point the agent at
  // `generate-mdl` instead of `onboarding`, while every step still shares the exact same
  // no-redirection/project-relative rule (the sandbox constraint itself never changes).
  // `skipSkillFetch` is set only by the `context` step's `resumeFromDisk` branch — the prior
  // attempt already fetched this same skill, so re-fetching it here would be exactly the kind
  // of rediscovery this resume path exists to avoid; the sandbox rule itself still applies.
  //
  // Only shell REDIRECTION (no 2>&1, no >, no >>) is actually enforced — on both dispatch
  // paths (in-process's setup-native.ts and dispatched's warble dispatcher guardrail share the same
  // DESTRUCTIVE/REDIRECTION denylist; neither blocks pipes or ||/&& chaining). The prior
  // wording here falsely claimed the sandbox blocks those too, which a real agent disproved by
  // running `cd <projectDir> && wren profile add ...` — the only way that step could succeed,
  // since the exec action's cwd is otherwise fixed to the workspace root and some wren
  // subcommands (`wren profile add`) have no path/project flag of their own. This rule now
  // says only what's true: project steps are rooted at their project either by
  // a turn-level binding or, where the backend exposes one, a per-action cwd.
  const bashDisciplineFor = (skillName: string, disciplineOptions?: { readonly skipSkillFetch?: boolean }): string => {
    const sandboxRule =
      "When you run wren CLI commands, invoke each one directly as a single plain command with NO shell redirection (no 2>&1, no >, no >>) — the sandbox blocks that and the call will fail. " +
      "For a project step, execution is rooted at the project directory either by a turn-level binding or, where the backend exposes it, a per-action cwd field. Do not prepend the project name to a project-relative path or use 'cd <dir> && ...' chaining. " +
      "pipes and ||/&& chaining are not specifically blocked, but are unnecessary and should be avoided.";
    return disciplineOptions?.skipSkillFetch
      ? sandboxRule
      : `${sandboxRule} Start by fetching the skill with 'wren skills get ${skillName}' (plain, no redirection) and follow it.`;
  };

  if (stepKey === "connect") {
    return (
      `Follow the wren onboarding skill to scaffold a new wren project named "${projectName}" for a "${sourceType}" data source, ` +
      `under the workspace root "${workspaceRoot}". The wren CLI is already installed and on PATH. ` +
      `${options?.driverNote ?? ""} The host manages the Python environment, so skip the skill's Preflight section entirely and skip Step 2's "pip install" sub-step; ` +
      `do not run pip install and do not spend turns checking the Python environment. Whenever the skill has you run "wren context init", always pass ` +
      `"--path \"${projectDir}\" --empty" explicitly — never run "wren context init" bare, since the exec action's cwd defaults to the workspace root and a ` +
      `bare call would scaffold the project into the workspace root itself instead of "${projectDir}". Go straight to running that "wren context init" command — it creates the project directory and writes its wren_project.yml for you; ` +
      `never hand-write or edit wren_project.yml yourself, before or after running it. Then write an empty .env template ` +
      `for the "${sourceType}" connection's required variables — do not fill in any values. ` +
      (options?.variantFields !== undefined && options.variantFields.length > 0
        ? `The user has chosen this connection's shape, so the template must contain exactly these variable names and no others: ${options.variantFields.join(", ")}. `
        : "") +
      `Then stop and wait for the user to fill in the .env file. ` +
      `${bashDisciplineFor("onboarding")} ${credentialBoundary} ${emptyCredentialTemplateBoundary} ${terminalContract}`
    );
  }

  if (stepKey === "context") {
    // No credential boundary here (unlike connect/connect_resume): this step never touches
    // secret values — the project's .env was already filled in and validated by the prior
    // connect_resume turn, and generate-mdl only discovers schema + writes MDL YAML/JSON.
    //
    // Resume path: after an `error_max_turns` checkpoint, the "continue" decision
    // re-dispatches this same step with `resumeFromDisk: true` so the agent picks up the
    // partially-written models already on disk instead of re-scaffolding from zero.
    //
    // The resumed agent was observed burning its (fresh) turn budget re-orienting
    // from scratch — re-`ls`-ing the project dir, re-reading files, re-fetching skills it
    // already had — instead of picking up where the prior attempt left off. So this branch
    // now reads the project dir at COMPOSE TIME (not the agent, and not the agent's
    // self-report) to hand it a concrete "already done" inventory, tells it the generate-mdl/
    // enrich-context skills were already fetched, and points it straight at finishing rather
    // than discovery. Every downstream instruction (build/validate/measure/stop) is still
    // shared byte-for-byte with the normal path so the existing prompt tests stay valid.
    //
    // Plan A (`resumeSession`): when the caller is resuming the SAME agent-sdk conversation
    // (not just replaying disk state), there is nothing left to compensate for — the agent's
    // own context already has the inventory, so this composes a short continuation nudge
    // instead of restating `describeResumeInventory`'s findings at all.
    const recoveryOpening = (() => {
      switch (options?.contextLifecycleRecovery) {
        case "discovery":
          return `Host verification already established schema discovery for the wren project "${projectName}" at "${projectDir}". Do NOT repeat discovery; the exact remaining ordered operations are: run "wren context validate" successfully, THEN run "wren context build" successfully. `;
        case "validate":
          return `Host verification already established schema discovery and "wren context validate" for the wren project "${projectName}" at "${projectDir}". Do NOT repeat either; the exact remaining operation is: run "wren context build" successfully and produce a nonempty target/mdl.json. `;
        case "build":
          return `Host verification already established schema discovery, "wren context validate", and "wren context build" for the wren project "${projectName}" at "${projectDir}". Do not redo lifecycle commands; inspect the host-required target/mdl.json artifact and report honestly if it is unavailable. `;
        default:
          return undefined;
      }
    })();
    const opening = recoveryOpening ?? (options?.schemaDiscoveryRecovery
      ? options.resumeSession
        ? `Continue this same conversation with the required schema-discovery correction for the wren project "${projectName}" at "${projectDir}". `
        : `A prior attempt to generate the MDL for the wren project "${projectName}" at "${projectDir}" did not complete recognized schema discovery. `
      : options?.resumeSession
      ? `Continue this same conversation exactly where you left off before you ran out of turns on generating the MDL for the wren project "${projectName}" at "${projectDir}" — you already have full context, so do not re-list directories, do not re-read files you've already read, and do not re-fetch any skill you already fetched. Pick up straight from where you stopped and keep finishing the generate-mdl work. `
      : options?.resumeFromDisk
        ? `A previous attempt to generate the MDL for the wren project "${projectName}" at "${projectDir}" ran out of turns partway through. ` +
          `Already done, read directly off disk — trust this instead of re-checking it yourself: ${describeResumeInventory(projectDir)} ` +
          `You already fetched the generate-mdl skill (and, if used, the enrich-context skill) in the previous attempt — do NOT run "wren skills get" for them again. ` +
          `Do NOT delete or re-scaffold any existing model, and do NOT run "wren context init" again. ` +
          `Skip re-orientation entirely: do not re-list directories or re-read files just to confirm the inventory above, and do not start over from schema discovery — go straight to finishing. Write only whatever model, measure, cube, or relationship is still genuinely missing (if anything), then build and validate as described below and stop. `
        : `Follow the wren generate-mdl skill to generate the MDL for the wren project "${projectName}" ` +
          `at "${projectDir}". `);
    // A real agent turn was observed running "wren generate-mdl" as if it were a CLI
    // subcommand — it isn't; "generate-mdl" only names a skill DOCUMENT, fetched via
    // "wren skills get generate-mdl". This note is a prompt-wording mitigation only
    // (probabilistic, not a guarantee the model will heed it) — worded so the resume
    // paths, which already fetched the skill, don't repeat the fetch instruction (that
    // would contradict their own "do NOT re-run wren skills get" guidance above).
    const generateMdlNote =
      options?.resumeFromDisk === true || options?.resumeSession === true || recoveryOpening !== undefined
        ? `Reminder: "generate-mdl" is a skill document you already fetched, not a runnable CLI subcommand — there is no "wren generate-mdl" command. `
        : `Note: "generate-mdl" names a skill DOCUMENT, not a runnable CLI subcommand — the only way to obtain it is "wren skills get generate-mdl"; there is no "wren generate-mdl" command, and running it will fail with a CLI usage/error rather than doing anything. `;
    const schemaDiscoveryRecovery = options?.schemaDiscoveryRecovery && recoveryOpening === undefined
      ? `Corrective requirement: before writing any model/cube/measure or treating "wren context build" or "wren context validate" as finalization, run a real schema-discovery command from the generate-mdl skill against the connected source and make sure it succeeds. The prior result did not establish that the source is empty; it established only that the workflow skipped successful discovery. If discovery fails, report that command/tool failure honestly and stop. `
      : "";
    const zeroMdlDiscovery = recoveryOpening === undefined ? zeroMdlSchemaDiscoveryInstruction(sourceType) : "";
    return (
      opening +
      generateMdlNote +
      schemaDiscoveryRecovery +
      zeroMdlDiscovery +
      `This project step is rooted at "${projectDir}" by its turn-level binding or, where exposed, a per-action cwd. Run every wren CLI command in this step — schema-introspection commands, "wren context build", and "wren context validate" — relative to that project directory. The wren CLI's .env auto-discovery only checks the process's current working directory and completely ignores --path, so a command run from the wrong directory will report this project's connection variables as unset even though "${projectDir}/.env" is filled in correctly — that is NOT a real connection failure. ` +
      (options?.contextLifecycleRecovery === "discovery"
        ? `The remaining ordered operations are mandatory: run "wren context validate" successfully, THEN run "wren context build" successfully (the build compiles the model YAML into target/mdl.json, which must contain at least one model). `
        : options?.contextLifecycleRecovery === "validate"
          ? `The remaining ordered operation is mandatory: run "wren context build" successfully and produce target/mdl.json with at least one model. `
          : options?.contextLifecycleRecovery === "build"
            ? `Do not run discovery, validate, or build again unless the host artifact check below shows the already-built target/mdl.json is unavailable; report that failure honestly instead. `
            : `After successful schema discovery and schema-derived model generation, you MUST run "wren context validate" successfully, THEN run "wren context build" successfully (the build compiles the model YAML into target/mdl.json, which must contain at least one model). `) +
      `The project is already scaffolded and connected: do NOT run "wren context init" (wren_project.yml already exists), and do NOT attempt to delete any file or directory (deletion is blocked by the sandbox). ` +
      `If a placeholder model such as "example" already exists on disk from a prior scaffold, leave it in place rather than trying to delete it. ` +
      `Never hand-write a placeholder, seed, sample, or otherwise invented model, cube, or metadata file just to make "wren context build" succeed — every model, column, and measure in the MDL must come from something you actually introspected from the connected warehouse, never from imagination. If schema introspection yields no tables, or a connection variable still reports as unset despite running from the project directory, STOP: do not write any model/cube/metadata content, and end the turn with SETUP_STATUS: error (or SETUP_STATUS: needs_input if the user needs to act, e.g. fix a bad credential) explaining exactly why — never fabricate content just to satisfy the build. ` +
      `Cubes and measures are optional enrichment, not Setup completion requirements. Do not fetch enrich-context or create a cube/measure solely to complete this step. ` +
      `Only after that successful validate-then-build sequence and a nonempty target/mdl.json with at least one model, STOP: report the model count and SETUP_STATUS: ok in your final message. Do NOT run further query/enrichment/cleanup loops after a successful build. ` +
      `${bashDisciplineFor("generate-mdl", { skipSkillFetch: options?.resumeFromDisk === true || options?.resumeSession === true || recoveryOpening !== undefined })} ${terminalContract}`
    );
  }

  return (
    `The GenBI host has already accepted and persisted the user's credential form for the wren project "${projectName}" at "${projectDir}"; treat that credential handoff as a verified host fact, but no connection profile exists for it yet. ` +
    `Do not inspect .env in any form: do not cat, sed, cut, grep, head, tail, awk, list its keys, test its contents, or ask setup_execution to read it. Build only placeholder field references from "wren docs connection-info ${sourceType}" and let "wren profile add" perform connection validation from the project directory. ` +
    `The project is already scaffolded — do NOT run "wren context init" again. ` +
    `This project's data source is "${sourceType}" — the connection profile you create MUST declare "datasource: ${sourceType}" and use exactly the fields "wren docs connection-info ${sourceType}" reports for it. ` +
    `The onboarding skill's own connection-profile worked example is written for postgres and only applies as-is when "${sourceType}" IS postgres — for any other data source, do NOT follow that worked example verbatim; use it only as a template shape and substitute "${sourceType}"'s own fields throughout. ` +
    `Follow the onboarding skill's connection-profile step (the step right after the project is scaffolded and its .env is filled in) to create that profile FIRST: ` +
    `it tells you the scratch file to write — a placeholder for every field, never a value read out of .env — and the exact "wren profile add" command to run. ` +
    `This project step is rooted at "${projectDir}" by its turn-level binding or, where exposed, a per-action cwd. Write that scratch file at the project-relative path exactly "conn.profile.yml"; do not prepend the workspace path or project name to that path. ` +
    `Do NOT add "--activate" to that command: this profile belongs to "${projectDir}" alone, and "wren profile add" already pins a pinless project to the profile it just created regardless of --activate, which is everything this project's own commands need — omitting --activate just avoids also repointing the operator's unrelated global default profile at this one project. ` +
    `"wren profile add" has no project-path flag of its own, so run it from the already-bound project directory; where the backend supports it, set the exec action's cwd field to "${projectDir}". Never "cd ${projectDir} && ..." chaining. ` +
    `Only once that command succeeds should you consider the connection validated, and report whether it succeeded. ` +
    `Only if validation genuinely succeeds, create the sentinel at the project-relative path exactly ".wren-validated" (empty content, no shell redirection; set a per-action cwd to "${projectDir}" only where supported) ` +
    `as independent proof of a successful validation — do not create it if validation failed or you are unsure. ` +
    `${bashDisciplineFor("onboarding")} ${credentialBoundary} ${terminalContract}`
  );
}
