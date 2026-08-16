import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
