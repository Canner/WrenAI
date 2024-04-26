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
