export interface CompactColumn {
  name: string;
  type: string;
  notNull: boolean;
  description?: string;
  properties?: Record<string, any>;
}

export interface CompactTable {
  name: string;
  columns: CompactColumn[];
  description?: string;
  properties?: Record<string, any>;
}

export interface IConnector<T, C> {
  prepare(prepareOptions: any): Promise<void>;
  connect(): Promise<boolean>;
  listTables(listTableOptions: any): Promise<CompactTable[] | T[]>;
  listConstraints(listConstraintOptions: any): Promise<[] | C[]>;
}
