import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlexLoading } from '@/components/PageLoading';
import {
  buildRuntimeScopeBootstrapCandidates,
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
  shouldSkipRuntimeScopeUrlExpansion,
  shouldAcceptRuntimeScopeBootstrapCandidate,
  shouldBlockRuntimeScopeBootstrapRender,
  shouldDeferRuntimeScopeUrlSync,
  writePersistedRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import {
  buildRuntimeSelectorStateUrl,
  fetchRuntimeSelectorState,
  peekRuntimeSelectorStatePayload,
} from '@/hooks/runtimeSelectorStateRequest';
import { isAbortRequestError } from '@/utils/abort';
import { Path } from '@/utils/enum';

interface Props {
  children: React.ReactNode;
}

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

  const nextUrl = useMemo(() => {
    if (
      !router.isReady ||
      !selectorToSync ||
      shouldSkipRuntimeScopeUrlExpansion({
        pathname: router.pathname,
        selectorFromUrl,
        selectorToSync,
      })
    ) {
      return null;
    }

    return buildRuntimeScopeUrl(router.asPath, {}, selectorToSync);
  }, [
    router.asPath,
    router.isReady,
    router.pathname,
    selectorFromUrl,
    selectorToSync,
  ]);

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

    let cancelled = false;
    const abortController = new AbortController();
    setBootstrapLoading(true);
    setSelectorToSync(null);

    const bootstrapRuntimeScope = async () => {
      const latestSelectorFromUrl = (() => {
        const routerSelector = readRuntimeScopeSelectorFromObject(
          router.query as Record<string, string | string[] | undefined>,
        );

        if (hasExplicitRuntimeScopeSelector(routerSelector)) {
          return routerSelector;
        }

        if (typeof window !== 'undefined') {
          return readRuntimeScopeSelectorFromSearch(window.location.search);
        }

        return routerSelector;
      })();
      const latestSelectorFromStored = readPersistedRuntimeScopeSelector();
      const latestBootstrapCandidates = buildRuntimeScopeBootstrapCandidates({
        urlSelector: latestSelectorFromUrl,
        storedSelector: latestSelectorFromStored,
        serverDefaultSelector: selectorFromServerDefault,
      });
      const latestUrlSelectorKey = hasExplicitRuntimeScopeSelector(
        latestSelectorFromUrl,
      )
        ? buildRuntimeScopeStateKey(latestSelectorFromUrl)
        : null;
      const latestStoredSelectorKey = hasExplicitRuntimeScopeSelector(
        latestSelectorFromStored,
      )
        ? buildRuntimeScopeStateKey(latestSelectorFromStored)
        : null;

      if (
        latestUrlSelectorKey &&
        lastValidatedSelectorKeyRef.current &&
        latestUrlSelectorKey === lastValidatedSelectorKeyRef.current
      ) {
        setSelectorToSync(latestSelectorFromUrl);
        setBootstrapLoading(false);
        return;
      }

      if (
        !latestUrlSelectorKey &&
        latestStoredSelectorKey &&
        lastValidatedSelectorKeyRef.current &&
        latestStoredSelectorKey === lastValidatedSelectorKeyRef.current
      ) {
        setSelectorToSync(latestSelectorFromStored);
        setBootstrapLoading(false);
        return;
      }

      for (const candidate of latestBootstrapCandidates) {
        if (cancelled || abortController.signal.aborted) {
          return;
        }

        const requestUrl = buildRuntimeSelectorStateUrl(candidate.selector);

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
          const cachedRuntimeSelectorState = peekRuntimeSelectorStatePayload({
            requestUrl,
          });
          const runtimeSelectorState =
            cachedRuntimeSelectorState ||
            (await fetchRuntimeSelectorState({
              requestUrl,
              signal: abortController.signal,
            }));
          if (cancelled) {
            return;
          }

          const selectorFromServer =
            buildRuntimeScopeSelectorFromRuntimeSelectorState(
              runtimeSelectorState,
            );

          if (
            !shouldAcceptRuntimeScopeBootstrapCandidate({
              candidate,
              selectorFromServer,
            })
          ) {
            if (candidate.source === 'stored') {
              writePersistedRuntimeScopeSelector({});
            }
            continue;
          }

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
          if (
            cancelled ||
            abortController.signal.aborted ||
            isAbortRequestError(_error)
          ) {
            return;
          }

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
      abortController.abort();
    };
  }, [
    mounted,
    router.isReady,
    shouldBypassBootstrap,
    selectorFromServerDefault,
    router.query.deployHash,
    router.query.kbSnapshotId,
    router.query.knowledgeBaseId,
    router.query.runtimeScopeId,
    router.query.workspaceId,
    recoveryNonce,
  ]);

  useEffect(() => {
    if (
      !router.isReady ||
      !selectorToSync ||
      syncFailed ||
      shouldDeferRuntimeScopeUrlSync({
        isBootstrapLoading: bootstrapLoading,
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
    bootstrapLoading,
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
