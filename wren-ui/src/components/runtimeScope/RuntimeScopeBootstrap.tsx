import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import apolloClient from '@/apollo/client';
import { FlexLoading } from '@/components/PageLoading';
import {
  buildRuntimeScopeBootstrapCandidates,
  buildRuntimeScopeHeaders,
  buildRuntimeScopeSelectorFromRuntimeSelectorState,
  buildRuntimeScopeStateKey,
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
  hasExplicitRuntimeScopeSelector,
  readPersistedRuntimeScopeSelector,
  readRuntimeScopeSelectorFromObject,
  readRuntimeScopeSelectorFromSearch,
  RUNTIME_SCOPE_RECOVERY_EVENT,
  resolveRuntimeScopeBootstrapSelector,
  RuntimeSelectorStateBootstrapData,
  shouldBlockRuntimeScopeBootstrapRender,
  shouldDeferRuntimeScopeUrlSync,
  writePersistedRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import { RUNTIME_SELECTOR_STATE } from '@/apollo/client/graphql/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import { Path } from '@/utils/enum';

interface RuntimeSelectorStateQueryData {
  runtimeSelectorState: RuntimeSelectorStateBootstrapData | null;
}

interface Props {
  children: React.ReactNode;
}

const RUNTIME_SCOPE_BOOTSTRAP_HEADER = 'x-wren-runtime-bootstrap';
const RUNTIME_SCOPE_BOOTSTRAP_FETCH_POLICY = 'no-cache';

export default function RuntimeScopeBootstrap({ children }: Props) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [recoveryNonce, setRecoveryNonce] = useState(0);
  const [selectorToSync, setSelectorToSync] =
    useState<ClientRuntimeScopeSelector | null>(null);
  const authSession = useAuthSession({ includeWorkspaceQuery: false });
  const lastValidatedSelectorKeyRef = useRef<string | null>(null);
  const validatedSelectorKeysRef = useRef<Set<string>>(new Set());
  const isBrowser = mounted;
  const shouldBypassBootstrap =
    router.pathname === Path.Auth || router.pathname === '/_error';
  const hasValidatedRuntimeScope = lastValidatedSelectorKeyRef.current != null;

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectorFromUrl = useMemo(() => {
    const routerSelector = readRuntimeScopeSelectorFromObject(
      router.query as Record<string, string | string[] | undefined>,
    );
    if (hasExplicitRuntimeScopeSelector(routerSelector)) {
      return routerSelector;
    }

    if (!isBrowser) {
      return routerSelector;
    }

    return readRuntimeScopeSelectorFromSearch(window.location.search);
  }, [
    isBrowser,
    router.query.deployHash,
    router.query.kbSnapshotId,
    router.query.knowledgeBaseId,
    router.query.runtimeScopeId,
    router.query.workspaceId,
  ]);
  const selectorFromStored = useMemo(
    () => (mounted ? readPersistedRuntimeScopeSelector() : {}),
    [mounted, recoveryNonce],
  );
  const selectorFromServerDefault = useMemo(() => {
    const runtimeSelector = authSession.data?.runtimeSelector;
    if (runtimeSelector?.workspaceId) {
      return runtimeSelector;
    }

    const defaultWorkspaceId =
      authSession.data?.defaultWorkspaceId ||
      authSession.data?.user?.defaultWorkspaceId;
    if (!defaultWorkspaceId) {
      return {};
    }

    return { workspaceId: defaultWorkspaceId };
  }, [authSession.data]);

  const bootstrapCandidates = useMemo(
    () =>
      buildRuntimeScopeBootstrapCandidates({
        urlSelector: selectorFromUrl,
        storedSelector: selectorFromStored,
        serverDefaultSelector: selectorFromServerDefault,
      }),
    [selectorFromServerDefault, selectorFromStored, selectorFromUrl],
  );
  const urlSelectorKey = useMemo(
    () =>
      hasExplicitRuntimeScopeSelector(selectorFromUrl)
        ? buildRuntimeScopeStateKey(selectorFromUrl)
        : null,
    [selectorFromUrl],
  );
  const storedSelectorKey = useMemo(
    () =>
      hasExplicitRuntimeScopeSelector(selectorFromStored)
        ? buildRuntimeScopeStateKey(selectorFromStored)
        : null,
    [selectorFromStored],
  );

  const nextUrl = useMemo(() => {
    if (!router.isReady || !selectorToSync) {
      return null;
    }

    return buildRuntimeScopeUrl(router.asPath, {}, selectorToSync);
  }, [router.asPath, router.isReady, selectorToSync]);

  useEffect(() => {
    setSyncFailed(false);
  }, [router.asPath]);

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') {
      return;
    }

    const handleRuntimeScopeRecovery = () => {
      writePersistedRuntimeScopeSelector({});
      lastValidatedSelectorKeyRef.current = null;
      validatedSelectorKeysRef.current.clear();
      setSyncFailed(false);
      setSelectorToSync(null);
      setBootstrapLoading(true);
      setRecoveryNonce((value) => value + 1);
    };

    window.addEventListener(
      RUNTIME_SCOPE_RECOVERY_EVENT,
      handleRuntimeScopeRecovery,
    );

    return () => {
      window.removeEventListener(
        RUNTIME_SCOPE_RECOVERY_EVENT,
        handleRuntimeScopeRecovery,
      );
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    if (shouldBypassBootstrap) {
      setBootstrapLoading(false);
      setSelectorToSync(null);
      return;
    }

    if (!router.isReady) {
      setBootstrapLoading(true);
      return;
    }

    if (
      urlSelectorKey &&
      lastValidatedSelectorKeyRef.current &&
      urlSelectorKey === lastValidatedSelectorKeyRef.current
    ) {
      setSelectorToSync(selectorFromUrl);
      setBootstrapLoading(false);
      return;
    }

    if (
      !urlSelectorKey &&
      storedSelectorKey &&
      lastValidatedSelectorKeyRef.current &&
      storedSelectorKey === lastValidatedSelectorKeyRef.current
    ) {
      setSelectorToSync(selectorFromStored);
      setBootstrapLoading(false);
      return;
    }

    let cancelled = false;
    setBootstrapLoading(true);
    setSelectorToSync(null);

    const bootstrapRuntimeScope = async () => {
      for (const candidate of bootstrapCandidates) {
        if (hasExplicitRuntimeScopeSelector(candidate.selector)) {
          const candidateKey = buildRuntimeScopeStateKey(candidate.selector);
          if (validatedSelectorKeysRef.current.has(candidateKey)) {
            writePersistedRuntimeScopeSelector(candidate.selector);
            lastValidatedSelectorKeyRef.current = candidateKey;
            setSelectorToSync(candidate.selector);
            setBootstrapLoading(false);
            return;
          }
        }

        try {
          const { data } =
            await apolloClient.query<RuntimeSelectorStateQueryData>({
              query: RUNTIME_SELECTOR_STATE,
              fetchPolicy: RUNTIME_SCOPE_BOOTSTRAP_FETCH_POLICY,
              context: {
                skipRuntimeScopeHeaders: true,
                headers: {
                  ...buildRuntimeScopeHeaders(candidate.selector),
                  [RUNTIME_SCOPE_BOOTSTRAP_HEADER]: '1',
                },
              },
            });

          if (cancelled) {
            return;
          }

          const selectorFromServer =
            buildRuntimeScopeSelectorFromRuntimeSelectorState(
              data?.runtimeSelectorState,
            );
          const resolvedSelector = resolveRuntimeScopeBootstrapSelector({
            candidate,
            selectorFromServer,
          });

          writePersistedRuntimeScopeSelector(resolvedSelector);
          const resolvedSelectorKey = hasExplicitRuntimeScopeSelector(
            resolvedSelector,
          )
            ? buildRuntimeScopeStateKey(resolvedSelector)
            : null;
          lastValidatedSelectorKeyRef.current = resolvedSelectorKey;
          if (resolvedSelectorKey) {
            validatedSelectorKeysRef.current.add(resolvedSelectorKey);
          }
          setSelectorToSync(resolvedSelector);
          setBootstrapLoading(false);
          return;
        } catch (_error) {
          if (candidate.source === 'stored') {
            writePersistedRuntimeScopeSelector({});
          }
        }
      }

      writePersistedRuntimeScopeSelector({});
      lastValidatedSelectorKeyRef.current = null;

      if (cancelled) {
        return;
      }

      setSelectorToSync({});
      setBootstrapLoading(false);
    };

    bootstrapRuntimeScope();

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapCandidates,
    mounted,
    router.isReady,
    selectorFromStored,
    selectorFromUrl,
    storedSelectorKey,
    shouldBypassBootstrap,
    urlSelectorKey,
    recoveryNonce,
  ]);

  useEffect(() => {
    if (
      !router.isReady ||
      !selectorToSync ||
      syncFailed ||
      shouldDeferRuntimeScopeUrlSync({
        selectorFromUrl,
        selectorToSync,
      })
    ) {
      return;
    }

    if (!nextUrl || nextUrl === router.asPath) {
      return;
    }

    let cancelled = false;
    router
      .replace(nextUrl, undefined, { shallow: true, scroll: false })
      .catch(() => {
        if (!cancelled) {
          setSyncFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    nextUrl,
    router,
    router.asPath,
    router.isReady,
    selectorToSync,
    selectorFromUrl,
    syncFailed,
  ]);

  if (!mounted) {
    return <FlexLoading tip="正在加载工作区..." />;
  }

  if (shouldBypassBootstrap) {
    return <>{children}</>;
  }

  const shouldBlockRender = shouldBlockRuntimeScopeBootstrapRender({
    isBrowser,
    currentUrl: router.asPath,
    nextUrl,
    isBootstrapLoading: bootstrapLoading,
    routerReady: router.isReady,
    syncFailed,
    allowLoadingWhileValidating: hasValidatedRuntimeScope,
  });

  if (shouldBlockRender) {
    return <FlexLoading tip="正在加载工作区..." />;
  }

  return <>{children}</>;
}
