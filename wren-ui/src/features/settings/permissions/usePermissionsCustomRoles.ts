import { useCallback, useState } from 'react';
import { message } from 'antd';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';

export type WorkspaceRoleDraftPayload = {
  name?: string;
  displayName?: string;
  description?: string | null;
  isActive?: boolean;
  permissionNames: string[];
};

export default function usePermissionsCustomRoles({
  loadRoleCatalog,
}: {
  loadRoleCatalog: () => Promise<unknown>;
}) {
  const [roleActionLoading, setRoleActionLoading] = useState<{
    kind: 'create' | 'update' | 'delete';
    roleId?: string;
  } | null>(null);

  const normalizePayload = useCallback((payload: WorkspaceRoleDraftPayload) => {
    const displayName = (payload.displayName || '').trim();
    const name = payload.name?.trim() || undefined;
    return {
      ...(name ? { name } : {}),
      displayName,
      description: payload.description?.trim() || null,
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      permissionNames: Array.from(
        new Set(
          (payload.permissionNames || [])
            .map((name) => String(name || '').trim())
            .filter(Boolean),
        ),
      ),
    };
  }, []);

  const handleCreateCustomRole = useCallback(
    async (payload: WorkspaceRoleDraftPayload) => {
      const normalized = normalizePayload(payload);
      if (!normalized.displayName && !normalized.name) {
        message.warning('请输入角色标识或角色名称');
        return null;
      }
      try {
        setRoleActionLoading({ kind: 'create' });
        const response = await fetch(
          buildRuntimeScopeUrl('/api/v1/workspace/roles'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(normalized),
          },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || '创建自定义角色失败');
        }

        message.success('自定义角色已创建');
        await loadRoleCatalog();
        return result?.role?.id || null;
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '创建自定义角色失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return null;
      } finally {
        setRoleActionLoading(null);
      }
    },
    [loadRoleCatalog, normalizePayload],
  );

  const handleUpdateCustomRole = useCallback(
    async (roleId: string, payload: WorkspaceRoleDraftPayload) => {
      const normalized = normalizePayload(payload);
      if (!normalized.displayName && !normalized.name) {
        message.warning('请输入角色标识或角色名称');
        return false;
      }
      try {
        setRoleActionLoading({ kind: 'update', roleId });
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/roles/${roleId}`),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(normalized),
          },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || '更新自定义角色失败');
        }

        message.success('角色配置已更新');
        await loadRoleCatalog();
        return true;
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新自定义角色失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return false;
      } finally {
        setRoleActionLoading(null);
      }
    },
    [loadRoleCatalog, normalizePayload],
  );

  const handleDeleteCustomRole = useCallback(
    async (roleId: string) => {
      try {
        setRoleActionLoading({ kind: 'delete', roleId });
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/roles/${roleId}`),
          {
            method: 'DELETE',
            credentials: 'include',
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '删除自定义角色失败');
        }

        message.success('自定义角色已删除');
        await loadRoleCatalog();
        return true;
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除自定义角色失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return false;
      } finally {
        setRoleActionLoading(null);
      }
    },
    [loadRoleCatalog],
  );

  return {
    roleActionLoading,
    handleCreateCustomRole,
    handleUpdateCustomRole,
    handleDeleteCustomRole,
  };
}
