import { memo, useCallback, useContext } from 'react';
import {
  CachedIcon,
  CustomNodeProps,
  NodeBody,
  NodeHeader,
  StyledNode,
} from './utils';
import MarkerHandle from './MarkerHandle';
import { DiagramContext } from '../Context';
import Column from './Column';
import CustomDropdown from '../CustomDropdown';
import { MoreIcon, ViewIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { ComposeDiagram, ComposeDiagramField } from '@/utils/data';
import { getColumnTypeIcon } from '@/utils/columnType';

export const ViewNode = ({ data }: CustomNodeProps<ComposeDiagram>) => {
  const context = useContext(DiagramContext);
  const onMoreClick = (type: MORE_ACTION) => {
    context?.onMoreClick({
      type,
      title: data.originalData.displayName,
      data: data.originalData,
    });
  };
  const onNodeClick = () => {
    context?.onNodeClick({
      title: data.originalData.displayName,
      data: data.originalData,
    });
  };

  const renderColumns = useCallback(getColumns, []);

  return (
    <StyledNode onClick={onNodeClick}>
      <NodeHeader className="dragHandle" color="var(--green-6)">
        <span className="adm-model-header">
          <ViewIcon />
          {data.originalData.displayName}
        </span>
        <span>
          <CachedIcon originalData={data.originalData} />
          <CustomDropdown onMoreClick={onMoreClick}>
            <MoreIcon
              style={{ marginLeft: 4 }}
              onClick={(e) => e.stopPropagation()}
            />
          </CustomDropdown>
        </span>

        <MarkerHandle id={data.originalData.id} />
      </NodeHeader>
      {!!data.originalData.fields.length && (
        <NodeBody draggable={false}>
          {renderColumns(data.originalData.fields)}
        </NodeBody>
      )}
    </StyledNode>
  );
};

export default memo(ViewNode);

function getColumns(columns: ComposeDiagramField[]) {
  return columns.map((column) => (
    <Column
      key={column.id}
      {...column}
      icon={getColumnTypeIcon({ type: column.type })}
    />
  ));
}
