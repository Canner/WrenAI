import { ApiError } from '../utils/apiUtils';
import {
  IOrganizationMemberProjectRepository,
  IOrganizationMemberRepository,
  OrganizationMemberMapping,
} from '../repositories/organizationMemberRepository';
import { IOrganizationRepository } from '../repositories/organizationRepository';
import { IProjectRepository } from '../repositories/projectRepository';
import { IUserRepository, RbacUser } from '../repositories/rbacRepository';

export const ORGANIZATION_MEMBER_ROLES = ['Admin', 'Member'] as const;
export const PROJECT_PERMISSION_ROLES = ['Owner', 'Editor', 'Viewer'] as const;

export type OrganizationMemberRole =
  (typeof ORGANIZATION_MEMBER_ROLES)[number];
export type ProjectPermissionRole = (typeof PROJECT_PERMISSION_ROLES)[number];

export interface MemberProjectInput {
  projectId: number;
  permission: ProjectPermissionRole;
}

export interface InviteOrganizationMemberInput {
  email: string;
  organizationRole: OrganizationMemberRole;
  projects: MemberProjectInput[];
}

export interface UpdateOrganizationMemberInput {
  organizationRole: OrganizationMemberRole;
}

export interface OrganizationMemberSummary {
  id: number;
  userId: number;
  name: string;
  email: string;
  organizationRole: OrganizationMemberRole;
  projects: Array<{
    projectId: number;
    displayName: string;
    permission: ProjectPermissionRole;
  }>;
}

export interface IOrganizationMemberService {
  listCurrentOrganizationMembers(): Promise<{
    members: OrganizationMemberSummary[];
    projects: Array<{ id: number; displayName: string }>;
  }>;
  inviteMember(
    input: InviteOrganizationMemberInput,
  ): Promise<OrganizationMemberSummary>;
  updateMember(
    id: number,
    input: UpdateOrganizationMemberInput,
  ): Promise<OrganizationMemberSummary>;
  removeMember(id: number): Promise<boolean>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class OrganizationMemberService implements IOrganizationMemberService {
  constructor(
    private readonly organizationRepository: IOrganizationRepository,
    private readonly organizationMemberRepository: IOrganizationMemberRepository,
    private readonly organizationMemberProjectRepository: IOrganizationMemberProjectRepository,
    private readonly userRepository: IUserRepository,
    private readonly projectRepository: IProjectRepository,
  ) {}

  public async listCurrentOrganizationMembers() {
    const organization = await this.getCurrentOrganizationOrThrow();
    const [members, projects] = await Promise.all([
      this.organizationMemberRepository.findMappingsByOrganizationId(
        organization.id,
      ),
      this.projectRepository.findAll({ order: 'id' }),
    ]);

    const hydratedMembers = await Promise.all(
      members.map((member) => this.serializeMember(member)),
    );

    return {
      members: hydratedMembers,
      projects: projects.map((project) => ({
        id: project.id,
        displayName: project.displayName,
      })),
    };
  }

  public async inviteMember(input: InviteOrganizationMemberInput) {
    const organization = await this.getCurrentOrganizationOrThrow();
    const payload = await this.validateInvitePayload(input);
    const existingUser = await this.userRepository.findOneBy({
      email: payload.email,
    });
    const user = existingUser
      ? existingUser
      : await this.createUserFromInvite(payload.email);

    const existingMembership =
      await this.organizationMemberRepository.findOneBy({
        organizationId: organization.id,
        userId: user.id,
      });
    if (existingMembership) {
      throw new ApiError('Member already exists in this organization', 409);
    }

    const tx = await this.organizationMemberRepository.transaction();
    try {
      const now = new Date().toISOString();
      const member = await this.organizationMemberRepository.createOne(
        {
          organizationId: organization.id,
          userId: user.id,
          organizationRole: payload.organizationRole,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );

      if (payload.projects.length) {
        await this.organizationMemberProjectRepository.createMany(
          payload.projects.map((project) => ({
            organizationMemberId: member.id,
            projectId: project.projectId,
            permission: project.permission,
            createdAt: now,
            updatedAt: now,
          })),
          { tx },
        );
      }

      await tx.commit();
      const mapping = await this.getMemberMappingOrThrow(member.id);
      return this.serializeMember(mapping);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async updateMember(
    id: number,
    input: UpdateOrganizationMemberInput,
  ): Promise<OrganizationMemberSummary> {
    const member = await this.organizationMemberRepository.findOneBy({ id });
    if (!member) {
      throw new ApiError('Member not found', 404);
    }

    const organization = await this.getCurrentOrganizationOrThrow();
    if (member.organizationId !== organization.id) {
      throw new ApiError('Member not found', 404);
    }

    const role = this.validateOrganizationRole(input.organizationRole);
    await this.organizationMemberRepository.updateOne(member.id, {
      organizationRole: role,
      updatedAt: new Date().toISOString(),
    });

    const mapping = await this.getMemberMappingOrThrow(member.id);
    return this.serializeMember(mapping);
  }

  public async removeMember(id: number): Promise<boolean> {
    const member = await this.organizationMemberRepository.findOneBy({ id });
    if (!member) return true;

    const organization = await this.getCurrentOrganizationOrThrow();
    if (member.organizationId !== organization.id) {
      throw new ApiError('Member not found', 404);
    }

    await this.organizationMemberRepository.deleteOne(member.id);
    return true;
  }

  private async getCurrentOrganizationOrThrow() {
    const organization =
      await this.organizationRepository.getCurrentOrganization();
    if (!organization) {
      throw new ApiError('Current organization not found', 404);
    }
    return organization;
  }

  private async createUserFromInvite(email: string): Promise<RbacUser> {
    const now = new Date().toISOString();
    const localPart = email.split('@')[0] || 'user';
    return this.userRepository.createOne({
      name: localPart,
      email,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async validateInvitePayload(input: InviteOrganizationMemberInput) {
    const email = `${input.email || ''}`.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new ApiError('A valid email address is required', 400);
    }

    const organizationRole = this.validateOrganizationRole(
      input.organizationRole,
    );
    const allProjects = await this.projectRepository.findAll({ order: 'id' });
    const projectMap = new Map(allProjects.map((project) => [project.id, project]));

    let projects = (input.projects || []).map((project) => ({
      projectId: Number(project.projectId),
      permission: this.validateProjectPermission(project.permission),
    }));

    if (organizationRole === 'Admin') {
      projects = allProjects.map((project) => ({
        projectId: project.id,
        permission: 'Owner' as ProjectPermissionRole,
      }));
    } else if (!projects.length) {
      throw new ApiError(
        'Select at least one project for organization members',
        400,
      );
    }

    for (const project of projects) {
      if (!projectMap.has(project.projectId)) {
        throw new ApiError(`Project ${project.projectId} not found`, 400);
      }
    }

    const dedupedProjects = Array.from(
      new Map(projects.map((project) => [project.projectId, project])).values(),
    );

    return {
      email,
      organizationRole,
      projects: dedupedProjects,
    };
  }

  private validateOrganizationRole(role: string): OrganizationMemberRole {
    const normalized = `${role || ''}`.trim();
    if (
      !ORGANIZATION_MEMBER_ROLES.includes(
        normalized as OrganizationMemberRole,
      )
    ) {
      throw new ApiError('Invalid organization role', 400);
    }
    return normalized as OrganizationMemberRole;
  }

  private validateProjectPermission(role: string): ProjectPermissionRole {
    const normalized = `${role || ''}`.trim();
    if (
      !PROJECT_PERMISSION_ROLES.includes(normalized as ProjectPermissionRole)
    ) {
      throw new ApiError('Invalid project permission', 400);
    }
    return normalized as ProjectPermissionRole;
  }

  private async getMemberMappingOrThrow(id: number) {
    const organization = await this.getCurrentOrganizationOrThrow();
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organization.id,
      );
    const member = members.find((item) => item.id === id);
    if (!member) {
      throw new ApiError('Member not found', 404);
    }
    return member;
  }

  private async serializeMember(
    member: OrganizationMemberMapping,
  ): Promise<OrganizationMemberSummary> {
    const projects =
      await this.organizationMemberProjectRepository.findByOrganizationMemberId(
        member.id,
      );
    return {
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      organizationRole: member.organizationRole as OrganizationMemberRole,
      projects: projects.map((project) => ({
        projectId: project.projectId,
        displayName: project.project.displayName,
        permission: project.permission as ProjectPermissionRole,
      })),
    };
  }
}
