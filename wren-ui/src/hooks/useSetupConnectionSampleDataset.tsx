import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { Path } from '@/utils/enum';
import { ONBOARDING_STATUS } from '@/apollo/client/graphql/onboarding';
import { useStartSampleDatasetMutation } from '@/apollo/client/graphql/dataSource.generated';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';

export default function useSetupConnectionSampleDataset() {
  const router = useRouter();

  const [startSampleDatasetMutation, { loading, error }] =
    useStartSampleDatasetMutation({
      onError: (error) => console.error(error),
      onCompleted: () => router.push(Path.Modeling),
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
