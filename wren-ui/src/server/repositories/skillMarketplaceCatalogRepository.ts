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
import { SkillExecutionMode } from './skillDefinitionRepository';

export interface SkillMarketplaceCatalog {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  category?: string | null;
  author?: string | null;
  version: string;
  runtimeKind: string;
  sourceType: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifestJson?: Record<string, any> | null;
  defaultInstruction?: string | null;
  defaultExecutionMode?: SkillExecutionMode;
  isBuiltin?: boolean;
  isFeatured?: boolean;
  installCount?: number;
}

export interface ISkillMarketplaceCatalogRepository extends IBasicRepository<SkillMarketplaceCatalog> {
  findFeatured(
    queryOptions?: IQueryOptions,
  ): Promise<SkillMarketplaceCatalog[]>;
  findBuiltin(queryOptions?: IQueryOptions): Promise<SkillMarketplaceCatalog[]>;
  findOneBySlug(
    slug: string,
    queryOptions?: IQueryOptions,
  ): Promise<SkillMarketplaceCatalog | null>;
}

export class SkillMarketplaceCatalogRepository
  extends BaseRepository<SkillMarketplaceCatalog>
  implements ISkillMarketplaceCatalogRepository
{
  private readonly jsonColumns = ['manifestJson'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'skill_marketplace_catalog' });
  }

  public async findFeatured(queryOptions?: IQueryOptions) {
    return await this.findAllBy({ isFeatured: true }, queryOptions);
  }

  public async findBuiltin(queryOptions?: IQueryOptions) {
    return await this.findAllBy({ isBuiltin: true }, queryOptions);
  }

  public async findOneBySlug(slug: string, queryOptions?: IQueryOptions) {
    return await this.findOneBy({ slug }, queryOptions);
  }

  protected override transformFromDBData = (
    data: any,
  ): SkillMarketplaceCatalog => {
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

    return transformedData as SkillMarketplaceCatalog;
  };

  protected override transformToDBData = (
    data: Partial<SkillMarketplaceCatalog>,
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
