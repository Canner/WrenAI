import { memo, useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from 'reactflow';
import styled from 'styled-components';
import CustomPopover from '../CustomPopover';
import { getJoinTypeText } from '@/utils/data';

const Joint = styled.div`
  position: absolute;
  width: 30px;
  height: 30px;
  opacity: 0;
`;

const ModelEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  data,
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isPopoverShow = data.highlight;
  const style = isPopoverShow
    ? {
        stroke: 'var(--geekblue-6)',
        strokeWidth: 1.5,
      }
    : { stroke: 'var(--gray-5)' };

  const relation = useMemo(() => {
    const fromField = `${data.relation.fromModelName}.${data.relation.fromColumnName}`;
    const toField = `${data.relation.toModelName}.${data.relation.toColumnName}`;
    return {
      name: data.relation.name,
      joinType: getJoinTypeText(data.relation.type),
      description: data.relation?.description || '-',
      fromField,
      toField,
    };
  }, [data.relation]);

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
      />
      <EdgeLabelRenderer>
        <CustomPopover
          visible={isPopoverShow}
          title="关系详情"
          content={
            <CustomPopover.Row gutter={16}>
              <CustomPopover.Col title="来源字段" span={12}>
                {relation.fromField}
              </CustomPopover.Col>
              <CustomPopover.Col title="目标字段" span={12}>
                {relation.toField}
              </CustomPopover.Col>
              <CustomPopover.Col title="关系类型" span={12}>
                {relation.joinType}
              </CustomPopover.Col>
              <CustomPopover.Col title="描述">
                {relation.description}
              </CustomPopover.Col>
            </CustomPopover.Row>
          }
        >
          <Joint
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          />
        </CustomPopover>
      </EdgeLabelRenderer>
    </>
  );
};

export default memo(ModelEdge);
