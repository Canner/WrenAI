import { CompactTable } from '../types';

export interface IConnector<T, C> {
  connect(): Promise<boolean>;
  listTables(listTableOptions: any): Promise<CompactTable[] | T[]>;
  listConstraints(listConstraintOptions: any): Promise<[] | C[]>;
}
