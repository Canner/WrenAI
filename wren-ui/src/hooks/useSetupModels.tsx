import { useEffect, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path, SETUP } from '@/utils/enum';
import type { ConnectionTablesResult } from '@/types/dataSource';

import { listConnectionTables, saveSetupTables } from '@/utils/modelingRest';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

export default function useSetupModels() {
  const [stepKey] = useState(SETUP.SELECT_MODELS);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [tables, setTables] = useState<ConnectionTablesResult>([]);
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!hasExecutableRuntimeScopeSelector(runtimeScopeNavigation.selector)) {
      setTables([]);
      setFetching(false);
      return;
    }

    let cancelled = false;
    setFetching(true);
    void listConnectionTables(runtimeScopeNavigation.selector)
      .then((nextTables) => {
        if (!cancelled) {
          setTables(nextTables || []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const errorMessage = resolveAbortSafeErrorMessage(
            error,
            '加载数据表失败，请稍后重试',
          );
          if (errorMessage) {
            message.error(errorMessage);
          }
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
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存模型失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
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
