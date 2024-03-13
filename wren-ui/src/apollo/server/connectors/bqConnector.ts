import { CompactTable } from '../types';
import { IConnector } from './connector';
import { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';

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
  description: string;
}

export interface BQConstraintResponse {
  constraintName: string;
  constraintType: string;
  constraintTable: string;
  constraintColumn: string;
  constraintedTable: string;
  constraintedColumn: string;
}

export interface BQListTableOptions {
  dataset: string;
  format?: boolean;
}
export class BQConnector
  implements IConnector<BQColumnResponse, BQConstraintResponse>
{
  private bq: BigQuery;

  // Not storing the bq client instance because we rarely need to use it
  constructor(bqOptions: BigQueryOptions) {
    this.bq = new BigQuery(bqOptions);
  }

  public async connect() {
    try {
      await this.bq.query('SELECT 1;');
      return true;
    } catch (err) {
      return false;
    }
  }

  public async listTables(listTableOptions: BQListTableOptions) {
    const { dataset, format } = listTableOptions;
    // list columns from INFORMATION_SCHEMA ref: https://cloud.google.com/bigquery/docs/information-schema-columns
    const columns = await new Promise((resolve, reject) => {
      this.bq.query(
        `SELECT 
          c.*, cf.description 
        FROM ${dataset}.INFORMATION_SCHEMA.COLUMNS c 
        JOIN ${dataset}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS cf 
          ON cf.table_name = c.table_name 
          AND cf.column_name = c.column_name
        ORDER BY 
          c.table_name, c.ordinal_position;`,
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });

    if (!format) {
      return columns as BQColumnResponse[];
    }
    return this.formatToCompactTable(columns);
  }

  public async listConstraints(options) {
    const { dataset } = options;
    // ref: information schema link: https://cloud.google.com/bigquery/docs/information-schema-intro
    const constraints = await new Promise((resolve, reject) => {
      this.bq.query(
        `
      SELECT 
        ccu.table_name as constraintTable, ccu.column_name constraintColumn, 
        kcu.table_name as constraintedTable, kcu.column_name as constraintedColumn, 
        tc.constraint_type as constraintType
      FROM ${dataset}.INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu 
      JOIN ${dataset}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
        ON ccu.constraint_name = kcu.constraint_name
      JOIN ${dataset}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      `,
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
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
          columns: [],
        };
        acc.push(table);
      }
      table.columns.push({
        name: row.column_name,
        type: row.data_type,
      });
      return acc;
    }, []);
  }
}
