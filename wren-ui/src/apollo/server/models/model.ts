enum _ModelType {
  TABLE = 'TABLE',
  CUSTOM = 'CUSTOM',
}

interface _CalculatedFieldData {
  name: string;
  expression: string;
  lineage: number[];
  diagram: JSON;
}

export interface CreateModelData {
  sourceTableName: string;
  fields: [string];
  primaryKey: string;
}

export interface UpdateModelData {
  fields: [string];
  primaryKey: string;
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

export interface UpdateModelMetadataInput {
  displayName: string;
  description: string;
  columns: Array<ColumnMetadataInput>;
  calculatedFields: Array<CalculatedFieldMetadataInput>;
  relationships: Array<RelationshipMetadataInput>;
}
