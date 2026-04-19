import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';

export type SidebarThread = {
  id: string;
  name: string;
  selector: ClientRuntimeScopeSelector;
};

export type SidebarThreadRuntimeIdentity = {
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
};

export type HomeSidebarThreadRecord = SidebarThreadRuntimeIdentity & {
  id: string | number;
  summary?: string | null;
};

export const EMPTY_SIDEBAR_THREADS: SidebarThread[] = [];
const SIDEBAR_CACHE_TTL_MS = 20_000;
const HOME_SIDEBAR_STORAGE_PREFIX = 'wren.homeSidebar';

type SidebarCacheRecord<T> = {
  value: T;
  updatedAt: number;
};

const getHomeSidebarStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
};

const readSidebarCacheRecord = <T>(
  key: string,
): SidebarCacheRecord<T> | null => {
  const storage = getHomeSidebarStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as SidebarCacheRecord<T>) : null;
  } catch (_error) {
    storage.removeItem(key);
    return null;
  }
};

const writeSidebarCacheRecord = <T>(key: string, value: T) => {
  const storage = getHomeSidebarStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      key,
      JSON.stringify({
        value,
        updatedAt: Date.now(),
      } satisfies SidebarCacheRecord<T>),
    );
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

export const resolveHomeSidebarScopeKey = ({
  workspaceId,
  runtimeScopeId,
}: {
  workspaceId?: string | null;
  runtimeScopeId?: string | null;
}) => workspaceId || runtimeScopeId || '__default__';

export const resolveHomeSidebarHeaderSelector = ({
  workspaceId,
  runtimeScopeId,
}: {
  workspaceId?: string | null;
  runtimeScopeId?: string | null;
}) => {
  if (workspaceId) {
    return { workspaceId };
  }

  if (runtimeScopeId) {
    return { runtimeScopeId };
  }

  return {};
};

const getHomeSidebarQueryEnabledStorageKey = (scopeKey: string) =>
  `${HOME_SIDEBAR_STORAGE_PREFIX}:queryEnabled:${scopeKey}`;

const getHomeSidebarThreadsStorageKey = (scopeKey: string) =>
  `${HOME_SIDEBAR_STORAGE_PREFIX}:threads:${scopeKey}`;

export const resolveHomeSidebarThreadSelector = (
  thread: SidebarThreadRuntimeIdentity,
): ClientRuntimeScopeSelector => {
  const workspaceId = thread.workspaceId || undefined;
  const knowledgeBaseId = thread.knowledgeBaseId || undefined;
  const kbSnapshotId = thread.kbSnapshotId || undefined;
  const deployHash = thread.deployHash || undefined;

  if (workspaceId || knowledgeBaseId || kbSnapshotId || deployHash) {
    return {
      ...(workspaceId ? { workspaceId } : {}),
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
      ...(kbSnapshotId ? { kbSnapshotId } : {}),
      ...(deployHash ? { deployHash } : {}),
    };
  }

  return {};
};

export const buildHomeSidebarThreadsUrl = (
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl('/api/v1/threads', {}, selector);

export const buildHomeSidebarThreadsRequestKey = (
  selector: ClientRuntimeScopeSelector,
) => buildHomeSidebarThreadsUrl(selector);

export const buildHomeSidebarThreadDetailUrl = (
  id: string,
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/threads/${id}`, {}, selector);

export const normalizeHomeSidebarThreads = (
  payload: unknown,
): HomeSidebarThreadRecord[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload as HomeSidebarThreadRecord[];
};

export const getCachedHomeSidebarQueryEnabled = (scopeKey: string) =>
  (() => {
    const cached = readSidebarCacheRecord<boolean>(
      getHomeSidebarQueryEnabledStorageKey(scopeKey),
    );
    if (!cached) {
      return false;
    }

    if (Date.now() - cached.updatedAt > SIDEBAR_CACHE_TTL_MS) {
      getHomeSidebarStorage()?.removeItem(
        getHomeSidebarQueryEnabledStorageKey(scopeKey),
      );
      return false;
    }

    return cached.value;
  })();

export const getCachedHomeSidebarThreads = (scopeKey: string) =>
  (() => {
    const cached = readSidebarCacheRecord<SidebarThread[]>(
      getHomeSidebarThreadsStorageKey(scopeKey),
    );
    if (!cached) {
      return EMPTY_SIDEBAR_THREADS;
    }

    if (Date.now() - cached.updatedAt > SIDEBAR_CACHE_TTL_MS) {
      getHomeSidebarStorage()?.removeItem(
        getHomeSidebarThreadsStorageKey(scopeKey),
      );
      return EMPTY_SIDEBAR_THREADS;
    }

    return cached.value;
  })();

export const cacheHomeSidebarQueryEnabled = (scopeKey: string) => {
  writeSidebarCacheRecord(getHomeSidebarQueryEnabledStorageKey(scopeKey), true);
};

export const cacheHomeSidebarThreads = (
  scopeKey: string,
  threads: SidebarThread[],
) => {
  writeSidebarCacheRecord(
    getHomeSidebarThreadsStorageKey(scopeKey),
    threads.length === 0 ? EMPTY_SIDEBAR_THREADS : threads,
  );
};

export const shouldScheduleDeferredSidebarLoad = ({
  deferInitialLoad,
  hasRuntimeScope,
  loadOnIntent,
  queryEnabled,
}: {
  deferInitialLoad: boolean;
  hasRuntimeScope: boolean;
  loadOnIntent: boolean;
  queryEnabled: boolean;
}) => hasRuntimeScope && deferInitialLoad && !queryEnabled && !loadOnIntent;

export const shouldEnableSidebarQueryOnIntent = ({
  disabled,
  hasRuntimeScope,
  queryEnabled,
}: {
  disabled?: boolean;
  hasRuntimeScope: boolean;
  queryEnabled: boolean;
}) => !disabled && hasRuntimeScope && !queryEnabled;

export const shouldFetchHomeSidebarThreads = ({
  disabled,
  hasRuntimeScope,
  queryEnabled,
  cachedThreadCount,
}: {
  disabled?: boolean;
  hasRuntimeScope: boolean;
  queryEnabled: boolean;
  cachedThreadCount: number;
}) => !disabled && hasRuntimeScope && queryEnabled && cachedThreadCount === 0;

export const shouldEagerLoadHomeSidebarOnIntent = ({
  disabled,
  hasRuntimeScope,
  cachedThreadCount,
}: {
  disabled?: boolean;
  hasRuntimeScope: boolean;
  cachedThreadCount: number;
}) => !disabled && hasRuntimeScope && cachedThreadCount === 0;
