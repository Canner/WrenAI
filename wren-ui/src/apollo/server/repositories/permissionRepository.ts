import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Permission {
  id: string;
  name: string;
  scopeType: string;
  description?: string | null;
}

export interface IPermissionRepository extends IBasicRepository<Permission> {}

export class PermissionRepository
  extends BaseRepository<Permission>
  implements IPermissionRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'permission' });
  }
}
