import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
  hasExplicitRuntimeScopeSelector,
  readRuntimeScopeSelectorFromObject,
  resolveClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';

type RouteParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export default function useRuntimeScopeNavigation() {
  const router = useRouter();
  const selectorFromRoute = useMemo(
    () =>
      readRuntimeScopeSelectorFromObject(
        router.query as Record<string, string | string[] | undefined>,
      ),
    [router.query],
  );
  const [selector, setSelector] =
    useState<ClientRuntimeScopeSelector>(selectorFromRoute);

  useEffect(() => {
    if (hasExplicitRuntimeScopeSelector(selectorFromRoute)) {
      setSelector(selectorFromRoute);
      return;
    }

    setSelector(resolveClientRuntimeScopeSelector());
  }, [
    selectorFromRoute.workspaceId,
    selectorFromRoute.knowledgeBaseId,
    selectorFromRoute.kbSnapshotId,
    selectorFromRoute.deployHash,
    selectorFromRoute.projectId,
  ]);

  const href = useCallback(
    (path: string, params: RouteParams = {}) =>
      buildRuntimeScopeUrl(path, params, selector),
    [selector],
  );

  const push = useCallback(
    (path: string, params: RouteParams = {}) => router.push(href(path, params)),
    [router, href],
  );

  const replace = useCallback(
    (path: string, params: RouteParams = {}) =>
      router.replace(href(path, params)),
    [router, href],
  );

  return {
    selector,
    href,
    push,
    replace,
    hasRuntimeScope: hasExplicitRuntimeScopeSelector(selector),
  };
}
