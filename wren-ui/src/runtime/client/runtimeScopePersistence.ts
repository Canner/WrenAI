import {
  hasExplicitRuntimeScopeSelector,
  normalizeSelector,
  RUNTIME_SCOPE_RECOVERY_EVENT,
  STORAGE_KEY,
} from './runtimeScopeShared';
import { readRuntimeScopeSelectorFromSearch } from './runtimeScopeParsing';
import type {
  ClientRuntimeScopeSelector,
  RuntimeScopeWindowLike,
} from './runtimeScopeTypes';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

let cachedResolvedSelectorSnapshot: {
  windowObject: RuntimeScopeWindowLike | null;
  search: string;
  storedRaw: string;
  selector: ClientRuntimeScopeSelector;
} | null = null;

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

export const readPersistedRuntimeScopeSelector = ({
  windowObject = getBrowserWindow(),
}: {
  windowObject?: RuntimeScopeWindowLike | null;
} = {}): ClientRuntimeScopeSelector =>
  readStoredRuntimeScopeSelector(getPreferredStorage(windowObject));

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
