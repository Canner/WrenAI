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
  saveModels(models: any): Promise<any>;
  analysisRelation(
    models: Model[],
    columns: ModelColumn[],
  ): Promise<AnalysisRelationInfo[]>;
}
