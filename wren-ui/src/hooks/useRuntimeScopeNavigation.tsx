import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
  hasExplicitRuntimeScopeSelector,
  readRuntimeScopeSelectorFromObject,
  resolveClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';

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

export default function useRuntimeScopeNavigation() {
  const router = useRouter();
  const selectorFromRoute = useMemo(
    () =>
      readRuntimeScopeSelectorFromObject(
        router.query as Record<string, string | string[] | undefined>,
      ),
    [router.query],
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
      href(path, params, workspaceSelector),
    [href, workspaceSelector],
  );

  const pushWorkspace = useCallback(
    (path: string, params: RouteParams = {}) =>
      push(path, params, workspaceSelector),
    [push, workspaceSelector],
  );

  const replaceWorkspace = useCallback(
    (path: string, params: RouteParams = {}) =>
      replace(path, params, workspaceSelector),
    [replace, workspaceSelector],
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
