import dynamic from 'next/dynamic';
import { forwardRef, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import SiderLayout from '@/components/layouts/SiderLayout';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import MetricDrawer from '@/components/pages/modeling/MetricDrawer';
import ViewDrawer from '@/components/pages/modeling/ViewDrawer';
import useDrawerAction from '@/hooks/useDrawerAction';
import { ClickPayload } from '@/components/diagram/Context';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';

const Diagram = dynamic(() => import('@/components/diagram'), { ssr: false });
// https://github.com/vercel/next.js/issues/4957#issuecomment-413841689
const ForwardDiagram = forwardRef(function ForwardDiagram(props: any, ref) {
  return <Diagram {...props} forwardRef={ref} />;
});

const DiagramWrapper = styled.div`
  position: relative;
  height: 100%;
`;

export function Modeling() {
  const diagramRef = useRef(null);

  const { data } = useDiagramQuery();

  const diagramData = useMemo(() => {
    if (!data) return null;
    return data?.diagram;
  }, [data]);

  const metadataDrawer = useDrawerAction();
  const modelDrawer = useDrawerAction();
  const metricDrawer = useDrawerAction();
  const viewDrawer = useDrawerAction();

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
    const action = {
      [MORE_ACTION.EDIT]: () => {
        const { nodeType } = data;
        if (nodeType === NODE_TYPE.MODEL) modelDrawer.openDrawer(data);
        if (nodeType === NODE_TYPE.METRIC) metricDrawer.openDrawer(data);
        if (nodeType === NODE_TYPE.VIEW) viewDrawer.openDrawer(data);
      },
      [MORE_ACTION.DELETE]: () => {
        // TODO: call delete API
        console.log(data);
      },
    };
    action[type] && action[type]();
  };

  return (
    <SiderLayout
      loading={diagramData === null}
      sidebar={{
        data: diagramData,
        onSelect,
      }}
    >
      <DiagramWrapper>
        <ForwardDiagram
          ref={diagramRef}
          data={diagramData}
          onMoreClick={onMoreClick}
          onNodeClick={onNodeClick}
        />
      </DiagramWrapper>
      <MetadataDrawer
        {...metadataDrawer.state}
        onClose={metadataDrawer.closeDrawer}
      />
      <ModelDrawer
        {...modelDrawer.state}
        onClose={modelDrawer.closeDrawer}
        onSubmit={async (values) => {
          console.log(values);
        }}
      />
      <MetricDrawer
        {...metricDrawer.state}
        onClose={metricDrawer.closeDrawer}
        onSubmit={async (values) => {
          console.log(values);
        }}
      />
      <ViewDrawer
        {...viewDrawer.state}
        onClose={viewDrawer.closeDrawer}
        onSubmit={async (values) => {
          console.log(values);
        }}
      />
    </SiderLayout>
  );
}

export default Modeling;
