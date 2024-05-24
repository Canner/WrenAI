import {
  IWrenEngineAdaptor,
  QueryResponse,
} from '../adaptors/wrenEngineAdaptor';
import { CompactTable } from './connector';
import { IConnector } from './connector';
import { getLogger } from '@server/utils';

const logger = getLogger('CouchbaseConnector');
logger.level = 'debug';

export interface CouchbasePrepareOptions {
  initSql: string;
}

export interface CouchbaseListTableOptions {
  format?: boolean;
}

export interface CouchbaseColumnResponse {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: string;
  is_nullable: string;
  data_type: string;
}

export class CouchbaseConnector
  implements IConnector<CouchbaseColumnResponse[], any[]>
{
  private wrenEngineAdaptor: IWrenEngineAdaptor;
  constructor({
    wrenEngineAdaptor,
  }: {
    wrenEngineAdaptor: IWrenEngineAdaptor;
  }) {
    this.wrenEngineAdaptor = wrenEngineAdaptor;
  }
  public async prepare(prepareOptions: CouchbasePrepareOptions): Promise<void> {
    const { initSql } = prepareOptions;
    await this.wrenEngineAdaptor.initDatabase(initSql);
  }

  public async connect(): Promise<boolean> {
    const sql = 'SELECT 1;';
    try {
      await this.wrenEngineAdaptor.queryCouchbase(sql);
      return true;
    } catch (_err) {
      return false;
    }
  }

  public async listTables(listTableOptions: CouchbaseListTableOptions) {
    const response = await this.wrenEngineAdaptor.queryCouchbaseSchema();
    if (listTableOptions.format) {
      return this.formatToCompactTable(response);
    }
    return response.data;
  }

  public async listConstraints(): Promise<any[]> {
    return [];
  }

  private formatToCompactTable(columns: QueryResponse): CompactTable[] {
    return columns.data.reduce((acc: CompactTable[], row: any) => {
      const [
        table_catalog,
        table_schema,
        table_name,
        column_name,
        _ordinal_position,
        is_nullable,
        data_type,
      ] = row;
      let table = acc.find(
        (t) => t.name === table_name && t.properties.schema === table_schema,
      );
      if (!table) {
        table = {
          name: table_name,
          description: '',
          columns: [],
          properties: {
            schema: table_schema,
            catalog: table_catalog,
          },
        };
        acc.push(table);
      }
      table.columns.push({
        name: column_name,
        type: data_type,
        notNull: is_nullable.toLocaleLowerCase() !== 'yes',
        description: '',
        properties: {},
      });
      return acc;
    }, []);
  }
}
