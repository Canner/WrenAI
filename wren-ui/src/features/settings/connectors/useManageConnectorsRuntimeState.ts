import { useMemo } from 'react';
import type useAuthSession from '@/hooks/useAuthSession';
import type useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import type useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveConnectorWorkspaceSelector } from './connectorsPageUtils';
import { resolveConnectorManagementCapabilities } from './connectorManagementCapabilities';
import buildConnectorManagementCapabilityInput from './buildConnectorManagementCapabilityInput';

export type ManageConnectorsRuntimeStateArgs = {
  authSession: ReturnType<typeof useAuthSession>;
  runtimeScopeNavigation: ReturnType<typeof useRuntimeScopeNavigation>;
  runtimeScopePage: ReturnType<typeof useProtectedRuntimeScopePage>;
};

export function useManageConnectorsRuntimeState({
  authSession,
  runtimeScopeNavigation,
  runtimeScopePage,
}: ManageConnectorsRuntimeStateArgs) {
  const workspaceScopedSelector = useMemo(
    () =>
      resolveConnectorWorkspaceSelector({
        runtimeSelector: runtimeScopeNavigation.selector,
        sessionWorkspaceId: authSession.data?.workspace?.id,
        actorWorkspaceId: authSession.data?.authorization?.actor?.workspaceId,
      }),
    [
      authSession.data?.authorization?.actor?.workspaceId,
      authSession.data?.workspace?.id,
      runtimeScopeNavigation.selector?.workspaceId,
    ],
  );

  const capabilityState = useMemo(
    () =>
      resolveConnectorManagementCapabilities(
        buildConnectorManagementCapabilityInput(authSession),
      ),
    [
      authSession.data?.authorization?.actions,
      authSession.data?.authorization?.actor?.isPlatformAdmin,
      authSession.data?.authorization?.actor?.platformRoleKeys,
      authSession.data?.isPlatformAdmin,
      authSession.data?.workspace?.kind,
    ],
  );

  const connectorsRequestEnabled = Boolean(
    runtimeScopePage.hasRuntimeScope && workspaceScopedSelector?.workspaceId,
  );

  const requireWorkspaceSelector = () => {
    if (!workspaceScopedSelector?.workspaceId) {
      throw new Error('当前工作空间未就绪，请稍后重试。');
    }

    return workspaceScopedSelector;
  };

  return {
    workspaceScopedSelector,
    connectorsRequestEnabled,
    requireWorkspaceSelector,
    ...capabilityState,
  };
}

export default useManageConnectorsRuntimeState;
