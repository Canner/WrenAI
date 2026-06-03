import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { Project } from './projectRepository';
import { DataSourceName } from '@server/types';
import { RbacUser } from './rbacRepository';

export interface OrganizationMember {
  id: number;
  organizationId: number;
  userId: number;
  organizationRole: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberProject {
  id: number;
  organizationMemberId: number;
  projectId: number;
  permission: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberProjectAssignment {
  id: number;
  projectId: number;
  permission: string;
  project: Project;
}

export interface OrganizationMemberMapping extends OrganizationMember {
  user: RbacUser;
  projects: OrganizationMemberProjectAssignment[];
}

export interface IOrganizationMemberRepository
  extends IBasicRepository<OrganizationMember> {
  findMappingsByOrganizationId(
    organizationId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberMapping[]>;
}

export interface IOrganizationMemberProjectRepository
  extends IBasicRepository<OrganizationMemberProject> {
  findByOrganizationMemberId(
    organizationMemberId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberProjectAssignment[]>;
}

export class OrganizationMemberRepository
  extends BaseRepository<OrganizationMember>
  implements IOrganizationMemberRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'organization_members' });
  }

  public async findMappingsByOrganizationId(
    organizationId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberMapping[]> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = await executer('organization_members')
      .select(
        'organization_members.*',
        'users.id as user__id',
        'users.name as user__name',
        'users.email as user__email',
        'users.external_id as user__external_id',
        'users.identity_provider as user__identity_provider',
        'users.is_active as user__is_active',
        'users.created_at as user__created_at',
        'users.updated_at as user__updated_at',
      )
      .join('users', 'organization_members.user_id', 'users.id')
      .where('organization_members.organization_id', organizationId)
      .orderBy('users.email');

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      organizationRole: row.organization_role,
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
      projects: [],
    }));
  }
}

export class OrganizationMemberProjectRepository
  extends BaseRepository<OrganizationMemberProject>
  implements IOrganizationMemberProjectRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'organization_member_projects' });
  }

  public async findByOrganizationMemberId(
    organizationMemberId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationMemberProjectAssignment[]> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = await executer('organization_member_projects')
      .select(
        'organization_member_projects.*',
        'project.id as project__id',
        'project.display_name as project__display_name',
        'project.type as project__type',
        'project.version as project__version',
        'project.catalog as project__catalog',
        'project.schema as project__schema',
        'project.sample_dataset as project__sample_dataset',
        'project.connection_info as project__connection_info',
        'project.language as project__language',
        'project.query_id as project__query_id',
        'project.questions as project__questions',
        'project.questions_status as project__questions_status',
        'project.questions_error as project__questions_error',
      )
      .join('project', 'organization_member_projects.project_id', 'project.id')
      .where(
        'organization_member_projects.organization_member_id',
        organizationMemberId,
      )
      .orderBy('project.id');

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      permission: row.permission,
      project: {
        id: row.project__id,
        displayName: row.project__display_name,
        type: DataSourceName[row.project__type],
        version: row.project__version,
        catalog: row.project__catalog,
        schema: row.project__schema,
        sampleDataset: row.project__sample_dataset,
        connectionInfo:
          typeof row.project__connection_info === 'string'
            ? JSON.parse(row.project__connection_info || '{}')
            : row.project__connection_info,
        language: row.project__language,
        queryId: row.project__query_id,
        questions:
          typeof row.project__questions === 'string'
            ? JSON.parse(row.project__questions || '[]')
            : row.project__questions,
        questionsStatus: row.project__questions_status,
        questionsError:
          typeof row.project__questions_error === 'string'
            ? JSON.parse(row.project__questions_error || '{}')
            : row.project__questions_error,
      },
    }));
  }
}
