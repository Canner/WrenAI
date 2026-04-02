import { useEffect } from 'react';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

export default function useProtectedRuntimeScopePage() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const guarding = !runtimeScopeNavigation.hasRuntimeScope;

  useEffect(() => {
    if (!guarding) {
      return;
    }

    runtimeScopeNavigation.replace(Path.OnboardingConnection);
  }, [guarding, runtimeScopeNavigation.replace]);

  return {
    guarding,
    hasRuntimeScope: runtimeScopeNavigation.hasRuntimeScope,
  };
}
