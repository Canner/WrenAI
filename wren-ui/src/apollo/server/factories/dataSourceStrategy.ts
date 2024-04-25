import { CompactTable } from '../connectors/connector';
import { Model, ModelColumn } from '../repositories';
import { AnalysisRelationInfo, DataSourceProperties } from '../types';

export interface IDataSourceStrategy {
  createDataSource(properties: DataSourceProperties): Promise<any>;
  updateDataSource(properties: DataSourceProperties): Promise<any>;
  listTable({
    formatToCompactTable,
  }: {
    formatToCompactTable: boolean;
  }): Promise<CompactTable[] | any[]>;

  /**
   * Save multiple models, all the supported column in the table will be created
   * @param models : array of table names in the datasource
   */
  saveModels(models: any): Promise<any>;
  /**
   * Save single model, only the column specified in the columns array will be created
   * @param table : source table name
   * @param columns : source column name of the table
   */
  saveModel(
    table: string,
    columns: string[],
    primaryKey?: string,
  ): Promise<any>;
  analysisRelation(
    models: Model[],
    columns: ModelColumn[],
  ): Promise<AnalysisRelationInfo[]>;
}
