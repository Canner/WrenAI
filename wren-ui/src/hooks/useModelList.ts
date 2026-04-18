import { useMemo } from 'react';
import {
  buildRuntimeScopeUrl,
  hasExecutableRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { parseRestJsonResponse } from '@/utils/rest';
import useRestRequest from './useRestRequest';

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

  const requestUrl = useMemo(() => {
    if (
      !enabled ||
      !hasExecutableRuntimeScopeSelector(runtimeScopeNavigation.selector)
    ) {
      return null;
    }

    return buildModelListUrl(runtimeScopeNavigation.selector);
  }, [
    enabled,
    runtimeScopeNavigation.selector.deployHash,
    runtimeScopeNavigation.selector.kbSnapshotId,
    runtimeScopeNavigation.selector.knowledgeBaseId,
    runtimeScopeNavigation.selector.runtimeScopeId,
    runtimeScopeNavigation.selector.workspaceId,
  ]);

  const { data, loading } = useRestRequest<ModelListItem[] | null>({
    enabled: Boolean(requestUrl),
    auto: true,
    initialData: null,
    requestKey: requestUrl,
    request: async ({ signal }) => {
      const response = await fetch(requestUrl as string, { signal });
      const payload = await parseRestJsonResponse<unknown>(
        response,
        '加载模型列表失败，请稍后重试。',
      );
      return normalizeModelListPayload(payload);
    },
    onError,
  });

  return {
    data,
    loading,
  };
}
