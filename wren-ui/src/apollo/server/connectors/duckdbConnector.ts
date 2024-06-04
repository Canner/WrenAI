import {
  IWrenEngineAdaptor,
  EngineQueryResponse,
} from '../adaptors/wrenEngineAdaptor';
import { CompactTable } from './connector';
import { IConnector } from './connector';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';

const logger = getLogger('DuckDBConnector');
logger.level = 'debug';

export interface DuckDBPrepareOptions {
  initSql: string;
  sessionProps: Record<string, any>;
}

export interface DuckDBListTableOptions {
  format?: boolean;
}

export interface DuckDBColumnResponse {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: string;
  is_nullable: string;
  data_type: string;
}

export class DuckDBConnector
  implements IConnector<DuckDBColumnResponse[], any[]>
{
  private wrenEngineAdaptor: IWrenEngineAdaptor;
  constructor({
    wrenEngineAdaptor,
  }: {
    wrenEngineAdaptor: IWrenEngineAdaptor;
  }) {
    this.wrenEngineAdaptor = wrenEngineAdaptor;
  }
  public async prepare(prepareOptions: DuckDBPrepareOptions): Promise<void> {
    const { initSql, sessionProps } = prepareOptions;
    await this.wrenEngineAdaptor.initDatabase(initSql);
    await this.wrenEngineAdaptor.putSessionProps(sessionProps);
  }

  public async connect(): Promise<boolean> {
    const sql = 'SELECT 1;';
    try {
      await this.wrenEngineAdaptor.queryDuckdb(sql);
      return true;
    } catch (err) {
      logger.error(`Error connecting to DuckDB: ${err}`);
      throw Errors.create(Errors.GeneralErrorCodes.CONNECTION_ERROR, {
        originalError: err,
      });
    }
  }

  public async listTables(listTableOptions: DuckDBListTableOptions) {
    const sql =
      'SELECT \
      table_catalog, table_schema, table_name, column_name, ordinal_position, is_nullable, data_type\
      FROM INFORMATION_SCHEMA.COLUMNS;';
    const response = await this.wrenEngineAdaptor.queryDuckdb(sql);
    if (listTableOptions.format) {
      return this.formatToCompactTable(response);
    }
    return response.data;
  }

  public async listConstraints(): Promise<any[]> {
    return [];
  }

  private formatToCompactTable(columns: EngineQueryResponse): CompactTable[] {
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
