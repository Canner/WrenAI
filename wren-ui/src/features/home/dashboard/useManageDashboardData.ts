import { useCallback, useEffect, useMemo, useRef } from 'react';

import { DataSourceName } from '@/types/dataSource';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import useRestRequest from '@/hooks/useRestRequest';
import {
  buildDashboardDetailUrl,
  buildDashboardListUrl,
  loadDashboardDetailPayload,
  loadDashboardListPayload,
  peekDashboardDetailPayload,
  peekDashboardListPayload,
  primeDashboardDetailPayload,
  type DashboardDetailData,
  type DashboardListItem,
} from '@/utils/dashboardRest';
import type { KnowledgeConnectionSettings } from '@/utils/settingsRest';
import type { DashboardGridItemData } from '@/utils/dashboardRest';

const normalizeDashboardError = (error: unknown, fallbackMessage: string) =>
  error instanceof Error ? error : new Error(fallbackMessage);

const resolveDashboardItemDeduplicationKey = (item: DashboardGridItemData) => {
  const sourceResponseId = item.detail?.sourceResponseId;
  if (sourceResponseId != null) {
    return `response:${sourceResponseId}`;
  }

  return `item:${item.id}`;
};

export const dedupeDashboardDetailItems = (
  items: DashboardGridItemData[],
): DashboardGridItemData[] => {
  const itemMap = new Map<string, DashboardGridItemData>();

  items.forEach((item) => {
    const key = resolveDashboardItemDeduplicationKey(item);
    const previousItem = itemMap.get(key);
    if (!previousItem || previousItem.id < item.id) {
      itemMap.set(key, item);
    }
  });

  return [...itemMap.values()].sort((left, right) => {
    if (left.layout.y !== right.layout.y) {
      return left.layout.y - right.layout.y;
    }
    if (left.layout.x !== right.layout.x) {
      return left.layout.x - right.layout.x;
    }
    return left.id - right.id;
  });
};

const normalizeLegacyDashboardItemLayouts = (
  items: DashboardGridItemData[],
): DashboardGridItemData[] => {
  if (items.length !== 1) {
    return items;
  }

  const [item] = items;
  if (
    item.layout.x === 0 &&
    item.layout.y === 0 &&
    item.layout.w === 6 &&
    item.layout.h === 3
  ) {
    return [
      {
        ...item,
        layout: {
          ...item.layout,
          w: 3,
          h: 2,
        },
      },
    ];
  }

  return items;
};

const normalizeDashboardDetailData = (
  payload: DashboardDetailData | null,
): DashboardDetailData | null => {
  if (!payload) {
    return null;
  }

  return {
    ...payload,
    items: normalizeLegacyDashboardItemLayouts(
      dedupeDashboardDetailItems(payload.items || []),
    ),
  };
};

export const isSupportCachedSettings = (
  connection?: KnowledgeConnectionSettings | null,
) => {
  if (!connection) {
    return false;
  }

  return !connection.sampleDataset && connection.type !== DataSourceName.DUCKDB;
};

export const buildDashboardListRequestKey = ({
  enabled,
  selector,
}: {
  enabled: boolean;
  selector: ClientRuntimeScopeSelector;
}) => (enabled ? buildDashboardListUrl(selector) : null);

export const buildDashboardDetailRequestKey = ({
  dashboardId,
  enabled,
  selector,
}: {
  dashboardId?: number | null;
  enabled: boolean;
  selector: ClientRuntimeScopeSelector;
}) =>
  enabled && dashboardId != null
    ? buildDashboardDetailUrl(dashboardId, selector)
    : null;

export const useDashboardListData = ({
  enabled,
  selector,
  onError,
}: {
  enabled: boolean;
  selector: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) => {
  const requestKey = useMemo(
    () =>
      buildDashboardListRequestKey({
        enabled,
        selector,
      }),
    [
      enabled,
      selector.deployHash,
      selector.kbSnapshotId,
      selector.knowledgeBaseId,
      selector.runtimeScopeId,
      selector.workspaceId,
    ],
  );
  const initialData = useMemo(() => {
    if (!requestKey) {
      return [] as DashboardListItem[];
    }

    return peekDashboardListPayload({ requestUrl: requestKey }) || [];
  }, [requestKey]);
  const useCacheRef = useRef(true);
  const {
    data,
    loading,
    refetch: refetchList,
    setData,
  } = useRestRequest<DashboardListItem[]>({
    enabled: Boolean(requestKey),
    auto: Boolean(requestKey),
    initialData,
    requestKey,
    request: async () =>
      loadDashboardListPayload({
        selector,
        requestUrl: requestKey as string,
        useCache: useCacheRef.current,
      }),
    onError: (error) => {
      onError?.(normalizeDashboardError(error, '加载看板列表失败。'));
    },
  });

  useEffect(() => {
    setData(initialData);
  }, [initialData, setData]);

  const refetch = useCallback(
    async ({ useCache = false }: { useCache?: boolean } = {}) => {
      if (!requestKey) {
        setData([]);
        return [] as DashboardListItem[];
      }

      useCacheRef.current = useCache;

      try {
        return await refetchList();
      } finally {
        useCacheRef.current = true;
      }
    },
    [refetchList, requestKey, setData],
  );

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
  const requestKey = useMemo(
    () =>
      buildDashboardDetailRequestKey({
        dashboardId,
        enabled,
        selector,
      }),
    [
      dashboardId,
      enabled,
      selector.deployHash,
      selector.kbSnapshotId,
      selector.knowledgeBaseId,
      selector.runtimeScopeId,
      selector.workspaceId,
    ],
  );
  const initialData = useMemo(() => {
    if (!requestKey) {
      return null;
    }

    return normalizeDashboardDetailData(
      peekDashboardDetailPayload({
        requestUrl: requestKey,
        dashboardId: dashboardId ?? undefined,
      }),
    );
  }, [dashboardId, requestKey]);
  const useCacheRef = useRef(true);
  const {
    data,
    loading,
    refetch: refetchDetail,
    setData,
  } = useRestRequest<DashboardDetailData | null>({
    enabled: Boolean(requestKey),
    auto: Boolean(requestKey),
    initialData,
    requestKey,
    request: async () =>
      normalizeDashboardDetailData(
        await loadDashboardDetailPayload({
          dashboardId: dashboardId as number,
          selector,
          requestUrl: requestKey as string,
          useCache: useCacheRef.current,
        }),
      ),
    onError: (error) => {
      onError?.(normalizeDashboardError(error, '加载看板项失败。'));
    },
  });

  useEffect(() => {
    setData(initialData);
  }, [initialData, setData]);

  const refetch = useCallback(
    async ({ useCache = false }: { useCache?: boolean } = {}) => {
      if (!requestKey) {
        setData(null);
        return null;
      }

      useCacheRef.current = useCache;

      try {
        return await refetchDetail();
      } finally {
        useCacheRef.current = true;
      }
    },
    [refetchDetail, requestKey, setData],
  );

  const updateData = useCallback(
    (updater: (previousData: DashboardDetailData) => DashboardDetailData) => {
      setData((previousData) => {
        if (!previousData) {
          return previousData;
        }

        const nextData = normalizeDashboardDetailData(updater(previousData));
        if (dashboardId != null) {
          primeDashboardDetailPayload({
            selector,
            dashboardId,
            payload: nextData as DashboardDetailData,
          });
        }
        return nextData;
      });
    },
    [dashboardId, selector],
  );

  return { data, loading, refetch, updateData };
};
