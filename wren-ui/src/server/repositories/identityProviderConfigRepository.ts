import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface IdentityProviderConfig {
  id: string;
  workspaceId: string;
  providerType: string;
  name: string;
  enabled: boolean;
  configJson?: Record<string, any> | null;
  createdBy?: string | null;
}

export interface IIdentityProviderConfigRepository extends IBasicRepository<IdentityProviderConfig> {}

export class IdentityProviderConfigRepository
  extends BaseRepository<IdentityProviderConfig>
  implements IIdentityProviderConfigRepository
{
  private readonly jsonColumns = ['configJson'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'identity_provider_config' });
  }

  protected override transformFromDBData = (
    data: any,
  ): IdentityProviderConfig => {
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

    return transformedData as IdentityProviderConfig;
  };

  protected override transformToDBData = (
    data: Partial<IdentityProviderConfig>,
  ) => {
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
