import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useOnboardingStatusQuery } from '@/apollo/client/graphql/onboarding.generated';
import { OnboardingStatus } from '@/apollo/client/graphql/__types__';
import { Path } from '@/utils/enum';

const redirectRoute = {
  [OnboardingStatus.DATASOURCE_SAVED]: Path.OnboardingModels,
  [OnboardingStatus.NOT_STARTED]: Path.OnboardingConnection,
  [OnboardingStatus.ONBOARDING_FINISHED]: Path.Home,
  [OnboardingStatus.WITH_SAMPLE_DATASET]: Path.Home,
};

export const useWithOnboarding = () => {
  const router = useRouter();
  const { data, loading, refetch } = useOnboardingStatusQuery();

  const onboardingStatus = data?.onboardingStatus?.status;

  useEffect(() => {
    // do not refetch onboarding status when onboarding page
    if (router.pathname.startsWith(Path.Onboarding)) {
      return;
    }

    // refetch onboarding status when the route changes
    refetch();
  }, [router.pathname]);

  useEffect(() => {
    if (onboardingStatus) {
      const newPath = redirectRoute[onboardingStatus];
      const pathname = router.pathname;

      // redirect to new path if onboarding is not completed
      if (newPath && newPath !== Path.Home) {
        // do not redirect if the new path and router pathname are the same
        if (newPath === pathname) {
          return;
        }

        // allow return back to previous steps
        if (
          router.pathname.startsWith(Path.Onboarding) &&
          onboardingStatus !== OnboardingStatus.ONBOARDING_FINISHED
        ) {
          return;
        }

        router.push(newPath);
        return;
      }

      // redirect to home page if onboarding is completed

      // redirect to the home page when entering the Index page
      if (pathname === '/') {
        router.push(newPath);
        return;
      }

      // redirect to home page since user using sample dataset
      if (
        pathname === Path.OnboardingRelationships &&
        onboardingStatus === OnboardingStatus.WITH_SAMPLE_DATASET
      ) {
        router.push(newPath);
        return;
      }

      // redirect to home page when entering the connection page or select models page
      if (
        [Path.OnboardingConnection, Path.OnboardingModels].includes(
          pathname as Path,
        )
      ) {
        router.push(newPath);
        return;
      }
    }
  }, [onboardingStatus, router.pathname]);

  return {
    loading,
    onboardingStatus,
  };
};
