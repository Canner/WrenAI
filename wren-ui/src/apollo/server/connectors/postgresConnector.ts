import { CompactTable } from './connector';
import { IConnector } from './connector';
import { getLogger } from '@server/utils';
import { WrenEngineColumnType } from './types';

import pg from 'pg';
const { Client } = pg;

const logger = getLogger('PostgresConnector');
logger.level = 'debug';

export interface PostgresConnectionConfig {
  user: string;
  password: string;
  host: string;
  database: string;
  port: number;
  ssl?: boolean;
}

export interface PostgresColumnResponse {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: string;
  is_nullable: string;
  data_type: WrenEngineColumnType;
}

export interface PostgresConstraintResponse {
  constraintName: string;
  constraintType: string;
  constraintTable: string;
  constraintColumn: string;
  constraintedTable: string;
  constraintedColumn: string;
}

export interface PostgresListTableOptions {
  format?: boolean;
}

export class PostgresConnector
  implements IConnector<PostgresColumnResponse, PostgresConstraintResponse>
{
  private config: PostgresConnectionConfig;
  private client?: pg.Client;

  constructor(config: PostgresConnectionConfig) {
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
      logger.error(`Error connecting to Postgres: ${err}`);
      return false;
    }
  }

  public async listTables(options: PostgresListTableOptions) {
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
        data_type: this.transformColumnType(row.data_type),
      };
    }) as PostgresColumnResponse[];

    return options.format ? this.formatToCompactTable(columns) : columns;
  }

  public async listConstraints() {
    const sql = `
      SELECT
        tc.table_schema,
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
    `;
    await this.prepareClient();
    const res = await this.client.query(sql);
    const constraints = res.rows.map((row) => {
      return {
        constraintName: row.constraint_name,
        constraintType: 'FOREIGN KEY',
        constraintTable: this.formatCompactTableName(
          row.table_name,
          row.table_schema,
        ),
        constraintColumn: row.column_name,
        constraintedTable: this.formatCompactTableName(
          row.foreign_table_name,
          row.foreign_table_schema,
        ),
        constraintedColumn: row.foreign_column_name,
      };
    }) as PostgresConstraintResponse[];
    return constraints;
  }

  private transformColumnType(dataType: string) {
    // lower case the dataType
    dataType = dataType.toLowerCase();

    // all possible types listed here: https://www.postgresql.org/docs/current/datatype.html#DATATYPE-TABLE

    switch (dataType) {
      case 'text':
        return WrenEngineColumnType.TEXT;
      case 'char':
      case 'character':
      case 'bpchar':
      case 'name':
        return WrenEngineColumnType.CHAR;
      case 'character varying':
        return WrenEngineColumnType.VARCHAR;
      case 'bigint':
        return WrenEngineColumnType.BIGINT;
      case 'int':
      case 'integer':
        return WrenEngineColumnType.INTEGER;
      case 'smallint':
        return WrenEngineColumnType.SMALLINT;
      case 'real':
        return WrenEngineColumnType.REAL;
      case 'double precision':
        return WrenEngineColumnType.DOUBLE;
      case 'numeric':
      case 'decimal':
        return WrenEngineColumnType.DECIMAL;
      case 'boolean':
        return WrenEngineColumnType.BOOLEAN;
      case 'timestamp':
      case 'timestamp without time zone':
        return WrenEngineColumnType.TIMESTAMP;
      case 'timestamp with time zone':
        return WrenEngineColumnType.TIMESTAMPTZ;
      case 'date':
        return WrenEngineColumnType.DATE;
      case 'interval':
        return WrenEngineColumnType.INTERVAL;
      case 'json':
        return WrenEngineColumnType.JSON;
      case 'bytea':
        return WrenEngineColumnType.BYTEA;
      case 'uuid':
        return WrenEngineColumnType.UUID;
      case 'inet':
        return WrenEngineColumnType.INET;
      case 'oid':
        return WrenEngineColumnType.OID;
      default:
        return WrenEngineColumnType.UNKNOWN;
    }
  }

  private formatToCompactTable(
    columns: PostgresColumnResponse[],
  ): CompactTable[] {
    return columns.reduce(
      (acc: CompactTable[], row: PostgresColumnResponse) => {
        const {
          table_catalog,
          table_schema,
          table_name,
          column_name,
          is_nullable,
          data_type,
        } = row;
        const tableName = this.formatCompactTableName(table_name, table_schema);
        let table = acc.find((t) => t.name === tableName);
        if (!table) {
          table = {
            name: tableName,
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
      },
      [],
    );
  }

  public async close() {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }

  public formatCompactTableName(tableName: string, schema: string) {
    return `${schema}.${tableName}`;
  }

  public parseCompactTableName(compactTableName: string) {
    const [schema, tableName] = compactTableName.split('.');
    return { schema, tableName };
  }

  private async prepareClient() {
    if (this.client) {
      return;
    }

    this.client = new Client(this.config);
    await this.client.connect();
  }
}
