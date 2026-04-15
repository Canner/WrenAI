import { useEffect, useState } from 'react';
import { message } from 'antd';
import { Path, SETUP } from '@/utils/enum';
import type { ListDataSourceTablesQuery } from '@/apollo/client/graphql/dataSource.generated';
import { listDataSourceTables, saveSetupTables } from '@/utils/modelingRest';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

export default function useSetupModels() {
  const [stepKey] = useState(SETUP.SELECT_MODELS);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [tables, setTables] = useState<
    ListDataSourceTablesQuery['listDataSourceTables']
  >([]);
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    void listDataSourceTables(runtimeScopeNavigation.selector)
      .then((nextTables) => {
        if (!cancelled) {
          setTables(nextTables || []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          message.error(error.message || '加载数据表失败，请稍后重试');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFetching(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeScopeNavigation.selector]);

  const submitModels = async (tables: string[]) => {
    try {
      setSubmitting(true);
      await saveSetupTables(runtimeScopeNavigation.selector, tables);
      runtimeScopeNavigation.push(Path.OnboardingRelationships);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '保存模型失败，请稍后重试',
      );
    } finally {
      setSubmitting(false);
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
    tables,
  };
}
