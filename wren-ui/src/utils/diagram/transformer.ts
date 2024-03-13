import { Edge, Node, Position } from 'reactflow';
import {
  EDGE_TYPE,
  MARKER_TYPE,
  NODE_TYPE,
  JOIN_TYPE,
} from '@/utils/enum';
import {
  ModelData,
  MetricData,
  ModelColumnData,
  MetricColumnData,
  RelationData,
  AdaptedData,
  ViewData,
} from '@/utils/data';

const config = {
  // the number of model in one row
  modelsInRow: 4,
  // the width of the model
  width: 200,
  // height should be calculated depending on the number of columns
  height: undefined,
  // the height of the model header
  headerHeight: 32,
  // the height of the model column
  columnHeight: 32,
  // the overflow of the model body
  bodyOverflow: 'auto',
  // the margin x between the model and the other models
  marginX: 100,
  // the margin y between the model and the other models
  marginY: 50,
};

type ComposeData = ModelData | MetricData | ViewData;

type NodeWithData = Node<{
  originalData: ComposeData;
  index: number;
  // highlight column ids inside
  highlight: string[];
}>;

type EdgeWithData = Edge<{
  relation?: RelationData;
  highlight: boolean;
}>;

type StartPoint = { x: number; y: number; floor: number };

export class Transformer {
  private readonly config: typeof config = config;
  private models: ModelData[];
  private metrics: MetricData[];
  private views: ViewData[];
  public nodes: NodeWithData[] = [];
  public edges: Edge[] = [];
  private start: StartPoint = {
    x: 0,
    y: 0,
    floor: 0,
  };

  constructor(data: AdaptedData) {
    this.models = data?.models || [];
    this.metrics = data?.metrics || [];
    this.views = data?.views || [];
    this.init();
  }

  public init() {
    const allNodeData = [...this.models, ...this.metrics, ...this.views];
    for (const data of allNodeData) {
      this.addOne(data);
    }
  }

  public addOne(data: ComposeData) {
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
    const width = this.getModelWidth();
    let floorHeight = 0;
    const { length } = this.nodes;
    const { marginX, marginY, modelsInRow } = this.config;
    const isNextFloor = length % modelsInRow === 0;
    if (isNextFloor) {
      this.start.floor++;
      const lastFloorIndex = modelsInRow * (this.start.floor - 1);
      const models = this.models.slice(lastFloorIndex, lastFloorIndex + 4);

      const modelWithMostColumns = models.reduce((prev, current) => {
        return prev.columns.length > current.columns.length ? prev : current;
      }, models[0]);

      floorHeight = this.getModelHeight(modelWithMostColumns.columns) + marginY;
    }

    this.start.x = this.start.x + width + marginX;
    if (isNextFloor) this.start.x = 0;
    this.start.y = this.start.y + floorHeight;
  }

  private createNode(props: {
    nodeType: NODE_TYPE | string;
    data: ComposeData;
    x: number;
    y: number;
  }): NodeWithData {
    const { nodeType, data, x, y } = props;
    // check nodeType and add edge
    switch (nodeType) {
      case NODE_TYPE.MODEL:
        this.addModelEdge(data as ModelData);
        break;
      case NODE_TYPE.METRIC:
        this.addMetricEdge(data as MetricData);
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

  private addModelEdge(data: ModelData) {
    const { columns } = data;
    for (const column of columns) {
      if (column?.relation) {
        // check if edge already exist
        const hasEdgeExist = this.edges.some((edge) => {
          const [id] = (edge.targetHandle || '').split('_');
          return id === column.id;
        });
        if (hasEdgeExist) break;

        // prepare to add new edge
        const targetModel = this.models.find(
          (model) =>
            model.id !== data.id &&
            column.relation?.models.includes(model.referenceName)
        )!;
        const targetColumn = targetModel?.columns.find(
          (targetColumn) =>
            targetColumn.relation?.referenceName ===
            column.relation?.referenceName
        );

        // check what source and target relation order
        const { joinType, models } = column.relation;
        const sourceJoinIndex = models.findIndex(
          (name) => name === data.referenceName
        );
        const targetJoinIndex = models.findIndex(
          (name) => name === targetModel?.referenceName
        );

        targetModel &&
          this.edges.push(
            this.createEdge({
              type: EDGE_TYPE.MODEL,
              joinType,
              sourceModel: data,
              sourceColumn: column,
              sourceJoinIndex,
              targetModel,
              targetColumn,
              targetJoinIndex,
            })
          );
      }
    }
  }

  private addMetricEdge(data: MetricData) {
    const { baseObject } = data;
    const targetModel = this.models.find(
      (model) => model.referenceName === baseObject
    )!;
    targetModel &&
      this.edges.push(
        this.createEdge({
          type: EDGE_TYPE.METRIC,
          sourceModel: data,
          targetModel,
        })
      );
  }

  private createEdge(props: {
    type?: EDGE_TYPE;
    sourceModel: ComposeData;
    sourceColumn?: ModelColumnData | MetricColumnData;
    sourceJoinIndex?: number;
    targetModel: ComposeData;
    targetColumn?: ModelColumnData | MetricColumnData;
    targetJoinIndex?: number;
    joinType?: JOIN_TYPE | string;
    animated?: boolean;
  }): EdgeWithData {
    const {
      type,
      sourceModel,
      sourceColumn,
      sourceJoinIndex,
      targetModel,
      targetColumn,
      targetJoinIndex,
      joinType,
      animated,
    } = props;
    const source = sourceModel.id;
    const target = targetModel.id;
    const [sourcePos, targetPos] = this.detectEdgePosition(source, target);
    const sourceHandle = `${sourceColumn?.id || source}_${sourcePos}`;
    const targetHandle = `${targetColumn?.id || target}_${targetPos}`;

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
        relation: (sourceColumn as ModelColumnData)?.relation,
        highlight: false,
      },
      animated,
    };
  }

  private getFloorIndex(index: number): number {
    const { modelsInRow } = this.config;
    return index % modelsInRow;
  }

  private detectEdgePosition(source: string, target: string) {
    const position = [];
    const [sourceIndex, targetIndex] = [...this.models, ...this.metrics].reduce(
      (result, current, index) => {
        if (current.id === source) result[0] = index;
        if (current.id === target) result[1] = index;
        return result;
      },
      [-1, -1]
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
    position?: Position
  ) {
    const markers =
      {
        [JOIN_TYPE.ONE_TO_ONE]: [MARKER_TYPE.ONE, MARKER_TYPE.ONE],
        [JOIN_TYPE.ONE_TO_MANY]: [MARKER_TYPE.ONE, MARKER_TYPE.MANY],
        [JOIN_TYPE.MANY_TO_ONE]: [MARKER_TYPE.MANY, MARKER_TYPE.ONE],
      }[joinType] || [];
    return markers[joinIndex] + (position ? `_${position}` : '');
  }

  private getModelWidth() {
    return this.config.width;
  }

  private getModelHeight(columns: ModelColumnData[]) {
    const { height: diagramHeight, headerHeight, columnHeight } = this.config;
    return headerHeight + (diagramHeight || columnHeight * columns.length);
  }
}
