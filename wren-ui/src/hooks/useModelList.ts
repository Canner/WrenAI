import { useEffect, useMemo, useState } from 'react';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

export type ModelListField = {
  id: number;
  displayName: string;
  referenceName: string;
  sourceColumnName: string;
  type?: string | null;
  isCalculated: boolean;
  notNull: boolean;
  expression?: string | null;
  properties?: Record<string, any> | null;
  nestedColumns?: Array<Record<string, any>> | null;
};

export type ModelListItem = {
  id: number;
  displayName: string;
  referenceName: string;
  sourceTableName: string;
  refSql?: string | null;
  primaryKey?: string | null;
  cached: boolean;
  refreshTime?: string | null;
  description?: string | null;
  fields: Array<ModelListField | null>;
  calculatedFields: Array<ModelListField | null>;
};

const DEFAULT_RESPONSE: ModelListItem[] = [];

const buildModelListUrl = (selector?: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/models/list', {}, selector);

export const normalizeModelListPayload = (
  payload: unknown,
): ModelListItem[] => {
  if (!Array.isArray(payload)) {
    return DEFAULT_RESPONSE;
  }

  return payload as ModelListItem[];
};

export default function useModelList({
  enabled = true,
  onError,
}: {
  enabled?: boolean;
  onError?: (error: Error) => void;
}) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [data, setData] = useState<ModelListItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const requestUrl = useMemo(() => {
    if (!enabled) {
      return null;
    }

    return buildModelListUrl(runtimeScopeNavigation.selector);
  }, [enabled, runtimeScopeNavigation.selector]);

  useEffect(() => {
    if (!requestUrl) {
      setData(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);

    void fetch(requestUrl, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || '加载模型列表失败，请稍后重试。');
        }

        return normalizeModelListPayload(payload);
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setData(payload);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        onError?.(
          error instanceof Error
            ? error
            : new Error('加载模型列表失败，请稍后重试。'),
        );
      })
      .finally(() => {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [onError, requestUrl]);

  return {
    data,
    loading,
  };
}
