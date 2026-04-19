import type { ClientRuntimeScopeSelector } from './runtimeScopeTypes';
import {
  normalizeSelector,
  normalizeValue,
  shouldUseProjectBridgeFallback,
} from './runtimeScopeShared';

const QUERY_KEYS = {
  workspaceId: ['workspaceId', 'workspace_id'],
  knowledgeBaseId: ['knowledgeBaseId', 'knowledge_base_id'],
  kbSnapshotId: ['kbSnapshotId', 'kb_snapshot_id'],
  deployHash: ['deployHash', 'deploy_hash'],
} as const;

const STALE_PROJECT_SCOPE_QUERY_KEYS = ['projectId', 'project_id'] as const;
const RUNTIME_SCOPE_ID_QUERY_KEYS = [
  'runtimeScopeId',
  'runtime_scope_id',
] as const;

const HEADER_KEYS = {
  workspaceId: 'x-wren-workspace-id',
  knowledgeBaseId: 'x-wren-knowledge-base-id',
  kbSnapshotId: 'x-wren-kb-snapshot-id',
  deployHash: 'x-wren-deploy-hash',
  runtimeScopeId: 'x-wren-runtime-scope-id',
} as const;

const RUNTIME_SCOPE_QUERY_KEYS = new Set([
  ...(Object.values(QUERY_KEYS) as readonly (readonly string[])[]).flat(),
  ...STALE_PROJECT_SCOPE_QUERY_KEYS,
  ...RUNTIME_SCOPE_ID_QUERY_KEYS,
]);

const isRemovedLegacyProjectScopeQueryKey = (key: string) =>
  key.replace(/_/g, '').toLowerCase() === 'legacyprojectid';

const warnDeprecatedProjectScopeAlias = (source: string) => {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') {
    return;
  }

  console.warn(
    `[runtimeScope] Detected deprecated compatibility query alias in ${source}; migrate to runtimeScopeId or canonical runtime scope fields.`,
  );
};

const readSearchParam = (
  searchParams: URLSearchParams,
  aliases: readonly string[],
): string | undefined => {
  for (const alias of aliases) {
    const value = normalizeValue(searchParams.get(alias));
    if (value) {
      return value;
    }
  }

  return undefined;
};

const hasStaleProjectScopeAliasInSearch = (searchParams: URLSearchParams) =>
  STALE_PROJECT_SCOPE_QUERY_KEYS.some((alias) => searchParams.has(alias)) ||
  Array.from(searchParams.keys()).some(isRemovedLegacyProjectScopeQueryKey);

const readValueFromObject = (
  source: Record<string, any> | undefined | null,
  keys: readonly string[],
): string | undefined => {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      if (value[0]) {
        return normalizeValue(String(value[0]));
      }
      continue;
    }

    const normalizedObjectValue = normalizeValue(
      value !== undefined && value !== null ? String(value) : undefined,
    );
    if (normalizedObjectValue) {
      return normalizedObjectValue;
    }
  }

  return undefined;
};

const hasStaleProjectScopeAliasInObject = (
  source: Record<string, any> | undefined | null,
) =>
  Boolean(
    source &&
      Object.keys(source).some(
        (key) =>
          STALE_PROJECT_SCOPE_QUERY_KEYS.includes(
            key as (typeof STALE_PROJECT_SCOPE_QUERY_KEYS)[number],
          ) || isRemovedLegacyProjectScopeQueryKey(key),
      ),
  );

const readQueryValue = (
  value: string | string[] | number | boolean | null | undefined,
): string | undefined => {
  if (Array.isArray(value)) {
    return normalizeValue(value[0]);
  }

  if (value === undefined || value === null) {
    return undefined;
  }

  return normalizeValue(`${value}`);
};

export const isRuntimeScopeQueryKey = (key: string) =>
  RUNTIME_SCOPE_QUERY_KEYS.has(key) || isRemovedLegacyProjectScopeQueryKey(key);

export const readRuntimeScopeSelectorFromSearch = (
  search?: string,
): ClientRuntimeScopeSelector => {
  const searchParams = new URLSearchParams((search || '').replace(/^\?/, ''));

  if (hasStaleProjectScopeAliasInSearch(searchParams)) {
    warnDeprecatedProjectScopeAlias('search params');
  }

  return normalizeSelector({
    workspaceId: readSearchParam(searchParams, QUERY_KEYS.workspaceId),
    knowledgeBaseId: readSearchParam(searchParams, QUERY_KEYS.knowledgeBaseId),
    kbSnapshotId: readSearchParam(searchParams, QUERY_KEYS.kbSnapshotId),
    deployHash: readSearchParam(searchParams, QUERY_KEYS.deployHash),
    runtimeScopeId: readSearchParam(searchParams, RUNTIME_SCOPE_ID_QUERY_KEYS),
  });
};

export const readRuntimeScopeSelectorFromUrl = (
  urlOrSearch?: string,
): ClientRuntimeScopeSelector => {
  if (!urlOrSearch) {
    return {};
  }

  const queryIndex = urlOrSearch.indexOf('?');
  if (queryIndex === -1) {
    return {};
  }

  return readRuntimeScopeSelectorFromSearch(urlOrSearch.slice(queryIndex));
};

export const readRuntimeScopeSelectorFromObject = (
  source?: Record<string, any> | null,
): ClientRuntimeScopeSelector => {
  if (hasStaleProjectScopeAliasInObject(source)) {
    warnDeprecatedProjectScopeAlias('query object');
  }

  return normalizeSelector({
    workspaceId: readValueFromObject(source, QUERY_KEYS.workspaceId),
    knowledgeBaseId: readValueFromObject(source, QUERY_KEYS.knowledgeBaseId),
    kbSnapshotId: readValueFromObject(source, QUERY_KEYS.kbSnapshotId),
    deployHash: readValueFromObject(source, QUERY_KEYS.deployHash),
    runtimeScopeId: readValueFromObject(source, RUNTIME_SCOPE_ID_QUERY_KEYS),
  });
};

export const buildRuntimeScopeQuery = (
  selector: ClientRuntimeScopeSelector,
): Record<string, string> => {
  const normalizedSelector = normalizeSelector(selector);
  const query: Record<string, string> = {};

  if (normalizedSelector.workspaceId) {
    query.workspaceId = normalizedSelector.workspaceId;
  }
  if (normalizedSelector.knowledgeBaseId) {
    query.knowledgeBaseId = normalizedSelector.knowledgeBaseId;
  }
  if (normalizedSelector.kbSnapshotId) {
    query.kbSnapshotId = normalizedSelector.kbSnapshotId;
  }
  if (normalizedSelector.deployHash) {
    query.deployHash = normalizedSelector.deployHash;
  }
  if (
    shouldUseProjectBridgeFallback(normalizedSelector) &&
    normalizedSelector.runtimeScopeId
  ) {
    query.runtimeScopeId = normalizedSelector.runtimeScopeId;
  }

  return query;
};

export const omitRuntimeScopeQuery = (
  source?: Record<string, any> | null,
): Record<string, string> =>
  Object.entries(source || {}).reduce<Record<string, string>>(
    (result, [key, value]) => {
      if (isRuntimeScopeQueryKey(key)) {
        return result;
      }

      const normalizedQueryValue = readQueryValue(value);
      if (normalizedQueryValue) {
        result[key] = normalizedQueryValue;
      }

      return result;
    },
    {},
  );

export const buildRuntimeScopeHeaders = (
  selector: ClientRuntimeScopeSelector,
): Record<string, string> => {
  const normalizedSelector = normalizeSelector(selector);
  const headers: Record<string, string> = {};

  if (normalizedSelector.workspaceId) {
    headers[HEADER_KEYS.workspaceId] = normalizedSelector.workspaceId;
  }
  if (normalizedSelector.knowledgeBaseId) {
    headers[HEADER_KEYS.knowledgeBaseId] = normalizedSelector.knowledgeBaseId;
  }
  if (normalizedSelector.kbSnapshotId) {
    headers[HEADER_KEYS.kbSnapshotId] = normalizedSelector.kbSnapshotId;
  }
  if (normalizedSelector.deployHash) {
    headers[HEADER_KEYS.deployHash] = normalizedSelector.deployHash;
  }
  if (
    shouldUseProjectBridgeFallback(normalizedSelector) &&
    normalizedSelector.runtimeScopeId
  ) {
    headers[HEADER_KEYS.runtimeScopeId] = normalizedSelector.runtimeScopeId;
  }

  return headers;
};
