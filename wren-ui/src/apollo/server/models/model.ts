export interface CreateModelData {
  sourceTableName: string;
  fields: [string];
  primaryKey: string;
}

export interface UpdateModelData {
  fields: [string];
  primaryKey: string;
}

export interface NestedColumnMetadataInput {
  id: number;
  displayName: string;
  description: string;
}

export interface ColumnMetadataInput {
  id: number;
  displayName: string;
  description: string;
}

export interface CalculatedFieldMetadataInput {
  id: number;
  description: string;
}

export interface RelationshipMetadataInput {
  id: number;
  description: string;
}

export interface ViewColumnMetadataInput {
  referenceName: string;
  description: string;
}

export interface UpdateModelMetadataInput {
  displayName: string;
  description: string;
  columns: Array<ColumnMetadataInput>;
  nestedColumns: Array<NestedColumnMetadataInput>;
  calculatedFields: Array<CalculatedFieldMetadataInput>;
  relationships: Array<RelationshipMetadataInput>;
}

export interface UpdateViewMetadataInput {
  displayName: string;
  description: string;
  columns: Array<ViewColumnMetadataInput>;
}

export enum ExpressionName {
  ABS = 'ABS',
  AVG = 'AVG',
  COUNT = 'COUNT',
  MAX = 'MAX',
  MIN = 'MIN',
  SUM = 'SUM',
  CBRT = 'CBRT',
  CEIL = 'CEIL',
  EXP = 'EXP',
  FLOOR = 'FLOOR',
  LN = 'LN',
  LOG10 = 'LOG10',
  ROUND = 'ROUND',
  SIGN = 'SIGN',
  LENGTH = 'LENGTH',
  REVERSE = 'REVERSE',
}

export interface CreateCalculatedFieldData {
  modelId: number;
  name: string; //displayName
  expression: ExpressionName;
  lineage: number[];
}

export interface UpdateCalculatedFieldData {
  name: string; //displayName
  expression: ExpressionName;
  lineage: number[];
}

export interface CheckCalculatedFieldCanQueryData {
  referenceName: string;
  expression: ExpressionName;
  lineage: number[];
}

export interface PreviewSQLData {
  sql: string;
  projectId?: number;
  limit?: number;
  dryRun?: boolean;
}
