import { useState } from 'react';
import { message } from 'antd';
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
    onError: (error) =>
      message.error(error.message || '加载数据表失败，请稍后重试'),
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
      message.error(
        error instanceof Error ? error.message : '保存模型失败，请稍后重试',
      );
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
