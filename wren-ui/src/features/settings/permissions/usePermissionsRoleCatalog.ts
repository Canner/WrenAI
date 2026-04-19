import { message } from 'antd';
import type {
  WorkspacePermissionCatalogItem,
  WorkspaceRoleBindingItem,
  WorkspaceRoleCatalogItem,
} from '@/features/settings/workspaceGovernanceShared';
import useRestRequest from '@/hooks/useRestRequest';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';

type RoleCatalogResponse = {
  roleCatalog: WorkspaceRoleCatalogItem[];
  roleBindings: WorkspaceRoleBindingItem[];
  permissionCatalog: WorkspacePermissionCatalogItem[];
};

export const EMPTY_ROLE_CATALOG_RESPONSE: RoleCatalogResponse = {
  roleCatalog: [],
  roleBindings: [],
  permissionCatalog: [],
};

export const buildPermissionsRoleCatalogRequestKey = ({
  enabled,
}: {
  enabled: boolean;
}) => (enabled ? 'workspace-roles' : null);

export const buildPermissionsRoleCatalogUrl = () =>
  buildRuntimeScopeUrl('/api/v1/workspace/roles');

export const normalizePermissionsRoleCatalogPayload = (payload: any) => ({
  roleCatalog: Array.isArray(payload?.roles) ? payload.roles : [],
  roleBindings: Array.isArray(payload?.bindings) ? payload.bindings : [],
  permissionCatalog: Array.isArray(payload?.permissionCatalog)
    ? payload.permissionCatalog
    : [],
});

export default function usePermissionsRoleCatalog({
  enabled,
}: {
  enabled: boolean;
}) {
  const {
    data: roleCatalogState,
    loading: roleCatalogLoading,
    refetch: loadRoleCatalog,
  } = useRestRequest<RoleCatalogResponse>({
    enabled,
    initialData: EMPTY_ROLE_CATALOG_RESPONSE,
    requestKey: buildPermissionsRoleCatalogRequestKey({ enabled }),
    request: async ({ signal }) => {
      const response = await fetch(buildPermissionsRoleCatalogUrl(), {
        credentials: 'include',
        signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          return EMPTY_ROLE_CATALOG_RESPONSE;
        }
        throw new Error(payload.error || '加载角色目录失败');
      }

      return normalizePermissionsRoleCatalogPayload(payload);
    },
    onError: (error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载角色目录失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    },
  });

  return {
    roleCatalog: roleCatalogState.roleCatalog,
    roleBindings: roleCatalogState.roleBindings,
    permissionCatalog: roleCatalogState.permissionCatalog,
    roleCatalogLoading,
    loadRoleCatalog,
  };
}
