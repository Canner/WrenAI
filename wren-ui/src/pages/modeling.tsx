import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { forwardRef, useEffect, useMemo, useRef, type Key } from 'react';
import { message } from 'antd';
import styled from 'styled-components';
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
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import { useDeployStatusQuery } from '@/apollo/client/graphql/deploy.generated';
import {
  useCreateModelMutation,
  useDeleteModelMutation,
  useUpdateModelMutation,
} from '@/apollo/client/graphql/model.generated';
import {
  useUpdateModelMetadataMutation,
  useUpdateViewMetadataMutation,
} from '@/apollo/client/graphql/metadata.generated';
import {
  useCreateCalculatedFieldMutation,
  useUpdateCalculatedFieldMutation,
  useDeleteCalculatedFieldMutation,
} from '@/apollo/client/graphql/calculatedField.generated';
import {
  useCreateRelationshipMutation,
  useDeleteRelationshipMutation,
  useUpdateRelationshipMutation,
} from '@/apollo/client/graphql/relationship.generated';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import * as events from '@/utils/events';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';
import { deleteViewById } from '@/utils/viewRest';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';

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

const ForwardDiagram = forwardRef<DiagramRefHandle, any>(
  function ForwardDiagram(props, ref) {
    return <Diagram {...props} forwardRef={ref} />;
  },
);

const DiagramWrapper = styled.div`
  position: relative;
  height: 100%;
`;

const ModelingStage = styled.div`
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 20px;
  min-height: calc(100vh - 260px);

  @media (max-width: 1200px) {
    grid-template-columns: 1fr;
  }
`;

const ModelingSidebarPanel = styled.aside`
  height: calc(100vh - 260px);
  min-height: 640px;
  border-radius: 22px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: linear-gradient(180deg, #fcfbff 0%, #f7f5ff 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  padding: 16px 0;
  overflow: auto;
`;

const DiagramPanel = styled.section`
  height: calc(100vh - 260px);
  min-height: 640px;
  border-radius: 22px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fbfbff;
  overflow: hidden;
`;

export default function Modeling() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const searchParams = useSearchParams();
  const diagramRef = useRef<DiagramRefHandle | null>(null);
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const isModelingReadonly = isHistoricalSnapshotReadonly({
    selectorHasRuntime: Boolean(
      runtimeScopeNavigation.selector.deployHash ||
        runtimeScopeNavigation.selector.kbSnapshotId ||
        runtimeScopeNavigation.selector.runtimeScopeId,
    ),
    currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
    defaultKbSnapshotId:
      runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
  });

  const { data, refetch: refetchDiagram } = useDiagramQuery({
    fetchPolicy: 'cache-first',
    nextFetchPolicy: 'cache-first',
    skip: !runtimeScopePage.hasRuntimeScope,
    onCompleted: () => {
      diagramRef.current?.fitView();
    },
  });

  const deployStatusQueryResult = useDeployStatusQuery({
    pollInterval: 3000,
    fetchPolicy: 'no-cache',
    skip: !runtimeScopePage.hasRuntimeScope,
  });

  const refetchQueries = [{ query: DIAGRAM }];
  const getBaseOptions = (options: Record<string, any> = {}) => {
    return {
      onError: (error: { message?: string }) =>
        message.error(error?.message || '模型更新失败，请稍后重试'),
      refetchQueries,
      awaitRefetchQueries: true,
      ...options,
      onCompleted: () => {
        // refetch to get latest deploy status
        deployStatusQueryResult.refetch();

        options.onCompleted && options.onCompleted();
      },
    };
  };

  const [createCalculatedField, { loading: calculatedFieldCreating }] =
    useCreateCalculatedFieldMutation(
      getBaseOptions({
        onError: null,
        onCompleted: () => {
          message.success('已成功创建计算字段。');
        },
      }),
    );

  const [updateCalculatedField, { loading: calculatedFieldUpdating }] =
    useUpdateCalculatedFieldMutation(
      getBaseOptions({
        onError: null,
        onCompleted: () => {
          message.success('已成功更新计算字段。');
        },
      }),
    );

  const [deleteCalculatedField] = useDeleteCalculatedFieldMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('已成功删除计算字段。');
      },
    }),
  );

  const [createModelMutation, { loading: modelCreating }] =
    useCreateModelMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('已成功创建模型。');
        },
        refetchQueries,
      }),
    );

  const [deleteModelMutation] = useDeleteModelMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('已成功删除模型。');
      },
      refetchQueries,
    }),
  );

  const [updateModelMutation, { loading: modelUpdating }] =
    useUpdateModelMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('已成功更新模型。');
        },
        refetchQueries,
      }),
    );

  const [updateModelMetadata, { loading: modelMetadataUpdating }] =
    useUpdateModelMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('已成功更新模型元数据。');
        },
      }),
    );

  const [createRelationshipMutation, { loading: relationshipCreating }] =
    useCreateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('已成功创建关系。');
        },
      }),
    );

  const [deleteRelationshipMutation] = useDeleteRelationshipMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('已成功删除关系。');
      },
    }),
  );

  const [updateRelationshipMutation, { loading: relationshipUpdating }] =
    useUpdateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('已成功更新关系。');
        },
      }),
    );

  const [updateViewMetadata, { loading: viewMetadataUpdating }] =
    useUpdateViewMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('已成功更新视图元数据。');
        },
      }),
    );

  const diagramData = useMemo<NormalizedDiagram | null>(() => {
    if (!data) return null;
    const diagram = data.diagram;
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
  }, [data]);

  const metadataDrawer = useDrawerAction();
  const modelDrawer = useDrawerAction();
  const editMetadataModal = useModalAction();
  const calculatedFieldModal = useModalAction();
  const relationshipModal = useRelationshipModal(diagramData);

  const queryParams = {
    viewId: searchParams.get('viewId'),
    openMetadata: searchParams.get('openMetadata'),
  };

  // doing actions if the route has specific query params
  useEffect(() => {
    if (!diagramData) return;
    // open view metadata drawer
    if (queryParams.viewId && queryParams.openMetadata) {
      const searchedView = diagramData.views.find(
        (view) => view.viewId === Number(queryParams.viewId),
      );
      !!searchedView && metadataDrawer.openDrawer(searchedView);
      // clear query params after opening the drawer
      runtimeScopeNavigation.replaceWorkspace('/modeling');
    }
  }, [queryParams, diagramData]);

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
      message.error(
        error instanceof Error ? error.message : '删除视图失败，请稍后重试',
      );
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
            await deleteModelMutation({
              variables: { where: { id: modelId } },
            });
            break;
          case NODE_TYPE.CALCULATED_FIELD:
            if (!('columnId' in data) || data.columnId === undefined) {
              return;
            }
            const columnId = Number(data.columnId);
            if (!Number.isFinite(columnId)) {
              return;
            }
            await deleteCalculatedField({
              variables: { where: { id: columnId } },
            });
            break;
          case NODE_TYPE.RELATION:
            if (!('relationId' in data) || data.relationId === undefined) {
              return;
            }
            const relationId = Number(data.relationId);
            if (!Number.isFinite(relationId)) {
              return;
            }
            await deleteRelationshipMutation({
              variables: { where: { id: relationId } },
            });
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
      void handler();
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

  const calculatedFieldLoading =
    calculatedFieldCreating || calculatedFieldUpdating;
  const editMetadataLoading = modelMetadataUpdating || viewMetadataUpdating;
  const modelLoading = modelCreating || modelUpdating;
  const relationshipLoading = relationshipUpdating || relationshipCreating;

  return (
    <DeployStatusContext.Provider value={{ ...deployStatusQueryResult }}>
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
            onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Knowledge),
          },
          {
            key: 'modeling',
            label: '语义建模',
            onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Modeling),
          },
        ]}
        activeSectionKey="modeling"
        loading={runtimeScopePage.guarding || diagramData === null}
      >
        <ModelingStage>
          <ModelingSidebarPanel>
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
              />
            ) : null}
          </ModelingSidebarPanel>
          <DiagramPanel>
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
                await updateModelMetadata({
                  variables: { where: { id: modelId }, data: metadata },
                });
                break;
              }

              case NODE_TYPE.VIEW: {
                await updateViewMetadata({
                  variables: { where: { id: viewId }, data: metadata },
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
              await updateModelMutation({ variables: { where: { id }, data } });
            } else {
              await createModelMutation({ variables: { data } });
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
              await updateCalculatedField({
                variables: { where: { id }, data },
              });
            } else {
              await createCalculatedField({ variables: { data } });
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
            if (values.relationId) {
              await updateRelationshipMutation({
                variables: {
                  where: { id: values.relationId },
                  data: { type: relation.type },
                },
              });
            } else {
              await createRelationshipMutation({
                variables: {
                  data: {
                    fromModelId: Number(relation.fromField.modelId),
                    fromColumnId: Number(relation.fromField.fieldId),
                    toModelId: Number(relation.toField.modelId),
                    toColumnId: Number(relation.toField.fieldId),
                    type: relation.type,
                  },
                },
              });
            }
          }}
        />
      </ConsoleShellLayout>
    </DeployStatusContext.Provider>
  );
}
