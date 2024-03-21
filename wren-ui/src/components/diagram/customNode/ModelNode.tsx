import { memo, useCallback, useContext } from 'react';
import { highlightEdges, highlightNodes, trimId } from '../utils';
import {
  CachedIcon,
  CustomNodeProps,
  NodeBody,
  NodeHeader,
  StyledNode,
} from './utils';
import MarkerHandle from './MarkerHandle';
import { DiagramContext } from '../Context';
import Column, { ColumnTitle, MoreColumnTip } from './Column';
import CustomDropdown from '../CustomDropdown';
import { PrimaryKeyIcon, ModelIcon, MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { ModelColumnData, ModelData } from '@/utils/data';
import { getColumnTypeIcon } from '@/utils/columnType';
import { makeIterable } from '@/utils/iteration';
import { Config } from '@/utils/diagram';

export const ModelNode = ({ data }: CustomNodeProps<ModelData>) => {
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

  const hasRelationTitle = !!data.originalData.relationFields.length;
  const renderColumns = useCallback(
    (columns: ModelColumnData[]) =>
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
          <CustomDropdown onMoreClick={onMoreClick}>
            <MoreIcon onClick={(e) => e.stopPropagation()} />
          </CustomDropdown>
        </span>

        <MarkerHandle id={data.originalData.id} />
      </NodeHeader>
      <NodeBody draggable={false}>
        {renderColumns([
          ...data.originalData.fields,
          ...data.originalData.calculatedFields,
        ])}
        {hasRelationTitle ? <ColumnTitle>Relations</ColumnTitle> : null}
        {renderColumns(data.originalData.relationFields)}
      </NodeBody>
    </StyledNode>
  );
};

export default memo(ModelNode);

const ColumnTemplate = (props) => {
  const { id, type, isPrimaryKey, relation, highlight } = props;
  const hasRelation = !!relation;

  const onMouseEnter = useCallback((reactflowInstance: any) => {
    if (!hasRelation) return;
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
    if (!hasRelation) return;
    const { setEdges, setNodes } = reactflowInstance;
    setEdges(highlightEdges([], false));
    setNodes(highlightNodes([], []));
  }, []);

  return (
    <Column
      {...props}
      key={id}
      className={highlight.includes(id) ? 'bg-gray-3' : undefined}
      icon={hasRelation ? <ModelIcon /> : getColumnTypeIcon({ type })}
      append={isPrimaryKey && <PrimaryKeyIcon />}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
    />
  );
};

const ColumnIterator = makeIterable(ColumnTemplate);

const getColumns = (
  columns: ModelColumnData[],
  data: CustomNodeProps<ModelData>['data'],
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
