import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { buildAuthPathWithRedirect } from '@/utils/authRedirect';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useAuthSession from './useAuthSession';

export const resolveProtectedRuntimeScopeRedirect = ({
  routerReady,
  authLoading,
  authenticated,
  hasRuntimeScope,
}: {
  routerReady: boolean;
  authLoading: boolean;
  authenticated: boolean;
  hasRuntimeScope: boolean;
}) => {
  if (!routerReady || authLoading) {
    return null;
  }

  if (!authenticated) {
    return Path.Auth;
  }

  if (!hasRuntimeScope) {
    return Path.OnboardingConnection;
  }

  return null;
};

export default function useProtectedRuntimeScopePage() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession({ includeWorkspaceQuery: false });
  const redirectPath = resolveProtectedRuntimeScopeRedirect({
    routerReady: router.isReady,
    authLoading: authSession.loading,
    authenticated: authSession.authenticated,
    hasRuntimeScope: runtimeScopeNavigation.hasRuntimeScope,
  });
  const guarding =
    !router.isReady ||
    authSession.loading ||
    !authSession.authenticated ||
    !runtimeScopeNavigation.hasRuntimeScope;

  useEffect(() => {
    if (!redirectPath) {
      return;
    }

    if (redirectPath === Path.Auth) {
      router
        .replace(buildAuthPathWithRedirect(router.asPath))
        .catch(() => null);
      return;
    }

    runtimeScopeNavigation.replace(redirectPath);
  }, [redirectPath, router, runtimeScopeNavigation.replace]);

  return {
    guarding,
    hasRuntimeScope: runtimeScopeNavigation.hasRuntimeScope,
    authenticated: authSession.authenticated,
  };
}
