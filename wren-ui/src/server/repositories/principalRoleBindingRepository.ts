import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export interface PrincipalRoleBinding {
  id: string;
  principalType: string;
  principalId: string;
  roleId: string;
  scopeType: string;
  scopeId: string;
  createdBy?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface ResolvedPrincipalRoleBinding {
  id: string;
  roleId: string;
  roleName: string;
  roleScopeType: string;
  principalType: string;
  principalId: string;
  scopeType: string;
  scopeId: string;
}

export interface PrincipalRoleBindingScope {
  principalType: string;
  principalId: string;
  scopeType: string;
  scopeId: string;
}

export interface IPrincipalRoleBindingRepository extends IBasicRepository<PrincipalRoleBinding> {
  findResolvedRoleBindings(
    scope: PrincipalRoleBindingScope,
    queryOptions?: IQueryOptions,
  ): Promise<ResolvedPrincipalRoleBinding[]>;
  findPermissionNamesByScope(
    scope: PrincipalRoleBindingScope,
    queryOptions?: IQueryOptions,
  ): Promise<string[]>;
  deleteByScope(
    scope: PrincipalRoleBindingScope,
    queryOptions?: IQueryOptions,
  ): Promise<number>;
}

export class PrincipalRoleBindingRepository
  extends BaseRepository<PrincipalRoleBinding>
  implements IPrincipalRoleBindingRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'principal_role_binding' });
  }

  public async findResolvedRoleBindings(
    scope: PrincipalRoleBindingScope,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = await executer({ binding: this.tableName })
      .join({ role: 'role' }, 'binding.role_id', 'role.id')
      .where({
        'binding.principal_type': scope.principalType,
        'binding.principal_id': scope.principalId,
        'binding.scope_type': scope.scopeType,
        'binding.scope_id': scope.scopeId,
      })
      .whereNot('role.is_active', false)
      .select(
        'binding.id',
        'binding.role_id as roleId',
        'binding.principal_type as principalType',
        'binding.principal_id as principalId',
        'binding.scope_type as scopeType',
        'binding.scope_id as scopeId',
        'role.name as roleName',
        'role.scope_type as roleScopeType',
      );

    return rows as ResolvedPrincipalRoleBinding[];
  }

  public async findPermissionNamesByScope(
    scope: PrincipalRoleBindingScope,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = await executer({ binding: this.tableName })
      .join({ role: 'role' }, 'binding.role_id', 'role.id')
      .join(
        { rolePermission: 'role_permission' },
        'binding.role_id',
        'rolePermission.role_id',
      )
      .join(
        { permission: 'permission' },
        'rolePermission.permission_id',
        'permission.id',
      )
      .where({
        'binding.principal_type': scope.principalType,
        'binding.principal_id': scope.principalId,
        'binding.scope_type': scope.scopeType,
        'binding.scope_id': scope.scopeId,
      })
      .whereNot('role.is_active', false)
      .select('permission.name');

    return Array.from(
      new Set(
        rows
          .map((row: { name?: string | null }) => row.name || null)
          .filter(Boolean),
      ),
    ) as string[];
  }

  public async deleteByScope(
    scope: PrincipalRoleBindingScope,
    queryOptions?: IQueryOptions,
  ) {
    return await this.deleteAllBy(
      {
        principalType: scope.principalType,
        principalId: scope.principalId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      },
      queryOptions,
    );
  }
}
