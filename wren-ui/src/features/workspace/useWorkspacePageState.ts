import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';

import { appMessage as message } from '@/utils/antdAppBridge';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import {
  loadWorkspaceOverview,
  peekWorkspaceOverview,
} from '@/utils/runtimePagePrefetch';
import type {
  WorkspaceOverviewPayload,
  WorkspacePageTab,
} from './workspacePageTypes';
import buildWorkspacePageDerivedState from './workspacePageDerivedState';

export default function useWorkspacePageState() {
  const router = useRouter();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const workspaceOverviewUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildRuntimeScopeUrl('/api/v1/workspace/current')
        : null,
    [runtimeScopePage.hasRuntimeScope],
  );
  const cachedOverview = useMemo(
    () =>
      workspaceOverviewUrl
        ? peekWorkspaceOverview<WorkspaceOverviewPayload>(workspaceOverviewUrl)
        : null,
    [workspaceOverviewUrl],
  );
  const [activeTab, setActiveTab] = useState<WorkspacePageTab>('mine');
  const [loading, setLoading] = useState(!cachedOverview);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WorkspaceOverviewPayload | null>(
    cachedOverview,
  );
  const dataRef = useRef<WorkspaceOverviewPayload | null>(cachedOverview);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [workspaceAction, setWorkspaceAction] = useState<{
    workspaceId: string;
    action: 'join' | 'apply';
  } | null>(null);
  const [reviewAction, setReviewAction] = useState<{
    memberId: string;
    action: 'approve' | 'reject';
  } | null>(null);

  const loadOverview = useCallback(async () => {
    if (!runtimeScopePage.hasRuntimeScope || !workspaceOverviewUrl) {
      return;
    }

    const nextCachedOverview =
      peekWorkspaceOverview<WorkspaceOverviewPayload>(workspaceOverviewUrl);
    setLoading(!nextCachedOverview && !dataRef.current);
    setError(null);

    try {
      const payload =
        await loadWorkspaceOverview<WorkspaceOverviewPayload>(
          workspaceOverviewUrl,
        );
      setData(payload);
      return payload;
    } catch (fetchError: any) {
      setError(fetchError?.message || '加载工作区信息失败');
      setData(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [runtimeScopePage.hasRuntimeScope, workspaceOverviewUrl]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const derivedState = useMemo(
    () =>
      buildWorkspacePageDerivedState({
        data,
        searchKeyword,
      }),
    [data, searchKeyword],
  );

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      const nextUrl = buildRuntimeScopeUrl(
        Path.Workspace,
        {},
        {
          workspaceId,
        },
      );
      await router.replace(nextUrl);
    },
    [router.replace],
  );

  const handleWorkspaceAction = useCallback(
    async (workspaceId: string, action: 'join' | 'apply') => {
      try {
        setWorkspaceAction({ workspaceId, action });
        const endpoint =
          action === 'join'
            ? '/api/v1/workspace/join'
            : '/api/v1/workspace/apply';
        const response = await fetch(buildRuntimeScopeUrl(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ workspaceId }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '工作区操作失败');
        }

        if (action === 'join') {
          message.success('已加入工作空间');
          await switchWorkspace(workspaceId);
          return;
        }

        message.success('已提交加入申请，等待管理员审批');
        setActiveTab('applications');
        await loadOverview();
      } catch (actionError: any) {
        message.error(actionError?.message || '工作区操作失败');
      } finally {
        setWorkspaceAction(null);
      }
    },
    [loadOverview, switchWorkspace],
  );

  const handleSetDefaultWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        const response = await fetch('/api/v1/workspace/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ defaultWorkspaceId: workspaceId }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '设置默认工作空间失败');
        }

        message.success('默认进入工作空间已更新');
        await loadOverview();
      } catch (actionError: any) {
        message.error(actionError?.message || '设置默认工作空间失败');
      }
    },
    [loadOverview],
  );

  const handleReviewAction = useCallback(
    async (memberId: string, action: 'approve' | 'reject') => {
      try {
        setReviewAction({ memberId, action });
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/members/${memberId}`),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '审批操作失败');
        }

        message.success(
          action === 'approve' ? '已批准加入申请' : '已拒绝加入申请',
        );
        await loadOverview();
      } catch (actionError: any) {
        message.error(actionError?.message || '审批操作失败');
      } finally {
        setReviewAction(null);
      }
    },
    [loadOverview],
  );

  return {
    activeTab,
    setActiveTab,
    searchKeyword,
    setSearchKeyword,
    loading,
    error,
    data,
    workspaceAction,
    reviewAction,
    runtimeScopePage,
    runtimeScopeNavigation,
    ...derivedState,
    loadOverview,
    switchWorkspace,
    handleWorkspaceAction,
    handleSetDefaultWorkspace,
    handleReviewAction,
  };
}
