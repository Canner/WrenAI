import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface SkillBinding {
  id: string;
  knowledgeBaseId: string;
  kbSnapshotId?: string | null;
  skillDefinitionId: string;
  connectorId?: string | null;
  bindingConfig?: Record<string, any> | null;
  enabled: boolean;
  createdBy?: string | null;
}

export interface ISkillBindingRepository extends IBasicRepository<SkillBinding> {}

export class SkillBindingRepository
  extends BaseRepository<SkillBinding>
  implements ISkillBindingRepository
{
  private readonly jsonColumns = ['bindingConfig'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'skill_binding' });
  }

  protected override transformFromDBData = (data: any): SkillBinding => {
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

    return transformedData as SkillBinding;
  };

  protected override transformToDBData = (data: Partial<SkillBinding>) => {
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
