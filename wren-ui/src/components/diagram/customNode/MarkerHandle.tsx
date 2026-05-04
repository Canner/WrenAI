import { Handle, Position } from 'reactflow';

// parent should be position relative
export default function MarkerHandle({ id }: { id: string }) {
  return (
    <>
      {/* all handlers */}
      <Handle
        type="source"
        position={Position.Left}
        id={`${id}_${Position.Left}`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}_${Position.Right}`}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}_${Position.Left}`}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={`${id}_${Position.Right}`}
      />
    </>
  );
}
