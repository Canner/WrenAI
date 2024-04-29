import dynamic from 'next/dynamic';
import { forwardRef, useMemo, useRef } from 'react';
import { message } from 'antd';
import styled from 'styled-components';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import SiderLayout from '@/components/layouts/SiderLayout';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import useDrawerAction from '@/hooks/useDrawerAction';
import { ClickPayload } from '@/components/diagram/Context';
import { DeployStatusContext } from '@/components/deploy/Context';
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import { useDeployStatusQuery } from '@/apollo/client/graphql/deploy.generated';
import { useDeleteViewMutation } from '@/apollo/client/graphql/view.generated';

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

  const [deleteViewMutation] = useDeleteViewMutation({
    onError: (error) => console.error(error),
    onCompleted: () => {
      // refetch to get latest deploy status
      deployStatusQueryResult.refetch();

      message.success('Successfully deleted view.');
    },
    refetchQueries: [{ query: DIAGRAM }],
    awaitRefetchQueries: true,
  });

  const diagramData = useMemo(() => {
    if (!data) return null;
    return data?.diagram;
  }, [data]);

  const metadataDrawer = useDrawerAction();

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
            console.log('update columns');
            break;
          default:
            console.log(data);
            break;
        }
      },
      [MORE_ACTION.EDIT]: () => {
        switch (nodeType) {
          case NODE_TYPE.CALCULATED_FIELD:
            console.log('edit calculated field');
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
            console.log('delete model');
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
    const { targetNodeType } = payload;
    switch (targetNodeType) {
      case NODE_TYPE.CALCULATED_FIELD:
        console.log('add calculated field');
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
          onSelect,
          onOpenModelDrawer: () => {
            // TODO: open model drawer
            console.log('open model drawer');
          },
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
        />
      </SiderLayout>
    </DeployStatusContext.Provider>
  );
}
