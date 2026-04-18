import { useCallback, useEffect, useState } from 'react';
import { DataSourceName } from '@/types/dataSource';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import { fetchSettings, resolveSettingsConnection } from '@/utils/settingsRest';
import { getThreadResponseNativeSql } from '@/utils/homeRest';

export interface NativeSQLResult {
  data: string;
  connectionType?: DataSourceName;
  hasNativeSQL: boolean;
  loading: boolean;
  nativeSQLMode: boolean;
  setNativeSQLMode: (value: boolean) => void;
}

// we assume that not having a sample dataset means supporting native SQL
function useNativeSQLInfo() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [connectionType, setConnectionType] = useState<DataSourceName>();
  const [sampleDataset, setSampleDataset] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;

    if (!hasExecutableRuntimeScopeSelector(runtimeScopeNavigation.selector)) {
      setConnectionType(undefined);
      setSampleDataset(undefined);
      return () => {
        cancelled = true;
      };
    }

    void fetchSettings(runtimeScopeNavigation.selector)
      .then((settings) => {
        if (cancelled) {
          return;
        }

        const connection = resolveSettingsConnection(settings);
        setConnectionType(connection?.type || undefined);
        setSampleDataset(connection?.sampleDataset || null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setConnectionType(undefined);
        setSampleDataset(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeScopeNavigation.selector]);

  return {
    hasNativeSQL: !Boolean(sampleDataset),
    connectionType,
  };
}

export default function useNativeSQL() {
  const nativeSQLInfo = useNativeSQLInfo();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const hasExecutableRuntime = hasExecutableRuntimeScopeSelector(
    runtimeScopeNavigation.selector,
  );

  const [nativeSQLMode, setNativeSQLMode] = useState<boolean>(false);
  const [data, setData] = useState('');
  const [loading, setLoading] = useState(false);

  const nativeSQLResult: NativeSQLResult = {
    ...nativeSQLInfo,
    data,
    loading,
    nativeSQLMode,
    setNativeSQLMode,
  };

  const fetchNativeSQL = useCallback(
    async (options: { variables: { responseId: number } }) => {
      const responseId = options?.variables?.responseId;
      if (!Number.isFinite(responseId)) {
        return { data: { nativeSql: '' } };
      }

      if (!hasExecutableRuntime) {
        setData('');
        return { data: { nativeSql: '' } };
      }

      setLoading(true);
      try {
        const nativeSql = await getThreadResponseNativeSql(
          runtimeScopeNavigation.selector,
          responseId,
        );
        setData(nativeSql);
        return {
          data: {
            nativeSql,
          },
        };
      } finally {
        setLoading(false);
      }
    },
    [hasExecutableRuntime, runtimeScopeNavigation.selector],
  );

  return {
    fetchNativeSQL,
    nativeSQLResult,
  };
}
