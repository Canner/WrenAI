import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Opt-in end-to-end coverage (skipped by default, no flag needed), following
 * the same `describe.skipIf` convention as `e2e-wren-native.test.ts`: this
 * shells out to the real, already-installed `wren` binary — it never imports
 * or modifies anything under `core/wren` — to prove, for real, the exact root
 * cause behind the setup wizard's connect-step bug rather than merely asserting it against a mock.
 *
 * Root cause under test: `wren profile add` pins a brand-new profile into a
 * pinless project's `wren_project.yml` only when the project's declared
 * `data_source` is the flat string shape (`data_source: <name>`) the pin
 * contract expects. A `wren_project.yml` that instead declares `data_source`
 * as a nested YAML mapping (`data_source:\n  type: duckdb`) — exactly the
 * shape the setup wizard's `connect` prompt could produce before this fix, if
 * an agent hand-wrote the file itself instead of letting `wren context init`
 * create it — reads as an incompatible declaration, so the pin is silently
 * skipped: the project ends up with a real connection profile but no
 * `profile:` pin, which is the "connected-but-unpinned" bug this ticket
 * fixes upstream of (in the prompt, not in the pin logic itself — the pin
 * logic's refuse-to-pin behavior here is correct by design and out of scope
 * for this ticket).
 *
 * This test is independent of the compose.ts prompt-wording fix and does not
 * flip with it — the wren CLI's pin behavior is unchanged by this ticket by
 * design (see the ticket's non-goals). Its purpose is to demonstrate, via a
 * real subprocess run, that the reported root cause is real and not just
 * asserted; the prompt-wording regression that *does* flip before/after the
 * fix lives in compose-setup-prompt.test.ts.
 */
function isWrenOnPath(): boolean {
  try {
    execFileSync("wren", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = isWrenOnPath();

describe.skipIf(!canRun)("wren profile add vs a nested data_source shape [opt-in e2e, real wren CLI]", () => {
  let projectDir: string | undefined;
  let wrenHome: string | undefined;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (wrenHome) rmSync(wrenHome, { recursive: true, force: true });
    projectDir = undefined;
    wrenHome = undefined;
  });

  it("does NOT pin the profile when wren_project.yml declares data_source as a nested mapping", () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "wren-harness-nested-ds-"));
    wrenHome = mkdtempSync(path.join(tmpdir(), "wren-harness-wren-home-"));
    const projectYmlPath = path.join(projectDir, "wren_project.yml");
    writeFileSync(projectYmlPath, "schema_version: 5\nname: my_project\ndata_source:\n  type: duckdb\n");
    const before = readFileSync(projectYmlPath, "utf-8");

    const output = execFileSync("wren", ["profile", "add", "duck_one", "--datasource", "duckdb"], {
      cwd: projectDir,
      env: { ...process.env, WREN_HOME: wrenHome },
      encoding: "utf-8",
    });

    // The pin never happens: no "Pinned profile" line in the CLI's own
    // output, and the project file comes out byte-identical — no
    // datasource rewrite either.
    expect(output).not.toMatch(/Pinned profile/i);
    expect(readFileSync(projectYmlPath, "utf-8")).toEqual(before);
  });

  it("DOES pin the profile once wren_project.yml uses the flat data_source shape (what 'wren context init' actually produces)", () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "wren-harness-flat-ds-"));
    wrenHome = mkdtempSync(path.join(tmpdir(), "wren-harness-wren-home-"));
    const projectYmlPath = path.join(projectDir, "wren_project.yml");
    writeFileSync(projectYmlPath, "schema_version: 5\nname: my_project\ndata_source: duckdb\n");

    const output = execFileSync("wren", ["profile", "add", "duck_one", "--datasource", "duckdb"], {
      cwd: projectDir,
      env: { ...process.env, WREN_HOME: wrenHome },
      encoding: "utf-8",
    });

    expect(output).toMatch(/Pinned profile 'duck_one'/i);
    expect(readFileSync(projectYmlPath, "utf-8")).toMatch(/profile:\s*duck_one/);
  });
});
