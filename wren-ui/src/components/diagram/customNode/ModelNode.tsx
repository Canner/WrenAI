import { memo, useCallback, useContext } from 'react';
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
import Column, {
  ColumnTitle,
  MoreColumnTip,
} from '@/components/diagram/customNode/Column';
import { PrimaryKeyIcon, ModelIcon } from '@/utils/icons';
import {
  ComposeDiagram,
  ComposeDiagramField,
  DiagramModel,
} from '@/utils/data';
import { getColumnTypeIcon } from '@/utils/columnType';
import { makeIterable } from '@/utils/iteration';
import { Config } from '@/utils/diagram';
import { NODE_TYPE } from '@/utils/enum';

export const ModelNode = ({ data }: CustomNodeProps<DiagramModel>) => {
  const context = useContext(DiagramContext);
  const onNodeClick = () => {
    context?.onNodeClick({
      title: data.originalData.displayName,
      data: data.originalData,
    });
  };

  const hasRelationTitle = !!data.originalData.relationFields.length;
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
          {data.originalData.displayName}
        </span>
        <span>
          <CachedIcon originalData={data.originalData} />
        </span>

        <MarkerHandle id={data.originalData.id.toString()} />
      </NodeHeader>
      <NodeBody draggable={false}>
        {renderColumns([
          ...data.originalData.fields,
          ...data.originalData.calculatedFields,
        ])}
        {hasRelationTitle ? <ColumnTitle>Relationships</ColumnTitle> : null}
        {renderColumns(data.originalData.relationFields)}
      </NodeBody>
    </StyledNode>
  );
};

export default memo(ModelNode);

const ColumnTemplate = (props) => {
  const { nodeType, id, type, isPrimaryKey, highlight } = props;
  const isRelation = nodeType === NODE_TYPE.RELATION;

  const onMouseEnter = useCallback((reactflowInstance: any) => {
    if (!isRelation) return;
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
    if (!isRelation) return;
    const { setEdges, setNodes } = reactflowInstance;
    setEdges(highlightEdges([], false));
    setNodes(highlightNodes([], []));
  }, []);

  return (
    <Column
      {...props}
      key={id}
      className={highlight.includes(id) ? 'bg-gray-3' : undefined}
      icon={isRelation ? <ModelIcon /> : getColumnTypeIcon({ type })}
      append={isPrimaryKey && <PrimaryKeyIcon />}
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
      {moreCount > 0 && <MoreColumnTip count={moreCount} />}
    </>
  );
};
