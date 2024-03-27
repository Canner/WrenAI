import { CompactTable } from '../types';

export interface IConnector<T, C> {
  prepare(prepareOptions: any): Promise<void>;
  connect(): Promise<boolean>;
  listTables(listTableOptions: any): Promise<CompactTable[] | T[]>;
  listConstraints(listConstraintOptions: any): Promise<[] | C[]>;
}
