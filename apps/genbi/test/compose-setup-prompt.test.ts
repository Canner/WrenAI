import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeSetupPrompt } from "../server/compose.js";
import type { SetupFormValues } from "../server/compose.js";

const form: SetupFormValues = {
  projectName: "acme",
  sourceType: "postgres",
  workspaceRoot: "/workspace/root",
};

describe("composeSetupPrompt", () => {
  it("connect: interpolates projectName, sourceType, and workspaceRoot verbatim", () => {
    const prompt = composeSetupPrompt("connect", form);
    expect(prompt).toContain('"acme"');
    expect(prompt).toContain('"postgres"');
    expect(prompt).toContain('"/workspace/root"');
  });

  it("connect: instructs scaffolding a NEW project and an empty .env template", () => {
    const prompt = composeSetupPrompt("connect", form);
    expect(prompt).toMatch(/scaffold a new wren project/i);
    expect(prompt).toMatch(/empty \.env template/i);
    expect(prompt).toMatch(/wait for the user to fill in the \.env file/i);
  });

  it("connect: delegates wren_project.yml creation to 'wren context init' and forbids hand-writing it", () => {
    // Root cause this regresses: the prompt used to say "writing its
    // wren_project.yml" as a bare agent action, alongside (not clearly
    // subordinate to) the "wren context init" instruction — an agent could,
    // and once did, hand-write the file itself in a shape (a nested
    // `data_source:` mapping) that `wren`'s pin contract silently rejects.
    // The file must come from "wren context init" alone.
    const prompt = composeSetupPrompt("connect", form);
    expect(prompt).toMatch(/"wren context init" command — it creates the project directory and writes its wren_project\.yml for you/i);
    expect(prompt).toMatch(/never hand-write or edit wren_project\.yml yourself/i);
    // The old, buggy phrasing must not recur: a bare "writing its
    // wren_project.yml" as its own agent action (not qualified by "never").
    expect(prompt).not.toMatch(/creating the project directory, writing its wren_project\.yml/i);
  });

  it("connect: instructs an explicit --path (never a bare 'wren context init') so the project is scaffolded under projectDir, not the workspace root", () => {
    const prompt = composeSetupPrompt("connect", form);
    expect(prompt).toMatch(/wren context init/i);
    expect(prompt).toContain('--path "/workspace/root/acme" --empty');
    expect(prompt).toMatch(/never run "wren context init" bare/i);
    expect(prompt).toMatch(/exec action's cwd defaults to the workspace root/i);
  });

  it("connect: keeps the agent out of the Python environment without asserting anything about it", () => {
    const prompt = composeSetupPrompt("connect", form);
    expect(prompt).toMatch(/wren CLI is already installed and on PATH/i);
    expect(prompt).toMatch(/skip the skill's Preflight section/i);
    expect(prompt).toMatch(/skip Step 2's "pip install" sub-step/i);
    expect(prompt).toMatch(/do not run pip install/i);
    expect(prompt).not.toMatch(/virtualenv/i);
    expect(prompt).not.toMatch(/virtual environment/i);
    // This test used to require the prompt to say there was "nothing to
    // install". That was false for all but a couple of wren's connectors — the
    // driver behind each one is an optional extra, and the agent can disprove
    // the claim in a single import. The host now provisions the driver and
    // passes what it actually did; with no such note, the prompt says nothing
    // about availability at all rather than guessing.
    expect(prompt).not.toMatch(/nothing to install/i);
    expect(prompt).not.toMatch(/already available/i);
  });

  it("connect: repeats the host's driver-provisioning outcome verbatim, including a failure", () => {
    const installed = composeSetupPrompt("connect", form, { driverNote: 'The "postgres" driver (wren\'s "postgres" extra) was just installed into the wren environment.' });
    expect(installed).toMatch(/was just installed into the wren environment/);

    const failed = composeSetupPrompt("connect", form, {
      driverNote: 'The "oracle" driver (wren\'s "oracle" extra) could NOT be provisioned: uv is not on PATH.',
    });
    expect(failed).toMatch(/could NOT be provisioned: uv is not on PATH/);
    expect(failed).not.toMatch(/already available|nothing to install/i);
  });

  it("connect_resume: references the scaffolded project path (workspaceRoot/projectName), not the bare workspaceRoot", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toContain("/workspace/root/acme");
    expect(prompt).toMatch(/host has already accepted and persisted the user's credential form/i);
    expect(prompt).toMatch(/validated/i);
  });

  it("connect_resume: treats credential submission as host-owned evidence and forbids every form of .env inspection", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toMatch(/verified host fact/i);
    expect(prompt).toMatch(/do not inspect \.env in any form/i);
    for (const command of ["cat", "sed", "cut", "grep", "head", "tail", "awk"]) {
      expect(prompt).toContain(command);
    }
    expect(prompt).toMatch(/do not .*list its keys/i);
    expect(prompt).toMatch(/let "wren profile add" perform connection validation/i);
  });

  it("connect_resume: states no connection profile exists yet and instructs creating it FIRST, before validating", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toMatch(/no connection profile exists (for it )?yet/i);
    expect(prompt).toMatch(/create that profile FIRST/i);
    expect(prompt).toMatch(/wren profile add/i);
    // Must not imply the profile already exists / only needs validating.
    expect(prompt).not.toMatch(/^Validate the connection/i);
  });

  it("connect_resume: forbids re-running 'wren context init' and runs 'wren profile add' from the already-bound project directory", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toMatch(/do NOT run "wren context init" again/i);
    expect(prompt).toMatch(/no project-path flag of its own/i);
    expect(prompt).toMatch(/project step is rooted at "\/workspace\/root\/acme"/i);
    expect(prompt).toMatch(/where the backend supports it, set the exec action's cwd field/i);
    // The anti-pattern ("cd <dir> && ...") is only ever mentioned as what NOT to do.
    expect(prompt).toMatch(/never "cd .* && \.\.\." chaining/i);
  });

  it("connect_resume: keeps conn.profile.yml and .wren-validated project-relative without assuming every backend has a per-action cwd", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toMatch(/project-relative path exactly "conn\.profile\.yml"/i);
    expect(prompt).toMatch(/do not prepend the workspace path or project name/i);
    expect(prompt).toMatch(/project-relative path exactly "\.wren-validated"/i);
    expect(prompt).toMatch(/per-action cwd.*only where supported/i);
  });

  it("connect_resume: interpolates the selected sourceType (not hardcoded postgres) and tells the agent the profile MUST use it", () => {
    const duckdbForm: SetupFormValues = { projectName: "acme", sourceType: "duckdb", workspaceRoot: "/workspace/root" };
    const prompt = composeSetupPrompt("connect_resume", duckdbForm);
    // The bug this regresses: the old prompt never mentioned sourceType at all, so an agent
    // Dispatched fresh (no session memory) fell back to the onboarding skill's postgres worked
    // example regardless of the actually-selected data source. A non-postgres case (duckdb) is
    // the one that would have failed to disprove the old, sourceType-blind wording.
    expect(prompt).toContain('"duckdb"');
    expect(prompt).toMatch(/data source is "duckdb"/i);
    expect(prompt).toMatch(/MUST declare "datasource: duckdb"/i);
    // "postgres" is expected to appear ONLY as the thing to avoid (the skill's worked example),
    // never as the profile's own declared datasource.
    expect(prompt).not.toMatch(/datasource: postgres/i);
  });

  it("connect_resume: explicitly warns against following the onboarding skill's postgres worked example verbatim for a non-postgres source", () => {
    const duckdbForm: SetupFormValues = { projectName: "acme", sourceType: "duckdb", workspaceRoot: "/workspace/root" };
    const prompt = composeSetupPrompt("connect_resume", duckdbForm);
    expect(prompt).toMatch(/worked example is written for postgres/i);
    expect(prompt).toMatch(/for any other data source, do not follow that worked example verbatim/i);
  });

  it("context: instructs generate-mdl, validate+build, and reporting the model count without requiring enrichment", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toContain("/workspace/root/acme");
    expect(prompt).toMatch(/generate-mdl skill/i);
    expect(prompt).toMatch(/Cubes and measures are optional enrichment/i);
    expect(prompt).toMatch(/Do not fetch enrich-context/i);
    expect(prompt).toContain('"wren context validate"');
    expect(prompt).toContain('"wren context build"');
    // The native lifecycle is discovery, validate, then build.
    expect(prompt).toMatch(/"wren context validate" successfully, THEN run "wren context build" successfully/i);
    expect(prompt).toMatch(/report the model count/i);
    expect(prompt).not.toMatch(/at least ONE measure/i);
  });

  it("context: fetches the generate-mdl skill (not onboarding) and carries the same backend-neutral project-relative rule as connect", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toContain("wren skills get generate-mdl");
    expect(prompt).not.toContain("wren skills get onboarding");
    expect(prompt).toMatch(/no shell redirection/i);
    expect(prompt).toMatch(/turn-level binding or, where the backend exposes it, a per-action cwd field/i);
    // The old wording falsely claimed pipes/chaining were sandbox-blocked; must not recur.
    expect(prompt).not.toMatch(/no pipes/i);
  });

  it("context: does NOT restate the credential boundary (no credentials are involved once .env is already filled in)", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).not.toMatch(/never ask for or print credential values/i);
  });

  it("context: mandates the already-bound project directory for every wren command, and explains why (.env discovery ignores --path)", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toMatch(/project step is rooted at "\/workspace\/root\/acme"/i);
    expect(prompt).toMatch(/relative to that project directory/i);
    expect(prompt).toMatch(/\.env auto-discovery only checks the process's current working directory/i);
    expect(prompt).toMatch(/completely ignores --path/i);
    // Was `DUCKDB_URL`: a DuckDB variable used to illustrate the point for
    // every project, including ones that have no such variable.
    expect(prompt).toMatch(/this project's connection variables as unset/i);
    expect(prompt).toMatch(/that is NOT a real connection failure/i);
  });

  it("context: gives a safe project-bound zero-MDL discovery recipe and DuckDB directory semantics", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toMatch(/do NOT run "wren --sql" for schema discovery/i);
    expect(prompt).toContain("resolve_profile_for_project(Path.cwd(), strict=True)");
    expect(prompt).toContain("p.pop('datasource')");
    expect(prompt).not.toContain("\\'");
    expect(prompt).toContain('c.query(\\"SELECT');
    expect(prompt).toContain('ordinal_position\\").to_pylist()');
    expect(prompt).toContain("expand_profile_secrets");
    expect(prompt).toContain("from wren.connector import get_connector");
    expect(prompt).toContain(`WREN_PYTHON="$(sed -n '1s/^#!//p' "$(command -v wren)")"`);
    expect(prompt).toContain('"$WREN_PYTHON" -c');
    expect(prompt).not.toMatch(/(?:^|[; ])python -c/i);
    expect(prompt).toContain("information_schema.columns");
    expect(prompt).toMatch(/without reading or printing \.env or the expanded profile/i);
    expect(prompt).not.toContain("\n");
  });

  it("context: sends the DuckDB directory semantics only to a file-backed source", () => {
    // This paragraph used to go to every project. Setup now offers wren's whole
    // connector set, so an agent connecting to Postgres was being told about
    // DUCKDB_URL — advice that cannot apply and names a variable its project
    // does not have.
    const duckdb = composeSetupPrompt("context", { ...form, sourceType: "duckdb" });
    expect(duckdb).toMatch(/DUCKDB_URL is a DIRECTORY containing one or more \.duckdb files/i);
    expect(duckdb).toMatch(/never pass that directory to duckdb\.connect/i);

    const postgres = composeSetupPrompt("context", { ...form, sourceType: "postgres" });
    expect(postgres).not.toMatch(/DUCKDB_URL/i);
    expect(postgres).not.toMatch(/duckdb\.connect/i);
  });

  it("context: presents the metadata query as a shape to adapt, not as the one true SQL", () => {
    // `information_schema` is not universal — BigQuery exposes it only as
    // `<dataset>.INFORMATION_SCHEMA.COLUMNS` and Oracle has none — so the recipe
    // must not order the agent to run "exactly this" against all 21 connectors.
    const prompt = composeSetupPrompt("context", { ...form, sourceType: "bigquery" });
    expect(prompt).not.toMatch(/run exactly this safe metadata query/i);
    expect(prompt).toMatch(/substitute that source's own metadata catalog/i);
  });

  it("context: forbids fabricating placeholder/seed MDL to satisfy the build, and requires ending the turn with error/needs_input instead", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toMatch(/never hand-write a placeholder, seed, sample, or otherwise invented model, cube, or metadata file/i);
    expect(prompt).toMatch(/must come from something you actually introspected from the connected warehouse, never from imagination/i);
    expect(prompt).toMatch(/never fabricate content just to satisfy the build/i);
    expect(prompt).toContain("SETUP_STATUS: error");
    expect(prompt).toContain("SETUP_STATUS: needs_input");
  });

  it("context: the project-directory mandate and no-fabrication instruction are present regardless of which opening branch composed the prompt (resumeFromDisk / resumeSession)", () => {
    const disk = composeSetupPrompt("context", form, { resumeFromDisk: true });
    const session = composeSetupPrompt("context", form, { resumeSession: true });
    for (const prompt of [disk, session]) {
      expect(prompt).toMatch(/project step is rooted at "\/workspace\/root\/acme"/i);
      expect(prompt).toMatch(/never hand-write a placeholder, seed, sample, or otherwise invented model, cube, or metadata file/i);
    }
  });

  it("context: schema-discovery recovery overrides the disk-resume skip-discovery wording and remains a one-line prompt", () => {
    const prompt = composeSetupPrompt("context", form, { schemaDiscoveryRecovery: true, resumeFromDisk: true });

    expect(prompt).toMatch(/prior attempt.*did not complete recognized schema discovery/i);
    expect(prompt).toMatch(/corrective requirement/i);
    expect(prompt).toMatch(/before writing any model\/cube\/measure/i);
    expect(prompt).toMatch(/before.*context build.*or.*context validate.*finalization/i);
    expect(prompt).not.toMatch(/do not start over from schema discovery/i);
    expect(prompt).not.toContain("\n");
  });

  it("context: matching retained lifecycle evidence asks only for the remaining ordered suffix", () => {
    const afterDiscovery = composeSetupPrompt("context", form, { contextLifecycleRecovery: "discovery" });
    expect(afterDiscovery).toMatch(/do NOT repeat discovery/i);
    expect(afterDiscovery).toMatch(/run "wren context validate" successfully, THEN run "wren context build" successfully/i);
    expect(afterDiscovery).not.toContain("resolve_profile_for_project");

    const afterValidate = composeSetupPrompt("context", form, { contextLifecycleRecovery: "validate" });
    expect(afterValidate).toMatch(/do NOT repeat either/i);
    expect(afterValidate).toMatch(/remaining operation.*"wren context build"/i);
    expect(afterValidate).not.toContain("wren skills get generate-mdl");
    expect(afterValidate).not.toContain("\n");
  });

  it("all three step keys append the SETUP_STATUS terminal-contract instruction", () => {
    for (const stepKey of ["connect", "connect_resume", "context"] as const) {
      const prompt = composeSetupPrompt(stepKey, form);
      expect(prompt).toContain("SETUP_STATUS: ok");
      expect(prompt).toContain("SETUP_STATUS: needs_input");
      expect(prompt).toContain("SETUP_STATUS: error");
    }
  });

  it("connect and connect_resume append the credential boundary and never carry a secret placeholder", () => {
    for (const stepKey of ["connect", "connect_resume"] as const) {
      const prompt = composeSetupPrompt(stepKey, form);
      expect(prompt).toMatch(/never ask for, print, or read credential values/i);
      // The prompt must never mention a credential VALUE, only that none should be printed.
      expect(prompt).not.toMatch(/password\s*[:=]/i);
      expect(prompt).not.toMatch(/api[_-]?key\s*[:=]/i);
      expect(prompt).not.toContain(form.projectName + form.projectName); // sanity: no accidental secret templating
    }
    expect(composeSetupPrompt("connect", form)).toMatch(/write only an empty \.env template/i);
    expect(composeSetupPrompt("connect_resume", form)).not.toMatch(/write only an empty \.env template/i);
  });

  it("the composed prompt never contains a newline (dispatched's chat is a line-per-turn stdin protocol)", () => {
    expect(composeSetupPrompt("connect", form)).not.toContain("\n");
    expect(composeSetupPrompt("connect_resume", form)).not.toContain("\n");
    expect(composeSetupPrompt("context", form)).not.toContain("\n");
  });

  it("different form values produce different prompts (no hardcoded stub values)", () => {
    const other: SetupFormValues = { projectName: "other-co", sourceType: "bigquery", workspaceRoot: "/tmp/ws" };
    const promptA = composeSetupPrompt("connect", form);
    const promptB = composeSetupPrompt("connect", other);
    expect(promptA).not.toEqual(promptB);
    expect(promptB).toContain('"other-co"');
    expect(promptB).toContain('"bigquery"');
    expect(promptB).toContain('"/tmp/ws"');
  });
});

// `resumeFromDisk` reads the real project dir at compose time, so these tests use a
// real temp directory (not the bare string paths above) laid out exactly like a partially-built
// wren project — model subdirectories, a `cubes/` entry of each on-disk shape, and a
// `relationships.yml` with a commented-out example block plus one real entry.
describe("composeSetupPrompt: context step's resumeFromDisk inventory", () => {
  let workspaceRoot: string;
  let projectName: string;
  let projectDir: string;
  let resumeForm: SetupFormValues;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "resume-prompt-test-"));
    workspaceRoot = path.dirname(projectDir);
    projectName = path.basename(projectDir);
    resumeForm = { projectName, sourceType: "postgres", workspaceRoot };
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("without resumeFromDisk, the normal context prompt still tells the agent to discover from scratch and fetch the skill", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    const prompt = composeSetupPrompt("context", resumeForm);
    expect(prompt).toMatch(/follow the wren generate-mdl skill/i);
    expect(prompt).toContain("wren skills get generate-mdl");
    expect(prompt).not.toMatch(/already done/i);
    expect(prompt).not.toMatch(/ran out of turns/i);
  });

  it("resumeFromDisk: reports 0 models plainly when no model directory exists yet", () => {
    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).toMatch(/ran out of turns partway through/i);
    expect(prompt).toMatch(/no model directories exist yet/i);
  });

  it("resumeFromDisk: enumerates already-written model directories by name", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    mkdirSync(path.join(projectDir, "models", "customers"), { recursive: true });
    // A stray file directly under models/ must not be miscounted as a model.
    writeFileSync(path.join(projectDir, "models", "README.md"), "not a model");

    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).toMatch(/2 model\(s\) already written/i);
    expect(prompt).toContain("customers");
    expect(prompt).toContain("orders");
    expect(prompt).not.toContain("README.md");
  });

  it("resumeFromDisk: enumerates cube names from both a directory shape and a flat .yml file shape", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    mkdirSync(path.join(projectDir, "cubes", "order_metrics"), { recursive: true });
    writeFileSync(path.join(projectDir, "cubes", "payment_metrics.yml"), "name: payment_metrics\n");

    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).toMatch(/2 cube\(s\) already defined/i);
    expect(prompt).toContain("order_metrics");
    expect(prompt).toContain("payment_metrics");
    expect(prompt).not.toContain("payment_metrics.yml");
  });

  it("resumeFromDisk: counts real relationships.yml entries but ignores a commented-out example block", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    writeFileSync(
      path.join(projectDir, "relationships.yml"),
      "relationships:\n" +
        "  - name: orders_customers\n" +
        "    models: [orders, customers]\n" +
        "# Example:\n" +
        "# relationships:\n" +
        "#   - name: commented_out_example\n",
    );

    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).toMatch(/1 relationship\(s\) already declared/i);
    expect(prompt).not.toContain("commented_out_example");
  });

  it("resumeFromDisk: omits the cube/relationship sentences entirely when neither exists", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).not.toMatch(/cube\(s\) already defined/i);
    expect(prompt).not.toMatch(/relationship\(s\) already declared/i);
  });

  it("resumeFromDisk: tells the agent the skills were already fetched and must NOT re-run 'wren skills get'", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).toMatch(/already fetched the generate-mdl skill/i);
    expect(prompt).not.toContain("wren skills get generate-mdl");
    // The underlying sandbox rule (no redirection, project-relative execution) must still be present.
    expect(prompt).toMatch(/no shell redirection/i);
    expect(prompt).toMatch(/turn-level binding or, where the backend exposes it, a per-action cwd field/i);
  });

  it("resumeFromDisk: points the agent at finishing (build/validate), not at starting from discovery", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).toMatch(/skip re-orientation entirely/i);
    expect(prompt).toMatch(/go straight to finishing/i);
    expect(prompt).not.toMatch(/follow the wren generate-mdl skill \(and, optionally/i);
    // Shared downstream instructions (validate before build, model-only completion, stop) still apply.
    expect(prompt).toMatch(/"wren context validate" successfully, THEN run "wren context build" successfully/i);
    expect(prompt).toMatch(/Cubes and measures are optional enrichment/i);
    expect(prompt).not.toMatch(/at least ONE measure/i);
  });

  it("resumeFromDisk: still never contains a newline (single-line stdin protocol)", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    mkdirSync(path.join(projectDir, "cubes", "order_metrics"), { recursive: true });
    writeFileSync(path.join(projectDir, "relationships.yml"), "relationships:\n  - name: a\n");
    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).not.toContain("\n");
  });
});
