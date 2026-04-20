import type { ExpressionName } from './calculatedField';

export enum NodeType {
  CALCULATED_FIELD = 'CALCULATED_FIELD',
  FIELD = 'FIELD',
  METRIC = 'METRIC',
  MODEL = 'MODEL',
  RELATION = 'RELATION',
  VIEW = 'VIEW',
}

export enum RelationType {
  MANY_TO_ONE = 'MANY_TO_ONE',
  ONE_TO_MANY = 'ONE_TO_MANY',
  ONE_TO_ONE = 'ONE_TO_ONE',
}

export type DiagramModelNestedField = {
  columnPath: string[];
  description?: string | null;
  displayName: string;
  id: string;
  nestedColumnId: number;
  referenceName: string;
  type: string;
};

export type DiagramModelField = {
  aggregation?: string | null;
  columnId: number;
  description?: string | null;
  displayName: string;
  expression?: string | null;
  id: string;
  isPrimaryKey: boolean;
  lineage?: number[] | null;
  nestedFields?: DiagramModelNestedField[] | null;
  nodeType: NodeType;
  referenceName: string;
  type: string;
};

export type DiagramModelRelationField = {
  description?: string | null;
  displayName: string;
  fromColumnDisplayName: string;
  fromColumnId: number;
  fromColumnName: string;
  fromModelDisplayName: string;
  fromModelId: number;
  fromModelName: string;
  id: string;
  nodeType: NodeType;
  referenceName: string;
  relationId: number;
  toColumnDisplayName: string;
  toColumnId: number;
  toColumnName: string;
  toModelDisplayName: string;
  toModelId: number;
  toModelName: string;
  type: RelationType;
};

export type DiagramModel = {
  cached: boolean;
  calculatedFields: Array<DiagramModelField | null>;
  description?: string | null;
  displayName: string;
  fields: Array<DiagramModelField | null>;
  id: string;
  modelId: number;
  nodeType: NodeType;
  refSql?: string | null;
  referenceName: string;
  refreshTime?: string | null;
  relationFields: Array<DiagramModelRelationField | null>;
  sourceTableName: string;
};

export type DiagramViewField = {
  description?: string | null;
  displayName: string;
  id: string;
  nodeType: NodeType;
  referenceName: string;
  type: string;
};

export type DiagramView = {
  description?: string | null;
  displayName: string;
  fields: Array<DiagramViewField | null>;
  id: string;
  nodeType: NodeType;
  referenceName: string;
  statement: string;
  viewId: number;
};

export type Diagram = {
  models: Array<DiagramModel | null>;
  views: Array<DiagramView | null>;
};

export type DiagramResponse = {
  diagram: Diagram;
};

export type CreateViewInput = {
  name: string;
  rephrasedQuestion: string;
  responseId: number;
};

export type CreateModelInput = {
  connectorId?: string | null;
  fields: string[];
  primaryKey?: string | null;
  sourceTableName: string;
};

export type ViewInfo = {
  displayName: string;
  id: number;
  name: string;
  statement: string;
};

export type ViewValidationResponse = {
  message?: string | null;
  valid: boolean;
};

export type ModelInfo = {
  cached: boolean;
  calculatedFields: Array<DiagramModelField | null>;
  description?: string | null;
  displayName: string;
  fields: Array<DiagramModelField | null>;
  id: number;
  primaryKey?: string | null;
  properties?: Record<string, unknown> | null;
  refSql?: string | null;
  referenceName: string;
  refreshTime?: string | null;
  sourceTableName: string;
};

export type RelationInput = {
  fromColumnId: number;
  fromModelId: number;
  toColumnId: number;
  toModelId: number;
  type: RelationType;
};

export type UpdateCalculatedFieldInput = {
  expression: ExpressionName;
  lineage: number[];
  name: string;
};

export type UpdateCalculatedFieldMetadataInput = {
  description?: string | null;
  id: number;
};

export type UpdateColumnMetadataInput = {
  description?: string | null;
  displayName?: string | null;
  id: number;
};

export type UpdateNestedColumnMetadataInput = {
  description?: string | null;
  displayName?: string | null;
  id: number;
};

export type UpdateRelationshipMetadataInput = {
  description?: string | null;
  id: number;
};

export type UpdateModelInput = {
  fields: string[];
  primaryKey?: string | null;
};

export type UpdateModelMetadataInput = {
  calculatedFields?: UpdateCalculatedFieldMetadataInput[] | null;
  columns?: UpdateColumnMetadataInput[] | null;
  description?: string | null;
  displayName?: string | null;
  nestedColumns?: UpdateNestedColumnMetadataInput[] | null;
  relationships?: UpdateRelationshipMetadataInput[] | null;
};

export type UpdateRelationInput = {
  type: RelationType;
};

export type UpdateViewColumnMetadataInput = {
  description?: string | null;
  referenceName: string;
};

export type UpdateViewMetadataInput = {
  columns?: UpdateViewColumnMetadataInput[] | null;
  description?: string | null;
  displayName?: string | null;
};
