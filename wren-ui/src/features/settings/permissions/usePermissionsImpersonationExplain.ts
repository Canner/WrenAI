import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import type { WorkspaceAuthorizationExplainResponse } from '@/features/settings/workspaceGovernanceShared';
import type { PrincipalType } from './usePermissionsRoleManagement';

export default function usePermissionsImpersonationExplain({
  workspaceId,
}: {
  workspaceId?: string | null;
}) {
  const [impersonationTargetUserId, setImpersonationTargetUserId] = useState<
    string | null
  >(null);
  const [impersonationReason, setImpersonationReason] = useState('');
  const [impersonationLoading, setImpersonationLoading] = useState(false);
  const [explainResult, setExplainResult] =
    useState<WorkspaceAuthorizationExplainResponse | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainPrincipalType, setExplainPrincipalType] =
    useState<PrincipalType>('user');
  const [explainPrincipalId, setExplainPrincipalId] = useState<string | null>(
    null,
  );
  const [explainAction, setExplainAction] = useState('');
  const [explainResourceType, setExplainResourceType] = useState('workspace');
  const [explainResourceId, setExplainResourceId] = useState('');
  const [explainResourceAttributes, setExplainResourceAttributes] =
    useState('{}');

  const handleStartImpersonation = useCallback(async () => {
    if (!impersonationTargetUserId) {
      message.warning('请选择目标用户');
      return;
    }
    if (!impersonationReason.trim()) {
      message.warning('请输入代理登录原因');
      return;
    }

    try {
      setImpersonationLoading(true);
      const response = await fetch('/api/auth/impersonation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetUserId: impersonationTargetUserId,
          targetWorkspaceId: workspaceId,
          reason: impersonationReason.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '发起代理登录失败');
      }

      message.success('已切换到代理登录会话');
      window.location.assign(
        buildRuntimeScopeUrl(Path.Home, {}, payload.runtimeSelector),
      );
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '发起代理登录失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setImpersonationLoading(false);
    }
  }, [impersonationReason, impersonationTargetUserId, workspaceId]);

  const handleRunAuthorizationExplain = useCallback(async () => {
    if (!explainPrincipalId) {
      message.warning('请选择要解释的主体');
      return;
    }

    try {
      setExplainLoading(true);
      const raw = explainResourceAttributes.trim();
      let resourceAttributes: Record<string, any> | undefined;
      if (raw && raw !== '{}') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          resourceAttributes = parsed as Record<string, any>;
        }
      }
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/authorization/explain'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            principalType: explainPrincipalType,
            principalId: explainPrincipalId,
            action: explainAction.trim() || undefined,
            resourceType: explainResourceType.trim() || 'workspace',
            resourceId: explainResourceId.trim() || workspaceId || '',
            resourceAttributes,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '权限解释失败');
      }

      setExplainResult(payload as WorkspaceAuthorizationExplainResponse);
      message.success('权限解释完成');
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(error, '权限解释失败');
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setExplainLoading(false);
    }
  }, [
    explainAction,
    explainPrincipalId,
    explainPrincipalType,
    explainResourceAttributes,
    explainResourceId,
    explainResourceType,
    workspaceId,
  ]);

  const handleExplainPrincipalTypeChange = useCallback(
    (value: PrincipalType) => {
      setExplainPrincipalType(value);
      setExplainPrincipalId(null);
    },
    [],
  );

  return {
    impersonationTargetUserId,
    impersonationReason,
    impersonationLoading,
    explainResult,
    explainLoading,
    explainPrincipalType,
    explainPrincipalId,
    explainAction,
    explainResourceType,
    explainResourceId,
    explainResourceAttributes,
    setImpersonationTargetUserId,
    setImpersonationReason,
    setExplainPrincipalId,
    setExplainAction,
    setExplainResourceType,
    setExplainResourceId,
    setExplainResourceAttributes,
    handleStartImpersonation,
    handleRunAuthorizationExplain,
    handleExplainPrincipalTypeChange,
  };
}
