import { useCallback, useEffect, useState } from 'react';
import { DataSourceName } from '@/types/api';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import { fetchSettings } from '@/utils/settingsRest';
import { getThreadResponseNativeSql } from '@/utils/homeRest';

export interface NativeSQLResult {
  data: string;
  dataSourceType?: DataSourceName;
  hasNativeSQL: boolean;
  loading: boolean;
  nativeSQLMode: boolean;
  setNativeSQLMode: (value: boolean) => void;
}

// we assume that not having a sample dataset means supporting native SQL
function useNativeSQLInfo() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [dataSourceType, setDataSourceType] = useState<DataSourceName>();
  const [sampleDataset, setSampleDataset] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;

    void fetchSettings(runtimeScopeNavigation.selector)
      .then((settings) => {
        if (cancelled) {
          return;
        }

        setDataSourceType(settings?.dataSource?.type || undefined);
        setSampleDataset(settings?.dataSource?.sampleDataset || null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setDataSourceType(undefined);
        setSampleDataset(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeScopeNavigation.selector]);

  return {
    hasNativeSQL: !Boolean(sampleDataset),
    dataSourceType,
  };
}

export default function useNativeSQL() {
  const nativeSQLInfo = useNativeSQLInfo();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

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
    [runtimeScopeNavigation.selector],
  );

  return {
    fetchNativeSQL,
    nativeSQLResult,
  };
}
