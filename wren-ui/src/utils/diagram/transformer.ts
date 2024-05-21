import { Edge, Node, Position } from 'reactflow';
import { EDGE_TYPE, MARKER_TYPE, NODE_TYPE, JOIN_TYPE } from '@/utils/enum';
import {
  ComposeDiagram,
  Diagram,
  DiagramModel,
  DiagramModelRelationField,
  DiagramView,
} from '@/utils/data';

export const Config = {
  // the number of nodes in one row
  nodesInRow: 4,
  // the width of the model
  width: 200,
  // height should be calculated depending on the number of columns
  height: undefined,
  // the height of the model header
  headerHeight: 32,
  // the height of the model column
  columnHeight: 32,
  // the height of more tip
  moreTipHeight: 25,
  // the columns limit
  columnsLimit: 10,
  // the overflow of the model body
  bodyOverflow: 'auto',
  // the margin x between the model and the other models
  marginX: 100,
  // the margin y between the model and the other models
  marginY: 50,
  // the model preserved height, for example: the model has 3 subtitles
  modelNodePreservedHeight: 32 * 3,
  // the view preserved height, for example: the view has 1 subtitle
  viewNodePreservedHeight: 32 * 1,
};

const convertBooleanToNumber = (value) => (value ? 1 : 0);

const getLimitedColumnsLengthProps = (columns: any[] = []) => {
  const isOverLimit = columns.length > Config.columnsLimit;
  const limitedLength = isOverLimit ? Config.columnsLimit : columns.length;
  return {
    isOverLimit,
    limitedLength,
    originalLength: columns.length,
  };
};

type NodeWithData = Node<{
  originalData: ComposeDiagram;
  index: number;
  // highlight column ids inside
  highlight: string[];
}>;

type EdgeWithData = Edge<{
  relation?: DiagramModelRelationField;
  highlight: boolean;
}>;

type StartPoint = { x: number; y: number; floor: number };

export class Transformer {
  private readonly config: typeof Config = Config;
  private models: DiagramModel[];
  public nodes: NodeWithData[] = [];
  private views: DiagramView[];
  public edges: Edge[] = [];
  private start: StartPoint = {
    x: 0,
    y: 0,
    floor: 0,
  };

  constructor(data: Diagram) {
    this.models = data?.models || [];
    this.views = data?.views || [];
    this.init();
  }

  public init() {
    const allNodeData = [...this.models, ...this.views];
    for (const data of allNodeData) {
      this.addOne(data);
    }
  }

  public addOne(data: ComposeDiagram) {
    const { nodeType } = data;
    // set position
    const nodeX = this.start.x;
    const nodeY = this.start.y;
    const node = this.createNode({ nodeType, data, x: nodeX, y: nodeY });

    // from the first model
    this.nodes.push(node);

    // update started point
    this.updateNextStartedPoint();
  }

  private updateNextStartedPoint() {
    const width = this.getNodeWidth();
    let floorHeight = 0;
    const { length } = this.nodes;
    const { marginX, marginY, nodesInRow } = this.config;
    const isNextFloor = length % nodesInRow === 0;
    if (isNextFloor) {
      this.start.floor++;
      const lastFloorIndex = nodesInRow * (this.start.floor - 1);
      const composeDiagrams: ComposeDiagram[] = [
        ...this.models,
        ...this.views,
      ].slice(lastFloorIndex, lastFloorIndex + 4);

      const modelWithMostColumns = composeDiagrams.reduce((prev, current) => {
        const prevColumns = [
          ...prev.fields,
          ...(prev?.calculatedFields || []),
          ...(current?.relationFields || []),
        ];
        const currentColumns = [
          ...current.fields,
          ...(current?.calculatedFields || []),
          ...(current?.relationFields || []),
        ];
        return prevColumns.length > currentColumns.length ? prev : current;
      }, composeDiagrams[0]);

      floorHeight = this.getNodeHeight(modelWithMostColumns) + marginY;
    }

    this.start.x = this.start.x + width + marginX;
    if (isNextFloor) this.start.x = 0;
    this.start.y = this.start.y + floorHeight;
  }

  private createNode(props: {
    nodeType: NODE_TYPE | string;
    data: ComposeDiagram;
    x: number;
    y: number;
  }): NodeWithData {
    const { nodeType, data, x, y } = props;
    // check nodeType and add edge
    switch (nodeType) {
      case NODE_TYPE.MODEL:
        this.addModelEdge(data as DiagramModel);
        break;
      default:
        break;
    }

    return {
      id: data.id,
      type: nodeType,
      position: { x, y },
      dragHandle: '.dragHandle',
      data: {
        originalData: data,
        index: this.nodes.length,
        highlight: [],
      },
    };
  }

  private addModelEdge(data: DiagramModel) {
    const { relationFields } = data;
    for (const relationField of relationFields) {
      // check if edge already exist
      const hasEdgeExist = this.edges.some((edge) => {
        // the edge should be unique as relationId
        const edgeRelationId = edge.data?.relation?.relationId;
        return edgeRelationId === relationField.relationId;
      });
      if (hasEdgeExist) continue;

      // prepare to add new edge
      const targetModel = this.models.find(
        (model) =>
          model.id !== data.id &&
          [relationField.fromModelName, relationField.toModelName].includes(
            model.referenceName,
          ),
      )!;

      // skip the edge if model not found
      if (!targetModel) continue;

      const targetField = targetModel.relationFields.find(
        (field) =>
          [
            `${field.fromModelName}.${field.fromColumnName}`,
            `${field.toModelName}.${field.toColumnName}`,
          ].toString() ===
          [
            `${relationField.fromModelName}.${relationField.fromColumnName}`,
            `${relationField.toModelName}.${relationField.toColumnName}`,
          ].toString(),
      );

      // check what source and target relation order
      const relationModels = [
        relationField.fromModelName,
        relationField.toModelName,
      ];
      const sourceJoinIndex = relationModels.findIndex(
        (name) => name === data.referenceName,
      );
      const targetJoinIndex = relationModels.findIndex(
        (name) => name === targetModel?.referenceName,
      );

      targetModel &&
        this.edges.push(
          this.createEdge({
            type: EDGE_TYPE.MODEL,
            joinType: relationField.type,
            sourceModel: data,
            sourceField: relationField,
            sourceJoinIndex,
            targetModel,
            targetField,
            targetJoinIndex,
          }),
        );
    }
  }

  private createEdge(props: {
    type?: EDGE_TYPE;
    sourceModel: ComposeDiagram;
    sourceField?: DiagramModelRelationField;
    sourceJoinIndex?: number;
    targetModel: ComposeDiagram;
    targetField?: DiagramModelRelationField;
    targetJoinIndex?: number;
    joinType?: JOIN_TYPE | string;
    animated?: boolean;
  }): EdgeWithData {
    const {
      type,
      sourceModel,
      sourceField,
      sourceJoinIndex,
      targetModel,
      targetField,
      targetJoinIndex,
      joinType,
      animated,
    } = props;
    const source = sourceModel.id;
    const target = targetModel.id;
    const [sourcePos, targetPos] = this.detectEdgePosition(source, target);
    const sourceHandle = `${sourceField?.id || source}_${sourcePos}`;
    const targetHandle = `${targetField?.id || target}_${targetPos}`;

    const markerStart = this.getMarker(joinType!, sourceJoinIndex!, sourcePos);
    const markerEnd = this.getMarker(joinType!, targetJoinIndex!, targetPos);

    return {
      id: `${sourceHandle}_${targetHandle}`,
      type,
      source,
      target,
      sourceHandle,
      targetHandle,
      markerStart,
      markerEnd,
      data: {
        relation: sourceField,
        highlight: false,
      },
      animated,
    };
  }

  private getFloorIndex(index: number): number {
    const { nodesInRow } = this.config;
    return index % nodesInRow;
  }

  private detectEdgePosition(source: string, target: string) {
    const position = [];
    const [sourceIndex, targetIndex] = [...this.models].reduce(
      (result, current, index) => {
        if (current.id === source) result[0] = index;
        if (current.id === target) result[1] = index;
        return result;
      },
      [-1, -1],
    );
    const sourceFloorIndex = this.getFloorIndex(sourceIndex);
    const targetFloorIndex = this.getFloorIndex(targetIndex);

    if (sourceFloorIndex === targetFloorIndex) {
      position[0] = Position.Left;
      position[1] = Position.Left;
    } else if (sourceFloorIndex > targetFloorIndex) {
      position[0] = Position.Left;
      position[1] = Position.Right;
    } else {
      position[0] = Position.Right;
      position[1] = Position.Left;
    }
    return position;
  }

  private getMarker(
    joinType: JOIN_TYPE | string,
    joinIndex: number,
    position?: Position,
  ) {
    const markers =
      {
        [JOIN_TYPE.ONE_TO_ONE]: [MARKER_TYPE.ONE, MARKER_TYPE.ONE],
        [JOIN_TYPE.ONE_TO_MANY]: [MARKER_TYPE.ONE, MARKER_TYPE.MANY],
        [JOIN_TYPE.MANY_TO_ONE]: [MARKER_TYPE.MANY, MARKER_TYPE.ONE],
      }[joinType] || [];
    return markers[joinIndex] + (position ? `_${position}` : '');
  }

  private getNodeWidth() {
    return this.config.width;
  }

  private getNodeHeight(composeDiagram: ComposeDiagram) {
    const {
      height: nodeHeight,
      headerHeight,
      columnHeight,
      moreTipHeight,
      modelNodePreservedHeight,
      viewNodePreservedHeight,
    } = this.config;

    // get preserved height setting
    const preservedHeightMap = {
      [NODE_TYPE.MODEL]: modelNodePreservedHeight,
      [NODE_TYPE.VIEW]: viewNodePreservedHeight,
    };
    const preservedHeight = preservedHeightMap[composeDiagram.nodeType];

    // check if columns limit is reached
    const { limitedLength: fieldsLength, isOverLimit: isFieldsOverLimit } =
      getLimitedColumnsLengthProps(composeDiagram.fields);
    const {
      limitedLength: calculatedFieldsLength,
      isOverLimit: isCalculatedFieldsOverLimit,
    } = getLimitedColumnsLengthProps(composeDiagram?.calculatedFields);
    const {
      limitedLength: relationFieldsLength,
      isOverLimit: isRelationsOverLimit,
    } = getLimitedColumnsLengthProps(composeDiagram?.relationFields);

    // count more tip
    const moreTipCount =
      convertBooleanToNumber(isFieldsOverLimit) +
      convertBooleanToNumber(isCalculatedFieldsOverLimit) +
      convertBooleanToNumber(isRelationsOverLimit);

    // calculate all block height
    const displayHeaderHeight = headerHeight;
    const displayColumnHeight =
      nodeHeight ||
      columnHeight *
        (fieldsLength + calculatedFieldsLength + relationFieldsLength);
    const displayMoreTipHeight = moreTipHeight * moreTipCount;
    // padding remain
    const paddingHeight = 4;

    return (
      displayHeaderHeight +
      displayColumnHeight +
      displayMoreTipHeight +
      preservedHeight +
      paddingHeight
    );
  }
}
