import { useCallback, useState } from 'react';
import { message } from 'antd';
import { Path } from '@/utils/enum';

type RuntimeSelector = {
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
  runtimeScopeId?: string;
};

type KnowledgeBaseEntity = {
  id: string;
  workspaceId: string;
  archivedAt?: string | null;
  defaultKbSnapshot?: {
    id: string;
    deployHash: string;
  } | null;
};

type KnowledgeBaseForm = {
  validateFields: () => Promise<{ name: string; description?: string }>;
};

export default function useKnowledgeBaseLifecycle<
  TKnowledgeBase extends KnowledgeBaseEntity,
>({
  editingKnowledgeBase,
  activeKnowledgeBase,
  kbForm,
  closeKnowledgeBaseModal,
  loadKnowledgeBases,
  refetchRuntimeSelector,
  setSelectedKnowledgeBaseId,
  clearDetailAsset,
  currentKnowledgeBaseId,
  canManageKnowledgeBaseLifecycle,
  isSnapshotReadonlyKnowledgeBase,
  snapshotReadonlyHint,
  runtimeNavigationSelector,
  routerAsPath,
  buildRuntimeScopeUrl,
  buildKnowledgeRuntimeSelector,
  replaceRoute,
  resolveLifecycleActionLabel,
}: {
  editingKnowledgeBase?: TKnowledgeBase | null;
  activeKnowledgeBase?: TKnowledgeBase | null;
  kbForm: KnowledgeBaseForm;
  closeKnowledgeBaseModal: () => void;
  loadKnowledgeBases: () => Promise<TKnowledgeBase[]>;
  refetchRuntimeSelector: () => Promise<unknown>;
  setSelectedKnowledgeBaseId: (id: string | null) => void;
  clearDetailAsset: () => void;
  currentKnowledgeBaseId?: string | null;
  canManageKnowledgeBaseLifecycle: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  snapshotReadonlyHint: string;
  runtimeNavigationSelector: RuntimeSelector;
  routerAsPath: string;
  buildRuntimeScopeUrl: (
    path: string,
    query?: Record<string, string | number | undefined>,
    selector?: RuntimeSelector,
  ) => string;
  buildKnowledgeRuntimeSelector: (
    knowledgeBase?: TKnowledgeBase | null,
  ) => RuntimeSelector;
  replaceRoute: (url: string) => Promise<unknown>;
  resolveLifecycleActionLabel: (archivedAt?: string | null) => string;
}) {
  const [creatingKnowledgeBase, setCreatingKnowledgeBase] = useState(false);
  const [knowledgeLifecycleSubmitting, setKnowledgeLifecycleSubmitting] =
    useState(false);

  const handleSaveKnowledgeBase = useCallback(async () => {
    try {
      const values = await kbForm.validateFields();
      setCreatingKnowledgeBase(true);
      const isEditing = Boolean(editingKnowledgeBase?.id);
      const response = await fetch(
        buildRuntimeScopeUrl(
          isEditing
            ? `/api/v1/knowledge/bases/${editingKnowledgeBase!.id}`
            : '/api/v1/knowledge/bases',
        ),
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: values.name,
            description: values.description,
          }),
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.error || (isEditing ? '更新知识库失败' : '创建知识库失败'),
        );
      }

      const saved = (await response.json()) as TKnowledgeBase;
      closeKnowledgeBaseModal();
      await loadKnowledgeBases();
      await refetchRuntimeSelector();
      setSelectedKnowledgeBaseId(saved.id);
      message.success(isEditing ? '知识库已更新' : '知识库已创建');
      const nextSearchParams = new URLSearchParams({
        workspaceId: saved.workspaceId,
        knowledgeBaseId: saved.id,
      });

      if (saved.defaultKbSnapshot?.id) {
        nextSearchParams.set('kbSnapshotId', saved.defaultKbSnapshot.id);
      }
      if (saved.defaultKbSnapshot?.deployHash) {
        nextSearchParams.set('deployHash', saved.defaultKbSnapshot.deployHash);
      }

      await replaceRoute(`${Path.Knowledge}?${nextSearchParams.toString()}`);
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      message.error(
        error.message ||
          (editingKnowledgeBase ? '更新知识库失败' : '创建知识库失败'),
      );
    } finally {
      setCreatingKnowledgeBase(false);
    }
  }, [
    buildRuntimeScopeUrl,
    closeKnowledgeBaseModal,
    editingKnowledgeBase,
    kbForm,
    loadKnowledgeBases,
    refetchRuntimeSelector,
    replaceRoute,
    setSelectedKnowledgeBaseId,
  ]);

  const handleToggleKnowledgeArchive = useCallback(async () => {
    if (!activeKnowledgeBase) {
      return;
    }

    if (!canManageKnowledgeBaseLifecycle) {
      if (isSnapshotReadonlyKnowledgeBase) {
        message.info(snapshotReadonlyHint);
        return;
      }

      message.info('当前角色暂不支持管理知识库生命周期');
      return;
    }

    const isArchived = Boolean(activeKnowledgeBase.archivedAt);
    const actionLabel = resolveLifecycleActionLabel(
      activeKnowledgeBase.archivedAt,
    );

    try {
      setKnowledgeLifecycleSubmitting(true);
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/knowledge/bases/${activeKnowledgeBase.id}`,
        ),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            archivedAt: isArchived ? null : new Date().toISOString(),
          }),
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `${actionLabel}失败`);
      }

      const nextKnowledgeBases = await loadKnowledgeBases();
      await refetchRuntimeSelector();
      message.success(`${actionLabel}成功`);

      if (!isArchived) {
        const fallbackKnowledgeBase =
          nextKnowledgeBases.find(
            (item) => item.id !== activeKnowledgeBase.id,
          ) || null;
        const shouldRedirectRuntime =
          activeKnowledgeBase.id === currentKnowledgeBaseId;

        clearDetailAsset();
        setSelectedKnowledgeBaseId(
          fallbackKnowledgeBase?.id || currentKnowledgeBaseId || null,
        );

        if (!shouldRedirectRuntime) {
          return;
        }

        const nextUrl = fallbackKnowledgeBase
          ? buildRuntimeScopeUrl(
              Path.Knowledge,
              {},
              buildKnowledgeRuntimeSelector(fallbackKnowledgeBase),
            )
          : buildRuntimeScopeUrl(
              Path.Knowledge,
              {},
              activeKnowledgeBase.workspaceId
                ? { workspaceId: activeKnowledgeBase.workspaceId }
                : runtimeNavigationSelector,
            );

        if (nextUrl !== routerAsPath) {
          await replaceRoute(nextUrl);
        }
        return;
      }

      const refreshedKnowledgeBase =
        nextKnowledgeBases.find((item) => item.id === activeKnowledgeBase.id) ||
        activeKnowledgeBase;
      setSelectedKnowledgeBaseId(refreshedKnowledgeBase.id);
    } catch (error: any) {
      message.error(error.message || `${actionLabel}失败`);
    } finally {
      setKnowledgeLifecycleSubmitting(false);
    }
  }, [
    activeKnowledgeBase,
    buildKnowledgeRuntimeSelector,
    buildRuntimeScopeUrl,
    canManageKnowledgeBaseLifecycle,
    clearDetailAsset,
    currentKnowledgeBaseId,
    isSnapshotReadonlyKnowledgeBase,
    loadKnowledgeBases,
    refetchRuntimeSelector,
    replaceRoute,
    resolveLifecycleActionLabel,
    routerAsPath,
    runtimeNavigationSelector,
    setSelectedKnowledgeBaseId,
    snapshotReadonlyHint,
  ]);

  return {
    creatingKnowledgeBase,
    knowledgeLifecycleSubmitting,
    handleSaveKnowledgeBase,
    handleToggleKnowledgeArchive,
  };
}
