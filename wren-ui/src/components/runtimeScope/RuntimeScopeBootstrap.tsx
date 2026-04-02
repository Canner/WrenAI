import { useQuery } from '@apollo/client';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { FlexLoading } from '@/components/PageLoading';
import {
  buildRuntimeScopeSelectorFromRuntimeSelectorState,
  buildRuntimeScopeUrl,
  hasExplicitRuntimeScopeSelector,
  readRuntimeScopeSelectorFromUrl,
  resolveClientRuntimeScopeSelector,
  RuntimeSelectorStateBootstrapData,
  shouldBlockRuntimeScopeBootstrapRender,
} from '@/apollo/client/runtimeScope';
import { RUNTIME_SELECTOR_STATE } from '@/apollo/client/graphql/runtimeScope';

interface RuntimeSelectorStateQueryData {
  runtimeSelectorState: RuntimeSelectorStateBootstrapData | null;
}

interface Props {
  children: React.ReactNode;
}

export default function RuntimeScopeBootstrap({ children }: Props) {
  const router = useRouter();
  const [syncFailed, setSyncFailed] = useState(false);
  const isBrowser = typeof window !== 'undefined';

  const selectorFromUrl = useMemo(
    () => readRuntimeScopeSelectorFromUrl(router.asPath),
    [router.asPath],
  );
  const hasUrlSelector = hasExplicitRuntimeScopeSelector(selectorFromUrl);

  const selectorFromClient = useMemo(
    () => resolveClientRuntimeScopeSelector(),
    [router.asPath],
  );
  const hasClientSelector = hasExplicitRuntimeScopeSelector(selectorFromClient);

  const shouldBootstrapFromServer =
    isBrowser && router.isReady && !hasUrlSelector && !hasClientSelector;

  const { data, loading } = useQuery<RuntimeSelectorStateQueryData>(
    RUNTIME_SELECTOR_STATE,
    {
      skip: !shouldBootstrapFromServer,
      fetchPolicy: 'no-cache',
      nextFetchPolicy: 'no-cache',
      errorPolicy: 'all',
    },
  );

  const selectorFromServer = useMemo(
    () =>
      buildRuntimeScopeSelectorFromRuntimeSelectorState(
        data?.runtimeSelectorState,
      ),
    [data],
  );

  const selectorToSync = useMemo(() => {
    if (hasUrlSelector) {
      return null;
    }

    if (hasClientSelector) {
      return selectorFromClient;
    }

    if (hasExplicitRuntimeScopeSelector(selectorFromServer)) {
      return selectorFromServer;
    }

    return null;
  }, [hasClientSelector, hasUrlSelector, selectorFromClient, selectorFromServer]);

  useEffect(() => {
    setSyncFailed(false);
  }, [router.asPath]);

  useEffect(() => {
    if (!router.isReady || !selectorToSync || syncFailed) {
      return;
    }

    const nextUrl = buildRuntimeScopeUrl(router.asPath, {}, selectorToSync);
    if (!nextUrl || nextUrl === router.asPath) {
      return;
    }

    let cancelled = false;
    router.replace(nextUrl).catch(() => {
      if (!cancelled) {
        setSyncFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router, router.asPath, router.isReady, selectorToSync, syncFailed]);

  const shouldBlockRender = shouldBlockRuntimeScopeBootstrapRender({
    hasUrlSelector,
    isBrowser,
    isServerBootstrapLoading: shouldBootstrapFromServer && loading,
    routerReady: router.isReady,
    selectorToSync,
    syncFailed,
  });

  if (shouldBlockRender) {
    return <FlexLoading tip="Loading workspace..." />;
  }

  return <>{children}</>;
}
