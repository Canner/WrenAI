import {
  buildRuntimeScopeHeaders,
  isRuntimeScopeQueryKey,
} from './runtimeScopeParsing';
import {
  normalizeSelector,
  shouldUseProjectBridgeFallback,
} from './runtimeScopeShared';
import { resolveClientRuntimeScopeSelector } from './runtimeScopePersistence';

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
