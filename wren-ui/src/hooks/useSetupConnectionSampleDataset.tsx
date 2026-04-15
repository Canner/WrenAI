import { useCallback, useState } from 'react';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import { startSampleDataset } from '@/utils/settingsRest';
import { clearRuntimePagePrefetchCache } from '@/utils/runtimePagePrefetch';

export default function useSetupConnectionSampleDataset() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const saveSampleDataset = useCallback(
    async (template: SampleDatasetName) => {
      try {
        setLoading(true);
        setError(null);
        const data = await startSampleDataset(
          runtimeScopeNavigation.selector,
          template,
        );
        clearRuntimePagePrefetchCache();
        const runtimeScopeId = data?.runtimeScopeId;
        if (runtimeScopeId) {
          await runtimeScopeNavigation.push(Path.Modeling, { runtimeScopeId });
          return;
        }

        await runtimeScopeNavigation.push(Path.Modeling);
      } catch (error) {
        const normalizedError =
          error instanceof Error
            ? error
            : new Error('导入样例数据失败，请稍后重试');
        setError(normalizedError);
        message.error(normalizedError.message || '导入样例数据失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [runtimeScopeNavigation],
  );

  return {
    loading,
    error,
    saveSampleDataset,
  };
}
