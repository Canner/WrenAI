import { useMemo } from 'react';
import { message } from 'antd';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import useRestRequest from '@/hooks/useRestRequest';
import type { WorkspaceGovernanceOverview } from '@/features/settings/workspaceGovernanceShared';

export const buildWorkspaceGovernanceOverviewUrl = ({
  enabled,
}: {
  enabled: boolean;
}) => (enabled ? buildRuntimeScopeUrl('/api/v1/workspace/current') : null);

export const buildWorkspaceGovernanceOverviewRequestKey = ({
  enabled,
}: {
  enabled: boolean;
}) => buildWorkspaceGovernanceOverviewUrl({ enabled });

export default function useWorkspaceGovernanceOverview({
  enabled,
  errorMessage,
}: {
  enabled: boolean;
  errorMessage: string;
}) {
  const requestUrl = useMemo(
    () => buildWorkspaceGovernanceOverviewRequestKey({ enabled }),
    [enabled],
  );

  const { data, loading, refetch, error } =
    useRestRequest<WorkspaceGovernanceOverview | null>({
      enabled: Boolean(requestUrl),
      initialData: null,
      requestKey: requestUrl,
      request: async ({ signal }) => {
        const response = await fetch(requestUrl!, {
          credentials: 'include',
          signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || errorMessage);
        }

        return payload as WorkspaceGovernanceOverview;
      },
      onError: (requestError) => {
        const resolvedErrorMessage = resolveAbortSafeErrorMessage(
          requestError,
          errorMessage,
        );
        if (resolvedErrorMessage) {
          message.error(resolvedErrorMessage);
        }
      },
    });

  return {
    workspaceOverview: data,
    loading,
    refetchWorkspaceOverview: refetch,
    error,
  };
}
