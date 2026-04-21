import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { Path } from '@/utils/enum';
import { SampleDatasetName } from '@/types/dataSource';

import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import { startSampleDataset } from '@/utils/settingsRest';
import { clearRuntimePagePrefetchCache } from '@/utils/runtimePagePrefetch';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';

export default function useSetupConnectionSampleDataset() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const saveSampleDataset = useCallback(
    async (template: SampleDatasetName) => {
      try {
        setLoading(true);
        setError(null);
        await startSampleDataset(runtimeScopeNavigation.selector, template);
        clearRuntimePagePrefetchCache();
        await runtimeScopeNavigation.push(
          Path.Knowledge,
          buildKnowledgeWorkbenchParams('modeling'),
        );
      } catch (error) {
        const normalizedError =
          error instanceof Error
            ? error
            : new Error('导入样例数据失败，请稍后重试');
        setError(normalizedError);
        message.error(
          normalizedError.message || '导入样例数据失败，请稍后重试',
        );
      } finally {
        setLoading(false);
      }
    },
    [runtimeScopeNavigation.push, runtimeScopeNavigation.selector],
  );

  return {
    loading,
    error,
    saveSampleDataset,
  };
}
