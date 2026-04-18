import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export type SkillExecutionMode = 'inject_only';
export type SkillInstalledFrom =
  | 'custom'
  | 'marketplace'
  | 'builtin'
  | 'migrated_from_binding';

export interface SkillDefinition {
  id: string;
  workspaceId: string;
  name: string;
  runtimeKind: string;
  sourceType: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifestJson?: Record<string, any> | null;
  catalogId?: string | null;
  instruction?: string | null;
  isEnabled?: boolean;
  executionMode?: SkillExecutionMode;
  connectorId?: string | null;
  runtimeConfigJson?: Record<string, any> | null;
  kbSuggestionIds?: string[] | null;
  installedFrom?: SkillInstalledFrom;
  migrationSourceBindingId?: string | null;
  secretRecordId?: string | null;
  createdBy?: string | null;
}

export interface ISkillDefinitionRepository
  extends IBasicRepository<SkillDefinition> {
  listAvailableSkillsByWorkspace(
    workspaceId: string,
    queryOptions?: IQueryOptions,
  ): Promise<SkillDefinition[]>;
  findAllByCatalogId(
    workspaceId: string,
    catalogId: string,
    queryOptions?: IQueryOptions,
  ): Promise<SkillDefinition[]>;
  findOneByMigrationSourceBindingId(
    bindingId: string,
    queryOptions?: IQueryOptions,
  ): Promise<SkillDefinition | null>;
}

export class SkillDefinitionRepository
  extends BaseRepository<SkillDefinition>
  implements ISkillDefinitionRepository
{
  private readonly jsonColumns = [
    'manifestJson',
    'runtimeConfigJson',
    'kbSuggestionIds',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'skill_definition' });
  }

  public async listAvailableSkillsByWorkspace(
    workspaceId: string,
    queryOptions?: IQueryOptions,
  ) {
    return await this.findAllBy({ workspaceId, isEnabled: true }, queryOptions);
  }

  public async findAllByCatalogId(
    workspaceId: string,
    catalogId: string,
    queryOptions?: IQueryOptions,
  ) {
    return await this.findAllBy({ workspaceId, catalogId }, queryOptions);
  }

  public async findOneByMigrationSourceBindingId(
    bindingId: string,
    queryOptions?: IQueryOptions,
  ) {
    return await this.findOneBy(
      { migrationSourceBindingId: bindingId },
      queryOptions,
    );
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
