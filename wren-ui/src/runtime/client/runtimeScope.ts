export interface ClientRuntimeScopeSelector {
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
  runtimeScopeId?: string;
}

export interface RuntimeSelectorStateBootstrapData {
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
  addEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
  dispatchEvent?: (event: Event) => boolean;
}

export interface RuntimeScopeBootstrapCandidate {
  source: 'url' | 'stored' | 'server_default' | 'default';
  selector: ClientRuntimeScopeSelector;
}

const STORAGE_KEY = 'wren.runtimeScope';
let cachedResolvedSelectorSnapshot: {
  windowObject: RuntimeScopeWindowLike | null;
  search: string;
  storedRaw: string;
  selector: ClientRuntimeScopeSelector;
} | null = null;
export const RUNTIME_SCOPE_RECOVERY_EVENT = 'wren:runtime-scope-recovery';
const RECOVERABLE_RUNTIME_SCOPE_ERROR_CODES = new Set([
  'NO_DEPLOYMENT_FOUND',
  'OUTDATED_RUNTIME_SNAPSHOT',
]);

const QUERY_KEYS = {
  workspaceId: ['workspaceId', 'workspace_id'],
  knowledgeBaseId: ['knowledgeBaseId', 'knowledge_base_id'],
  kbSnapshotId: ['kbSnapshotId', 'kb_snapshot_id'],
  deployHash: ['deployHash', 'deploy_hash'],
} as const;

// Compatibility-only query aliases; new routes should use runtimeScopeId or
// canonical runtime scope fields instead of relying on these stale params.
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

const normalizeValue = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = `${value}`.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeSelector = (
  selector: ClientRuntimeScopeSelector,
): ClientRuntimeScopeSelector => {
  const normalizedSelector = {
    workspaceId: normalizeValue(selector.workspaceId),
    knowledgeBaseId: normalizeValue(selector.knowledgeBaseId),
    kbSnapshotId: normalizeValue(selector.kbSnapshotId),
    deployHash: normalizeValue(selector.deployHash),
    runtimeScopeId: normalizeValue(selector.runtimeScopeId),
  };

  if (
    normalizedSelector.workspaceId ||
    normalizedSelector.knowledgeBaseId ||
    normalizedSelector.kbSnapshotId ||
    normalizedSelector.deployHash
  ) {
    return {
      ...normalizedSelector,
      runtimeScopeId: undefined,
    };
  }

  return normalizedSelector;
};

const hasModernRuntimeScopeSelector = (
  selector: ClientRuntimeScopeSelector,
) => {
  const normalizedSelector = normalizeSelector(selector);

  return Boolean(
    normalizedSelector.workspaceId ||
      normalizedSelector.knowledgeBaseId ||
      normalizedSelector.kbSnapshotId ||
      normalizedSelector.deployHash,
  );
};

const shouldUseProjectBridgeFallback = (
  selector: ClientRuntimeScopeSelector,
) => {
  const normalizedSelector = normalizeSelector(selector);
  return Boolean(
    normalizedSelector.runtimeScopeId &&
      !hasModernRuntimeScopeSelector(normalizedSelector),
  );
};

export const hasExplicitRuntimeScopeSelector = (
  selector: ClientRuntimeScopeSelector,
) => Object.values(normalizeSelector(selector)).some(Boolean);

export const hasExecutableRuntimeScopeSelector = (
  selector: ClientRuntimeScopeSelector,
) => {
  const normalizedSelector = normalizeSelector(selector);
  return Boolean(
    normalizedSelector.kbSnapshotId || normalizedSelector.deployHash,
  );
};

export const shouldHydrateRuntimeScopeSelector = (
  selector: ClientRuntimeScopeSelector,
) =>
  hasExplicitRuntimeScopeSelector(selector) &&
  !hasExecutableRuntimeScopeSelector(selector);

export const mergeRuntimeScopeSelectors = (
  preferredSelector: ClientRuntimeScopeSelector,
  fallbackSelector: ClientRuntimeScopeSelector,
): ClientRuntimeScopeSelector =>
  normalizeSelector({
    workspaceId: preferredSelector.workspaceId || fallbackSelector.workspaceId,
    knowledgeBaseId:
      preferredSelector.knowledgeBaseId || fallbackSelector.knowledgeBaseId,
    kbSnapshotId:
      preferredSelector.kbSnapshotId || fallbackSelector.kbSnapshotId,
    deployHash: preferredSelector.deployHash || fallbackSelector.deployHash,
    runtimeScopeId:
      preferredSelector.runtimeScopeId || fallbackSelector.runtimeScopeId,
  });

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

    const normalizedValue = normalizeValue(
      value !== undefined && value !== null ? String(value) : undefined,
    );
    if (normalizedValue) {
      return normalizedValue;
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

const isRuntimeScopeQueryKey = (key: string) =>
  RUNTIME_SCOPE_QUERY_KEYS.has(key) || isRemovedLegacyProjectScopeQueryKey(key);

const getBrowserWindow = (): RuntimeScopeWindowLike | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window;
};

const createRuntimeScopeRecoveryEvent = () => {
  if (typeof Event === 'function') {
    return new Event(RUNTIME_SCOPE_RECOVERY_EVENT);
  }

  return { type: RUNTIME_SCOPE_RECOVERY_EVENT } as Event;
};

export const shouldRecoverRuntimeScopeFromErrorCode = (code?: string | null) =>
  RECOVERABLE_RUNTIME_SCOPE_ERROR_CODES.has(normalizeValue(code) || '');

const getPreferredStorage = (
  windowObject?: RuntimeScopeWindowLike | null,
): StorageLike | null => {
  if (!windowObject) {
    return null;
  }

  return windowObject.sessionStorage || windowObject.localStorage || null;
};

const readStoredRuntimeScopeRaw = (storage?: StorageLike | null): string => {
  if (!storage) {
    return '';
  }

  try {
    return storage.getItem(STORAGE_KEY) || '';
  } catch (_error) {
    return '';
  }
};

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

  const keyParts = [
    normalizedSelector.workspaceId || '',
    normalizedSelector.knowledgeBaseId || '',
    normalizedSelector.kbSnapshotId || '',
    normalizedSelector.deployHash || '',
  ];

  if (
    shouldUseProjectBridgeFallback(normalizedSelector) &&
    normalizedSelector.runtimeScopeId
  ) {
    keyParts.push(normalizedSelector.runtimeScopeId);
  }

  return keyParts.join('|');
};

export const buildRuntimeScopeSelectorFromRuntimeSelectorState = (
  selectorState?: RuntimeSelectorStateBootstrapData | null,
): ClientRuntimeScopeSelector => {
  if (!selectorState?.currentWorkspace?.id) {
    return {};
  }

  return normalizeSelector({
    workspaceId: selectorState.currentWorkspace.id,
    knowledgeBaseId: selectorState.currentKnowledgeBase?.id || undefined,
    kbSnapshotId: selectorState.currentKbSnapshot?.id || undefined,
    deployHash: selectorState.currentKbSnapshot?.deployHash || undefined,
  });
};

export const buildRuntimeScopeBootstrapCandidates = ({
  urlSelector,
  storedSelector,
  serverDefaultSelector,
}: {
  urlSelector: ClientRuntimeScopeSelector;
  storedSelector: ClientRuntimeScopeSelector;
  serverDefaultSelector?: ClientRuntimeScopeSelector;
}): RuntimeScopeBootstrapCandidate[] => {
  const candidates: RuntimeScopeBootstrapCandidate[] = [];
  const seen = new Set<string>();

  const appendCandidate = (
    source: RuntimeScopeBootstrapCandidate['source'],
    selector: ClientRuntimeScopeSelector,
  ) => {
    const normalizedSelector = normalizeSelector(selector);
    const key = hasExplicitRuntimeScopeSelector(normalizedSelector)
      ? buildRuntimeScopeStateKey(normalizedSelector)
      : '__default__';

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({
      source,
      selector: normalizedSelector,
    });
  };

  if (hasExplicitRuntimeScopeSelector(urlSelector)) {
    appendCandidate('url', urlSelector);
  }

  if (hasExplicitRuntimeScopeSelector(storedSelector)) {
    appendCandidate('stored', storedSelector);
  }

  if (hasExplicitRuntimeScopeSelector(serverDefaultSelector || {})) {
    appendCandidate('server_default', serverDefaultSelector || {});
  }

  appendCandidate('default', {});

  return candidates;
};

export const resolveRuntimeScopeBootstrapSelector = ({
  candidate,
  selectorFromServer,
}: {
  candidate: RuntimeScopeBootstrapCandidate;
  selectorFromServer: ClientRuntimeScopeSelector;
}): ClientRuntimeScopeSelector => {
  if (hasExplicitRuntimeScopeSelector(selectorFromServer)) {
    return mergeRuntimeScopeSelectors(selectorFromServer, candidate.selector);
  }

  if (candidate.source === 'default') {
    return normalizeSelector(selectorFromServer);
  }

  return normalizeSelector(candidate.selector);
};

export const shouldBlockRuntimeScopeBootstrapRender = ({
  isBrowser,
  currentUrl,
  nextUrl,
  isBootstrapLoading,
  routerReady,
  syncFailed,
  allowLoadingWhileValidating = false,
}: {
  isBrowser: boolean;
  currentUrl: string;
  nextUrl?: string | null;
  isBootstrapLoading: boolean;
  routerReady: boolean;
  syncFailed: boolean;
  allowLoadingWhileValidating?: boolean;
}) => {
  if (!isBrowser) {
    return false;
  }

  if (!routerReady) {
    return true;
  }

  if (isBootstrapLoading && !allowLoadingWhileValidating) {
    return true;
  }

  if (syncFailed) {
    return false;
  }

  return Boolean(nextUrl && nextUrl !== currentUrl);
};

export const shouldDeferRuntimeScopeUrlSync = ({
  selectorFromUrl,
  selectorToSync,
}: {
  selectorFromUrl: ClientRuntimeScopeSelector;
  selectorToSync?: ClientRuntimeScopeSelector | null;
}) => {
  const normalizedUrlSelector = normalizeSelector(selectorFromUrl);
  const normalizedSelectorToSync = normalizeSelector(selectorToSync || {});

  if (!hasExplicitRuntimeScopeSelector(normalizedUrlSelector)) {
    return false;
  }

  if (!hasExplicitRuntimeScopeSelector(normalizedSelectorToSync)) {
    return true;
  }

  return !(
    (!normalizedUrlSelector.workspaceId ||
      normalizedUrlSelector.workspaceId ===
        normalizedSelectorToSync.workspaceId) &&
    (!normalizedUrlSelector.knowledgeBaseId ||
      normalizedUrlSelector.knowledgeBaseId ===
        normalizedSelectorToSync.knowledgeBaseId) &&
    (!normalizedUrlSelector.kbSnapshotId ||
      normalizedUrlSelector.kbSnapshotId ===
        normalizedSelectorToSync.kbSnapshotId) &&
    (!normalizedUrlSelector.deployHash ||
      normalizedUrlSelector.deployHash ===
        normalizedSelectorToSync.deployHash) &&
    (!normalizedUrlSelector.runtimeScopeId ||
      normalizedUrlSelector.runtimeScopeId ===
        normalizedSelectorToSync.runtimeScopeId)
  );
};

const readStoredRuntimeScopeSelector = (
  storage?: StorageLike | null,
  rawValue?: string,
): ClientRuntimeScopeSelector => {
  if (!storage) {
    return {};
  }

  try {
    const raw = rawValue ?? readStoredRuntimeScopeRaw(storage);
    if (!raw) {
      return {};
    }

    return normalizeSelector(JSON.parse(raw));
  } catch (_error) {
    return {};
  }
};

export const readPersistedRuntimeScopeSelector = ({
  windowObject = getBrowserWindow(),
}: {
  windowObject?: RuntimeScopeWindowLike | null;
} = {}): ClientRuntimeScopeSelector =>
  readStoredRuntimeScopeSelector(getPreferredStorage(windowObject));

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
      cachedResolvedSelectorSnapshot = null;
      return;
    }

    const serializedSelector = JSON.stringify(normalizedSelector);
    storage.setItem(STORAGE_KEY, serializedSelector);
    cachedResolvedSelectorSnapshot = {
      windowObject: null,
      search: '',
      storedRaw: serializedSelector,
      selector: normalizedSelector,
    };
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

export const writePersistedRuntimeScopeSelector = (
  selector: ClientRuntimeScopeSelector,
  {
    windowObject = getBrowserWindow(),
  }: {
    windowObject?: RuntimeScopeWindowLike | null;
  } = {},
) => {
  persistRuntimeScopeSelector(getPreferredStorage(windowObject), selector);
};

export const triggerRuntimeScopeRecovery = ({
  windowObject = getBrowserWindow(),
}: {
  windowObject?: RuntimeScopeWindowLike | null;
} = {}) => {
  if (!windowObject) {
    return false;
  }

  writePersistedRuntimeScopeSelector({}, { windowObject });

  if (typeof windowObject.dispatchEvent !== 'function') {
    return false;
  }

  return windowObject.dispatchEvent(createRuntimeScopeRecoveryEvent());
};

export const resolveClientRuntimeScopeSelector = ({
  windowObject = getBrowserWindow(),
}: {
  windowObject?: RuntimeScopeWindowLike | null;
} = {}): ClientRuntimeScopeSelector => {
  if (!windowObject) {
    return {};
  }

  const preferredStorage = getPreferredStorage(windowObject);
  const currentSearch = windowObject.location?.search || '';

  if (
    cachedResolvedSelectorSnapshot &&
    cachedResolvedSelectorSnapshot.windowObject === windowObject &&
    cachedResolvedSelectorSnapshot.search === currentSearch
  ) {
    return cachedResolvedSelectorSnapshot.selector;
  }

  const selectorFromQuery = readRuntimeScopeSelectorFromSearch(currentSearch);

  if (hasExplicitRuntimeScopeSelector(selectorFromQuery)) {
    persistRuntimeScopeSelector(preferredStorage, selectorFromQuery);
    cachedResolvedSelectorSnapshot = {
      windowObject,
      search: currentSearch,
      storedRaw: readStoredRuntimeScopeRaw(preferredStorage),
      selector: selectorFromQuery,
    };
    return selectorFromQuery;
  }

  const resolvedSelector = readStoredRuntimeScopeSelector(
    preferredStorage,
    readStoredRuntimeScopeRaw(preferredStorage),
  );
  cachedResolvedSelectorSnapshot = {
    windowObject,
    search: currentSearch,
    storedRaw: readStoredRuntimeScopeRaw(preferredStorage),
    selector: resolvedSelector,
  };
  return resolvedSelector;
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
  if (
    shouldUseProjectBridgeFallback(normalizedSelector) &&
    normalizedSelector.runtimeScopeId
  ) {
    headers[HEADER_KEYS.runtimeScopeId] = normalizedSelector.runtimeScopeId;
  }

  return headers;
};

export const mergeRuntimeScopeRequestHeaders = (
  previousHeaders: Record<string, any> = {},
  selector = resolveClientRuntimeScopeSelector(),
): Record<string, any> => ({
  ...buildRuntimeScopeHeaders(selector),
  ...previousHeaders,
});

export const buildRuntimeScopeUrl = (
  url: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  selector = resolveClientRuntimeScopeSelector(),
): string => {
  const normalizedSelector = normalizeSelector(selector);
  const parsedUrl = new URL(url, 'http://wren.local');

  Array.from(parsedUrl.searchParams.keys()).forEach((key) => {
    if (isRuntimeScopeQueryKey(key)) {
      parsedUrl.searchParams.delete(key);
    }
  });

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
  if (
    shouldUseProjectBridgeFallback(normalizedSelector) &&
    normalizedSelector.runtimeScopeId
  ) {
    parsedUrl.searchParams.set(
      'runtimeScopeId',
      normalizedSelector.runtimeScopeId,
    );
  }

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
};
