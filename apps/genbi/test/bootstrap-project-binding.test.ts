import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recoverBootstrapProjectBinding } from "../server/bootstrap-project-binding.js";
import { Store } from "../server/db.js";
import { resolveProjectIdentity } from "../server/enrichment.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { root: string; project: string; store: Store } {
  const root = mkdtempSync(path.join(tmpdir(), "genbi-bootstrap-binding-"));
  dirs.push(root);
  const project = path.join(root, "demo");
  mkdirSync(project);
  writeFileSync(path.join(project, "wren_project.yml"), "data_source: duckdb\nprofile: demo\n");
  writeFileSync(path.join(project, ".wren-validated"), "");
  const store = new Store(path.join(root, "bff.sqlite"));
  store.setSetupConnectForm({ projectName: "demo", sourceType: "duckdb" });
  store.activateEnrichmentBinding(resolveProjectIdentity(project));
  return { root, project, store };
}

describe("bootstrap project binding recovery", () => {
  it("restores the exact identity-fenced connected project without advancing its generation", () => {
    const { root, project, store } = fixture();
    const before = store.getEnrichmentBinding();

    expect(recoverBootstrapProjectBinding(store, root)).toBe(realpathSync(project));
    expect(store.getEnrichmentBinding()).toEqual(before);
    store.close();
  });

  it("fails closed without the host-verified connection marker", () => {
    const { root, project, store } = fixture();
    rmSync(path.join(project, ".wren-validated"));

    expect(recoverBootstrapProjectBinding(store, root)).toBeUndefined();
    store.close();
  });

  it("fails closed when the project path is replaced after the persisted bind", () => {
    const { root, project, store } = fixture();
    renameSync(project, path.join(root, "old-demo"));
    mkdirSync(project);
    writeFileSync(path.join(project, "wren_project.yml"), "data_source: duckdb\nprofile: demo\n");
    writeFileSync(path.join(project, ".wren-validated"), "");

    expect(recoverBootstrapProjectBinding(store, root)).toBeUndefined();
    store.close();
  });

  it("fails closed when the persisted binding is for a different project", () => {
    const { root, store } = fixture();
    const other = path.join(root, "other");
    mkdirSync(other);
    store.activateEnrichmentBinding(resolveProjectIdentity(other));

    expect(recoverBootstrapProjectBinding(store, root)).toBeUndefined();
    store.close();
  });
});

/**
 * Adopt takes a project the user already has, so it is normally OUTSIDE the
 * workspace root — `outside` here is the point of the fixture, not incidental.
 * It also writes neither a connect form nor `.wren-validated`: both belong to
 * the create flow, and requiring either would make every adopted project
 * unrecoverable across a restart.
 */
function adoptFixture(): { root: string; outside: string; store: Store } {
  const root = mkdtempSync(path.join(tmpdir(), "genbi-adopt-binding-root-"));
  const elsewhere = mkdtempSync(path.join(tmpdir(), "genbi-adopt-binding-project-"));
  dirs.push(root, elsewhere);
  const outside = path.join(elsewhere, "existing-project");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "wren_project.yml"), "data_source: duckdb\nprofile: existing\n");
  const store = new Store(path.join(root, "bff.sqlite"));
  store.setSetupMode("adopt");
  store.activateEnrichmentBinding(resolveProjectIdentity(outside));
  return { root, outside, store };
}

describe("adopted project binding recovery", () => {
  it("restores a project adopted from outside the workspace root", () => {
    const { root, outside, store } = adoptFixture();
    const before = store.getEnrichmentBinding();

    expect(recoverBootstrapProjectBinding(store, root)).toBe(realpathSync(outside));
    expect(store.getEnrichmentBinding()).toEqual(before);
    store.close();
  });

  it("restores without the create flow's connection marker, which adopt never writes", () => {
    const { root, outside, store } = adoptFixture();

    expect(existsSync(path.join(outside, ".wren-validated"))).toBe(false);
    expect(recoverBootstrapProjectBinding(store, root)).toBe(realpathSync(outside));
    store.close();
  });

  it("fails closed when a different directory has taken the adopted path", () => {
    // Mutation proof for the identity fence: the recorded path still exists and
    // still looks like a wren project, so only the device+inode comparison can
    // reject it. Drop that comparison and this case starts recovering a
    // directory the user never adopted.
    const { root, outside, store } = adoptFixture();
    renameSync(outside, `${outside}-moved`);
    mkdirSync(outside);
    writeFileSync(path.join(outside, "wren_project.yml"), "data_source: duckdb\nprofile: impostor\n");

    expect(existsSync(path.join(outside, "wren_project.yml"))).toBe(true);
    expect(recoverBootstrapProjectBinding(store, root)).toBeUndefined();
    store.close();
  });

  it("fails closed when the adopted project no longer holds a wren project file", () => {
    const { root, outside, store } = adoptFixture();
    rmSync(path.join(outside, "wren_project.yml"));

    expect(recoverBootstrapProjectBinding(store, root)).toBeUndefined();
    store.close();
  });

  it("fails closed with no persisted binding at all, the only proof adopt verification ran", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-adopt-binding-empty-"));
    dirs.push(root);
    const store = new Store(path.join(root, "bff.sqlite"));
    store.setSetupMode("adopt");

    expect(recoverBootstrapProjectBinding(store, root)).toBeUndefined();
    store.close();
  });
});
