import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { message } from 'antd';
import styled from 'styled-components';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import { editCalculatedField } from '@/utils/modelingHelper';
import SiderLayout from '@/components/layouts/SiderLayout';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import EditMetadataModal from '@/components/pages/modeling/EditMetadataModal';
import CalculatedFieldModal from '@/components/modals/CalculatedFieldModal';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import RelationModal, {
  RelationFormValues,
} from '@/components/modals/RelationModal';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import { convertFormValuesToIdentifier } from '@/hooks/useCombineFieldOptions';
import { ClickPayload } from '@/components/diagram/Context';
import { DeployStatusContext } from '@/components/deploy/Context';
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import { LIST_MODELS } from '@/apollo/client/graphql/model';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import { useDeployStatusQuery } from '@/apollo/client/graphql/deploy.generated';
import { useDeleteViewMutation } from '@/apollo/client/graphql/view.generated';
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
import * as events from '@/utils/events';

const Diagram = dynamic(() => import('@/components/diagram'), { ssr: false });
// https://github.com/vercel/next.js/issues/4957#issuecomment-413841689
const ForwardDiagram = forwardRef(function ForwardDiagram(props: any, ref) {
  return <Diagram {...props} forwardRef={ref} />;
});

const DiagramWrapper = styled.div`
  position: relative;
  height: 100%;
`;

export default function Modeling() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const diagramRef = useRef(null);

  const { data } = useDiagramQuery({
    fetchPolicy: 'cache-and-network',
    onCompleted: () => {
      diagramRef.current?.fitView();
    },
  });

  const deployStatusQueryResult = useDeployStatusQuery({
    pollInterval: 1000,
    fetchPolicy: 'no-cache',
  });

  const refetchQueries = [{ query: DIAGRAM }];
  const refetchQueriesForModel = [...refetchQueries, { query: LIST_MODELS }];
  const getBaseOptions = (options) => {
    return {
      onError: (error) => console.error(error),
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
          message.success('Successfully created calculated field.');
        },
      }),
    );

  const [updateCalculatedField, { loading: calculatedFieldUpdating }] =
    useUpdateCalculatedFieldMutation(
      getBaseOptions({
        onError: null,
        onCompleted: () => {
          message.success('Successfully updated calculated field.');
        },
      }),
    );

  const [deleteCalculatedField] = useDeleteCalculatedFieldMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted calculated field.');
      },
    }),
  );

  const [createModelMutation, { loading: modelCreating }] =
    useCreateModelMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully created model.');
        },
        refetchQueries: refetchQueriesForModel,
      }),
    );

  const [deleteModelMutation] = useDeleteModelMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted model.');
      },
      refetchQueries: refetchQueriesForModel,
    }),
  );

  const [updateModelMutation, { loading: modelUpdating }] =
    useUpdateModelMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated model.');
        },
        refetchQueries: refetchQueriesForModel,
      }),
    );

  const [deleteViewMutation] = useDeleteViewMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted view.');
      },
    }),
  );

  const [updateModelMetadata, { loading: modelMetadataUpdating }] =
    useUpdateModelMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated model metadata.');
        },
      }),
    );

  const [createRelationshipMutation, { loading: relationshipCreating }] =
    useCreateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully created relationship.');
        },
      }),
    );

  const [deleteRelationshipMutation] = useDeleteRelationshipMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted relationship.');
      },
    }),
  );

  const [updateRelationshipMutation, { loading: relationshipUpdating }] =
    useUpdateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated relationship.');
        },
      }),
    );

  const [updateViewMetadata, { loading: viewMetadataUpdating }] =
    useUpdateViewMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated view metadata.');
        },
      }),
    );

  const diagramData = useMemo(() => {
    if (!data) return null;
    return data?.diagram;
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
      router.replace(router.pathname);
    }
  }, [queryParams, diagramData]);

  useEffect(() => {
    if (metadataDrawer.state.visible) {
      const data = metadataDrawer.state.defaultValue;
      let currentNodeData = null;
      switch (data.nodeType) {
        case NODE_TYPE.MODEL: {
          currentNodeData = diagramData.models.find(
            (model) => model.modelId === data.modelId,
          );
          break;
        }

        case NODE_TYPE.VIEW: {
          currentNodeData = diagramData.views.find(
            (view) => view.viewId === data.viewId,
          );
          break;
        }

        default:
          break;
      }

      metadataDrawer.updateState(currentNodeData);
    }
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

  const onSelect = (selectKeys) => {
    if (diagramRef.current) {
      const { getNodes, fitBounds } = diagramRef.current;
      const node = getNodes().find((node) => node.id === selectKeys[0]);
      const position = {
        ...node.position,
        width: node.width,
        height: node.height,
      };
      fitBounds(position);
    }
  };

  const onNodeClick = async (payload: ClickPayload) => {
    metadataDrawer.openDrawer(payload.data);
  };

  const onMoreClick = (payload) => {
    const { type, data } = payload;
    const { nodeType } = data;
    const action = {
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
            await deleteModelMutation({
              variables: { where: { id: data.modelId } },
            });
            break;
          case NODE_TYPE.CALCULATED_FIELD:
            await deleteCalculatedField({
              variables: { where: { id: data.columnId } },
            });
            break;
          case NODE_TYPE.RELATION:
            await deleteRelationshipMutation({
              variables: { where: { id: data.relationId } },
            });
            break;
          case NODE_TYPE.VIEW:
            await deleteViewMutation({
              variables: { where: { id: data.viewId } },
            });
            break;

          default:
            console.log(data);
            break;
        }
      },
    };
    action[type] && action[type]();
  };

  const onAddClick = (payload) => {
    const { targetNodeType, data } = payload;
    switch (targetNodeType) {
      case NODE_TYPE.CALCULATED_FIELD:
        calculatedFieldModal.openModal(null, {
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
      <SiderLayout
        loading={diagramData === null}
        sidebar={{
          data: diagramData,
          onOpenModelDrawer: modelDrawer.openDrawer,
          onSelect,
        }}
      >
        <DiagramWrapper>
          <ForwardDiagram
            ref={diagramRef}
            data={diagramData}
            onMoreClick={onMoreClick}
            onNodeClick={onNodeClick}
            onAddClick={onAddClick}
          />
        </DiagramWrapper>
        <MetadataDrawer
          {...metadataDrawer.state}
          onClose={metadataDrawer.closeDrawer}
          onEditClick={editMetadataModal.openModal}
        />
        <EditMetadataModal
          {...editMetadataModal.state}
          onClose={editMetadataModal.closeModal}
          loading={editMetadataLoading}
          onSubmit={async ({ nodeType, data }) => {
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
          onSubmit={async ({ id, data }) => {
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
      </SiderLayout>
    </DeployStatusContext.Provider>
  );
}
