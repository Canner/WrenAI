import { memo } from 'react';
import { BaseEdge, EdgeProps, getSmoothStepPath } from 'reactflow';

const MetricEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
}: EdgeProps) => {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge
      path={edgePath}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={{ stroke: 'var(--gray-5)' }}
    />
  );
};

export default memo(MetricEdge);
