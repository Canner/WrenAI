import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import usePermissionsCustomRoles from './usePermissionsCustomRoles';
import usePermissionsRoleCatalog from './usePermissionsRoleCatalog';

export type PrincipalType = 'user' | 'group' | 'service_account';

export default function usePermissionsRoleManagement({
  enabled,
}: {
  enabled: boolean;
}) {
  const [bindingPrincipalType, setBindingPrincipalType] =
    useState<PrincipalType>('user');
  const [bindingPrincipalId, setBindingPrincipalId] = useState<string | null>(
    null,
  );
  const [bindingRoleId, setBindingRoleId] = useState<string | null>(null);
  const [bindingActionLoading, setBindingActionLoading] = useState<{
    kind: 'create' | 'delete';
    bindingId?: string;
  } | null>(null);

  const {
    roleCatalog,
    roleBindings,
    permissionCatalog,
    roleCatalogLoading,
    loadRoleCatalog,
  } = usePermissionsRoleCatalog({ enabled });
  const customRoles = usePermissionsCustomRoles({ loadRoleCatalog });

  const handleCreateRoleBinding = useCallback(async () => {
    if (!bindingPrincipalId || !bindingRoleId) {
      message.warning('请选择绑定主体和角色');
      return;
    }
    try {
      setBindingActionLoading({ kind: 'create' });
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/role-bindings'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            principalType: bindingPrincipalType,
            principalId: bindingPrincipalId,
            roleId: bindingRoleId,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建角色绑定失败');
      }

      message.success('角色绑定已创建');
      setBindingPrincipalId(null);
      setBindingRoleId(null);
      await loadRoleCatalog();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建角色绑定失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setBindingActionLoading(null);
    }
  }, [
    bindingPrincipalId,
    bindingPrincipalType,
    bindingRoleId,
    loadRoleCatalog,
  ]);

  const handleDeleteRoleBinding = useCallback(
    async (bindingId: string) => {
      try {
        setBindingActionLoading({ kind: 'delete', bindingId });
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/role-bindings/${bindingId}`),
          {
            method: 'DELETE',
            credentials: 'include',
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '删除角色绑定失败');
        }

        message.success('角色绑定已删除');
        await loadRoleCatalog();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除角色绑定失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        setBindingActionLoading(null);
      }
    },
    [loadRoleCatalog],
  );

  const handleBindingPrincipalTypeChange = useCallback(
    (value: PrincipalType) => {
      setBindingPrincipalType(value);
      setBindingPrincipalId(null);
    },
    [],
  );

  return {
    roleCatalog,
    roleBindings,
    permissionCatalog,
    roleCatalogLoading,
    bindingPrincipalType,
    bindingPrincipalId,
    bindingRoleId,
    bindingActionLoading,
    setBindingPrincipalId,
    setBindingRoleId,
    handleCreateRoleBinding,
    handleDeleteRoleBinding,
    handleBindingPrincipalTypeChange,
    ...customRoles,
  };
}
