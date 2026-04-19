import { useMemo } from 'react';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { parseRestJsonResponse } from '@/utils/rest';
import useRestRequest from '@/hooks/useRestRequest';
import {
  buildSkillConnectorsRequestKey,
  normalizeSkillConnectorsPayload,
  type ConnectorView,
} from './skillsPageUtils';

const EMPTY_CONNECTORS: ConnectorView[] = [];

export { buildSkillConnectorsRequestKey } from './skillsPageUtils';

export default function useSkillConnectors({
  enabled,
  runtimeScopeSelector,
  onError,
}: {
  enabled: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) {
  const requestKey = useMemo(
    () =>
      buildSkillConnectorsRequestKey({
        enabled,
        runtimeScopeSelector,
      }),
    [
      enabled,
      runtimeScopeSelector.deployHash,
      runtimeScopeSelector.kbSnapshotId,
      runtimeScopeSelector.knowledgeBaseId,
      runtimeScopeSelector.runtimeScopeId,
      runtimeScopeSelector.workspaceId,
    ],
  );
  const requestUrl = requestKey;

  const { data, loading } = useRestRequest<ConnectorView[]>({
    enabled: Boolean(requestUrl),
    initialData: EMPTY_CONNECTORS,
    requestKey,
    request: async ({ signal }) => {
      const response = await fetch(requestUrl!, { signal });
      const payload = await parseRestJsonResponse<unknown>(
        response,
        '加载技能所需连接器失败。',
      );
      return normalizeSkillConnectorsPayload(payload);
    },
    onError,
  });

  return {
    connectors: data,
    loading,
  };
}
