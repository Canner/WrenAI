import { useCallback, useState } from 'react';
import { message } from 'antd';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';

type ReviewActionDecision = 'keep' | 'remove';

export default function usePermissionsAccessGovernance({
  workspaceName,
  refetchWorkspaceOverview,
}: {
  workspaceName?: string | null;
  refetchWorkspaceOverview: () => Promise<unknown>;
}) {
  const [accessReviewTitle, setAccessReviewTitle] = useState('');
  const [accessReviewLoading, setAccessReviewLoading] = useState(false);
  const [reviewActionLoading, setReviewActionLoading] = useState<{
    reviewId: string;
    itemId: string;
    decision: ReviewActionDecision;
  } | null>(null);
  const [breakGlassUserId, setBreakGlassUserId] = useState<string | null>(null);
  const [breakGlassRoleKey, setBreakGlassRoleKey] = useState('owner');
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassDurationMinutes, setBreakGlassDurationMinutes] =
    useState('60');
  const [breakGlassLoading, setBreakGlassLoading] = useState(false);

  const handleCreateAccessReview = useCallback(async () => {
    try {
      setAccessReviewLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/access-reviews'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title:
              accessReviewTitle.trim() ||
              `${workspaceName || 'Workspace'} Access Review`,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '发起访问复核失败');
      }

      message.success('访问复核已发起');
      setAccessReviewTitle('');
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '发起访问复核失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setAccessReviewLoading(false);
    }
  }, [accessReviewTitle, refetchWorkspaceOverview, workspaceName]);

  const handleReviewAccessItem = useCallback(
    async (
      reviewId: string,
      itemId: string,
      decision: ReviewActionDecision,
    ) => {
      try {
        setReviewActionLoading({ reviewId, itemId, decision });
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/access-reviews/${reviewId}`),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ itemId, decision }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '更新访问复核失败');
        }

        message.success(
          decision === 'keep' ? '已保留访问权限' : '已移除访问权限',
        );
        await refetchWorkspaceOverview();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新访问复核失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        setReviewActionLoading(null);
      }
    },
    [refetchWorkspaceOverview],
  );

  const handleCreateBreakGlassGrant = useCallback(async () => {
    if (!breakGlassReason.trim()) {
      message.warning('请输入 break-glass 原因');
      return;
    }

    try {
      setBreakGlassLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/break-glass'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            userId: breakGlassUserId,
            roleKey: breakGlassRoleKey,
            durationMinutes: Number.parseInt(
              breakGlassDurationMinutes || '60',
              10,
            ),
            reason: breakGlassReason.trim(),
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建 break-glass 授权失败');
      }

      message.success('break-glass 授权已创建');
      setBreakGlassUserId(null);
      setBreakGlassRoleKey('owner');
      setBreakGlassReason('');
      setBreakGlassDurationMinutes('60');
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建 break-glass 授权失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setBreakGlassLoading(false);
    }
  }, [
    breakGlassDurationMinutes,
    breakGlassReason,
    breakGlassRoleKey,
    breakGlassUserId,
    refetchWorkspaceOverview,
  ]);

  const handleRevokeBreakGlassGrant = useCallback(
    async (grantId: string) => {
      try {
        setBreakGlassLoading(true);
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/break-glass/${grantId}`),
          {
            method: 'PATCH',
            credentials: 'include',
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '撤销 break-glass 授权失败');
        }

        message.success('break-glass 授权已撤销');
        await refetchWorkspaceOverview();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '撤销 break-glass 授权失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        setBreakGlassLoading(false);
      }
    },
    [refetchWorkspaceOverview],
  );

  return {
    accessReviewTitle,
    accessReviewLoading,
    reviewActionLoading,
    breakGlassUserId,
    breakGlassRoleKey,
    breakGlassReason,
    breakGlassDurationMinutes,
    breakGlassLoading,
    setAccessReviewTitle,
    setBreakGlassUserId,
    setBreakGlassRoleKey,
    setBreakGlassReason,
    setBreakGlassDurationMinutes,
    handleCreateAccessReview,
    handleReviewAccessItem,
    handleCreateBreakGlassGrant,
    handleRevokeBreakGlassGrant,
  };
}
