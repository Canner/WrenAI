import { SampleDatasetName } from './type';
import { ecommerceSampleDataset } from './sampleEcommerceDataset';
import { hrSampleDataset } from './sampleHrDataset';
import { musicSampleDataset } from './sampleMusicDataset';
import { nbaSampleDataset } from './sampleNbaDataset';

export type {
  SampleDatasetColumn,
  SampleDataset,
  SampleDatasetRelationship,
  SampleDatasetSchema,
  SampleDatasetTable,
  SuggestedQuestion,
} from './sampleTypes';
import type { SampleDataset } from './sampleTypes';

export const sampleDatasets: Record<string, SampleDataset> = {
  hr: hrSampleDataset,
  music: musicSampleDataset,
  ecommerce: ecommerceSampleDataset,
  nba: nbaSampleDataset,
};

export const buildInitSql = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];

  return selectedDataset.tables
    .map((table) => {
      const schema = table.schema
        ?.map(({ columnName, dataType }) => `'${columnName}': '${dataType}'`)
        .join(', ');
      const fileExtension = table.filePath.split('.').pop();
      const createTableStatement = (fileType: string, schema?: string) => {
        if (fileType !== 'csv' && fileType !== 'parquet') {
          throw new Error(`Unsupported file type: ${fileType}`);
        }
        const baseStatement = `CREATE TABLE ${table.tableName} AS select * FROM read_${fileType}('${table.filePath}'`;
        const schemaPart =
          fileType === 'csv' && schema ? `, columns={${schema}}` : '';
        const headerPart = fileType === 'csv' ? ',header=true' : '';
        return `${baseStatement}${headerPart}${schemaPart});`;
      };

      if (!fileExtension) {
        throw new Error(
          `Missing file extension for file path: ${table.filePath}`,
        );
      }

      return createTableStatement(fileExtension, schema);
    })
    .join('\n');
};

export const getRelations = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];
  return selectedDataset.relations;
};

export const getSampleAskQuestions = (datasetName: SampleDatasetName) => {
  const selectedDataset = sampleDatasets[datasetName.toLowerCase()];
  return selectedDataset.questions;
};
