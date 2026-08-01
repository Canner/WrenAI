import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContextFileTree, computeKnowledgeStatus } from "../server/context-files.js";
import type { WrenContextShow } from "../server/context-source.js";

let projectDir: string;

const contextShow: WrenContextShow = {
  models: [{ name: "customers", primaryKey: "id", columns: [{ name: "id", type: "INTEGER" }] }],
  relationships: [{ name: "orders_customers", models: ["orders", "customers"], joinType: "MANY_TO_ONE", condition: "orders.customer_id = customers.id" }],
  cubes: [{ name: "order_metrics", baseObject: "orders", measures: [{ name: "total_revenue", expression: "SUM(orders.amount)" }] }],
};

function writeFile(relPath: string, content: string): void {
  const full = path.join(projectDir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "context-files-test-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("buildContextFileTree", () => {
  it("builds one group per entity kind with the real file text as content", () => {
    writeFile("models/customers/metadata.yml", "name: customers\ncolumns:\n  - name: id\n");
    writeFile("relationships.yml", "relationships:\n  - name: orders_customers\n");
    writeFile("cubes/order_metrics/metadata.yml", "name: order_metrics\nbaseObject: orders\n");
    writeFile("knowledge/rules/general.md", "# rules\nDo not sum across currencies.\n");
    writeFile("wren_project.yml", "schema_version: 5\nname: fixture\n");

    const tree = buildContextFileTree(projectDir, contextShow);
    const groupKeys = tree.map((g) => g.key);
    expect(groupKeys).toEqual(["models", "relationships", "cubes", "knowledge", "project"]);

    const modelsGroup = tree.find((g) => g.key === "models")!;
    expect(modelsGroup.children).toHaveLength(1);
    expect(modelsGroup.children![0]).toMatchObject({ kind: "model", path: path.join("models", "customers", "metadata.yml"), entityKey: "customers" });
    expect(modelsGroup.children![0]!.content).toContain("name: customers");

    const relGroup = tree.find((g) => g.key === "relationships")!;
    expect(relGroup.children).toHaveLength(1);
    expect(relGroup.children![0]).toMatchObject({ kind: "relationship", entityKey: "orders_customers" });
    expect(relGroup.children![0]!.content).toContain("orders_customers");

    const cubesGroup = tree.find((g) => g.key === "cubes")!;
    expect(cubesGroup.children![0]).toMatchObject({ kind: "cube", entityKey: "order_metrics" });

    const knowledgeGroup = tree.find((g) => g.key === "knowledge")!;
    expect(knowledgeGroup.children!.some((n) => n.entityKey === "general")).toBe(true);
    expect(knowledgeGroup.children!.find((n) => n.entityKey === "general")!.content).toContain("Do not sum across currencies");

    const projectGroup = tree.find((g) => g.key === "project")!;
    expect(projectGroup.children![0]!.content).toContain("schema_version: 5");
  });

  it("skips a group entirely when none of its files exist on disk (no empty sections)", () => {
    // No files written at all — the models group's one entity has no metadata.yml on disk.
    const tree = buildContextFileTree(projectDir, contextShow);
    expect(tree).toEqual([]);
  });

  it("only lists real placeholder-free knowledge rule files, ignoring caveats/glossary-style empty subdirs", () => {
    writeFile("knowledge/rules/general.md", "content");
    writeFile("knowledge/caveats/.gitkeep", "");
    const tree = buildContextFileTree(projectDir, contextShow);
    const knowledgeGroup = tree.find((g) => g.key === "knowledge")!;
    expect(knowledgeGroup.children!.map((n) => n.title)).toEqual(["general.md"]);
  });
});

describe("computeKnowledgeStatus", () => {
  it("instructionsPresent is true when at least one knowledge/rules/*.md file exists", () => {
    writeFile("knowledge/rules/general.md", "content");
    expect(computeKnowledgeStatus(projectDir)).toEqual({ instructionsPresent: true, verifiedPairCount: 0 });
  });

  it("instructionsPresent is false when knowledge/rules has no .md files (or doesn't exist)", () => {
    expect(computeKnowledgeStatus(projectDir)).toEqual({ instructionsPresent: false, verifiedPairCount: 0 });
    writeFile("knowledge/rules/.gitkeep", "");
    expect(computeKnowledgeStatus(projectDir)).toEqual({ instructionsPresent: false, verifiedPairCount: 0 });
  });
});
