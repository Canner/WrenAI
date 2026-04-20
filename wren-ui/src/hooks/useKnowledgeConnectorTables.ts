import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompactTable } from '@/types/dataSource';

type RuntimeScopeUrlBuilder = (
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
  selector?: {
    workspaceId?: string;
    knowledgeBaseId?: string;
    kbSnapshotId?: string;
    deployHash?: string;
    runtimeScopeId?: string;
  },
) => string;

export const normalizeKnowledgeConnectorTablesPayload = (
  payload: unknown,
): CompactTable[] =>
  Array.isArray(payload) ? (payload as CompactTable[]) : [];

export const buildKnowledgeConnectorTablesErrorKey = ({
  requestUrl,
  error,
}: {
  requestUrl?: string | null;
  error: unknown;
}) => {
  if (!requestUrl) {
    return null;
  }

  const message =
    error instanceof Error
      ? error.message
      : '加载连接器数据表失败，请稍后重试。';

  return `${requestUrl}|${message}`;
};

export const buildKnowledgeConnectorTablesUrl = ({
  buildRuntimeScopeUrl,
  connectorId,
  workspaceId,
}: {
  buildRuntimeScopeUrl: RuntimeScopeUrlBuilder;
  connectorId?: string | null;
  workspaceId?: string | null;
}) => {
  if (!connectorId || !workspaceId) {
    return null;
  }

  return buildRuntimeScopeUrl(
    `/api/v1/connectors/${connectorId}/tables`,
    {},
    {
      workspaceId,
    },
  );
};

export default function useKnowledgeConnectorTables({
  buildRuntimeScopeUrl,
  connectorId,
  workspaceId,
  enabled,
  onLoadError,
}: {
  buildRuntimeScopeUrl: RuntimeScopeUrlBuilder;
  connectorId?: string | null;
  workspaceId?: string | null;
  enabled: boolean;
  onLoadError?: (error: unknown) => void;
}) {
  const [connectorTables, setConnectorTables] = useState<CompactTable[]>([]);
  const [connectorTablesLoading, setConnectorTablesLoading] = useState(false);
  const onLoadErrorRef = useRef(onLoadError);
  const lastNotifiedErrorKeyRef = useRef<string | null>(null);

  const requestUrl = useMemo(
    () =>
      enabled
        ? buildKnowledgeConnectorTablesUrl({
            buildRuntimeScopeUrl,
            connectorId,
            workspaceId,
          })
        : null,
    [buildRuntimeScopeUrl, connectorId, enabled, workspaceId],
  );

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    if (!requestUrl) {
      setConnectorTables([]);
      setConnectorTablesLoading(false);
      lastNotifiedErrorKeyRef.current = null;
      return;
    }

    let cancelled = false;

    const loadTables = async () => {
      setConnectorTablesLoading(true);
      try {
        const response = await fetch(requestUrl);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            payload?.error || '加载连接器数据表失败，请稍后重试。',
          );
        }

        if (!cancelled) {
          setConnectorTables(normalizeKnowledgeConnectorTablesPayload(payload));
          lastNotifiedErrorKeyRef.current = null;
        }
      } catch (error) {
        if (!cancelled) {
          setConnectorTables([]);
          const errorKey = buildKnowledgeConnectorTablesErrorKey({
            requestUrl,
            error,
          });
          if (errorKey && lastNotifiedErrorKeyRef.current !== errorKey) {
            lastNotifiedErrorKeyRef.current = errorKey;
            onLoadErrorRef.current?.(error);
          }
        }
      } finally {
        if (!cancelled) {
          setConnectorTablesLoading(false);
        }
      }
    };

    void loadTables();

    return () => {
      cancelled = true;
    };
  }, [requestUrl]);

  return {
    connectorTables,
    connectorTablesLoading,
  };
}
