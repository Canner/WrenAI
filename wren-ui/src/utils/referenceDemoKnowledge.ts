import {
  REFERENCE_ASSET_ALIASES,
  REFERENCE_DEMO_KNOWLEDGE_BASES,
  REFERENCE_SNAPSHOT_ALIASES,
  REFERENCE_THREAD_TITLE_ALIASES,
  REFERENCE_WORKSPACE_ALIASES,
} from './referenceDemoKnowledgeData';
import type {
  ReferenceDemoKnowledge,
  ReferenceDemoKnowledgeTarget,
} from './referenceDemoKnowledgeTypes';

export {
  DEFAULT_REFERENCE_DEMO_KNOWLEDGE,
  REFERENCE_DEMO_KNOWLEDGE_BASES,
  REFERENCE_HOME_FALLBACK_QUESTION,
  REFERENCE_HOME_RECOMMENDATIONS,
} from './referenceDemoKnowledgeData';
export type {
  ReferenceDemoField,
  ReferenceDemoKnowledge,
  ReferenceDemoKnowledgeTarget,
} from './referenceDemoKnowledgeTypes';

const normalizeReferenceName = (value?: string | null) =>
  (value || '').trim().toLowerCase();

const getReferenceKnowledgeRawName = (value?: ReferenceDemoKnowledgeTarget) =>
  typeof value === 'string' ? value : value?.name;

const getReferenceKnowledgeCandidates = (
  value?: ReferenceDemoKnowledgeTarget,
) => {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  if (value.kind && value.kind !== 'system_sample') {
    return [];
  }

  return [value.sampleDataset, value.slug, value.name];
};

const findAlias = (aliases: Array<[RegExp, string]>, value?: string | null) => {
  const raw = (value || '').trim();
  if (!raw) {
    return null;
  }

  for (const [pattern, label] of aliases) {
    if (pattern.test(raw)) {
      return label;
    }
  }

  return null;
};

export const getReferenceDemoKnowledgeByName = (
  value?: ReferenceDemoKnowledgeTarget,
): ReferenceDemoKnowledge | null => {
  const normalizedCandidates = [
    ...new Set(
      getReferenceKnowledgeCandidates(value)
        .map((candidate) => normalizeReferenceName(candidate))
        .filter(Boolean),
    ),
  ];

  if (normalizedCandidates.length === 0) {
    return null;
  }

  return (
    REFERENCE_DEMO_KNOWLEDGE_BASES.find((item) =>
      normalizedCandidates.some(
        (candidate) =>
          candidate === normalizeReferenceName(item.name) ||
          candidate === normalizeReferenceName(item.id) ||
          item.aliases.some(
            (alias) => candidate === normalizeReferenceName(alias),
          ),
      ),
    ) || null
  );
};

const getReferenceAssetAliasEntry = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
  assetName?: string | null,
) => {
  const knowledgeId = getReferenceDemoKnowledgeByName(knowledgeName)?.id;
  const assetKey = normalizeReferenceName(assetName);
  if (!knowledgeId || !assetKey) {
    return null;
  }

  return REFERENCE_ASSET_ALIASES[knowledgeId]?.[assetKey] || null;
};

export const getReferenceDisplayKnowledgeName = (
  value?: ReferenceDemoKnowledgeTarget,
) =>
  getReferenceDemoKnowledgeByName(value)?.name ||
  getReferenceKnowledgeRawName(value) ||
  '当前知识库';

export const getReferenceDisplayThreadTitle = (value?: string | null) => {
  const raw = (value || '').trim();
  if (!raw) {
    return '未命名对话';
  }

  for (const [pattern, translated] of REFERENCE_THREAD_TITLE_ALIASES) {
    if (pattern.test(raw)) {
      return translated;
    }
  }

  return raw;
};

export const getReferenceDisplayWorkspaceName = (value?: string | null) =>
  findAlias(REFERENCE_WORKSPACE_ALIASES, value) || value || '工作区';

export const getReferenceDisplaySnapshotName = (value?: string | null) =>
  findAlias(REFERENCE_SNAPSHOT_ALIASES, value) || value || '快照';

export const getReferenceDisplayAssetName = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
  assetName?: string | null,
) =>
  getReferenceAssetAliasEntry(knowledgeName, assetName)?.name ||
  assetName ||
  '未命名资产';

export const getReferenceDisplayAssetDescription = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
  assetName?: string | null,
  fallback?: string | null,
) =>
  getReferenceAssetAliasEntry(knowledgeName, assetName)?.description ||
  fallback ||
  null;

export const getReferenceAssetCountByKnowledgeName = (
  knowledgeName?: ReferenceDemoKnowledgeTarget,
) => {
  const reference = getReferenceDemoKnowledgeByName(knowledgeName);
  if (!reference?.id) {
    return null;
  }

  const assets = Object.values(REFERENCE_ASSET_ALIASES[reference.id] || {});
  const uniqueAssetNames = new Set(
    assets.map((asset) => asset.name).filter(Boolean),
  );

  return uniqueAssetNames.size || null;
};
