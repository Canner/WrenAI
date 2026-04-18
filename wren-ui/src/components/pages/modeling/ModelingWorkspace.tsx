import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Key,
} from 'react';
import { message, Skeleton } from 'antd';
import styled from 'styled-components';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { MORE_ACTION, NODE_TYPE, Path } from '@/utils/enum';
import { editCalculatedField } from '@/utils/modelingHelper';
import { ComposeDiagram, Diagram as RuntimeDiagram } from '@/utils/data';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import EditMetadataModal from '@/components/pages/modeling/EditMetadataModal';
import CalculatedFieldModal from '@/components/modals/CalculatedFieldModal';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import ModelingSidebar from '@/components/sidebar/Modeling';
import RelationModal, {
  RelationFormValues,
} from '@/components/modals/RelationModal';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { convertFormValuesToIdentifier } from '@/hooks/useCombineFieldOptions';
import { ClickPayload } from '@/components/diagram/Context';
import { DeployStatusContext } from '@/components/deploy/Context';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import * as events from '@/utils/events';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';
import { deleteViewById } from '@/utils/viewRest';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import {
  buildKnowledgeDiagramUrl,
  loadKnowledgeDiagramPayload,
} from '@/utils/knowledgeDiagramRest';
import {
  createCalculatedField,
  createModel,
  createRelationship,
  deleteCalculatedField,
  deleteModel,
  deleteRelationship,
  updateCalculatedField,
  updateModel,
  updateModelMetadata,
  updateRelationship,
  updateViewMetadata,
} from '@/utils/modelingRest';
import useDeployStatusRest from '@/hooks/useDeployStatusRest';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';

const Diagram = dynamic(() => import('@/components/diagram'), { ssr: false });
// https://github.com/vercel/next.js/issues/4957#issuecomment-413841689
type DiagramNode = {
  id: string;
  position: {
    x: number;
    y: number;
  };
  width?: number;
  height?: number;
};

type DiagramRefHandle = {
  fitView: () => void;
  getNodes: () => DiagramNode[];
  fitBounds: (bounds: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  }) => void;
};

type NormalizedDiagram = Omit<RuntimeDiagram, 'models' | 'views'> & {
  models: NonNullable<RuntimeDiagram['models'][number]>[];
  views: NonNullable<RuntimeDiagram['views'][number]>[];
};

export type ModelingWorkspaceProps = {
  embedded?: boolean;
};

const ForwardDiagram = forwardRef<DiagramRefHandle, any>(
  function ForwardDiagram(props, ref) {
    return <Diagram {...props} forwardRef={ref} />;
  },
);

const DiagramWrapper = styled.div`
  position: relative;
  height: 100%;
`;

const ModelingStage = styled.div<{ $embedded?: boolean }>`
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 20px;
  min-height: ${(props) =>
    props.$embedded ? 'min(78vh, 920px)' : 'calc(100vh - 260px)'};

  @media (max-width: 1200px) {
    grid-template-columns: 1fr;
    min-height: auto;
  }
`;

const ModelingSidebarPanel = styled.aside<{ $embedded?: boolean }>`
  height: ${(props) =>
    props.$embedded ? 'min(78vh, 920px)' : 'calc(100vh - 260px)'};
  min-height: ${(props) => (props.$embedded ? '680px' : '640px')};
  border-radius: ${(props) => (props.$embedded ? '20px' : '22px')};
  border: 1px solid var(--nova-outline-soft);
  background: ${(props) =>
    props.$embedded
      ? 'rgba(255, 255, 255, 0.96)'
      : 'linear-gradient(180deg, #fcfbff 0%, #f7f5ff 100%)'};
  box-shadow: ${(props) =>
    props.$embedded
      ? '0 14px 30px rgba(15, 23, 42, 0.04)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.7)'};
  padding: ${(props) => (props.$embedded ? '12px 0' : '16px 0')};
  overflow: auto;

  @media (max-width: 1200px) {
    height: 560px;
    min-height: 560px;
  }
`;

const DiagramPanel = styled.section<{ $embedded?: boolean }>`
  height: ${(props) =>
    props.$embedded ? 'min(78vh, 920px)' : 'calc(100vh - 260px)'};
  min-height: ${(props) => (props.$embedded ? '680px' : '640px')};
  border-radius: ${(props) => (props.$embedded ? '20px' : '22px')};
  border: 1px solid var(--nova-outline-soft);
  background: ${(props) => (props.$embedded ? '#ffffff' : '#fbfbff')};
  box-shadow: ${(props) =>
    props.$embedded ? '0 14px 30px rgba(15, 23, 42, 0.04)' : 'none'};
  overflow: hidden;

  @media (max-width: 1200px) {
    height: 560px;
    min-height: 560px;
  }
`;

const EmbeddedLoadingState = styled.div`
  border-radius: 20px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.04);
  padding: 24px;
`;

export default function ModelingWorkspace({
  embedded = false,
}: ModelingWorkspaceProps) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const searchParams = useSearchParams();
  const diagramRef = useRef<DiagramRefHandle | null>(null);
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const isModelingReadonly =
    runtimeSelectorState?.currentKnowledgeBase?.kind === 'system_sample' ||
    isHistoricalSnapshotReadonly({
      selectorHasRuntime: Boolean(
        runtimeScopeNavigation.selector.deployHash ||
          runtimeScopeNavigation.selector.kbSnapshotId ||
          runtimeScopeNavigation.selector.runtimeScopeId,
      ),
      currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
      defaultKbSnapshotId:
        runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
    });

  const clearPath = embedded ? Path.Knowledge : Path.Modeling;
  const clearParams = embedded
    ? buildKnowledgeWorkbenchParams('modeling')
    : undefined;

  const deployStatusQueryResult = useDeployStatusRest();
  const [diagramPayload, setDiagramPayload] = useState<{
    diagram: RuntimeDiagram;
  } | null>(null);
  const [_diagramLoading, setDiagramLoading] = useState(false);
  const [calculatedFieldLoading, setCalculatedFieldLoading] = useState(false);
  const [editMetadataLoading, setEditMetadataLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const diagramRequestUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildKnowledgeDiagramUrl(runtimeScopeNavigation.selector)
        : null,
    [runtimeScopeNavigation.selector, runtimeScopePage.hasRuntimeScope],
  );

  const refetchDiagram = useCallback(async () => {
    if (!diagramRequestUrl) {
      setDiagramPayload(null);
      setDiagramLoading(false);
      return null;
    }

    setDiagramLoading(true);
    try {
      const payload = await loadKnowledgeDiagramPayload({
        requestUrl: diagramRequestUrl,
        useCache: false,
      });
      setDiagramPayload(payload);
      return payload;
    } finally {
      setDiagramLoading(false);
    }
  }, [diagramRequestUrl]);

  const refreshModelingData = useCallback(
    async ({ fitView = false }: { fitView?: boolean } = {}) => {
      const [nextDiagram] = await Promise.all([
        refetchDiagram(),
        deployStatusQueryResult.refetch(),
      ]);
      if (fitView) {
        diagramRef.current?.fitView();
      }
      return nextDiagram;
    },
    [deployStatusQueryResult, refetchDiagram],
  );

  useEffect(() => {
    if (!runtimeScopePage.hasRuntimeScope) {
      setDiagramPayload(null);
      setDiagramLoading(false);
      return;
    }

    void refreshModelingData({ fitView: true }).catch((error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载图谱失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    });
  }, [refreshModelingData, runtimeScopePage.hasRuntimeScope]);

  const diagramData = useMemo<NormalizedDiagram | null>(() => {
    if (!diagramPayload) return null;
    const diagram = diagramPayload.diagram;
    if (!diagram) return null;
    return {
      ...diagram,
      models: (diagram.models || []).filter(
        (model): model is NonNullable<RuntimeDiagram['models'][number]> =>
          Boolean(model),
      ),
      views: (diagram.views || []).filter(
        (view): view is NonNullable<RuntimeDiagram['views'][number]> =>
          Boolean(view),
      ),
    };
  }, [diagramPayload]);

  const metadataDrawer = useDrawerAction();
  const modelDrawer = useDrawerAction();
  const editMetadataModal = useModalAction();
  const calculatedFieldModal = useModalAction();
  const relationshipModal = useRelationshipModal(diagramData);

  const runDiagramMutation = useCallback(
    async <T,>(
      setLoadingState: (loading: boolean) => void,
      action: () => Promise<T>,
    ) => {
      setLoadingState(true);
      try {
        const result = await action();
        await refreshModelingData();
        return result;
      } finally {
        setLoadingState(false);
      }
    },
    [refreshModelingData],
  );

  const queryParams = {
    modelId: searchParams.get('modelId'),
    viewId: searchParams.get('viewId'),
    openMetadata: searchParams.get('openMetadata'),
    openModelDrawer: searchParams.get('openModelDrawer'),
    relationId: searchParams.get('relationId'),
    openRelationModal: searchParams.get('openRelationModal'),
  };

  // doing actions if the route has specific query params
  useEffect(() => {
    if (!diagramData) return;
    if (queryParams.modelId && queryParams.openMetadata) {
      const searchedModel = diagramData.models.find(
        (model) => model.modelId === Number(queryParams.modelId),
      );
      !!searchedModel && metadataDrawer.openDrawer(searchedModel);
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    // open view metadata drawer
    if (queryParams.viewId && queryParams.openMetadata) {
      const searchedView = diagramData.views.find(
        (view) => view.viewId === Number(queryParams.viewId),
      );
      !!searchedView && metadataDrawer.openDrawer(searchedView);
      // clear query params after opening the drawer
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    if (queryParams.openModelDrawer) {
      modelDrawer.openDrawer();
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    if (queryParams.relationId && queryParams.openRelationModal) {
      const relationId = Number(queryParams.relationId);
      const searchedRelation = diagramData.models
        .flatMap((model) => model.relationFields || [])
        .find((relation) => relation?.relationId === relationId);
      if (searchedRelation) {
        relationshipModal.openModal(searchedRelation);
      }
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
      return;
    }

    if (queryParams.modelId && queryParams.openRelationModal) {
      const searchedModel = diagramData.models.find(
        (model) => model.modelId === Number(queryParams.modelId),
      );
      if (searchedModel) {
        relationshipModal.openModal(searchedModel);
      }
      runtimeScopeNavigation.replaceWorkspace(clearPath, clearParams);
    }
  }, [
    queryParams,
    diagramData,
    metadataDrawer,
    modelDrawer,
    relationshipModal,
    runtimeScopeNavigation,
  ]);

  useEffect(() => {
    if (!metadataDrawer.state.visible || !diagramData) {
      return;
    }
    const selectedData = metadataDrawer.state.defaultValue as
      | ComposeDiagram
      | undefined;
    if (!selectedData) {
      return;
    }
    let currentNodeData: ComposeDiagram | undefined;
    switch (selectedData.nodeType) {
      case NODE_TYPE.MODEL: {
        currentNodeData = diagramData.models.find(
          (model) => model.modelId === selectedData.modelId,
        );
        break;
      }

      case NODE_TYPE.VIEW: {
        currentNodeData = diagramData.views.find(
          (view) => view.viewId === selectedData.viewId,
        );
        break;
      }

      default:
        break;
    }
    metadataDrawer.updateState(currentNodeData);
  }, [diagramData]);

  // register event listener for global
  useEffect(() => {
    events.subscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    return () => {
      events.unsubscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    };
  }, []);

  const goToFirstModel = () => {
    if (diagramRef.current) {
      const { getNodes } = diagramRef.current;
      const node = getNodes()[0];
      node?.id && onSelect([node.id]);
    }
  };

  const onSelect = (selectKeys: Key[]) => {
    const firstSelectedKey = selectKeys[0];
    if (!diagramRef.current || !firstSelectedKey) {
      return;
    }
    const { getNodes, fitBounds } = diagramRef.current;
    const node = getNodes().find(
      (candidate) => candidate.id === String(firstSelectedKey),
    );
    if (!node) {
      return;
    }
    const position = {
      ...node.position,
      width: node.width,
      height: node.height,
    };
    fitBounds(position);
  };

  const onNodeClick = async (payload: ClickPayload) => {
    metadataDrawer.openDrawer(payload.data);
  };

  const notifyModelingReadonly = () => {
    message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
  };

  const handleDeleteView = async (viewId: number) => {
    try {
      await deleteViewById(runtimeScopeNavigation.selector, viewId);
      await refetchDiagram();
      await deployStatusQueryResult.refetch();
      message.success('已成功删除视图。');
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '删除视图失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    }
  };

  const onMoreClick = (payload: ClickPayload) => {
    if (!diagramData) {
      return;
    }
    const { type, data } = payload;
    const { nodeType } = data;
    if (isModelingReadonly) {
      notifyModelingReadonly();
      return;
    }
    const action: Partial<Record<MORE_ACTION, () => void | Promise<void>>> = {
      [MORE_ACTION.UPDATE_COLUMNS]: () => {
        switch (nodeType) {
          case NODE_TYPE.MODEL:
            modelDrawer.openDrawer(data);
            break;
          default:
            console.log(data);
            break;
        }
      },
      [MORE_ACTION.EDIT]: () => {
        switch (nodeType) {
          case NODE_TYPE.CALCULATED_FIELD:
            editCalculatedField(
              { ...payload, diagramData },
              calculatedFieldModal.openModal,
            );
            break;
          case NODE_TYPE.RELATION:
            relationshipModal.openModal(data);
            break;

          default:
            console.log(data);
            break;
        }
      },
      [MORE_ACTION.DELETE]: async () => {
        switch (nodeType) {
          case NODE_TYPE.MODEL:
            if (!('modelId' in data) || data.modelId === undefined) {
              return;
            }
            const modelId = Number(data.modelId);
            if (!Number.isFinite(modelId)) {
              return;
            }
            await runDiagramMutation(
              () => undefined,
              async () => {
                await deleteModel(runtimeScopeNavigation.selector, modelId);
                message.success('已成功删除模型。');
              },
            );
            break;
          case NODE_TYPE.CALCULATED_FIELD:
            if (!('columnId' in data) || data.columnId === undefined) {
              return;
            }
            const columnId = Number(data.columnId);
            if (!Number.isFinite(columnId)) {
              return;
            }
            await runDiagramMutation(
              () => undefined,
              async () => {
                await deleteCalculatedField(
                  runtimeScopeNavigation.selector,
                  columnId,
                );
                message.success('已成功删除计算字段。');
              },
            );
            break;
          case NODE_TYPE.RELATION:
            if (!('relationId' in data) || data.relationId === undefined) {
              return;
            }
            const relationId = Number(data.relationId);
            if (!Number.isFinite(relationId)) {
              return;
            }
            await runDiagramMutation(
              () => undefined,
              async () => {
                await deleteRelationship(
                  runtimeScopeNavigation.selector,
                  relationId,
                );
                message.success('已成功删除关系。');
              },
            );
            break;
          case NODE_TYPE.VIEW:
            if (!('viewId' in data) || data.viewId === undefined) {
              return;
            }
            const viewId = Number(data.viewId);
            if (!Number.isFinite(viewId)) {
              return;
            }
            await handleDeleteView(viewId);
            break;

          default:
            console.log(data);
            break;
        }
      },
    };
    const handler = action[type as MORE_ACTION];
    if (handler) {
      void Promise.resolve(handler()).catch((error) => {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '建模操作失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      });
    }
  };

  const onAddClick = (payload: ClickPayload) => {
    if (isModelingReadonly) {
      notifyModelingReadonly();
      return;
    }
    const { targetNodeType, data } = payload;
    switch (targetNodeType) {
      case NODE_TYPE.CALCULATED_FIELD:
        if (!diagramData) {
          return;
        }
        calculatedFieldModal.openModal(undefined, {
          models: diagramData.models,
          sourceModel: data,
        });
        break;
      case NODE_TYPE.RELATION:
        relationshipModal.openModal(data);
        break;
      default:
        console.log('add', targetNodeType);
        break;
    }
  };

  const workspaceContent = (
    <>
      <ModelingStage $embedded={embedded}>
        <ModelingSidebarPanel $embedded={embedded}>
          {diagramData ? (
            <ModelingSidebar
              data={diagramData}
              onOpenModelDrawer={() => {
                if (isModelingReadonly) {
                  notifyModelingReadonly();
                  return;
                }
                modelDrawer.openDrawer();
              }}
              onSelect={onSelect}
              readOnly={isModelingReadonly}
              onRefresh={refreshModelingData}
            />
          ) : null}
        </ModelingSidebarPanel>
        <DiagramPanel $embedded={embedded}>
          <DiagramWrapper>
            <ForwardDiagram
              ref={diagramRef}
              data={diagramData}
              onMoreClick={onMoreClick}
              onNodeClick={onNodeClick}
              onAddClick={onAddClick}
              readOnly={isModelingReadonly}
            />
          </DiagramWrapper>
        </DiagramPanel>
      </ModelingStage>
      <MetadataDrawer
        {...metadataDrawer.state}
        onClose={metadataDrawer.closeDrawer}
        readOnly={isModelingReadonly}
        onEditClick={(value) => {
          if (isModelingReadonly) {
            notifyModelingReadonly();
            return;
          }
          editMetadataModal.openModal(value);
        }}
      />
      <EditMetadataModal
        {...editMetadataModal.state}
        onClose={editMetadataModal.closeModal}
        loading={editMetadataLoading}
        onSubmit={async ({ nodeType, data }) => {
          if (isModelingReadonly) {
            notifyModelingReadonly();
            return;
          }
          const { modelId, viewId, ...metadata } = data;
          switch (nodeType) {
            case NODE_TYPE.MODEL: {
              await runDiagramMutation(setEditMetadataLoading, async () => {
                await updateModelMetadata(
                  runtimeScopeNavigation.selector,
                  Number(modelId),
                  metadata,
                );
              });
              break;
            }

            case NODE_TYPE.VIEW: {
              await runDiagramMutation(setEditMetadataLoading, async () => {
                await updateViewMetadata(
                  runtimeScopeNavigation.selector,
                  Number(viewId),
                  metadata,
                );
              });
              break;
            }

            default:
              console.log('onSubmit', nodeType, data);
              break;
          }
        }}
      />
      <ModelDrawer
        {...modelDrawer.state}
        onClose={modelDrawer.closeDrawer}
        submitting={modelLoading}
        readOnly={isModelingReadonly}
        onSubmit={async ({ id, data }) => {
          if (isModelingReadonly) {
            notifyModelingReadonly();
            return;
          }
          if (id) {
            await runDiagramMutation(setModelLoading, async () => {
              await updateModel(runtimeScopeNavigation.selector, id, data);
            });
          } else {
            await runDiagramMutation(setModelLoading, async () => {
              await createModel(runtimeScopeNavigation.selector, data);
            });
          }
        }}
      />
      <CalculatedFieldModal
        {...calculatedFieldModal.state}
        onClose={calculatedFieldModal.closeModal}
        loading={calculatedFieldLoading}
        onSubmit={async ({ id, data }) => {
          if (isModelingReadonly) {
            notifyModelingReadonly();
            return;
          }
          if (id) {
            await runDiagramMutation(setCalculatedFieldLoading, async () => {
              await updateCalculatedField(
                runtimeScopeNavigation.selector,
                id,
                data,
              );
            });
          } else {
            await runDiagramMutation(setCalculatedFieldLoading, async () => {
              await createCalculatedField(
                runtimeScopeNavigation.selector,
                data,
              );
            });
          }
        }}
      />
      <RelationModal
        {...relationshipModal.state}
        onClose={relationshipModal.onClose}
        loading={relationshipLoading}
        onSubmit={async (
          values: RelationFormValues & { relationId?: number },
        ) => {
          if (isModelingReadonly) {
            notifyModelingReadonly();
            return;
          }
          const relation = convertFormValuesToIdentifier(values);
          const relationId = values.relationId;
          if (relationId != null) {
            await runDiagramMutation(setRelationshipLoading, async () => {
              await updateRelationship(
                runtimeScopeNavigation.selector,
                relationId,
                {
                  type: relation.type,
                },
              );
            });
          } else {
            await runDiagramMutation(setRelationshipLoading, async () => {
              await createRelationship(runtimeScopeNavigation.selector, {
                fromModelId: Number(relation.fromField.modelId),
                fromColumnId: Number(relation.fromField.fieldId),
                toModelId: Number(relation.toField.modelId),
                toColumnId: Number(relation.toField.fieldId),
                type: relation.type,
              });
            });
          }
        }}
      />
    </>
  );

  const loading = runtimeScopePage.guarding || diagramData === null;

  return (
    <DeployStatusContext.Provider value={{ ...deployStatusQueryResult }}>
      {embedded ? (
        loading ? (
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
            isModelingReadonly ? ` ${HISTORICAL_SNAPSHOT_READONLY_HINT}` : ''
          }`}
          sections={[
            {
              key: 'overview',
              label: '知识库概览',
              onClick: () =>
                runtimeScopeNavigation.pushWorkspace(Path.Knowledge),
            },
            {
              key: 'modeling',
              label: '语义建模',
              onClick: () =>
                runtimeScopeNavigation.pushWorkspace(
                  Path.Knowledge,
                  buildKnowledgeWorkbenchParams('modeling'),
                ),
            },
          ]}
          activeSectionKey="modeling"
          loading={loading}
        >
          {workspaceContent}
        </ConsoleShellLayout>
      )}
    </DeployStatusContext.Provider>
  );
}
