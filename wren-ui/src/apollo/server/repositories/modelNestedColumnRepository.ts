import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ModelNestedColumn {
  id: number; // ID
  modelId: number; // Reference to model ID
  columnId: number; // Reference to column ID
  columnPath: string[];
  displayName: string; // Nested column name displayed in UI
  referenceName: string; // The name used in the MDL structure and when querying the data
  sourceColumnName: string; // The nested column name in the datasource
  type: string; // Data type, refer to the nested column type in the datasource
  properties?: Record<string, any>; // Nested column properties, a json string, the description should be stored here
}

export interface IModelNestedColumnRepository
  extends IBasicRepository<ModelNestedColumn> {
  findNestedColumnsByModelIds(modelIds: number[]): Promise<ModelNestedColumn[]>;
  findNestedColumnsByIds(ids: number[]): Promise<ModelNestedColumn[]>;
}

export class ModelNestedColumnRepository
  extends BaseRepository<ModelNestedColumn>
  implements IModelNestedColumnRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model_nested_column' });
  }

  public findNestedColumnsByModelIds = async (modelIds: number[]) => {
    const result = await this.knex(this.tableName)
      .select('*')
      .whereIn('model_id', modelIds);
    return result.map((r) => this.transformFromDBData(r));
  };

  public findNestedColumnsByIds = async (ids: number[]) => {
    const result = await this.knex(this.tableName)
      .select('*')
      .whereIn('id', ids);
    return result.map((r) => this.transformFromDBData(r));
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (['columnPath', 'properties'].includes(key)) {
        return value ? JSON.stringify(value) : null;
      }
      return value;
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  protected override transformFromDBData = (data: any): ModelNestedColumn => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['columnPath', 'properties'].includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as ModelNestedColumn;
    return formattedData;
  };
}
