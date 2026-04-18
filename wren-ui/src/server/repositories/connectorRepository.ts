import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface Connector {
  id: string;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  databaseProvider?: string | null;
  trinoCatalogName?: string | null;
  displayName: string;
  configJson?: Record<string, any> | null;
  secretRecordId?: string | null;
  createdBy?: string | null;
}

export interface IConnectorRepository extends IBasicRepository<Connector> {}

export class ConnectorRepository
  extends BaseRepository<Connector>
  implements IConnectorRepository
{
  private readonly jsonColumns = ['configJson'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'connector' });
  }

  protected override transformFromDBData = (data: any): Connector => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformedData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value === 'string') {
        return value ? JSON.parse(value) : value;
      }
      return value;
    });

    return transformedData as Connector;
  };

  protected override transformToDBData = (data: Partial<Connector>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value !== 'string') {
        return JSON.stringify(value);
      }
      return value;
    });

    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}
