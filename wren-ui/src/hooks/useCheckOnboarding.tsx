import { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { OnboardingStatus } from '@/types/project';

import { buildAuthPathWithRedirect } from '@/utils/authRedirect';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useAuthSession from './useAuthSession';
import { fetchOnboardingStatus } from '@/utils/onboardingRest';
import { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  buildKnowledgeWorkbenchParams,
  isKnowledgeModelingRoute,
} from '@/utils/knowledgeWorkbench';
import useRestRequest from './useRestRequest';
import { buildRuntimeScopeStateKey } from '@/runtime/client/runtimeScope';

const redirectRoute: Partial<
  Record<
    OnboardingStatus,
    { path: Path; params?: Record<string, string | number | boolean> }
  >
> = {
  [OnboardingStatus.CONNECTION_SAVED]: { path: Path.OnboardingModels },
  [OnboardingStatus.NOT_STARTED]: { path: Path.OnboardingConnection },
  [OnboardingStatus.ONBOARDING_FINISHED]: {
    path: Path.Knowledge,
    params: buildKnowledgeWorkbenchParams('modeling'),
  },
  [OnboardingStatus.WITH_SAMPLE_DATASET]: {
    path: Path.Knowledge,
    params: buildKnowledgeWorkbenchParams('modeling'),
  },
} as const;

const resolveRedirectParams = (target: {
  path: Path;
  params?: Record<string, string | number | boolean>;
}) =>
  target.path === Path.Knowledge
    ? buildKnowledgeWorkbenchParams('modeling')
    : undefined;

export const buildOnboardingStatusSelector = (
  selector: ClientRuntimeScopeSelector,
): ClientRuntimeScopeSelector => ({
  ...(selector.workspaceId ? { workspaceId: selector.workspaceId } : {}),
  ...(selector.knowledgeBaseId
    ? { knowledgeBaseId: selector.knowledgeBaseId }
    : {}),
  ...(selector.kbSnapshotId ? { kbSnapshotId: selector.kbSnapshotId } : {}),
  ...(selector.deployHash ? { deployHash: selector.deployHash } : {}),
  ...(selector.runtimeScopeId
    ? { runtimeScopeId: selector.runtimeScopeId }
    : {}),
});

const useOnboardingStatusState = ({ skip }: { skip: boolean }) => {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const onboardingSelector = useMemo(
    () => buildOnboardingStatusSelector(runtimeScopeNavigation.selector),
    [
      runtimeScopeNavigation.selector.workspaceId,
      runtimeScopeNavigation.selector.knowledgeBaseId,
      runtimeScopeNavigation.selector.kbSnapshotId,
      runtimeScopeNavigation.selector.deployHash,
      runtimeScopeNavigation.selector.runtimeScopeId,
    ],
  );
  const requestKey = useMemo(
    () =>
      skip || Object.keys(onboardingSelector).length === 0
        ? null
        : buildRuntimeScopeStateKey(onboardingSelector),
    [onboardingSelector, skip],
  );

  const {
    data: onboardingStatus,
    loading,
    error,
    refetch: refetchStatus,
  } = useRestRequest<OnboardingStatus | undefined>({
    enabled: !skip,
    auto: !skip,
    initialData: undefined,
    requestKey,
    request: ({ signal }) =>
      fetchOnboardingStatus(onboardingSelector, { signal }).then(
        (payload) => payload.status ?? undefined,
      ),
  });

  const refetch = useCallback(async () => {
    const status = await refetchStatus();
    return { status };
  }, [refetchStatus]);

  return {
    loading,
    error,
    refetch,
    onboardingStatus,
  };
};

export const useWithOnboarding = () => {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const pushRuntimeScope = runtimeScopeNavigation.push;
  const authSession = useAuthSession();
  const { onboardingStatus, loading } = useOnboardingStatusState({
    skip: !authSession.authenticated,
  });

  useEffect(() => {
    if (!router.isReady || authSession.loading) {
      return;
    }

    if (!authSession.authenticated) {
      router
        .replace(buildAuthPathWithRedirect(router.asPath))
        .catch(() => null);
    }
  }, [authSession.authenticated, authSession.loading, router, router.isReady]);

  useEffect(() => {
    if (!authSession.authenticated) {
      return;
    }

    if (onboardingStatus) {
      const target = redirectRoute[onboardingStatus];
      const pathname = router.pathname;

      if (!target) {
        return;
      }

      const isCurrentTarget =
        target.path === Path.Knowledge
          ? isKnowledgeModelingRoute({ pathname, query: router.query })
          : pathname === target.path;

      if (target.path !== Path.Knowledge) {
        if (isCurrentTarget) {
          return;
        }

        if (
          router.pathname.startsWith(Path.Onboarding) &&
          onboardingStatus !== OnboardingStatus.ONBOARDING_FINISHED
        ) {
          return;
        }

        pushRuntimeScope(target.path, resolveRedirectParams(target));
        return;
      }

      if (pathname === '/') {
        pushRuntimeScope(target.path, resolveRedirectParams(target));
        return;
      }

      if (pathname.startsWith(Path.Onboarding)) {
        return;
      }

      if (!isCurrentTarget) {
        pushRuntimeScope(target.path, resolveRedirectParams(target));
      }
    }
  }, [
    authSession.authenticated,
    onboardingStatus,
    pushRuntimeScope,
    router.pathname,
    router.query,
  ]);

  return {
    loading: authSession.loading || loading,
    onboardingStatus,
    authenticated: authSession.authenticated,
  };
};

export default function useOnboardingStatus() {
  return useOnboardingStatusState({ skip: false });
}
