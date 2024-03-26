import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useOnboardingStatusQuery } from '@/apollo/client/graphql/onboarding.generated';
import { OnboardingStatus } from '@/apollo/client/graphql/__types__';
import { Path } from '@/utils/enum';

const redirectRoute = {
  [OnboardingStatus.DatasourceSaved]: '/setup/models',
  [OnboardingStatus.NotStarted]: '/setup/connection',
  [OnboardingStatus.OnboardingFinished]: '',
  [OnboardingStatus.WithSampleDataset]: '',
};

export const useWithOnboarding = () => {
  const router = useRouter();
  const { data, loading } = useOnboardingStatusQuery({
    fetchPolicy: 'network-only',
  });
  const onboardingStatus = data?.onboardingStatus?.status;

  useEffect(() => {
    if (onboardingStatus) {
      const newPath = redirectRoute[onboardingStatus];

      if (newPath) {
        router.push(newPath);
        return;
      }

      // for Index page
      if (router.pathname === '/') {
        router.push(Path.Home);
        return;
      }
    }
  }, [onboardingStatus, router]);

  return {
    loading,
    onboardingStatus,
  };
};
