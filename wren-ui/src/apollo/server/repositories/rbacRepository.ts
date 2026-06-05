import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
  coerceBoolean,
} from './baseRepository';

export interface Role {
  id: number;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RbacUser {
  id: number;
  name: string;
  email: string;
  externalId?: string | null;
  identityProvider?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserRole {
  id: number;
  userId: number;
  roleId: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleMapping extends UserRole {
  user: RbacUser;
  role: Role;
}

export interface IRoleRepository extends IBasicRepository<Role> {}

export interface IUserRepository extends IBasicRepository<RbacUser> {}

export interface IUserRoleRepository extends IBasicRepository<UserRole> {
  findMappings(queryOptions?: IQueryOptions): Promise<UserRoleMapping[]>;
  findMappingsByUserId(
    userId: number,
    queryOptions?: IQueryOptions,
  ): Promise<UserRoleMapping[]>;
  findMappingsByRoleId(
    roleId: number,
    queryOptions?: IQueryOptions,
  ): Promise<UserRoleMapping[]>;
}

export class RoleRepository
  extends BaseRepository<Role>
  implements IRoleRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'roles' });
  }
}

export class UserRepository
  extends BaseRepository<RbacUser>
  implements IUserRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'users' });
  }

  protected override transformFromDBData = (data: any): RbacUser => {
    const user = this.defaultTransformFromDBData(data) as RbacUser;
    return {
      ...user,
      isActive: coerceBoolean(user.isActive),
    };
  };
}

export class UserRoleRepository
  extends BaseRepository<UserRole>
  implements IUserRoleRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'user_roles' });
  }

  public async findMappings(queryOptions?: IQueryOptions) {
    return this.queryMappings({}, queryOptions);
  }

  public async findMappingsByUserId(
    userId: number,
    queryOptions?: IQueryOptions,
  ) {
    return this.queryMappings({ userId }, queryOptions);
  }

  public async findMappingsByRoleId(
    roleId: number,
    queryOptions?: IQueryOptions,
  ) {
    return this.queryMappings({ roleId }, queryOptions);
  }

  private async queryMappings(
    filter: Partial<UserRole>,
    queryOptions?: IQueryOptions,
  ): Promise<UserRoleMapping[]> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer('user_roles')
      .select(
        'user_roles.*',
        'users.id as user__id',
        'users.name as user__name',
        'users.email as user__email',
        'users.external_id as user__external_id',
        'users.identity_provider as user__identity_provider',
        'users.is_active as user__is_active',
        'users.created_at as user__created_at',
        'users.updated_at as user__updated_at',
        'roles.id as role__id',
        'roles.name as role__name',
        'roles.description as role__description',
        'roles.created_at as role__created_at',
        'roles.updated_at as role__updated_at',
      )
      .join('users', 'user_roles.user_id', 'users.id')
      .join('roles', 'user_roles.role_id', 'roles.id')
      .orderBy('users.email')
      .orderBy('roles.name');

    if (filter.userId) {
      query.where('user_roles.user_id', filter.userId);
    }
    if (filter.roleId) {
      query.where('user_roles.role_id', filter.roleId);
    }

    const rows = await query;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      roleId: row.role_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      user: {
        id: row.user__id,
        name: row.user__name,
        email: row.user__email,
        externalId: row.user__external_id,
        identityProvider: row.user__identity_provider,
        isActive: coerceBoolean(row.user__is_active),
        createdAt: row.user__created_at,
        updatedAt: row.user__updated_at,
      },
      role: {
        id: row.role__id,
        name: row.role__name,
        description: row.role__description,
        createdAt: row.role__created_at,
        updatedAt: row.role__updated_at,
      },
    }));
  }
}
