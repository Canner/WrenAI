enum ModelType {
  TABLE = 'TABLE',
  CUSTOM = 'CUSTOM',
}

interface CalculatedFieldData {
  name: string;
  expression: string;
  lineage: number[];
  diagram: JSON;
}

export interface CreateModelData {
  type: ModelType;
  displayName: string;
  sourceTableName: string;
  refSql: string;
  description: string;
  cached: boolean;
  refreshTime?: string;
  fields: [string];
  calculatedFields?: [CalculatedFieldData];
}
