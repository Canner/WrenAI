import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import {
  parseRestJsonResponse,
  withTransientRuntimeScopeRetry,
} from '@/utils/rest';

export type RuntimeSelectorState = {
  currentWorkspace?: {
    id: string;
    slug: string;
    name: string;
    kind?: string | null;
  } | null;
  workspaces: Array<{
    id: string;
    slug: string;
    name: string;
  }>;
  currentKnowledgeBase?: {
    id: string;
    slug: string;
    name: string;
    kind?: string | null;
    defaultKbSnapshotId?: string | null;
  } | null;
  currentKbSnapshot?: {
    id: string;
    snapshotKey: string;
    displayName: string;
    deployHash: string;
    status: string;
  } | null;
  knowledgeBases: Array<{
    id: string;
    slug: string;
    name: string;
    defaultKbSnapshotId?: string | null;
    assetCount?: number | null;
  }>;
  kbSnapshots: Array<{
    id: string;
    snapshotKey: string;
    displayName: string;
    deployHash: string;
    status: string;
  }>;
};

export type RuntimeSelectorStateRefetchResult = {
  data: {
    runtimeSelectorState: RuntimeSelectorState | null;
  };
};

type TimedCacheEntry = {
  payload: RuntimeSelectorState | null;
  updatedAt: number;
};

const RUNTIME_SELECTOR_STATE_CACHE_TTL_MS = 30_000;
const RUNTIME_SELECTOR_STATE_STORAGE_PREFIX = 'wren.runtimeSelectorState:';
const runtimeSelectorStateCache = new Map<string, TimedCacheEntry>();
const runtimeSelectorStateRequestCache = new Map<
  string,
  Promise<RuntimeSelectorState | null>
>();

const getRuntimeSelectorStateStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const getRuntimeSelectorStateStorageKey = (requestUrl: string) =>
  `${RUNTIME_SELECTOR_STATE_STORAGE_PREFIX}${requestUrl}`;

const getRuntimeSelectorStateStorageKeys = (storage: Storage) => {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(RUNTIME_SELECTOR_STATE_STORAGE_PREFIX)) {
      keys.push(key);
    }
  }

  return keys;
};

const readStoredRuntimeSelectorState = (
  requestUrl: string,
): TimedCacheEntry | null => {
  const storage = getRuntimeSelectorStateStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(
      getRuntimeSelectorStateStorageKey(requestUrl),
    );
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as TimedCacheEntry | null;
    if (
      !parsed ||
      typeof parsed.updatedAt !== 'number' ||
      !Object.prototype.hasOwnProperty.call(parsed, 'payload')
    ) {
      storage.removeItem(getRuntimeSelectorStateStorageKey(requestUrl));
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
};

const writeStoredRuntimeSelectorState = (
  requestUrl: string,
  entry: TimedCacheEntry,
) => {
  const storage = getRuntimeSelectorStateStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      getRuntimeSelectorStateStorageKey(requestUrl),
      JSON.stringify(entry),
    );
  } catch (_error) {
    // ignore sessionStorage write failures
  }
};

const clearStoredRuntimeSelectorState = (requestUrl: string) => {
  const storage = getRuntimeSelectorStateStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(getRuntimeSelectorStateStorageKey(requestUrl));
  } catch (_error) {
    // ignore sessionStorage cleanup failures
  }
};

const getFreshRuntimeSelectorStateEntry = (
  requestUrl: string,
): TimedCacheEntry | null => {
  const inMemoryEntry = runtimeSelectorStateCache.get(requestUrl) || null;
  const cachedEntry =
    inMemoryEntry || readStoredRuntimeSelectorState(requestUrl);

  if (!cachedEntry) {
    return null;
  }

  if (
    Date.now() - cachedEntry.updatedAt >
    RUNTIME_SELECTOR_STATE_CACHE_TTL_MS
  ) {
    runtimeSelectorStateCache.delete(requestUrl);
    clearStoredRuntimeSelectorState(requestUrl);
    return null;
  }

  if (!inMemoryEntry) {
    runtimeSelectorStateCache.set(requestUrl, cachedEntry);
  }

  return cachedEntry;
};

export const buildRuntimeSelectorStateUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/runtime/scope/current', {}, selector);

export const buildRuntimeSelectorStateRequestKey = ({
  skip,
  selector,
}: {
  skip: boolean;
  selector: ClientRuntimeScopeSelector;
}) => (skip ? null : buildRuntimeSelectorStateUrl(selector));

export const buildRuntimeSelectorRequestOptions = ({
  signal,
}: {
  signal?: AbortSignal;
}) => ({
  method: 'GET' as const,
  signal,
});

export const resolveRuntimeSelectorInitialLoading = ({
  loading,
  runtimeSelectorState,
}: {
  loading: boolean;
  runtimeSelectorState: RuntimeSelectorState | null;
}) => loading && runtimeSelectorState === null;

export const peekRuntimeSelectorStatePayload = ({
  requestUrl,
}: {
  requestUrl: string;
}) => getFreshRuntimeSelectorStateEntry(requestUrl)?.payload || null;

export const primeRuntimeSelectorStatePayload = ({
  requestUrl,
  payload,
}: {
  requestUrl: string;
  payload: RuntimeSelectorState | null;
}) => {
  const entry = {
    payload,
    updatedAt: Date.now(),
  };

  runtimeSelectorStateCache.set(requestUrl, entry);
  writeStoredRuntimeSelectorState(requestUrl, entry);
};

export const clearRuntimeSelectorStateCache = () => {
  runtimeSelectorStateCache.clear();
  runtimeSelectorStateRequestCache.clear();

  const storage = getRuntimeSelectorStateStorage();
  if (!storage) {
    return;
  }

  try {
    getRuntimeSelectorStateStorageKeys(storage).forEach((key) =>
      storage.removeItem(key),
    );
  } catch (_error) {
    // ignore sessionStorage cleanup failures
  }
};

export const fetchRuntimeSelectorState = async ({
  requestUrl,
  signal,
}: {
  requestUrl: string;
  signal: AbortSignal;
}) => {
  const cachedEntry = getFreshRuntimeSelectorStateEntry(requestUrl);
  if (cachedEntry) {
    return cachedEntry.payload;
  }

  const pendingRequest = runtimeSelectorStateRequestCache.get(requestUrl);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = withTransientRuntimeScopeRetry({
    signal,
    loader: async () => {
      const response = await fetch(
        requestUrl,
        buildRuntimeSelectorRequestOptions({ signal }),
      );

      return parseRestJsonResponse<RuntimeSelectorState | null>(
        response,
        '加载运行时范围失败，请稍后重试。',
      );
    },
  })
    .then((payload) => {
      primeRuntimeSelectorStatePayload({ requestUrl, payload });
      return payload;
    })
    .finally(() => {
      runtimeSelectorStateRequestCache.delete(requestUrl);
    });

  runtimeSelectorStateRequestCache.set(requestUrl, request);
  return request;
};
