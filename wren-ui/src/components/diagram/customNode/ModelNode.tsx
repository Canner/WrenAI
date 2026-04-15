import { memo, useCallback, useContext } from 'react';
import { Typography } from 'antd';
import { useReactFlow } from 'reactflow';
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

const isComposeDiagramField = (
  field: ComposeDiagramField | null | undefined,
): field is ComposeDiagramField => Boolean(field);

export const ModelNode = ({ data }: CustomNodeProps<DiagramModel>) => {
  const context = useContext(DiagramContext);
  const readOnly = Boolean(context?.readOnly);
  const onMoreClick = (
    payload: MORE_ACTION | { type: MORE_ACTION; data: any },
  ) => {
    const type =
      typeof payload === 'object' && payload !== null ? payload.type : payload;
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
  const onAddClick = (targetNodeType: NODE_TYPE) => {
    context?.onAddClick({
      targetNodeType,
      data: data.originalData,
    });
  };

  const renderColumns = useCallback(
    (columns: Array<ComposeDiagramField | null | undefined>) =>
      getColumns(columns, data, { limit: Config.columnsLimit }),
    [data],
  );

  return (
    <StyledNode
      onClick={onNodeClick}
      data-testid={`diagram__model-node__${data.originalData.displayName}`}
      data-guideid={`model-${data.index}`}
    >
      <NodeHeader className="dragHandle">
        <span className="adm-model-header">
          <ModelIcon />
          <Text ellipsis title={data.originalData.displayName}>
            {data.originalData.displayName}
          </Text>
        </span>
        <span>
          <CachedIcon
            originalData={{
              cached: Boolean(data.originalData.cached),
              refreshTime: data.originalData.refreshTime || undefined,
            }}
          />
          <ModelDropdown
            data={data.originalData}
            onMoreClick={onMoreClick}
            disableMutationActions={readOnly}
          >
            <MoreButton
              className="gray-1"
              marginRight={-4}
              data-guideid={`edit-model-${data.index}`}
              disabled={readOnly}
            />
          </ModelDropdown>
        </span>

        <MarkerHandle id={data.originalData.id.toString()} />
      </NodeHeader>
      <NodeBody draggable={false}>
        <Column.Title show={true}>字段</Column.Title>
        {renderColumns(data.originalData.fields)}
        <Column.Title
          show={true}
          extra={
            <AddButton
              className="gray-8"
              marginRight={-8}
              disabled={readOnly}
              onClick={() => onAddClick(NODE_TYPE.CALCULATED_FIELD)}
            />
          }
        >
          计算字段
        </Column.Title>
        {renderColumns(data.originalData.calculatedFields)}
        <Column.Title
          show={true}
          extra={
            <AddButton
              className="gray-8"
              marginRight={-8}
              disabled={readOnly}
              onClick={() => onAddClick(NODE_TYPE.RELATION)}
            />
          }
        >
          关系
        </Column.Title>
        {renderColumns(data.originalData.relationFields)}
      </NodeBody>
    </StyledNode>
  );
};

export default memo(ModelNode);

type ColumnTemplateProps = ComposeDiagramField & {
  data: ComposeDiagramField[];
  index: number;
  highlight: string[];
};

const ColumnTemplate = (props: ColumnTemplateProps) => {
  const {
    nodeType,
    id,
    type,
    isPrimaryKey,
    highlight,
    data: _data,
    index: _index,
  } = props;
  const isRelationship = nodeType === NODE_TYPE.RELATION;
  const isCalculatedField = nodeType === NODE_TYPE.CALCULATED_FIELD;
  const isMoreButtonShow = isCalculatedField || isRelationship;
  const reactflowInstance = useReactFlow();

  const context = useContext(DiagramContext);
  const readOnly = Boolean(context?.readOnly);
  const onMoreClick = (
    payload: MORE_ACTION | { type: MORE_ACTION; data: any },
  ) => {
    const type =
      typeof payload === 'object' && payload !== null ? payload.type : payload;
    const moreData =
      typeof payload === 'object' && payload !== null && payload.data
        ? payload.data
        : props;
    context?.onMoreClick({
      type,
      data: moreData,
    });
  };

  const onMouseEnter = useCallback(
    (_event: React.MouseEvent) => {
      if (!isRelationship) return;
      const { getEdges, setEdges, setNodes } = reactflowInstance;
      const edges = getEdges();
      const relatedEdge = edges.find(
        (edge: any) =>
          trimId(edge.sourceHandle || '') === id ||
          trimId(edge.targetHandle || '') === id,
      );

      // skip to highlight & open relationship popup if no related edge
      if (!relatedEdge) return;

      const highlightedHandles = [
        relatedEdge.sourceHandle ? trimId(relatedEdge.sourceHandle) : '',
        relatedEdge.targetHandle ? trimId(relatedEdge.targetHandle) : '',
      ].filter(Boolean);
      setEdges(highlightEdges([relatedEdge?.id], true));
      setNodes(
        highlightNodes(
          [relatedEdge.source, relatedEdge.target],
          highlightedHandles,
        ),
      );
    },
    [reactflowInstance],
  );
  const onMouseLeave = useCallback(
    (_event: React.MouseEvent) => {
      if (!isRelationship) return;
      const { setEdges, setNodes } = reactflowInstance;
      setEdges(highlightEdges([], false));
      setNodes(highlightNodes([], []));
    },
    [reactflowInstance],
  );

  const onMoreMouseEnter = useCallback(
    (event: React.MouseEvent) => {
      onMouseLeave(event);
    },
    [reactflowInstance],
  );

  const onMoreMouseLeave = useCallback(
    (event: React.MouseEvent) => {
      onMouseEnter(event);
    },
    [reactflowInstance],
  );

  const onMenuEnter = useCallback(
    (event: React.MouseEvent) => {
      onMouseLeave(event);
    },
    [reactflowInstance],
  );

  return (
    <Column
      id={id}
      type={String(type || '')}
      displayName={props.displayName}
      key={id}
      className={highlight.includes(id) ? 'bg-gray-3' : undefined}
      icon={isRelationship ? <ModelIcon /> : getColumnTypeIcon({ type })}
      extra={
        <>
          {isPrimaryKey && <PrimaryKeyIcon />}{' '}
          {isMoreButtonShow && (
            <ColumnDropdown
              data={props}
              onMoreClick={onMoreClick}
              onMenuEnter={onMenuEnter}
              disableMutationActions={readOnly}
            >
              <MoreButton
                className="gray-8"
                marginRight={-4}
                disabled={readOnly}
                onMouseEnter={onMoreMouseEnter}
                onMouseLeave={onMoreMouseLeave}
              />
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
  columns: Array<ComposeDiagramField | null | undefined>,
  data: CustomNodeProps<ComposeDiagram>['data'],
  pagination?: { limit: number },
) => {
  const normalizedColumns = columns.filter(isComposeDiagramField);
  const moreCount = pagination
    ? normalizedColumns.length - pagination.limit
    : 0;
  const slicedColumns = pagination
    ? normalizedColumns.slice(0, pagination.limit)
    : normalizedColumns;
  return (
    <>
      <ColumnIterator
        data={slicedColumns}
        highlight={data.highlight}
        modelId={data.originalData.modelId}
      />
      {moreCount > 0 && <Column.MoreTip count={moreCount} />}
    </>
  );
};
