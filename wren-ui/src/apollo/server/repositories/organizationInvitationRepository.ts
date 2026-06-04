import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { Project } from './projectRepository';
import { DataSourceName } from '@server/types';

export interface OrganizationInvitation {
  id: number;
  organizationId: number;
  invitedByUserId?: number | null;
  email: string;
  organizationRole: string;
  token: string;
  status: string;
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationInvitationProject {
  id: number;
  organizationInvitationId: number;
  projectId: number;
  permission: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationInvitationProjectAssignment {
  id: number;
  projectId: number;
  permission: string;
  project: Project;
}

export interface OrganizationInvitationMapping extends OrganizationInvitation {
  projects: OrganizationInvitationProjectAssignment[];
}

export interface IOrganizationInvitationRepository
  extends IBasicRepository<OrganizationInvitation> {
  findByOrganizationId(
    organizationId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationInvitation[]>;
}

export interface IOrganizationInvitationProjectRepository
  extends IBasicRepository<OrganizationInvitationProject> {
  findByOrganizationInvitationId(
    organizationInvitationId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationInvitationProjectAssignment[]>;
}

export class OrganizationInvitationRepository
  extends BaseRepository<OrganizationInvitation>
  implements IOrganizationInvitationRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'organization_invitations' });
  }

  public async findByOrganizationId(
    organizationId: number,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = await executer(this.tableName)
      .where({ organization_id: organizationId })
      .orderBy('created_at', 'desc');

    return rows.map(this.transformFromDBData);
  }
}

export class OrganizationInvitationProjectRepository
  extends BaseRepository<OrganizationInvitationProject>
  implements IOrganizationInvitationProjectRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'organization_invitation_projects' });
  }

  public async findByOrganizationInvitationId(
    organizationInvitationId: number,
    queryOptions?: IQueryOptions,
  ): Promise<OrganizationInvitationProjectAssignment[]> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = await executer('organization_invitation_projects')
      .select(
        'organization_invitation_projects.*',
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
      .join(
        'project',
        'organization_invitation_projects.project_id',
        'project.id',
      )
      .where(
        'organization_invitation_projects.organization_invitation_id',
        organizationInvitationId,
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
