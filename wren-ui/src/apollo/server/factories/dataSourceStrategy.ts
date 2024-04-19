import { CompactTable } from '../connectors/connector';
import { Model, ModelColumn } from '../repositories';
import { AnalysisRelationInfo } from '../types';

export interface IDataSourceStrategy {
  saveDataSource(properties: any): Promise<any>;
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
