import type {
  ClientRuntimeScopeSelector,
  RuntimeScopeBootstrapCandidate,
  RuntimeSelectorStateBootstrapData,
} from './runtimeScopeTypes';

const RECOVERABLE_RUNTIME_SCOPE_ERROR_CODES = new Set([
  'NO_DEPLOYMENT_FOUND',
  'OUTDATED_RUNTIME_SNAPSHOT',
]);

export const RUNTIME_SCOPE_RECOVERY_EVENT = 'wren:runtime-scope-recovery';
export const STORAGE_KEY = 'wren.runtimeScope';

export const normalizeValue = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = `${value}`.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeSelector = (
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

export const shouldUseProjectBridgeFallback = (
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
    candidates.push({ source, selector: normalizedSelector });
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

export const shouldAcceptRuntimeScopeBootstrapCandidate = ({
  candidate,
  selectorFromServer,
}: {
  candidate: RuntimeScopeBootstrapCandidate;
  selectorFromServer: ClientRuntimeScopeSelector;
}) =>
  hasExplicitRuntimeScopeSelector(selectorFromServer) ||
  candidate.source === 'default';

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

export const shouldRecoverRuntimeScopeFromErrorCode = (code?: string | null) =>
  RECOVERABLE_RUNTIME_SCOPE_ERROR_CODES.has(normalizeValue(code) || '');
