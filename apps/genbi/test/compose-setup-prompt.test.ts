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

  it("connect: tells the agent the wren CLI is already installed with nothing to install, and to skip Preflight/pip install — without claiming a virtualenv is active", () => {
    const prompt = composeSetupPrompt("connect", form);
    expect(prompt).toMatch(/wren CLI is already installed and on PATH/i);
    expect(prompt).toMatch(/nothing to install/i);
    expect(prompt).toMatch(/skip the skill's Preflight section/i);
    expect(prompt).toMatch(/skip Step 2's "pip install" sub-step/i);
    expect(prompt).toMatch(/do not run pip install/i);
    expect(prompt).not.toMatch(/virtualenv/i);
    expect(prompt).not.toMatch(/virtual environment/i);
  });

  it("connect_resume: references the scaffolded project path (workspaceRoot/projectName), not the bare workspaceRoot", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toContain("/workspace/root/acme");
    expect(prompt).toMatch(/user has filled in the \.env file/i);
    expect(prompt).toMatch(/validated/i);
  });

  it("connect_resume: states no connection profile exists yet and instructs creating it FIRST, before validating", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toMatch(/no connection profile exists (for it )?yet/i);
    expect(prompt).toMatch(/create that profile FIRST/i);
    expect(prompt).toMatch(/wren profile add/i);
    // Must not imply the profile already exists / only needs validating.
    expect(prompt).not.toMatch(/^Validate the connection/i);
  });

  it("connect_resume: forbids re-running 'wren context init' and instructs the cwd field for 'wren profile add' (which has no path flag)", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toMatch(/do NOT run "wren context init" again/i);
    expect(prompt).toMatch(/no project-path flag of its own/i);
    expect(prompt).toContain('cwd field set to "/workspace/root/acme"');
    // The anti-pattern ("cd <dir> && ...") is only ever mentioned as what NOT to do.
    expect(prompt).toMatch(/never "cd .* && \.\.\." chaining/i);
  });

  it("connect_resume: gives write and exec the same project cwd with a short conn.profile.yml path", () => {
    const prompt = composeSetupPrompt("connect_resume", form);
    expect(prompt).toContain('write action with cwd set to "/workspace/root/acme" and path set exactly to "conn.profile.yml"');
    expect(prompt).toContain('exec action\'s cwd field set to "/workspace/root/acme"');
    expect(prompt).toMatch(/do not prepend the workspace path or project name to that write path/i);
    expect(prompt).toContain('path set exactly to ".wren-validated"');
  });

  it("connect_resume: interpolates the selected sourceType (not hardcoded postgres) and tells the agent the profile MUST use it", () => {
    const duckdbForm: SetupFormValues = { projectName: "acme", sourceType: "duckdb", workspaceRoot: "/workspace/root" };
    const prompt = composeSetupPrompt("connect_resume", duckdbForm);
    // The bug this regresses: the old prompt never mentioned sourceType at all, so an agent
    // dispatched fresh (no session memory) fell back to the onboarding skill's postgres worked
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

  it("context: instructs generate-mdl (+ optional enrich-context), validate+build, and reporting the model count", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toContain("/workspace/root/acme");
    expect(prompt).toMatch(/generate-mdl skill/i);
    expect(prompt).toMatch(/enrich-context skill/i);
    expect(prompt).toContain('"wren context validate"');
    expect(prompt).toContain('"wren context build"');
    // build must run before validate, and the agent reports model + measure counts
    expect(prompt).toMatch(/"wren context build" BEFORE "wren context validate"/i);
    expect(prompt).toMatch(/at least ONE measure/i);
    expect(prompt).toMatch(/report the model and measure counts/i);
  });

  it("context: fetches the generate-mdl skill (not onboarding) and carries the same no-redirection/cwd-field rule as connect", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toContain("wren skills get generate-mdl");
    expect(prompt).not.toContain("wren skills get onboarding");
    expect(prompt).toMatch(/no shell redirection/i);
    expect(prompt).toMatch(/optional cwd field/i);
    // The old wording falsely claimed pipes/chaining were sandbox-blocked; must not recur.
    expect(prompt).not.toMatch(/no pipes/i);
  });

  it("context: does NOT restate the credential boundary (no credentials are involved once .env is already filled in)", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).not.toMatch(/never ask for or print credential values/i);
  });

  it("context: mandates the exec action's cwd field (set to projectDir) for every wren command, and explains why (.env discovery ignores --path)", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toMatch(/cwd field set to "\/workspace\/root\/acme"/i);
    expect(prompt).toMatch(/never the workspace root/i);
    expect(prompt).toMatch(/\.env auto-discovery only checks the process's current working directory/i);
    expect(prompt).toMatch(/completely ignores --path/i);
    expect(prompt).toMatch(/DUCKDB_URL/i);
    expect(prompt).toMatch(/that is NOT a real connection failure/i);
  });

  it("context: forbids fabricating placeholder/seed MDL to satisfy the build, and requires ending the turn with error/needs_input instead", () => {
    const prompt = composeSetupPrompt("context", form);
    expect(prompt).toMatch(/never hand-write a placeholder, seed, sample, or otherwise invented model, cube, or metadata file/i);
    expect(prompt).toMatch(/must come from something you actually introspected from the connected warehouse, never from imagination/i);
    expect(prompt).toMatch(/never fabricate content just to satisfy the build/i);
    expect(prompt).toContain("SETUP_STATUS: error");
    expect(prompt).toContain("SETUP_STATUS: needs_input");
  });

  it("context: the cwd mandate and no-fabrication instruction are present regardless of which opening branch composed the prompt (resumeFromDisk / resumeSession)", () => {
    const disk = composeSetupPrompt("context", form, { resumeFromDisk: true });
    const session = composeSetupPrompt("context", form, { resumeSession: true });
    for (const prompt of [disk, session]) {
      expect(prompt).toMatch(/cwd field set to "\/workspace\/root\/acme"/i);
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
      expect(prompt).toMatch(/never ask for or print credential values/i);
      expect(prompt).toMatch(/you must never read its values back/i);
      // The prompt must never mention a credential VALUE, only that none should be printed.
      expect(prompt).not.toMatch(/password\s*[:=]/i);
      expect(prompt).not.toMatch(/api[_-]?key\s*[:=]/i);
      expect(prompt).not.toContain(form.projectName + form.projectName); // sanity: no accidental secret templating
    }
  });

  it("the composed prompt never contains a newline (Mode B's chat is a line-per-turn stdin protocol)", () => {
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
    // The underlying sandbox rule (no redirection, cwd field) must still be present.
    expect(prompt).toMatch(/no shell redirection/i);
    expect(prompt).toMatch(/optional cwd field/i);
  });

  it("resumeFromDisk: points the agent at finishing (build/validate), not at starting from discovery", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).toMatch(/skip re-orientation entirely/i);
    expect(prompt).toMatch(/go straight to finishing/i);
    expect(prompt).not.toMatch(/follow the wren generate-mdl skill \(and, optionally/i);
    // Shared downstream instructions (build before validate, define a measure, stop) still apply.
    expect(prompt).toContain('"wren context build" BEFORE "wren context validate"');
    expect(prompt).toMatch(/at least ONE measure/i);
  });

  it("resumeFromDisk: still never contains a newline (single-line stdin protocol)", () => {
    mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
    mkdirSync(path.join(projectDir, "cubes", "order_metrics"), { recursive: true });
    writeFileSync(path.join(projectDir, "relationships.yml"), "relationships:\n  - name: a\n");
    const prompt = composeSetupPrompt("context", resumeForm, { resumeFromDisk: true });
    expect(prompt).not.toContain("\n");
  });
});
