import { useCallback } from 'react';
import { Path } from '@/utils/enum';
import { ONBOARDING_STATUS } from '@/apollo/client/graphql/onboarding';
import { useStartSampleDatasetMutation } from '@/apollo/client/graphql/dataSource.generated';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

export default function useSetupConnectionSampleDataset() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const [startSampleDatasetMutation, { loading, error }] =
    useStartSampleDatasetMutation({
      onError: (error) => console.error(error),
      onCompleted: () => runtimeScopeNavigation.push(Path.Modeling),
      refetchQueries: [{ query: ONBOARDING_STATUS }],
      awaitRefetchQueries: true,
    });

  const saveSampleDataset = useCallback(
    async (template: SampleDatasetName) => {
      await startSampleDatasetMutation({
        variables: { data: { name: template } },
      });
    },
    [startSampleDatasetMutation],
  );

  return {
    loading,
    error,
    saveSampleDataset,
  };
}
