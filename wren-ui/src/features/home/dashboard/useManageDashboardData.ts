import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataSourceName } from '@/types/dataSource';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  loadDashboardDetailPayload,
  loadDashboardListPayload,
  peekDashboardDetailPayload,
  peekDashboardListPayload,
  primeDashboardDetailPayload,
  type DashboardDetailData,
  type DashboardListItem,
} from '@/utils/dashboardRest';
import type { KnowledgeConnectionSettings } from '@/utils/settingsRest';

const normalizeDashboardError = (error: unknown, fallbackMessage: string) =>
  error instanceof Error ? error : new Error(fallbackMessage);

export const isSupportCachedSettings = (
  connection?: KnowledgeConnectionSettings | null,
) => {
  if (!connection) {
    return false;
  }

  return !connection.sampleDataset && connection.type !== DataSourceName.DUCKDB;
};

export const useDashboardListData = ({
  enabled,
  selector,
  onError,
}: {
  enabled: boolean;
  selector: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) => {
  const initialData = useMemo(() => {
    if (!enabled) {
      return [] as DashboardListItem[];
    }

    return peekDashboardListPayload({ selector }) || [];
  }, [
    enabled,
    selector.deployHash,
    selector.kbSnapshotId,
    selector.knowledgeBaseId,
    selector.runtimeScopeId,
    selector.workspaceId,
  ]);
  const [data, setData] = useState<DashboardListItem[]>(initialData);
  const [loading, setLoading] = useState(
    Boolean(enabled && initialData.length === 0),
  );

  useEffect(() => {
    setData(initialData);
    setLoading(Boolean(enabled && initialData.length === 0));
  }, [enabled, initialData]);

  const refetch = useCallback(
    async ({ useCache = false }: { useCache?: boolean } = {}) => {
      if (!enabled) {
        setData([]);
        setLoading(false);
        return [] as DashboardListItem[];
      }

      setLoading(true);

      try {
        const payload = await loadDashboardListPayload({ selector, useCache });
        setData(payload);
        return payload;
      } catch (error) {
        const normalizedError = normalizeDashboardError(
          error,
          '加载看板列表失败。',
        );
        onError?.(normalizedError);
        throw normalizedError;
      } finally {
        setLoading(false);
      }
    },
    [enabled, onError, selector],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refetch({ useCache: true }).catch(() => null);
  }, [enabled, refetch]);

  return { data, loading, refetch };
};

export const useDashboardDetailData = ({
  dashboardId,
  enabled,
  selector,
  onError,
}: {
  dashboardId?: number | null;
  enabled: boolean;
  selector: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) => {
  const initialData = useMemo(() => {
    if (!enabled || dashboardId == null) {
      return null;
    }

    return peekDashboardDetailPayload({ selector, dashboardId });
  }, [
    dashboardId,
    enabled,
    selector.deployHash,
    selector.kbSnapshotId,
    selector.knowledgeBaseId,
    selector.runtimeScopeId,
    selector.workspaceId,
  ]);
  const [data, setData] = useState<DashboardDetailData | null>(initialData);
  const [loading, setLoading] = useState(
    Boolean(enabled && dashboardId != null && !initialData),
  );

  useEffect(() => {
    setData(initialData);
    setLoading(Boolean(enabled && dashboardId != null && !initialData));
  }, [dashboardId, enabled, initialData]);

  const refetch = useCallback(
    async ({ useCache = false }: { useCache?: boolean } = {}) => {
      if (!enabled || dashboardId == null) {
        setData(null);
        setLoading(false);
        return null;
      }

      setLoading(true);

      try {
        const payload = await loadDashboardDetailPayload({
          dashboardId,
          selector,
          useCache,
        });
        setData(payload);
        return payload;
      } catch (error) {
        const normalizedError = normalizeDashboardError(
          error,
          '加载看板项失败。',
        );
        onError?.(normalizedError);
        throw normalizedError;
      } finally {
        setLoading(false);
      }
    },
    [dashboardId, enabled, onError, selector],
  );

  useEffect(() => {
    if (!enabled || dashboardId == null) {
      return;
    }

    void refetch({ useCache: true }).catch(() => null);
  }, [dashboardId, enabled, refetch]);

  const updateData = useCallback(
    (updater: (previousData: DashboardDetailData) => DashboardDetailData) => {
      setData((previousData) => {
        if (!previousData) {
          return previousData;
        }

        const nextData = updater(previousData);
        if (dashboardId != null) {
          primeDashboardDetailPayload({
            selector,
            dashboardId,
            payload: nextData,
          });
        }
        return nextData;
      });
    },
    [dashboardId, selector],
  );

  return { data, loading, refetch, updateData };
};
