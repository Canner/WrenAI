import { RelationType } from '@server/types';

export enum NodeType {
  MODEL = 'MODEL',
  VIEW = 'VIEW',
  RELATION = 'RELATION',
  FIELD = 'FIELD',
  CALCULATED_FIELD = 'CALCULATED_FIELD',
}

export interface Diagram {
  models: DiagramModel[];
  views: DiagramView[];
}

export interface DiagramView {
  id: string;
  viewId: number;
  nodeType: NodeType;
  statement: string;
  displayName: string;
  referenceName: string;
  fields: DiagramViewField[];
  description: string;
}

export interface DiagramViewField {
  id: string;
  displayName: string;
  referenceName: string;
  type: string;
  nodeType: NodeType;
  description: string;
}

export interface DiagramModel {
  id: string;
  modelId: number;
  nodeType: NodeType;
  displayName: string;
  referenceName: string;
  sourceTableName: string;
  refSql?: string;
  cached: boolean;
  refreshTime: string;
  description: string;
  fields: DiagramModelField[];
  calculatedFields: DiagramModelField[];
  relationFields: DiagramModelRelationField[];
}

export interface DiagramModelNestedField {
  id: string;
  nestedColumnId: number;
  type: string;
  displayName: string;
  referenceName: string;
  description: string;
}

export interface DiagramModelField {
  id: string;
  columnId: number;
  type: string;
  nodeType: NodeType;
  displayName: string;
  referenceName: string;
  description: string;
  isPrimaryKey?: boolean;
  expression?: string;
  lineage?: string;
  aggregation?: string;
  nestedFields?: DiagramModelNestedField[];
}

export interface DiagramModelRelationField {
  id: string;
  relationId: number;
  type: RelationType;
  nodeType: NodeType;
  displayName: string;
  referenceName: string;
  fromModelId: number;
  fromModelName: string;
  fromModelDisplayName: string;
  fromColumnId: number;
  fromColumnName: string;
  fromColumnDisplayName: string;
  toModelId: number;
  toModelName: string;
  toModelDisplayName: string;
  toColumnId: number;
  toColumnName: string;
  toColumnDisplayName: string;
  description: string;
}
