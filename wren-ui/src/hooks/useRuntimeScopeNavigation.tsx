import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
  hasExplicitRuntimeScopeSelector,
  readRuntimeScopeSelectorFromObject,
  readRuntimeScopeSelectorFromSearch,
  resolveClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import {
  isKnowledgeWorkbenchRoute,
  isLegacyModelingRoute,
} from '@/utils/knowledgeWorkbench';

type RouteParams = Record<string, string | number | boolean | null | undefined>;

type SelectorOverride = ClientRuntimeScopeSelector | null | undefined;

export const shouldNavigateRuntimeScope = (
  nextUrl?: string | null,
  currentUrl?: string | null,
) => Boolean(nextUrl) && nextUrl !== currentUrl;

export const resolveWorkspaceNavigationSelector = (
  selector: ClientRuntimeScopeSelector,
): ClientRuntimeScopeSelector => {
  if (selector.workspaceId) {
    return { workspaceId: selector.workspaceId };
  }

  if (selector.runtimeScopeId) {
    return { runtimeScopeId: selector.runtimeScopeId };
  }

  return {};
};

const normalizeNavigationPath = (path?: string | null) =>
  (path || '').split('?')[0].split('#')[0];

export const shouldPreserveKnowledgeRuntimeScope = (path?: string | null) => {
  const normalizedPath = normalizeNavigationPath(path);
  return (
    isKnowledgeWorkbenchRoute(normalizedPath) ||
    isLegacyModelingRoute(normalizedPath)
  );
};

export const resolveScopedNavigationSelector = ({
  selector,
  path,
}: {
  selector: ClientRuntimeScopeSelector;
  path?: string | null;
}): ClientRuntimeScopeSelector => {
  if (
    shouldPreserveKnowledgeRuntimeScope(path) &&
    hasExplicitRuntimeScopeSelector(selector)
  ) {
    return selector;
  }

  return resolveWorkspaceNavigationSelector(selector);
};

export const resolveRuntimeNavigationSelector = ({
  selectorFromRoute,
  storedSelector,
}: {
  selectorFromRoute: ClientRuntimeScopeSelector;
  storedSelector: ClientRuntimeScopeSelector;
}) =>
  hasExplicitRuntimeScopeSelector(selectorFromRoute)
    ? selectorFromRoute
    : storedSelector;

export const resolveRuntimeRouteSelector = ({
  selectorFromRoute,
  windowSearch,
}: {
  selectorFromRoute: ClientRuntimeScopeSelector;
  windowSearch?: string | null;
}) => {
  if (hasExplicitRuntimeScopeSelector(selectorFromRoute)) {
    return selectorFromRoute;
  }

  return readRuntimeScopeSelectorFromSearch(windowSearch || '');
};

export default function useRuntimeScopeNavigation() {
  const router = useRouter();
  const selectorFromRoute = useMemo(
    () =>
      resolveRuntimeRouteSelector({
        selectorFromRoute: readRuntimeScopeSelectorFromObject(
          router.query as Record<string, string | string[] | undefined>,
        ),
        windowSearch:
          typeof window === 'undefined' ? '' : window.location.search,
      }),
    [
      router.query.workspaceId,
      router.query.knowledgeBaseId,
      router.query.kbSnapshotId,
      router.query.deployHash,
      router.query.runtimeScopeId,
    ],
  );
  const selector = useMemo(
    () =>
      resolveRuntimeNavigationSelector({
        selectorFromRoute,
        storedSelector: resolveClientRuntimeScopeSelector(),
      }),
    [
      selectorFromRoute.workspaceId,
      selectorFromRoute.knowledgeBaseId,
      selectorFromRoute.kbSnapshotId,
      selectorFromRoute.deployHash,
      selectorFromRoute.runtimeScopeId,
    ],
  );
  const workspaceSelector = useMemo(
    () => resolveWorkspaceNavigationSelector(selector),
    [selector.runtimeScopeId, selector.workspaceId],
  );

  const href = useCallback(
    (
      path: string,
      params: RouteParams = {},
      selectorOverride?: SelectorOverride,
    ) => buildRuntimeScopeUrl(path, params, selectorOverride || selector),
    [selector],
  );

  const push = useCallback(
    (
      path: string,
      params: RouteParams = {},
      selectorOverride?: SelectorOverride,
    ) => {
      const nextUrl = href(path, params, selectorOverride);
      if (!shouldNavigateRuntimeScope(nextUrl, router.asPath)) {
        return Promise.resolve(true);
      }

      return router.push(nextUrl, undefined, { scroll: false });
    },
    [router, href],
  );

  const replace = useCallback(
    (
      path: string,
      params: RouteParams = {},
      selectorOverride?: SelectorOverride,
    ) => {
      const nextUrl = href(path, params, selectorOverride);
      if (!shouldNavigateRuntimeScope(nextUrl, router.asPath)) {
        return Promise.resolve(true);
      }

      return router.replace(nextUrl, undefined, { scroll: false });
    },
    [router, href],
  );

  const hrefWorkspace = useCallback(
    (path: string, params: RouteParams = {}) =>
      href(path, params, resolveScopedNavigationSelector({ selector, path })),
    [href, selector],
  );

  const pushWorkspace = useCallback(
    (path: string, params: RouteParams = {}) =>
      push(path, params, resolveScopedNavigationSelector({ selector, path })),
    [push, selector],
  );

  const replaceWorkspace = useCallback(
    (path: string, params: RouteParams = {}) =>
      replace(
        path,
        params,
        resolveScopedNavigationSelector({ selector, path }),
      ),
    [replace, selector],
  );

  return {
    selector,
    workspaceSelector,
    href,
    hrefWorkspace,
    push,
    pushWorkspace,
    replace,
    replaceWorkspace,
    hasRuntimeScope: hasExplicitRuntimeScopeSelector(selector),
  };
}
