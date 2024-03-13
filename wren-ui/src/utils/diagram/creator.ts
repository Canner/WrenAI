import { Edge, Node, Viewport, ReactFlowJsonObject } from 'reactflow';
import { AdaptedData } from '@/utils/data';
import { Transformer } from './transformer';

export class DiagramCreator {
  private nodes: Node[];
  private edges: Edge[];
  private viewport: Viewport = { x: 0, y: 0, zoom: 1 };

  constructor(data: AdaptedData) {
    const transformedData = new Transformer(data);
    this.nodes = transformedData.nodes;
    this.edges = transformedData.edges;
  }

  public toJsonObject(): ReactFlowJsonObject {
    return {
      nodes: this.nodes,
      edges: this.edges,
      viewport: this.viewport,
    };
  }
}
