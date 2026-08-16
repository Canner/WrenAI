/**
 * The Harness connection panel showed `${BIGQUERY_PROJECT_ID}/${BIGQUERY_DATASET_ID}`
 * as a project's location.
 *
 * wren keeps credentials out of `~/.wren/profiles.yml` by storing `${VAR}`
 * references there and expanding them at run time against the project's `.env`.
 * `conn.yml` already got that treatment here; the stored-profile path did not,
 * so the panel rendered the reference rather than the value.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeConnection, resolveConnectionSource } from "../server/conn-config.js";

let workspace: string;
let projectDir: string;
let wrenHome: string;
let originalWrenHome: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "wren-harness-conn-config-test-"));
  projectDir = path.join(workspace, "acme");
  mkdirSync(projectDir, { recursive: true });
  // Isolate from the developer's real ~/.wren/profiles.yml.
  wrenHome = path.join(workspace, "wren-home");
  mkdirSync(wrenHome, { recursive: true });
  originalWrenHome = process.env.WREN_HOME;
  process.env.WREN_HOME = wrenHome;
});

afterEach(() => {
  if (originalWrenHome === undefined) delete process.env.WREN_HOME;
  else process.env.WREN_HOME = originalWrenHome;
  rmSync(workspace, { recursive: true, force: true });
});

function pinnedProfile(body: string): void {
  writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: bigquery\n");
  writeFileSync(path.join(wrenHome, "profiles.yml"), `profiles:\n  acme_profile:\n${body}`);
}

describe("resolveConnectionSource — stored profile values", () => {
  it("expands a profile's ${VAR} references against the project's .env", () => {
    pinnedProfile("    datasource: bigquery\n    project_id: ${BIGQUERY_PROJECT_ID}\n    dataset_id: ${BIGQUERY_DATASET_ID}\n");
    writeFileSync(path.join(projectDir, ".env"), "BIGQUERY_PROJECT_ID=acme-analytics\nBIGQUERY_DATASET_ID=warehouse\n");

    const source = resolveConnectionSource(projectDir);
    expect(source.fields).toMatchObject({ project_id: "acme-analytics", dataset_id: "warehouse" });
    expect(describeConnection(source.datasource, source.fields).location).toBe("acme-analytics/warehouse");
  });

  it("drops a reference it cannot resolve instead of displaying it raw", () => {
    // Showing `${BIGQUERY_DATASET_ID}` tells the reader nothing about where the
    // project connects, and it was long enough to break the panel's layout.
    pinnedProfile("    datasource: bigquery\n    project_id: ${BIGQUERY_PROJECT_ID}\n    dataset_id: ${BIGQUERY_DATASET_ID}\n");
    writeFileSync(path.join(projectDir, ".env"), "BIGQUERY_PROJECT_ID=acme-analytics\n");

    const source = resolveConnectionSource(projectDir);
    expect(source.fields.dataset_id).toBeUndefined();
    expect(describeConnection(source.datasource, source.fields).location).toBe("acme-analytics");
  });

  it("still reports the type when nothing resolves, rather than inventing a location", () => {
    pinnedProfile("    datasource: bigquery\n    project_id: ${BIGQUERY_PROJECT_ID}\n");
    const source = resolveConnectionSource(projectDir);
    expect(source.datasource).toBe("bigquery");
    expect(describeConnection(source.datasource, source.fields)).toEqual({ type: "bigquery", location: "—" });
  });

  it("passes a literal profile value through untouched", () => {
    pinnedProfile("    datasource: bigquery\n    project_id: acme-analytics\n    dataset_id: warehouse\n");
    expect(describeConnection("bigquery", resolveConnectionSource(projectDir).fields).location).toBe("acme-analytics/warehouse");
  });

  it("never surfaces a credential field, resolved or not", () => {
    pinnedProfile("    datasource: bigquery\n    project_id: ${BIGQUERY_PROJECT_ID}\n    credentials: ${BIGQUERY_CREDENTIALS}\n");
    writeFileSync(path.join(projectDir, ".env"), "BIGQUERY_PROJECT_ID=acme-analytics\nBIGQUERY_CREDENTIALS=super-secret\n");

    const { location } = describeConnection("bigquery", resolveConnectionSource(projectDir).fields);
    // The display allowlist is what keeps this out — expansion must not become
    // a way for a credential to reach the panel.
    expect(location).toBe("acme-analytics");
    expect(location).not.toContain("super-secret");
  });
});
