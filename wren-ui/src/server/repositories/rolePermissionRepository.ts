import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface RolePermission {
  id: string;
  roleId: string;
  permissionId: string;
}

export interface IRolePermissionRepository extends IBasicRepository<RolePermission> {}

export class RolePermissionRepository
  extends BaseRepository<RolePermission>
  implements IRolePermissionRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'role_permission' });
  }
}
