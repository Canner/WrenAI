import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export interface Role {
  id: string;
  name: string;
  scopeType: string;
  scopeId?: string | null;
  displayName?: string | null;
  description?: string | null;
  isSystem?: boolean;
  isActive?: boolean;
  createdBy?: string | null;
}

export interface IRoleRepository extends IBasicRepository<Role> {
  findByNames(names: string[], queryOptions?: IQueryOptions): Promise<Role[]>;
}

export class RoleRepository
  extends BaseRepository<Role>
  implements IRoleRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'role' });
  }

  public async findByNames(names: string[], queryOptions?: IQueryOptions) {
    if (!names.length) {
      return [];
    }

    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = await executer(this.tableName).whereIn('name', names);
    return rows.map(this.transformFromDBData);
  }
}
