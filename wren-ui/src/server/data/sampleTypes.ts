import { RelationType } from '../types';
import { SampleDatasetName } from './type';

export interface SampleDatasetColumn {
  name: string;
  properties?: Record<string, any>;
}

export interface SampleDatasetSchema {
  columnName: string;
  dataType: string;
}

export interface SampleDatasetTable {
  filePath: string;
  tableName: string;
  primaryKey?: string;
  schema?: SampleDatasetSchema[];
  columns?: SampleDatasetColumn[];
  properties?: Record<string, any>;
}

export interface SampleDatasetRelationship {
  fromModelName: string;
  fromColumnName: string;
  toModelName: string;
  toColumnName: string;
  type: RelationType;
  description?: string;
}

export interface SuggestedQuestion {
  question: string;
  label: string;
}

export interface SampleDataset {
  name: SampleDatasetName;
  tables: SampleDatasetTable[];
  questions?: SuggestedQuestion[];
  relations?: SampleDatasetRelationship[];
}
