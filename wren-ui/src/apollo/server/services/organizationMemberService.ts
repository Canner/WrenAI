import { ApiError } from '../utils/apiUtils';
import { v4 as uuidv4 } from 'uuid';
import {
  IOrganizationMemberProjectRepository,
  IOrganizationMemberRepository,
  OrganizationMemberMapping,
} from '../repositories/organizationMemberRepository';
import {
  IOrganizationInvitationProjectRepository,
  IOrganizationInvitationRepository,
  OrganizationInvitation,
} from '../repositories/organizationInvitationRepository';
import { IOrganizationRepository } from '../repositories/organizationRepository';
import { IProjectRepository } from '../repositories/projectRepository';
import { IUserRepository, RbacUser } from '../repositories/rbacRepository';

export const ORGANIZATION_MEMBER_ROLES = ['Admin', 'Member'] as const;
export const PROJECT_PERMISSION_ROLES = ['Owner', 'Editor', 'Viewer'] as const;
export const ORGANIZATION_INVITATION_STATUSES = [
  'Pending',
  'Accepted',
  'Expired',
] as const;

export type OrganizationMemberRole =
  (typeof ORGANIZATION_MEMBER_ROLES)[number];
export type ProjectPermissionRole = (typeof PROJECT_PERMISSION_ROLES)[number];
export type OrganizationInvitationStatus =
  (typeof ORGANIZATION_INVITATION_STATUSES)[number];

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

export interface OrganizationInvitationSummary {
  id: number;
  email: string;
  organizationRole: OrganizationMemberRole;
  status: OrganizationInvitationStatus;
  token: string;
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
  projects: Array<{
    projectId: number;
    displayName: string;
    permission: ProjectPermissionRole;
  }>;
}

export interface IOrganizationMemberService {
  listCurrentOrganizationMembers(): Promise<{
    members: OrganizationMemberSummary[];
    invitations: OrganizationInvitationSummary[];
    projects: Array<{ id: number; displayName: string }>;
    currentUserId: number | null;
  }>;
  inviteMember(
    input: InviteOrganizationMemberInput,
  ): Promise<OrganizationInvitationSummary>;
  updateMember(
    id: number,
    input: UpdateOrganizationMemberInput,
  ): Promise<OrganizationMemberSummary>;
  removeMember(id: number): Promise<boolean>;
  removeInvitation(id: number): Promise<boolean>;
  acceptInvitation(token: string): Promise<OrganizationMemberSummary>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_TTL_DAYS = 3;

export class OrganizationMemberService implements IOrganizationMemberService {
  constructor(
    private readonly organizationRepository: IOrganizationRepository,
    private readonly organizationMemberRepository: IOrganizationMemberRepository,
    private readonly organizationMemberProjectRepository: IOrganizationMemberProjectRepository,
    private readonly organizationInvitationRepository: IOrganizationInvitationRepository,
    private readonly organizationInvitationProjectRepository: IOrganizationInvitationProjectRepository,
    private readonly userRepository: IUserRepository,
    private readonly projectRepository: IProjectRepository,
  ) {}

  public async listCurrentOrganizationMembers() {
    const organization = await this.getCurrentOrganizationOrThrow();
    const [members, listedProjects] = await Promise.all([
      this.organizationMemberRepository.findMappingsByOrganizationId(
        organization.id,
      ),
      this.projectRepository.findAll({ order: 'id' }),
    ]);
    const projects =
      listedProjects.length > 0
        ? listedProjects
        : await this.getFallbackProjects();
    const invitations = await this.organizationInvitationRepository.findByOrganizationId(
      organization.id,
    );
    const normalizedInvitations = await Promise.all(
      invitations.map((invite) => this.normalizeInvitation(invite)),
    );

    const hydratedMembers = await Promise.all(
      members.map((member) => this.serializeMember(member)),
    );
    const currentUserId =
      hydratedMembers.find((member) => member.organizationRole === 'Admin')
        ?.userId ??
      hydratedMembers[0]?.userId ??
      null;

    return {
      members: hydratedMembers,
      invitations: await Promise.all(
        normalizedInvitations
          .filter((invite) => invite.status !== 'Accepted')
          .map((invite) => this.serializeInvitation(invite)),
      ),
      projects: projects.map((project) => ({
        id: project.id,
        displayName: project.displayName,
      })),
      currentUserId,
    };
  }

  public async inviteMember(input: InviteOrganizationMemberInput) {
    const organization = await this.getCurrentOrganizationOrThrow();
    const payload = await this.validateInvitePayload(input);
    const existingMembership =
      await this.findExistingMemberByEmail(organization.id, payload.email);
    if (existingMembership) {
      throw new ApiError('Member already exists in this organization', 409);
    }
    const existingInvitation =
      await this.findActiveInvitationByEmail(organization.id, payload.email);
    if (existingInvitation) {
      throw new ApiError(
        'A pending invitation already exists for this email',
        409,
      );
    }

    const currentUserId = await this.getCurrentUserId(organization.id);

    const tx = await this.organizationMemberRepository.transaction();
    try {
      const now = new Date().toISOString();
      const invitation = await this.organizationInvitationRepository.createOne(
        {
          organizationId: organization.id,
          invitedByUserId: currentUserId,
          email: payload.email,
          organizationRole: payload.organizationRole,
          token: uuidv4(),
          status: 'Pending',
          expiresAt: this.buildInvitationExpiry(now),
          acceptedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );

      if (payload.projects.length) {
        await this.organizationInvitationProjectRepository.createMany(
          payload.projects.map((project) => ({
            organizationInvitationId: invitation.id,
            projectId: project.projectId,
            permission: project.permission,
            createdAt: now,
            updatedAt: now,
          })),
          { tx },
        );
      }

      await tx.commit();
      const createdInvitation =
        await this.organizationInvitationRepository.findOneBy({
          id: invitation.id,
        });
      return this.serializeInvitation(createdInvitation);
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
    await this.assertNotCurrentUser(member.userId, organization.id);

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
    await this.assertNotCurrentUser(member.userId, organization.id);

    await this.organizationMemberRepository.deleteOne(member.id);
    return true;
  }

  public async removeInvitation(id: number): Promise<boolean> {
    const invitation = await this.organizationInvitationRepository.findOneBy({
      id,
    });
    if (!invitation) return true;

    const organization = await this.getCurrentOrganizationOrThrow();
    if (invitation.organizationId !== organization.id) {
      throw new ApiError('Invitation not found', 404);
    }

    await this.organizationInvitationRepository.deleteOne(invitation.id);
    return true;
  }

  public async acceptInvitation(
    token: string,
  ): Promise<OrganizationMemberSummary> {
    const invitation = await this.organizationInvitationRepository.findOneBy({
      token,
    });
    if (!invitation) {
      throw new ApiError('Invitation not found', 404);
    }

    const normalizedInvitation = await this.normalizeInvitation(invitation);
    if (normalizedInvitation.status === 'Expired') {
      throw new ApiError('Invitation has expired', 410);
    }

    const existingMembership =
      await this.findExistingMemberByEmail(
        normalizedInvitation.organizationId,
        normalizedInvitation.email,
      );
    if (existingMembership) {
      await this.organizationInvitationRepository.updateOne(
        normalizedInvitation.id,
        {
          status: 'Accepted',
          acceptedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      );
      return existingMembership;
    }

    const tx = await this.organizationInvitationRepository.transaction();
    try {
      const now = new Date().toISOString();
      const existingUser = await this.userRepository.findOneBy(
        { email: normalizedInvitation.email },
        { tx },
      );
      const user = existingUser
        ? existingUser
        : await this.createUserFromInvite(normalizedInvitation.email, tx);
      const member = await this.organizationMemberRepository.createOne(
        {
          organizationId: normalizedInvitation.organizationId,
          userId: user.id,
          organizationRole: normalizedInvitation.organizationRole,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );
      const invitationProjects =
        await this.organizationInvitationProjectRepository.findByOrganizationInvitationId(
          normalizedInvitation.id,
          { tx },
        );
      if (invitationProjects.length) {
        await this.organizationMemberProjectRepository.createMany(
          invitationProjects.map((project) => ({
            organizationMemberId: member.id,
            projectId: project.projectId,
            permission: project.permission,
            createdAt: now,
            updatedAt: now,
          })),
          { tx },
        );
      }
      await this.organizationInvitationRepository.updateOne(
        normalizedInvitation.id,
        {
          status: 'Accepted',
          acceptedAt: now,
          updatedAt: now,
        },
        { tx },
      );
      await tx.commit();
      const mapping = await this.getMemberMappingOrThrow(member.id);
      return this.serializeMember(mapping);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  private async getCurrentOrganizationOrThrow() {
    const organization =
      await this.organizationRepository.getCurrentOrganization();
    if (!organization) {
      throw new ApiError('Current organization not found', 404);
    }
    return organization;
  }

  private async createUserFromInvite(
    email: string,
    tx?: any,
  ): Promise<RbacUser> {
    const now = new Date().toISOString();
    const localPart = email.split('@')[0] || 'user';
    return this.userRepository.createOne(
      {
        name: localPart,
        email,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      tx ? { tx } : undefined,
    );
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

  private async serializeInvitation(
    invitation: OrganizationInvitation | null,
  ): Promise<OrganizationInvitationSummary> {
    if (!invitation) {
      throw new ApiError('Invitation not found', 404);
    }
    const projects =
      await this.organizationInvitationProjectRepository.findByOrganizationInvitationId(
        invitation.id,
      );
    return {
      id: invitation.id,
      email: invitation.email,
      organizationRole: invitation.organizationRole as OrganizationMemberRole,
      status: invitation.status as OrganizationInvitationStatus,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      createdAt: invitation.createdAt,
      projects: projects.map((project) => ({
        projectId: project.projectId,
        displayName: project.project.displayName,
        permission: project.permission as ProjectPermissionRole,
      })),
    };
  }

  private buildInvitationExpiry(createdAt: string) {
    const expiresAt = new Date(createdAt);
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);
    return expiresAt.toISOString();
  }

  private async normalizeInvitation(invitation: OrganizationInvitation) {
    if (
      invitation.status === 'Pending' &&
      new Date(invitation.expiresAt).getTime() < Date.now()
    ) {
      return await this.organizationInvitationRepository.updateOne(
        invitation.id,
        {
          status: 'Expired',
          updatedAt: new Date().toISOString(),
        },
      );
    }
    return invitation;
  }

  private async findExistingMemberByEmail(
    organizationId: number,
    email: string,
  ): Promise<OrganizationMemberSummary | null> {
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organizationId,
      );
    const member = members.find(
      (item) => item.user.email.toLowerCase() === email.toLowerCase(),
    );
    return member ? this.serializeMember(member) : null;
  }

  private async findActiveInvitationByEmail(
    organizationId: number,
    email: string,
  ) {
    const invitations =
      await this.organizationInvitationRepository.findByOrganizationId(
        organizationId,
      );
    for (const invitation of invitations) {
      const normalized = await this.normalizeInvitation(invitation);
      if (
        normalized.email.toLowerCase() === email.toLowerCase() &&
        normalized.status === 'Pending'
      ) {
        return normalized;
      }
    }
    return null;
  }

  private async getCurrentUserId(
    organizationId: number,
  ): Promise<number | null> {
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organizationId,
      );
    return (
      members.find((member) => member.organizationRole === 'Admin')?.userId ??
      members[0]?.userId ??
      null
    );
  }

  private async assertNotCurrentUser(userId: number, organizationId: number) {
    const currentUserId = await this.getCurrentUserId(organizationId);
    if (currentUserId && currentUserId === userId) {
      throw new ApiError('You cannot modify your own organization role', 400);
    }
  }

  private async getFallbackProjects() {
    try {
      const currentProject = await this.projectRepository.getCurrentProject();
      return currentProject ? [currentProject] : [];
    } catch {
      return [];
    }
  }
}
