export interface ClientRuntimeScopeSelector {
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
  projectId?: string;
}

export interface RuntimeSelectorStateBootstrapData {
  currentProjectId?: number | null;
  currentWorkspace?: {
    id?: string | null;
  } | null;
  currentKnowledgeBase?: {
    id?: string | null;
  } | null;
  currentKbSnapshot?: {
    id?: string | null;
    deployHash?: string | null;
  } | null;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface RuntimeScopeWindowLike {
  location?: {
    search?: string;
  };
  sessionStorage?: StorageLike | null;
  localStorage?: StorageLike | null;
}

const STORAGE_KEY = 'wren.runtimeScope';

const QUERY_KEYS = {
  workspaceId: ['workspaceId', 'workspace_id'],
  knowledgeBaseId: ['knowledgeBaseId', 'knowledge_base_id'],
  kbSnapshotId: ['kbSnapshotId', 'kb_snapshot_id'],
  deployHash: ['deployHash', 'deploy_hash'],
  projectId: ['projectId', 'project_id', 'legacyProjectId', 'legacy_project_id'],
} as const;

const HEADER_KEYS = {
  workspaceId: 'x-wren-workspace-id',
  knowledgeBaseId: 'x-wren-knowledge-base-id',
  kbSnapshotId: 'x-wren-kb-snapshot-id',
  deployHash: 'x-wren-deploy-hash',
  projectId: 'x-wren-project-id',
} as const;

const RUNTIME_SCOPE_QUERY_KEYS = new Set(
  (Object.values(QUERY_KEYS) as readonly (readonly string[])[]).flat(),
);

const normalizeValue = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = `${value}`.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeSelector = (
  selector: ClientRuntimeScopeSelector,
): ClientRuntimeScopeSelector => ({
  workspaceId: normalizeValue(selector.workspaceId),
  knowledgeBaseId: normalizeValue(selector.knowledgeBaseId),
  kbSnapshotId: normalizeValue(selector.kbSnapshotId),
  deployHash: normalizeValue(selector.deployHash),
  projectId: normalizeValue(selector.projectId),
});

export const hasExplicitRuntimeScopeSelector = (
  selector: ClientRuntimeScopeSelector,
) =>
  Object.values(normalizeSelector(selector)).some(Boolean);

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

    const normalizedValue = normalizeValue(
      value !== undefined && value !== null ? String(value) : undefined,
    );
    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return undefined;
};

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

const isRuntimeScopeQueryKey = (key: string) =>
  RUNTIME_SCOPE_QUERY_KEYS.has(key);

const getBrowserWindow = (): RuntimeScopeWindowLike | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window;
};

const getPreferredStorage = (
  windowObject?: RuntimeScopeWindowLike | null,
): StorageLike | null => {
  if (!windowObject) {
    return null;
  }

  return windowObject.sessionStorage || windowObject.localStorage || null;
};

export const readRuntimeScopeSelectorFromSearch = (
  search?: string,
): ClientRuntimeScopeSelector => {
  const searchParams = new URLSearchParams((search || '').replace(/^\?/, ''));

  return normalizeSelector({
    workspaceId: readSearchParam(searchParams, QUERY_KEYS.workspaceId),
    knowledgeBaseId: readSearchParam(searchParams, QUERY_KEYS.knowledgeBaseId),
    kbSnapshotId: readSearchParam(searchParams, QUERY_KEYS.kbSnapshotId),
    deployHash: readSearchParam(searchParams, QUERY_KEYS.deployHash),
    projectId: readSearchParam(searchParams, QUERY_KEYS.projectId),
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
): ClientRuntimeScopeSelector =>
  normalizeSelector({
    workspaceId: readValueFromObject(source, QUERY_KEYS.workspaceId),
    knowledgeBaseId: readValueFromObject(source, QUERY_KEYS.knowledgeBaseId),
    kbSnapshotId: readValueFromObject(source, QUERY_KEYS.kbSnapshotId),
    deployHash: readValueFromObject(source, QUERY_KEYS.deployHash),
    projectId: readValueFromObject(source, QUERY_KEYS.projectId),
  });

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
  if (normalizedSelector.projectId) {
    query.projectId = normalizedSelector.projectId;
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

      const normalizedValue = readQueryValue(value);
      if (normalizedValue) {
        result[key] = normalizedValue;
      }

      return result;
    },
    {},
  );

export const buildRuntimeScopeStateKey = (
  selector: ClientRuntimeScopeSelector,
): string => {
  const normalizedSelector = normalizeSelector(selector);

  return [
    normalizedSelector.workspaceId || '',
    normalizedSelector.knowledgeBaseId || '',
    normalizedSelector.kbSnapshotId || '',
    normalizedSelector.deployHash || '',
    normalizedSelector.projectId || '',
  ].join('|');
};

export const buildRuntimeScopeSelectorFromRuntimeSelectorState = (
  selectorState?: RuntimeSelectorStateBootstrapData | null,
): ClientRuntimeScopeSelector => {
  if (
    selectorState?.currentWorkspace?.id &&
    selectorState?.currentKnowledgeBase?.id &&
    selectorState?.currentKbSnapshot?.id &&
    selectorState?.currentKbSnapshot?.deployHash
  ) {
    return normalizeSelector({
      workspaceId: selectorState.currentWorkspace.id,
      knowledgeBaseId: selectorState.currentKnowledgeBase.id,
      kbSnapshotId: selectorState.currentKbSnapshot.id,
      deployHash: selectorState.currentKbSnapshot.deployHash,
    });
  }

  if (selectorState?.currentProjectId) {
    return normalizeSelector({
      projectId: `${selectorState.currentProjectId}`,
    });
  }

  return {};
};

export const shouldBlockRuntimeScopeBootstrapRender = ({
  hasUrlSelector,
  isBrowser,
  isServerBootstrapLoading,
  routerReady,
  selectorToSync,
  syncFailed,
}: {
  hasUrlSelector: boolean;
  isBrowser: boolean;
  isServerBootstrapLoading: boolean;
  routerReady: boolean;
  selectorToSync?: ClientRuntimeScopeSelector | null;
  syncFailed: boolean;
}) => {
  if (hasUrlSelector || syncFailed) {
    return false;
  }

  if (!isBrowser || !routerReady) {
    return true;
  }

  if (hasExplicitRuntimeScopeSelector(selectorToSync || {})) {
    return true;
  }

  return isServerBootstrapLoading;
};

const readStoredRuntimeScopeSelector = (
  storage?: StorageLike | null,
): ClientRuntimeScopeSelector => {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return normalizeSelector(JSON.parse(raw));
  } catch (_error) {
    return {};
  }
};

const persistRuntimeScopeSelector = (
  storage: StorageLike | null,
  selector: ClientRuntimeScopeSelector,
) => {
  if (!storage) {
    return;
  }

  const normalizedSelector = normalizeSelector(selector);

  try {
    if (!hasExplicitRuntimeScopeSelector(normalizedSelector)) {
      storage.removeItem?.(STORAGE_KEY);
      return;
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(normalizedSelector));
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

export const resolveClientRuntimeScopeSelector = ({
  windowObject = getBrowserWindow(),
}: {
  windowObject?: RuntimeScopeWindowLike | null;
} = {}): ClientRuntimeScopeSelector => {
  if (!windowObject) {
    return {};
  }

  const selectorFromQuery = readRuntimeScopeSelectorFromSearch(
    windowObject.location?.search,
  );

  if (hasExplicitRuntimeScopeSelector(selectorFromQuery)) {
    persistRuntimeScopeSelector(
      getPreferredStorage(windowObject),
      selectorFromQuery,
    );
    return selectorFromQuery;
  }

  return readStoredRuntimeScopeSelector(getPreferredStorage(windowObject));
};

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
  if (normalizedSelector.projectId) {
    headers[HEADER_KEYS.projectId] = normalizedSelector.projectId;
  }

  return headers;
};

export const buildRuntimeScopeUrl = (
  url: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  selector = resolveClientRuntimeScopeSelector(),
): string => {
  const normalizedSelector = normalizeSelector(selector);
  const parsedUrl = new URL(url, 'http://wren.local');

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    parsedUrl.searchParams.set(key, `${value}`);
  });

  if (normalizedSelector.workspaceId) {
    parsedUrl.searchParams.set('workspaceId', normalizedSelector.workspaceId);
  }
  if (normalizedSelector.knowledgeBaseId) {
    parsedUrl.searchParams.set(
      'knowledgeBaseId',
      normalizedSelector.knowledgeBaseId,
    );
  }
  if (normalizedSelector.kbSnapshotId) {
    parsedUrl.searchParams.set('kbSnapshotId', normalizedSelector.kbSnapshotId);
  }
  if (normalizedSelector.deployHash) {
    parsedUrl.searchParams.set('deployHash', normalizedSelector.deployHash);
  }
  if (normalizedSelector.projectId) {
    parsedUrl.searchParams.set('projectId', normalizedSelector.projectId);
  }

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
};
