import { CompactTable } from './connector';
import { IConnector } from './connector';
import { getLogger } from '@server/utils';

import pg from 'pg';
const { Client } = pg;

const logger = getLogger('PGConnector');
logger.level = 'debug';

export interface PGConnectionConfig {
  user: string;
  password: string;
  host: string;
  database: string;
  port: number;
}

export interface PGColumnResponse {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: string;
  is_nullable: string;
  data_type: string;
}

export interface PGListTableOptions {
  format?: boolean;
}

export class PGConnector implements IConnector<PGColumnResponse, any[]> {
  private config: PGConnectionConfig;
  private client?: pg.Client;

  constructor(config: PGConnectionConfig) {
    this.config = config;
  }

  public async prepare() {
    return;
  }

  public async connect(): Promise<boolean> {
    try {
      await this.prepareClient();
      // query to check if connection is successful
      await this.client.query('SELECT 1;');
      return true;
    } catch (err) {
      logger.error(`Error connecting to PG: ${err}`);
      return false;
    }
  }

  public async listTables(options: PGListTableOptions) {
    const sql = `
      SELECT
        t.table_catalog,
        t.table_schema,
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.ordinal_position
      FROM
        information_schema.tables t
      JOIN
        information_schema.columns c ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE
        t.table_type in ('BASE TABLE', 'VIEW')
        and t.table_schema not in ('information_schema', 'pg_catalog')
      ORDER BY
        t.table_schema,
        t.table_name,
        c.ordinal_position;
    `;
    await this.prepareClient();
    const res = await this.client.query(sql);
    const columns = res.rows.map((row) => {
      return {
        table_catalog: row.table_catalog,
        table_schema: row.table_schema,
        table_name: row.table_name,
        column_name: row.column_name,
        ordinal_position: row.ordinal_position,
        is_nullable: row.is_nullable,
        data_type: row.data_type,
      };
    }) as PGColumnResponse[];

    return options.format ? this.formatToCompactTable(columns) : columns;
  }

  public async listConstraints(
    _listConstraintOptions: any,
  ): Promise<[] | any[][]> {
    return [];
  }

  private formatToCompactTable(columns: PGColumnResponse[]): CompactTable[] {
    return columns.reduce((acc: CompactTable[], row: PGColumnResponse) => {
      const {
        table_catalog,
        table_schema,
        table_name,
        column_name,
        ordinal_position,
        is_nullable,
        data_type,
      } = row;
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
        properties: {
          ordinalPosition: ordinal_position,
        },
      });
      return acc;
    }, []);
  }

  public async close() {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }

  private async prepareClient() {
    if (this.client) {
      return;
    }

    this.client = new Client(this.config);
    await this.client.connect();
  }
}
