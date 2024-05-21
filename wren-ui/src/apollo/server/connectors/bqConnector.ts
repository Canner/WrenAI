import { CompactTable } from './connector';
import { IConnector } from './connector';
import { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';

const logger = getLogger('DuckDBConnector');
logger.level = 'debug';

// column type ref: https://cloud.google.com/bigquery/docs/information-schema-columns#schema
export interface BQColumnResponse {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  is_nullable: string;
  data_type: string;
  is_generated: string;
  generation_expression: any;
  is_stored: string;
  is_hidden: string;
  is_updatable: string;
  is_system_defined: string;
  is_partitioning_column: string;
  clustering_ordinal_position: number;
  collation_name: string;
  column_default: string;
  rounding_mode: string;
  column_description: string;
  table_description: string;
}

export interface BQConstraintResponse {
  constraintName: string;
  constraintType: string;
  constraintTable: string;
  constraintColumn: string;
  constraintedTable: string;
  constraintedColumn: string;
}

export interface BQListTableFilter {
  tableName: string;
}
export interface BQListTableOptions {
  datasetId: string;
  format?: boolean;
  filter?: BQListTableFilter;
}
export class BQConnector
  implements IConnector<BQColumnResponse, BQConstraintResponse>
{
  private bq: BigQuery;

  // Not storing the bq client instance because we rarely need to use it
  constructor(bqOptions: BigQueryOptions) {
    this.bq = new BigQuery(bqOptions);
  }

  public async prepare() {
    return;
  }

  public async connect() {
    try {
      await this.bq.query('SELECT 1;');
      return true;
    } catch (err) {
      logger.error(`Error connecting to BigQuery: ${err}`);
      throw Errors.create(Errors.GeneralErrorCodes.CONNECTION_ERROR, {
        originalError: err,
      });
    }
  }

  public async listTables(listTableOptions: BQListTableOptions) {
    const { datasetId, format, filter } = listTableOptions;
    // AND cf.column_name = cf.field_path => filter out the subfield in record
    let sql = `SELECT 
        c.*, 
        cf.description AS column_description, 
        table_options.option_value AS table_description
      FROM ${datasetId}.INFORMATION_SCHEMA.COLUMNS c 
      JOIN ${datasetId}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS cf 
        ON cf.table_name = c.table_name 
        AND cf.column_name = c.column_name
      LEFT JOIN ${datasetId}.INFORMATION_SCHEMA.TABLE_OPTIONS table_options
        ON c.table_name = table_options.table_name
      WHERE 
        NOT REGEXP_CONTAINS(cf.data_type, r'^(STRUCT|ARRAY<STRUCT)')
        AND cf.column_name = cf.field_path 
      `;

    if (filter?.tableName) {
      sql += ` AND c.table_name = '${filter.tableName}'`;
    }
    sql += ` ORDER BY c.table_name, c.ordinal_position`;

    // list columns from INFORMATION_SCHEMA ref: https://cloud.google.com/bigquery/docs/information-schema-columns
    const columns = await new Promise((resolve, reject) => {
      this.bq.query(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    if (!format) {
      return columns as BQColumnResponse[];
    }
    return this.formatToCompactTable(columns);
  }

  public async listConstraints(options) {
    const { datasetId } = options;
    // ref: information schema link: https://cloud.google.com/bigquery/docs/information-schema-intro
    const constraints = await new Promise((resolve, reject) => {
      this.bq.query(
        `
      SELECT 
        ccu.table_name as constraintTable, ccu.column_name constraintColumn, 
        kcu.table_name as constraintedTable, kcu.column_name as constraintedColumn, 
        tc.constraint_type as constraintType
      FROM ${datasetId}.INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu 
      JOIN ${datasetId}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
        ON ccu.constraint_name = kcu.constraint_name
      JOIN ${datasetId}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      `,
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        },
      );
    });
    return constraints as BQConstraintResponse[];
  }

  private formatToCompactTable(columns: any): CompactTable[] {
    return columns.reduce((acc: CompactTable[], row: any) => {
      let table = acc.find((t) => t.name === row.table_name);
      if (!table) {
        table = {
          name: row.table_name,
          description: row.table_description,
          columns: [],
        };
        acc.push(table);
      }
      table.columns.push({
        name: row.column_name,
        type: row.data_type,
        notNull: row.is_nullable.toLocaleLowerCase() !== 'yes',
        description: row.column_description,
      });
      return acc;
    }, []);
  }
}
