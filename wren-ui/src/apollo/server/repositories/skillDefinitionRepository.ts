import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface SkillDefinition {
  id: string;
  workspaceId: string;
  name: string;
  runtimeKind: string;
  sourceType: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifestJson?: Record<string, any> | null;
  createdBy?: string | null;
}

export interface ISkillDefinitionRepository extends IBasicRepository<SkillDefinition> {}

export class SkillDefinitionRepository
  extends BaseRepository<SkillDefinition>
  implements ISkillDefinitionRepository
{
  private readonly jsonColumns = ['manifestJson'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'skill_definition' });
  }

  protected override transformFromDBData = (data: any): SkillDefinition => {
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

    return transformedData as SkillDefinition;
  };

  protected override transformToDBData = (data: Partial<SkillDefinition>) => {
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
