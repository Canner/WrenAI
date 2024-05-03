import dynamic from 'next/dynamic';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { message } from 'antd';
import styled from 'styled-components';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import SiderLayout from '@/components/layouts/SiderLayout';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import EditMetadataModal from '@/components/pages/modeling/EditMetadataModal';
import CalculatedFieldModal from '@/components/modals/CalculatedFieldModal';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import { ClickPayload } from '@/components/diagram/Context';
import { DeployStatusContext } from '@/components/deploy/Context';
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import { useDeployStatusQuery } from '@/apollo/client/graphql/deploy.generated';
import { useDeleteViewMutation } from '@/apollo/client/graphql/view.generated';
import {
  useCreateModelMutation,
  useDeleteModelMutation,
  useUpdateModelMutation,
} from '@/apollo/client/graphql/model.generated';
import { useUpdateModelMetadataMutation } from '@/apollo/client/graphql/metadata.generated';

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
  const diagramRef = useRef(null);

  const { data } = useDiagramQuery({
    fetchPolicy: 'cache-and-network',
    onCompleted: () => {
      diagramRef.current?.fitView();
    },
  });

  // TODO: No matter which operation is performed, we must re-fetch the latest deploy status
  const deployStatusQueryResult = useDeployStatusQuery({
    fetchPolicy: 'no-cache',
  });

  const getBaseOptions = (options) => {
    return {
      onError: (error) => console.error(error),
      refetchQueries: [{ query: DIAGRAM }],
      awaitRefetchQueries: true,
      ...options,
      onCompleted: () => {
        // refetch to get latest deploy status
        deployStatusQueryResult.refetch();

        options.onCompleted && options.onCompleted();
      },
    };
  };

  const [createModelMutation, createModelResult] = useCreateModelMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully created model.');
      },
    }),
  );

  const [deleteModelMutation] = useDeleteModelMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted model.');
      },
    }),
  );

  const [updateModelMutation, updateModelResult] = useUpdateModelMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully updated model.');
      },
    }),
  );

  const [deleteViewMutation] = useDeleteViewMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted view.');
      },
    }),
  );

  const [updateModelMetadata] = useUpdateModelMetadataMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully updated model metadata.');
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

  useEffect(() => {
    if (metadataDrawer.state.visible) {
      const data = metadataDrawer.state.defaultValue;
      const currentModel = diagramData.models.find(
        (model) => model.modelId === data.modelId,
      );
      metadataDrawer.updateState(currentModel);
    }
  }, [diagramData]);

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
            // TODO: integrate with update calculated field modal
            const sourceModel =
              diagramData.models.find(
                (model) => model.modelId === data.modelId,
              ) || {};
            calculatedFieldModal.openModal({
              name: data.referenceName,
              expression: '',
              lineage: [],
              payload: {
                models: diagramData.models,
                sourceModel,
              },
            });
            break;
          case NODE_TYPE.RELATION:
            console.log('edit relation');
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
            console.log('delete calculated field');
            break;
          case NODE_TYPE.RELATION:
            console.log('delete relation');
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
        calculatedFieldModal.openModal({
          payload: {
            models: diagramData.models,
            sourceModel: data,
          },
        });
        break;
      case NODE_TYPE.RELATION:
        console.log('add relation');
        break;
      default:
        console.log('add', targetNodeType);
        break;
    }
  };

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
          onSubmit={async ({ id, data }) => {
            await updateModelMetadata({ variables: { where: { id }, data } });
          }}
        />
        <ModelDrawer
          {...modelDrawer.state}
          onClose={modelDrawer.closeDrawer}
          submitting={createModelResult.loading || updateModelResult.loading}
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
          onSubmit={async (values) => {
            console.log(values);
          }}
        />
      </SiderLayout>
    </DeployStatusContext.Provider>
  );
}
