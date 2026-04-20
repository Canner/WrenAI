import { DataSourceName } from './types';
import { WREN_AI_CONNECTION_INFO } from './repositories';

export interface IDataSourceConnectionInfo<C, I extends Record<string, any>> {
  sensitiveProps: string[];
  toIbisConnectionInfo(connectionInfo: C): I;
  toMultipleIbisConnectionInfos?(connectionInfo: C): I[];
}

export type DataSourceConnectionRegistry = Record<
  DataSourceName,
  IDataSourceConnectionInfo<WREN_AI_CONNECTION_INFO, Record<string, any>>
>;
