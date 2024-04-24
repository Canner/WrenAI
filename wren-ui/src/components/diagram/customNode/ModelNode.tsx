import { memo, useCallback, useContext } from 'react';
import { Typography } from 'antd';
import {
  highlightEdges,
  highlightNodes,
  trimId,
} from '@/components/diagram/utils';
import {
  CachedIcon,
  CustomNodeProps,
  NodeBody,
  NodeHeader,
  StyledNode,
} from '@/components/diagram/customNode/utils';
import MarkerHandle from '@/components/diagram/customNode/MarkerHandle';
import { DiagramContext } from '@/components/diagram/Context';
import Column from '@/components/diagram/customNode/Column';
import { PrimaryKeyIcon, ModelIcon } from '@/utils/icons';
import {
  ComposeDiagram,
  ComposeDiagramField,
  DiagramModel,
} from '@/utils/data';
import { getColumnTypeIcon } from '@/utils/columnType';
import { makeIterable } from '@/utils/iteration';
import { Config } from '@/utils/diagram';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import {
  ModelDropdown,
  ColumnDropdown,
} from '@/components/diagram/CustomDropdown';
import { AddButton, MoreButton } from '@/components/ActionButton';

const { Text } = Typography;

export const ModelNode = ({ data }: CustomNodeProps<DiagramModel>) => {
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

  const hasRelationships = !!data.originalData.relationFields.length;
  const hasCalculatedFields = !!data.originalData.calculatedFields.length;
  const renderColumns = useCallback(
    (columns: ComposeDiagramField[]) =>
      getColumns(columns, data, { limit: Config.columnsLimit }),
    [data.highlight],
  );

  return (
    <StyledNode onClick={onNodeClick}>
      <NodeHeader className="dragHandle">
        <span className="adm-model-header">
          <ModelIcon />
          <Text ellipsis title={data.originalData.displayName}>
            {data.originalData.displayName}
          </Text>
        </span>
        <span>
          <CachedIcon originalData={data.originalData} />
          <CustomDropdown nodeType={NODE_TYPE.MODEL} onMoreClick={onMoreClick}>
            <MoreButton className="gray-1" marginRight={-4} />
          </CustomDropdown>
        </span>

        <MarkerHandle id={data.originalData.id.toString()} />
      </NodeHeader>
      <NodeBody draggable={false}>
        <Column.Title show={true}>Columns</Column.Title>
        {renderColumns([...data.originalData.fields])}
        <Column.Title
          show={hasCalculatedFields}
          extra={<AddButton className="gray-8" marginRight={-8} />}
        >
          Calculated Fields
        </Column.Title>
        {renderColumns(data.originalData.calculatedFields)}
        <Column.Title
          show={hasRelationships}
          extra={<AddButton className="gray-8" marginRight={-8} />}
        >
          Relationships
        </Column.Title>
        {renderColumns(data.originalData.relationFields)}
      </NodeBody>
    </StyledNode>
  );
};

export default memo(ModelNode);

const ColumnTemplate = (props) => {
  const { nodeType, id, type, isPrimaryKey, highlight } = props;
  const isRelationship = nodeType === NODE_TYPE.RELATION;
  const isCalculatedField = nodeType === NODE_TYPE.CALCULATED_FIELD;
  const isMoreButtonShow = isCalculatedField || isRelationship;

  const onMouseEnter = useCallback((reactflowInstance: any) => {
    if (!isRelationship) return;
    const { getEdges, setEdges, setNodes } = reactflowInstance;
    const edges = getEdges();
    const relatedEdge = edges.find(
      (edge: any) =>
        trimId(edge.sourceHandle) === id || trimId(edge.targetHandle) === id,
    );
    setEdges(highlightEdges([relatedEdge.id], true));
    setNodes(
      highlightNodes(
        [relatedEdge.source, relatedEdge.target],
        [trimId(relatedEdge.sourceHandle), trimId(relatedEdge.targetHandle)],
      ),
    );
  }, []);
  const onMouseLeave = useCallback((reactflowInstance: any) => {
    if (!isRelationship) return;
    const { setEdges, setNodes } = reactflowInstance;
    setEdges(highlightEdges([], false));
    setNodes(highlightNodes([], []));
  }, []);

  return (
    <Column
      {...props}
      key={id}
      className={highlight.includes(id) ? 'bg-gray-3' : undefined}
      icon={isRelationship ? <ModelIcon /> : getColumnTypeIcon({ type })}
      extra={
        <>
          {isPrimaryKey && <PrimaryKeyIcon />}{' '}
          {isMoreButtonShow && (
            <ColumnDropdown nodeType={nodeType} onMoreClick={onMoreClick}>
              <MoreButton className="gray-8" marginRight={-4} />
            </ColumnDropdown>
          )}
        </>
      }
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
    />
  );
};

const ColumnIterator = makeIterable(ColumnTemplate);

const getColumns = (
  columns: ComposeDiagramField[],
  data: CustomNodeProps<ComposeDiagram>['data'],
  pagination?: { limit: number },
) => {
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
};
