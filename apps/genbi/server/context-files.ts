/**
 * Builds the Context page's file tree by reading the
 * REAL bound project directory (model/cube/knowledge files, relationships.yml,
 * wren_project.yml) rather than a seeded fixture. Each leaf's `content` is the
 * actual file text on disk, so `FileViewer.tsx` renders real project source.
 *
 * Model/relationship/cube NAMES come from an already-loaded
 * `WrenContextShow` (see `server/context-source.ts`) rather than re-parsing
 * YAML here — `wren context show` is the authoritative parse of that data;
 * this module only needs it to know which per-entity files exist and how to
 * label them, then reads each file's raw bytes straight from disk.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { WrenContextShow } from "./context-source.js";
import type { ContextFileNode, KnowledgeStatus } from "./wire-types.js";

function readFileSafe(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function buildModelNodes(projectDir: string, contextShow: WrenContextShow): ContextFileNode[] {
  return contextShow.models.flatMap((model) => {
    const relPath = path.join("models", model.name, "metadata.yml");
    const content = readFileSafe(path.join(projectDir, relPath));
    if (content === undefined) return [];
    return [{ key: `file-model-${model.name}`, title: `${model.name}/metadata.yml`, kind: "model", path: relPath, entityKey: model.name, content }];
  });
}

/** `relationships.yml` is a single file holding every relationship — one leaf per relationship, all sharing that same real file text, distinguished by `entityKey`. */
function buildRelationshipNodes(projectDir: string, contextShow: WrenContextShow): ContextFileNode[] {
  const relPath = "relationships.yml";
  const content = readFileSafe(path.join(projectDir, relPath));
  if (content === undefined) return [];
  return contextShow.relationships.map((rel) => ({
    key: `file-relationship-${rel.name}`,
    title: rel.name,
    kind: "relationship",
    path: relPath,
    entityKey: rel.name,
    content,
  }));
}

function buildCubeNodes(projectDir: string, contextShow: WrenContextShow): ContextFileNode[] {
  return contextShow.cubes.flatMap((cube) => {
    const relPath = path.join("cubes", cube.name, "metadata.yml");
    const content = readFileSafe(path.join(projectDir, relPath));
    if (content === undefined) return [];
    return [{ key: `file-cube-${cube.name}`, title: `${cube.name}/metadata.yml`, kind: "cube", path: relPath, entityKey: cube.name, content }];
  });
}

/** `knowledge/rules/*.md` are the only knowledge files with real authored content today (`caveats/`, `glossary/`, `metrics/`, `sql/` are placeholders) — plus `knowledge/knowledge.yml` when present. */
function buildKnowledgeNodes(projectDir: string): ContextFileNode[] {
  const rulesDir = path.join(projectDir, "knowledge", "rules");
  const nodes: ContextFileNode[] = [];
  if (existsSync(rulesDir)) {
    const entries = readdirSync(rulesDir)
      .filter((name) => name.endsWith(".md"))
      .sort();
    for (const name of entries) {
      const content = readFileSafe(path.join(rulesDir, name));
      if (content === undefined) continue;
      const relPath = path.join("knowledge", "rules", name);
      const entityKey = name.replace(/\.md$/, "");
      nodes.push({ key: `file-knowledge-rule-${entityKey}`, title: name, kind: "knowledge", path: relPath, entityKey, content });
    }
  }
  const knowledgeYamlPath = path.join(projectDir, "knowledge", "knowledge.yml");
  const knowledgeYamlContent = readFileSafe(knowledgeYamlPath);
  if (knowledgeYamlContent !== undefined) {
    nodes.push({ key: "file-knowledge-config", title: "knowledge.yml", kind: "knowledge", path: path.join("knowledge", "knowledge.yml"), entityKey: "knowledge-config", content: knowledgeYamlContent });
  }
  return nodes;
}

function buildProjectNode(projectDir: string): ContextFileNode[] {
  const content = readFileSafe(path.join(projectDir, "wren_project.yml"));
  if (content === undefined) return [];
  return [{ key: "file-wren-project", title: "wren_project.yml", path: "wren_project.yml", content }];
}

/**
 * `instructionsPresent` from the real presence of at least one authored
 * `knowledge/rules/*.md` file (as opposed to the placeholder-only
 * subdirectories, e.g. `caveats/`/`glossary/`). `verifiedPairCount` is always
 * 0 — there is no live Q-SQL verified-pair source over a real project yet
 * (see `server/impact.ts`'s doc comment).
 */
export function computeKnowledgeStatus(projectDir: string): KnowledgeStatus {
  const rulesDir = path.join(projectDir, "knowledge", "rules");
  const instructionsPresent = existsSync(rulesDir) && readdirSync(rulesDir).some((name) => name.endsWith(".md"));
  return { instructionsPresent, verifiedPairCount: 0 };
}

/** Builds the whole `GET /api/context/files` tree — one top-level group per entity kind, skipping any group that ends up with no readable files rather than emitting an empty section. */
export function buildContextFileTree(projectDir: string, contextShow: WrenContextShow): ContextFileNode[] {
  const groups: ContextFileNode[] = [];

  const models = buildModelNodes(projectDir, contextShow);
  if (models.length > 0) groups.push({ key: "models", title: "Models", children: models });

  const relationships = buildRelationshipNodes(projectDir, contextShow);
  if (relationships.length > 0) groups.push({ key: "relationships", title: "Relationships", children: relationships });

  const cubes = buildCubeNodes(projectDir, contextShow);
  if (cubes.length > 0) groups.push({ key: "cubes", title: "Cubes", children: cubes });

  const knowledge = buildKnowledgeNodes(projectDir);
  if (knowledge.length > 0) groups.push({ key: "knowledge", title: "Knowledge", children: knowledge });

  const project = buildProjectNode(projectDir);
  if (project.length > 0) groups.push({ key: "project", title: "Project", children: project });

  return groups;
}
