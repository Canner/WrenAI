import { useState } from 'react';
import { Path, SETUP } from '@/utils/enum';
import {
  useListDataSourceTablesQuery,
  useSaveTablesMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

export default function useSetupModels() {
  const [stepKey] = useState(SETUP.SELECT_MODELS);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const { data, loading: fetching } = useListDataSourceTablesQuery({
    fetchPolicy: 'no-cache',
    onError: (error) => console.error(error),
  });

  // Handle errors via try/catch blocks rather than onError callback
  const [saveTablesMutation, { loading: submitting }] = useSaveTablesMutation();

  const submitModels = async (tables: string[]) => {
    try {
      await saveTablesMutation({
        variables: {
          data: { tables },
        },
      });
      runtimeScopeNavigation.push(Path.OnboardingRelationships);
    } catch (error) {
      console.error(error);
    }
  };

  const onBack = () => {
    runtimeScopeNavigation.push(Path.OnboardingConnection);
  };

  const onNext = (data: { selectedTables: string[] }) => {
    submitModels(data.selectedTables);
  };

  return {
    submitting,
    fetching,
    stepKey,
    onBack,
    onNext,
    tables: data?.listDataSourceTables || [],
  };
}
