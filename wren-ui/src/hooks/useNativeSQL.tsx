import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataSourceName } from '@/types/dataSource';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

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
function useNativeSQLInfo(
  runtimeScopeSelectorOverride?: ClientRuntimeScopeSelector,
) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopeSelector = useMemo(
    () => ({
      workspaceId:
        runtimeScopeSelectorOverride?.workspaceId ||
        runtimeScopeNavigation.selector.workspaceId,
      knowledgeBaseId:
        runtimeScopeSelectorOverride?.knowledgeBaseId ||
        runtimeScopeNavigation.selector.knowledgeBaseId,
      kbSnapshotId:
        runtimeScopeSelectorOverride?.kbSnapshotId ||
        runtimeScopeNavigation.selector.kbSnapshotId,
      deployHash:
        runtimeScopeSelectorOverride?.deployHash ||
        runtimeScopeNavigation.selector.deployHash,
      runtimeScopeId:
        runtimeScopeSelectorOverride?.runtimeScopeId ||
        runtimeScopeNavigation.selector.runtimeScopeId,
    }),
    [
      runtimeScopeNavigation.selector.deployHash,
      runtimeScopeNavigation.selector.kbSnapshotId,
      runtimeScopeNavigation.selector.knowledgeBaseId,
      runtimeScopeNavigation.selector.runtimeScopeId,
      runtimeScopeNavigation.selector.workspaceId,
      runtimeScopeSelectorOverride?.deployHash,
      runtimeScopeSelectorOverride?.kbSnapshotId,
      runtimeScopeSelectorOverride?.knowledgeBaseId,
      runtimeScopeSelectorOverride?.runtimeScopeId,
      runtimeScopeSelectorOverride?.workspaceId,
    ],
  );
  const [connectionType, setConnectionType] = useState<DataSourceName>();
  const [sampleDataset, setSampleDataset] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;

    if (!hasExecutableRuntimeScopeSelector(runtimeScopeSelector)) {
      setConnectionType(undefined);
      setSampleDataset(undefined);
      return () => {
        cancelled = true;
      };
    }

    void fetchSettings(runtimeScopeSelector)
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
  }, [runtimeScopeSelector]);

  return {
    hasNativeSQL: !Boolean(sampleDataset),
    connectionType,
  };
}

export default function useNativeSQL(
  runtimeScopeSelectorOverride?: ClientRuntimeScopeSelector,
) {
  const nativeSQLInfo = useNativeSQLInfo(runtimeScopeSelectorOverride);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopeSelector = useMemo(
    () => ({
      workspaceId:
        runtimeScopeSelectorOverride?.workspaceId ||
        runtimeScopeNavigation.selector.workspaceId,
      knowledgeBaseId:
        runtimeScopeSelectorOverride?.knowledgeBaseId ||
        runtimeScopeNavigation.selector.knowledgeBaseId,
      kbSnapshotId:
        runtimeScopeSelectorOverride?.kbSnapshotId ||
        runtimeScopeNavigation.selector.kbSnapshotId,
      deployHash:
        runtimeScopeSelectorOverride?.deployHash ||
        runtimeScopeNavigation.selector.deployHash,
      runtimeScopeId:
        runtimeScopeSelectorOverride?.runtimeScopeId ||
        runtimeScopeNavigation.selector.runtimeScopeId,
    }),
    [
      runtimeScopeNavigation.selector.deployHash,
      runtimeScopeNavigation.selector.kbSnapshotId,
      runtimeScopeNavigation.selector.knowledgeBaseId,
      runtimeScopeNavigation.selector.runtimeScopeId,
      runtimeScopeNavigation.selector.workspaceId,
      runtimeScopeSelectorOverride?.deployHash,
      runtimeScopeSelectorOverride?.kbSnapshotId,
      runtimeScopeSelectorOverride?.knowledgeBaseId,
      runtimeScopeSelectorOverride?.runtimeScopeId,
      runtimeScopeSelectorOverride?.workspaceId,
    ],
  );
  const hasExecutableRuntime =
    hasExecutableRuntimeScopeSelector(runtimeScopeSelector);

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
          runtimeScopeSelector,
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
    [hasExecutableRuntime, runtimeScopeSelector],
  );

  return {
    fetchNativeSQL,
    nativeSQLResult,
  };
}
