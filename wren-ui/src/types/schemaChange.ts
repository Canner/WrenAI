import type { NodeType } from './modeling';

export type DetailedAffectedCalculatedFields = {
  displayName: string;
  referenceName: string;
  type: string;
};

export type DetailedAffectedRelationships = {
  displayName: string;
  referenceName: string;
};

export type DetailedChangeColumn = {
  displayName: string;
  sourceColumnName: string;
  type: string;
};

export type DetailedChangeTable = {
  calculatedFields: DetailedAffectedCalculatedFields[];
  columns: DetailedChangeColumn[];
  displayName: string;
  id: number;
  name: string;
  relationships: DetailedAffectedRelationships[];
  sourceTableName: string;
};

export type ResolveSchemaChangeWhereInput = {
  type: SchemaChangeType;
};

export type SchemaChange = {
  deletedColumns?: DetailedChangeTable[] | null;
  deletedTables?: DetailedChangeTable[] | null;
  lastSchemaChangeTime?: string | null;
  modifiedColumns?: DetailedChangeTable[] | null;
};

export enum SchemaChangeType {
  DELETED_COLUMNS = 'DELETED_COLUMNS',
  DELETED_TABLES = 'DELETED_TABLES',
  MODIFIED_COLUMNS = 'MODIFIED_COLUMNS',
}

export type SchemaChangeTableChildRow = {
  displayName: string;
  referenceName: string;
  resourceType: NodeType;
  type?: string;
};
