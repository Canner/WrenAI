import { Skeleton } from 'antd';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import { DeployStatusContext } from '@/components/deploy/Context';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';
import { Path } from '@/utils/enum';
import { EmbeddedLoadingState } from '@/features/modeling/modelingWorkspaceLayout';
import ModelingWorkspaceContent from '@/features/modeling/ModelingWorkspaceContent';
import useModelingWorkspaceInteractions from '@/features/modeling/useModelingWorkspaceInteractions';
import useModelingWorkspaceMutationHandlers from '@/features/modeling/useModelingWorkspaceMutationHandlers';
import useModelingWorkspaceState from '@/features/modeling/useModelingWorkspaceState';

export type ModelingWorkspaceProps = {
  embedded?: boolean;
};

export default function ModelingWorkspace({
  embedded = false,
}: ModelingWorkspaceProps) {
  const modelingState = useModelingWorkspaceState();
  const metadataDrawer = useDrawerAction();
  const modelDrawer = useDrawerAction();
  const editMetadataModal = useModalAction();
  const calculatedFieldModal = useModalAction();
  const relationshipModal = useRelationshipModal(modelingState.diagramData);

  const runDiagramMutation = async <T,>(
    setLoadingState: (loading: boolean) => void,
    action: () => Promise<T>,
  ) => {
    setLoadingState(true);
    try {
      const result = await action();
      await modelingState.refreshModelingData();
      return result;
    } finally {
      setLoadingState(false);
    }
  };

  const {
    onSelect,
    onNodeClick,
    onMoreClick,
    onAddClick,
    notifyModelingReadonly,
    buildRelationshipMutationInput,
  } = useModelingWorkspaceInteractions({
    diagramData: modelingState.diagramData,
    queryParams: modelingState.queryParams,
    metadataDrawer,
    modelDrawer,
    calculatedFieldModal,
    relationshipModal,
    diagramRef: modelingState.diagramRef,
    isModelingReadonly: modelingState.isModelingReadonly,
    runDiagramMutation,
    refetchDiagram: modelingState.refetchDiagram,
    refetchDeployStatus: modelingState.deployStatusQueryResult.refetch,
    runtimeScopeNavigation: modelingState.runtimeScopeNavigation,
  });
  const mutationHandlers = useModelingWorkspaceMutationHandlers({
    isModelingReadonly: modelingState.isModelingReadonly,
    notifyModelingReadonly,
    runtimeSelector: modelingState.runtimeScopeNavigation.selector,
    runDiagramMutation,
    buildRelationshipMutationInput,
  });

  const workspaceContent = (
    <ModelingWorkspaceContent
      embedded={embedded}
      diagramRef={modelingState.diagramRef}
      diagramData={modelingState.diagramData}
      isModelingReadonly={modelingState.isModelingReadonly}
      metadataDrawer={metadataDrawer}
      editMetadataModal={editMetadataModal}
      calculatedFieldModal={calculatedFieldModal}
      modelDrawer={modelDrawer}
      relationshipModal={relationshipModal}
      editMetadataLoading={mutationHandlers.editMetadataLoading}
      modelLoading={mutationHandlers.modelLoading}
      calculatedFieldLoading={mutationHandlers.calculatedFieldLoading}
      relationshipLoading={mutationHandlers.relationshipLoading}
      onOpenModelDrawer={() => {
        if (modelingState.isModelingReadonly) {
          notifyModelingReadonly();
          return;
        }
        modelDrawer.openDrawer();
      }}
      onSelect={onSelect}
      onRefresh={modelingState.refreshModelingData}
      onMoreClick={onMoreClick}
      onNodeClick={onNodeClick}
      onAddClick={onAddClick}
      onOpenEditMetadata={(value) => {
        if (modelingState.isModelingReadonly) {
          notifyModelingReadonly();
          return;
        }
        editMetadataModal.openModal(value);
      }}
      onEditMetadataSubmit={mutationHandlers.onEditMetadataSubmit}
      onModelSubmit={mutationHandlers.onModelSubmit}
      onCalculatedFieldSubmit={mutationHandlers.onCalculatedFieldSubmit}
      onRelationshipSubmit={mutationHandlers.onRelationshipSubmit}
    />
  );

  return (
    <DeployStatusContext.Provider
      value={{ ...modelingState.deployStatusQueryResult }}
    >
      {embedded ? (
        modelingState.loading ? (
          <EmbeddedLoadingState>
            <Skeleton active paragraph={{ rows: 8 }} />
          </EmbeddedLoadingState>
        ) : (
          workspaceContent
        )
      ) : (
        <ConsoleShellLayout
          activeNav="knowledge"
          title="语义建模"
          description={`围绕当前知识库维护模型、视图、关系和计算字段，作为问答、SQL 生成与图表展示的统一语义层。${
            modelingState.isModelingReadonly
              ? ` ${modelingState.readonlyHint}`
              : ''
          }`}
          sections={[
            {
              key: 'overview',
              label: '知识库概览',
              onClick: () =>
                modelingState.runtimeScopeNavigation.pushWorkspace(
                  Path.Knowledge,
                ),
            },
            {
              key: 'modeling',
              label: '语义建模',
              onClick: () =>
                modelingState.runtimeScopeNavigation.pushWorkspace(
                  Path.Knowledge,
                  buildKnowledgeWorkbenchParams('modeling'),
                ),
            },
          ]}
          activeSectionKey="modeling"
          loading={modelingState.loading}
        >
          {workspaceContent}
        </ConsoleShellLayout>
      )}
    </DeployStatusContext.Provider>
  );
}
