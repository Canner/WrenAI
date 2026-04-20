import { Model, ModelColumn, RelationInfo } from '../repositories';

export type ConnectionSchema = {
  name: string;
  columns: {
    name: string;
    type: string;
  }[];
};

export type ConnectionSchemaChange = {
  [SchemaChangeType.DELETED_TABLES]?: ConnectionSchema[];
  [SchemaChangeType.DELETED_COLUMNS]?: ConnectionSchema[];
  [SchemaChangeType.MODIFIED_COLUMNS]?: ConnectionSchema[];
};

export type ConnectionSchemaResolve = {
  [SchemaChangeType.DELETED_TABLES]?: boolean;
  [SchemaChangeType.DELETED_COLUMNS]?: boolean;
  [SchemaChangeType.MODIFIED_COLUMNS]?: boolean;
};

export enum SchemaChangeType {
  DELETED_TABLES = 'deletedTables',
  DELETED_COLUMNS = 'deletedColumns',
  MODIFIED_COLUMNS = 'modifiedColumns',
}

export interface AffectedResources {
  sourceTableName: string;
  referenceName: string;
  displayName: string;
  modelId: number;
  columns: Array<{
    sourceColumnName: string;
    displayName: string;
    type: string;
  }>;
  relationships: Array<{
    id: number;
    displayName: string;
    referenceName: string;
  }>;
  calculatedFields: ModelColumn[];
}

export interface IConnectionSchemaDetector {
  detectSchemaChange(): Promise<boolean>;
  resolveSchemaChange(type: string): Promise<void>;
  getAffectedResources(
    changes: ConnectionSchema[],
    {
      models,
      modelColumns,
      modelRelationships,
    }: {
      models: Model[];
      modelColumns: ModelColumn[];
      modelRelationships: RelationInfo[];
    },
  ): AffectedResources[];
}
