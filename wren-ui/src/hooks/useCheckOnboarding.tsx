import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useOnboardingStatusQuery } from '@/apollo/client/graphql/onboarding.generated';
import { OnboardingStatus } from '@/apollo/client/graphql/__types__';
import { Path } from '@/utils/enum';

const redirectRoute = {
  [OnboardingStatus.DatasourceSaved]: Path.OnboardingModels,
  [OnboardingStatus.NotStarted]: Path.OnboardingConnection,
  [OnboardingStatus.OnboardingFinished]: Path.Home,
  [OnboardingStatus.WithSampleDataset]: Path.Home,
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

      // redirect to new path if onboarding is not completed
      if (newPath && newPath !== Path.Home) {
        // do not redirect if the new path and router pathname are the same
        if (newPath === router.pathname) {
          return;
        }

        router.push(newPath);
        return;
      }

      // redirect to home page if onboarding is completed

      // redirect to the home page when entering the Index page
      if (router.pathname === '/') {
        router.push(newPath);
        return;
      }

      // redirect to home page when entering the onboarding page
      if (router.pathname.startsWith(Path.Onboarding)) {
        router.push(newPath);
      }
    }
  }, [onboardingStatus, router.pathname]);

  return {
    loading,
    onboardingStatus,
  };
};
