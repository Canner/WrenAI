import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
  coerceBoolean,
} from './baseRepository';

export interface Organization {
  id: number;
  name: string;
  identifier: string;
  description?: string | null;
  isCurrent: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface IOrganizationRepository extends IBasicRepository<Organization> {
  getCurrentOrganization: (
    queryOptions?: IQueryOptions,
  ) => Promise<Organization | null>;
  setCurrentOrganization: (
    id: number,
    queryOptions?: IQueryOptions,
  ) => Promise<Organization>;
}

export class OrganizationRepository
  extends BaseRepository<Organization>
  implements IOrganizationRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'organization' });
  }

  protected override transformFromDBData = (data: any): Organization => {
    const organization = super.transformFromDBData(data) as Organization;
    return {
      ...organization,
      isCurrent: coerceBoolean(organization.isCurrent),
    };
  };

  public async getCurrentOrganization(queryOptions?: IQueryOptions) {
    return await this.findOneBy({ isCurrent: true }, queryOptions);
  }

  public async setCurrentOrganization(id: number, queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    await executer(this.tableName).update({ is_current: false });
    const [result] = await executer(this.tableName)
      .where({ id })
      .update({ is_current: true })
      .returning('*');
    return this.transformFromDBData(result);
  }
}
