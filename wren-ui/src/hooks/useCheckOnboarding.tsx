import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { OnboardingStatus } from '@/types/api';
import { buildAuthPathWithRedirect } from '@/utils/authRedirect';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useAuthSession from './useAuthSession';
import { fetchOnboardingStatus } from '@/utils/onboardingRest';

const redirectRoute = {
  [OnboardingStatus.DATASOURCE_SAVED]: Path.OnboardingModels,
  [OnboardingStatus.NOT_STARTED]: Path.OnboardingConnection,
  [OnboardingStatus.ONBOARDING_FINISHED]: Path.Modeling,
  [OnboardingStatus.WITH_SAMPLE_DATASET]: Path.Modeling,
};

const useOnboardingStatusState = ({ skip }: { skip: boolean }) => {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [onboardingStatus, setOnboardingStatus] = useState<
    OnboardingStatus | undefined
  >(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (skip) {
      setOnboardingStatus(undefined);
      setError(null);
      setLoading(false);
      return { status: undefined };
    }

    setLoading(true);
    try {
      const payload = await fetchOnboardingStatus(
        runtimeScopeNavigation.selector,
      );
      const status = payload.status || undefined;
      setOnboardingStatus(status);
      setError(null);
      return { status };
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error('加载引导状态失败，请稍后重试。');
      setError(normalizedError);
      throw normalizedError;
    } finally {
      setLoading(false);
    }
  }, [runtimeScopeNavigation.selector, skip]);

  useEffect(() => {
    if (skip) {
      setOnboardingStatus(undefined);
      setError(null);
      setLoading(false);
      return;
    }

    void refetch().catch(() => null);
  }, [refetch, skip]);

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
      const newPath = redirectRoute[onboardingStatus];
      const pathname = router.pathname;

      if (newPath && newPath !== Path.Modeling) {
        if (newPath === pathname) {
          return;
        }

        if (
          router.pathname.startsWith(Path.Onboarding) &&
          onboardingStatus !== OnboardingStatus.ONBOARDING_FINISHED
        ) {
          return;
        }

        runtimeScopeNavigation.push(newPath);
        return;
      }

      if (pathname === '/') {
        runtimeScopeNavigation.push(newPath);
        return;
      }

      if (pathname.startsWith(Path.Onboarding)) {
        return;
      }
    }
  }, [
    authSession.authenticated,
    onboardingStatus,
    router.pathname,
    runtimeScopeNavigation,
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
