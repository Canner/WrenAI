import { useRouter } from 'next/router';
import { Select, Space } from 'antd';
import styled, { css } from 'styled-components';
import {
  buildRuntimeScopeUrl,
  omitRuntimeScopeQuery,
} from '@/runtime/client/runtimeScope';
import useRuntimeScopeTransition from '@/hooks/useRuntimeScopeTransition';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { Path } from '@/utils/enum';
import {
  getReferenceDisplayKnowledgeName,
  getReferenceDisplaySnapshotName,
  getReferenceDisplayWorkspaceName,
} from '@/utils/referenceDemoKnowledge';

const SelectorGroup = styled(Space)`
  ${(props: { $layout?: 'inline' | 'stacked' }) =>
    props.$layout === 'stacked'
      ? css`
          width: 100%;

          .ant-space-item {
            width: 100%;
          }

          .runtime-scope-select,
          .runtime-scope-workspace {
            width: 100%;
            min-width: 0;
          }
        `
      : css`
          .runtime-scope-select {
            min-width: 168px;
          }

          .runtime-scope-workspace {
            min-width: 196px;
          }
        `}
`;

interface Props {
  className?: string;
  layout?: 'inline' | 'stacked';
  size?: 'large' | 'middle' | 'small';
  scope?: 'workspace' | 'knowledge' | 'full';
}

export default function RuntimeScopeSelector({
  className,
  layout = 'inline',
  size = 'small',
  scope = 'full',
}: Props) {
  const router = useRouter();
  const runtimeScopeTransition = useRuntimeScopeTransition();
  const runtimeSelector = useRuntimeSelectorState();
  const selectorState = runtimeSelector.runtimeSelectorState;
  const loading = runtimeSelector.loading;
  const initialLoading = runtimeSelector.initialLoading;
  const currentWorkspace = selectorState?.currentWorkspace;
  const workspaces = selectorState?.workspaces || [];
  const currentKnowledgeBase = selectorState?.currentKnowledgeBase;
  const currentKbSnapshot = selectorState?.currentKbSnapshot;
  const onThreadPage = router.pathname === Path.Thread;
  const baseParams = omitRuntimeScopeQuery(router.query);
  const showWorkspace =
    scope === 'workspace' || scope === 'knowledge' || scope === 'full';
  const showKnowledgeBase = scope === 'knowledge' || scope === 'full';
  const showKbSnapshot = scope === 'full';

  if (!selectorState || !currentWorkspace) {
    return null;
  }

  const navigateWithSelector = (nextSelector: {
    workspaceId: string;
    knowledgeBaseId?: string;
    kbSnapshotId?: string;
    targetPath?: string;
  }) => {
    const targetPath = nextSelector.targetPath || router.pathname;
    const nextUrl = buildRuntimeScopeUrl(
      targetPath,
      targetPath === router.pathname ? baseParams : {},
      nextSelector,
    );
    runtimeScopeTransition.transitionTo(nextUrl);
  };

  return (
    <SelectorGroup
      className={className}
      size={layout === 'stacked' ? [0, 8] : [8, 0]}
      direction={layout === 'stacked' ? 'vertical' : 'horizontal'}
      $layout={layout}
    >
      {showWorkspace ? (
        <Select
          className="runtime-scope-select runtime-scope-workspace"
          size={size}
          loading={initialLoading}
          value={currentWorkspace?.id}
          disabled={
            initialLoading ||
            runtimeScopeTransition.transitioning ||
            workspaces.length <= 1
          }
          options={workspaces.map((workspace) => ({
            label: getReferenceDisplayWorkspaceName(workspace.name),
            value: workspace.id,
          }))}
          placeholder="工作区"
          dropdownMatchSelectWidth={false}
          optionLabelProp="label"
          onChange={(workspaceId: string) => {
            if (!workspaceId || workspaceId === currentWorkspace?.id) {
              return;
            }

            navigateWithSelector({
              workspaceId,
              ...(onThreadPage ? { targetPath: Path.Home } : {}),
            });
          }}
        />
      ) : null}
      {showKnowledgeBase ? (
        <Select
          className="runtime-scope-select"
          size={size}
          loading={loading}
          value={currentKnowledgeBase?.id}
          disabled={
            loading ||
            runtimeScopeTransition.transitioning ||
            onThreadPage ||
            !selectorState.knowledgeBases.length
          }
          options={selectorState.knowledgeBases.map((knowledgeBase) => ({
            label: getReferenceDisplayKnowledgeName(knowledgeBase.name),
            value: knowledgeBase.id,
          }))}
          placeholder="知识库"
          dropdownMatchSelectWidth={false}
          onChange={(knowledgeBaseId: string) => {
            if (
              !currentWorkspace?.id ||
              !knowledgeBaseId ||
              knowledgeBaseId === currentKnowledgeBase?.id
            ) {
              return;
            }

            navigateWithSelector({
              workspaceId: currentWorkspace.id,
              knowledgeBaseId,
            });
          }}
        />
      ) : null}
      {showKbSnapshot ? (
        <Select
          className="runtime-scope-select"
          size={size}
          loading={loading}
          value={currentKbSnapshot?.id}
          disabled={
            loading ||
            runtimeScopeTransition.transitioning ||
            onThreadPage ||
            !currentWorkspace?.id ||
            !currentKnowledgeBase?.id ||
            !selectorState.kbSnapshots.length
          }
          options={selectorState.kbSnapshots.map((kbSnapshot) => ({
            label: getReferenceDisplaySnapshotName(kbSnapshot.displayName),
            value: kbSnapshot.id,
          }))}
          placeholder="快照"
          dropdownMatchSelectWidth={false}
          onChange={(kbSnapshotId: string) => {
            if (
              !currentWorkspace?.id ||
              !currentKnowledgeBase?.id ||
              !kbSnapshotId ||
              kbSnapshotId === currentKbSnapshot?.id
            ) {
              return;
            }

            navigateWithSelector({
              workspaceId: currentWorkspace.id,
              knowledgeBaseId: currentKnowledgeBase.id,
              kbSnapshotId,
            });
          }}
        />
      ) : null}
    </SelectorGroup>
  );
}
