enum ModelType {
  TABLE = 'TABLE',
  CUSTOM = 'CUSTOM',
}

export interface CreateModelPayload {
  type: ModelType;
  tableName: string;
  displayName: string;
  description?: string;
  cached: boolean;
  // 30m, 1h, 1d, 1w, 1m, 1y
  refreshTime?: string;
  fields?: string[];
  customFields?: {
    name: string;
    expression: string;
  }[];
  calculatedFields?: {
    name: string;
    expression: string;
  }[];
}

export interface ModelWhere {
  name: string;
}

export type UpdateModelWhere = ModelWhere;
export type UpdateModelPayload = Partial<Omit<CreateModelPayload, 'tableName'>>;

export type DeleteModelWhere = ModelWhere;

export type GetModelWhere = ModelWhere;

export interface CompactColumn {
  name: string;
  type: string;
}

export interface CompactTable {
  name: string;
  columns: CompactColumn[];
}
