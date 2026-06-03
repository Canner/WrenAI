import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
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
  passwordHash?: string | null;
  externalId?: string | null;
  identityProvider?: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
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

export interface Organization {
  id: number;
  name: string;
  slug: string;
  externalId?: string | null;
  identityProvider?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: number;
  organizationId: number;
  userId: number;
  roleId: number;
  status: string;
  invitedByMemberId?: number | null;
  joinedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberMapping extends OrganizationMember {
  organization: Organization;
  user: RbacUser;
  role: Role;
}

export interface MemberInvitation {
  id: number;
  organizationId: number;
  roleId: number;
  email: string;
  name?: string | null;
  token: string;
  status: string;
  invitedByMemberId?: number | null;
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberInvitationMapping extends MemberInvitation {
  organization: Organization;
  role: Role;
  invitedBy?: OrganizationMemberMapping | null;
}

export interface AuthSession {
  id: number;
  userId: number;
  organizationMemberId: number;
  token: string;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface IOrganizationRepository
  extends IBasicRepository<Organization> {}

export interface IOrganizationMemberRepository
  extends IBasicRepository<OrganizationMember> {
  findMappings(
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberMapping[]>;
  findMappingsByOrganizationId(
    organizationId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberMapping[]>;
  findMappingById(
    id: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberMapping | null>;
  findActiveMappingByUserId(
    userId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberMapping | null>;
}

export interface IMemberInvitationRepository
  extends IBasicRepository<MemberInvitation> {
  findMappings(
    queryOptions?: IQueryOptions,
  ): Promise<MemberInvitationMapping[]>;
  findMappingByToken(
    token: string,
    queryOptions?: IQueryOptions,
  ): Promise<MemberInvitationMapping | null>;
}

export interface IAuthSessionRepository extends IBasicRepository<AuthSession> {
  findActiveByToken(
    token: string,
    queryOptions?: IQueryOptions,
  ): Promise<AuthSession | null>;
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
        isActive: row.user__is_active,
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

export class OrganizationRepository
  extends BaseRepository<Organization>
  implements IOrganizationRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'organizations' });
  }
}

export class OrganizationMemberRepository
  extends BaseRepository<OrganizationMember>
  implements IOrganizationMemberRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'organization_members' });
  }

  public async findMappings(queryOptions?: IQueryOptions) {
    return this.queryMappings({}, queryOptions);
  }

  public async findMappingsByOrganizationId(
    organizationId: number,
    queryOptions?: IQueryOptions,
  ) {
    return this.queryMappings({ organizationId }, queryOptions);
  }

  public async findMappingById(id: number, queryOptions?: IQueryOptions) {
    const [mapping] = await this.queryMappings({ id }, queryOptions);
    return mapping || null;
  }

  public async findActiveMappingByUserId(
    userId: number,
    queryOptions?: IQueryOptions,
  ) {
    const [mapping] = await this.queryMappings(
      { userId, status: 'active' },
      queryOptions,
    );
    return mapping || null;
  }

  private async queryMappings(
    filter: Partial<OrganizationMember>,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberMapping[]> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer('organization_members')
      .select(
        'organization_members.*',
        'organizations.id as organization__id',
        'organizations.name as organization__name',
        'organizations.slug as organization__slug',
        'organizations.external_id as organization__external_id',
        'organizations.identity_provider as organization__identity_provider',
        'organizations.is_active as organization__is_active',
        'organizations.created_at as organization__created_at',
        'organizations.updated_at as organization__updated_at',
        'users.id as user__id',
        'users.name as user__name',
        'users.email as user__email',
        'users.password_hash as user__password_hash',
        'users.external_id as user__external_id',
        'users.identity_provider as user__identity_provider',
        'users.is_active as user__is_active',
        'users.last_login_at as user__last_login_at',
        'users.created_at as user__created_at',
        'users.updated_at as user__updated_at',
        'roles.id as role__id',
        'roles.name as role__name',
        'roles.description as role__description',
        'roles.created_at as role__created_at',
        'roles.updated_at as role__updated_at',
      )
      .join(
        'organizations',
        'organization_members.organization_id',
        'organizations.id',
      )
      .join('users', 'organization_members.user_id', 'users.id')
      .join('roles', 'organization_members.role_id', 'roles.id')
      .orderBy('users.email');

    if (filter.id) query.where('organization_members.id', filter.id);
    if (filter.organizationId) {
      query.where(
        'organization_members.organization_id',
        filter.organizationId,
      );
    }
    if (filter.userId)
      query.where('organization_members.user_id', filter.userId);
    if (filter.status)
      query.where('organization_members.status', filter.status);

    const rows = await query;
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      roleId: row.role_id,
      status: row.status,
      invitedByMemberId: row.invited_by_member_id,
      joinedAt: row.joined_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      organization: {
        id: row.organization__id,
        name: row.organization__name,
        slug: row.organization__slug,
        externalId: row.organization__external_id,
        identityProvider: row.organization__identity_provider,
        isActive: row.organization__is_active,
        createdAt: row.organization__created_at,
        updatedAt: row.organization__updated_at,
      },
      user: {
        id: row.user__id,
        name: row.user__name,
        email: row.user__email,
        passwordHash: row.user__password_hash,
        externalId: row.user__external_id,
        identityProvider: row.user__identity_provider,
        isActive: row.user__is_active,
        lastLoginAt: row.user__last_login_at,
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

export class MemberInvitationRepository
  extends BaseRepository<MemberInvitation>
  implements IMemberInvitationRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'member_invitations' });
  }

  public async findMappings(queryOptions?: IQueryOptions) {
    return this.queryMappings({}, queryOptions);
  }

  public async findMappingByToken(token: string, queryOptions?: IQueryOptions) {
    const [mapping] = await this.queryMappings({ token }, queryOptions);
    return mapping || null;
  }

  private async queryMappings(
    filter: Partial<MemberInvitation>,
    queryOptions?: IQueryOptions,
  ): Promise<MemberInvitationMapping[]> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer('member_invitations')
      .select(
        'member_invitations.*',
        'organizations.id as organization__id',
        'organizations.name as organization__name',
        'organizations.slug as organization__slug',
        'organizations.external_id as organization__external_id',
        'organizations.identity_provider as organization__identity_provider',
        'organizations.is_active as organization__is_active',
        'organizations.created_at as organization__created_at',
        'organizations.updated_at as organization__updated_at',
        'roles.id as role__id',
        'roles.name as role__name',
        'roles.description as role__description',
        'roles.created_at as role__created_at',
        'roles.updated_at as role__updated_at',
      )
      .join(
        'organizations',
        'member_invitations.organization_id',
        'organizations.id',
      )
      .join('roles', 'member_invitations.role_id', 'roles.id')
      .orderBy('member_invitations.created_at', 'desc');

    if (filter.token) query.where('member_invitations.token', filter.token);
    if (filter.organizationId) {
      query.where('member_invitations.organization_id', filter.organizationId);
    }
    if (filter.status) query.where('member_invitations.status', filter.status);

    const rows = await query;
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      roleId: row.role_id,
      email: row.email,
      name: row.name,
      token: row.token,
      status: row.status,
      invitedByMemberId: row.invited_by_member_id,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      organization: {
        id: row.organization__id,
        name: row.organization__name,
        slug: row.organization__slug,
        externalId: row.organization__external_id,
        identityProvider: row.organization__identity_provider,
        isActive: row.organization__is_active,
        createdAt: row.organization__created_at,
        updatedAt: row.organization__updated_at,
      },
      role: {
        id: row.role__id,
        name: row.role__name,
        description: row.role__description,
        createdAt: row.role__created_at,
        updatedAt: row.role__updated_at,
      },
      invitedBy: null,
    }));
  }
}

export class AuthSessionRepository
  extends BaseRepository<AuthSession>
  implements IAuthSessionRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'auth_sessions' });
  }

  public async findActiveByToken(token: string, queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const result = await executer('auth_sessions')
      .where({ token })
      .whereNull('revoked_at')
      .where('expires_at', '>', new Date().toISOString())
      .limit(1);
    return result?.[0] ? this.transformFromDBData(result[0]) : null;
  }
}
