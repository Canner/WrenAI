import { memo, useCallback, useContext } from 'react';
import { Button, Typography } from 'antd';
import { MoreIcon, ViewIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { ComposeDiagram, ComposeDiagramField, DiagramView } from '@/utils/data';
import { getColumnTypeIcon } from '@/utils/columnType';
import { Config } from '@/utils/diagram';
import { makeIterable } from '@/utils/iteration';
import { DiagramContext } from '@/components/diagram/Context';
import {
  CustomNodeProps,
  NodeBody,
  NodeHeader,
  StyledNode,
} from '@/components/diagram/customNode/utils';
import MarkerHandle from '@/components/diagram/customNode/MarkerHandle';
import Column from '@/components/diagram/customNode/Column';
import { ViewDropdown } from '@/components/diagram/CustomDropdown';

const { Text } = Typography;

export const ViewNode = ({ data }: CustomNodeProps<DiagramView>) => {
  const context = useContext(DiagramContext);
  const onMoreClick = (type: MORE_ACTION) => {
    context?.onMoreClick({
      type,
      data: data.originalData,
    });
  };
  const onNodeClick = () => {
    context?.onNodeClick({
      data: data.originalData,
    });
  };

  const renderColumns = useCallback(
    (columns: ComposeDiagramField[]) =>
      getColumns(columns, data, { limit: Config.columnsLimit }),
    [data.highlight],
  );

  return (
    <StyledNode
      onClick={onNodeClick}
      data-testid={`diagram__view-node__${data.originalData.displayName}`}
    >
      <NodeHeader className="dragHandle" color="var(--green-6)">
        <span className="adm-model-header">
          <ViewIcon />
          <Text ellipsis title={data.originalData.displayName}>
            {data.originalData.displayName}
          </Text>
        </span>
        <span>
          <ViewDropdown onMoreClick={onMoreClick}>
            <Button
              className="gray-1"
              icon={<MoreIcon />}
              onClick={(event) => event.stopPropagation()}
              type="text"
              size="small"
            />
          </ViewDropdown>
        </span>

        <MarkerHandle id={data.originalData.id} />
      </NodeHeader>
      <NodeBody draggable={false}>
        {renderColumns(data.originalData.fields)}
      </NodeBody>
    </StyledNode>
  );
};

export default memo(ViewNode);

const ColumnTemplate = (props) => {
  const { id, type } = props;
  return <Column {...props} key={id} icon={getColumnTypeIcon({ type })} />;
};

const ColumnIterator = makeIterable(ColumnTemplate);

function getColumns(
  columns: ComposeDiagramField[],
  data: CustomNodeProps<ComposeDiagram>['data'],
  pagination?: { limit: number },
) {
  const moreCount = pagination ? columns.length - pagination.limit : 0;
  const slicedColumns = pagination
    ? columns.slice(0, pagination.limit)
    : columns;
  return (
    <>
      <ColumnIterator data={slicedColumns} highlight={data.highlight} />
      {moreCount > 0 && <Column.MoreTip count={moreCount} />}
    </>
  );
}
