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

export interface UpdateCurrentUserProfileInput {
  name: string;
}

export interface CurrentUserProfile {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
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

export interface ProjectAccessMemberSummary {
  id: number;
  userId: number;
  name: string;
  email: string;
  organizationRole: OrganizationMemberRole;
  permission: 'Owner' | 'Contributor' | 'Viewer';
  isCurrentUser: boolean;
  canEditPermission: boolean;
  canRemove: boolean;
}

export interface ProjectAccessAvailableMember {
  id: number;
  userId: number;
  name: string;
  email: string;
  organizationRole: OrganizationMemberRole;
}

export interface AddProjectMemberInput {
  organizationMemberId: number;
  permission: 'Owner' | 'Contributor' | 'Viewer';
}

export interface UpdateProjectMemberPermissionInput {
  permission: 'Owner' | 'Contributor' | 'Viewer';
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
  leaveCurrentOrganization(): Promise<boolean>;
  deleteCurrentOrganization(): Promise<boolean>;
  getCurrentUserProfile(): Promise<CurrentUserProfile>;
  updateCurrentUserProfile(
    input: UpdateCurrentUserProfileInput,
  ): Promise<CurrentUserProfile>;
  deleteCurrentUserAccount(): Promise<boolean>;
  listCurrentProjectAccess(): Promise<{
    members: ProjectAccessMemberSummary[];
    availableMembers: ProjectAccessAvailableMember[];
    currentUserId: number | null;
    canManageAccess: boolean;
  }>;
  addProjectMember(
    input: AddProjectMemberInput,
  ): Promise<ProjectAccessMemberSummary>;
  updateProjectMemberPermission(
    id: number,
    input: UpdateProjectMemberPermissionInput,
  ): Promise<ProjectAccessMemberSummary>;
  removeProjectMember(id: number): Promise<boolean>;
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

  public async leaveCurrentOrganization(): Promise<boolean> {
    const organization = await this.getCurrentOrganizationOrThrow();
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organization.id,
      );
    const currentUserId = await this.getCurrentUserId(organization.id);
    const currentMember = members.find(
      (member) => member.userId === currentUserId,
    );

    if (!currentMember) {
      throw new ApiError('Current organization member not found', 404);
    }

    if (currentMember.organizationRole === 'Admin') {
      const adminCount = members.filter(
        (member) => member.organizationRole === 'Admin',
      ).length;
      if (adminCount <= 1) {
        throw new ApiError(
          'If you are the last Organization admin, you cannot leave the organization. You will need to delete the organization to remove yourself from it.',
          400,
        );
      }
    }

    await this.organizationMemberRepository.deleteOne(currentMember.id);
    return true;
  }

  public async deleteCurrentOrganization(): Promise<boolean> {
    const organization = await this.getCurrentOrganizationOrThrow();
    await this.assertCurrentUserAdmin(organization.id);

    const tx = await this.organizationRepository.transaction();
    try {
      await this.organizationRepository.deleteOne(organization.id, { tx });
      const remainingOrganizations = await this.organizationRepository.findAll({
        order: 'id',
        tx,
      });
      if (remainingOrganizations.length > 0) {
        await this.organizationRepository.setCurrentOrganization(
          remainingOrganizations[0].id,
          { tx },
        );
      }
      await tx.commit();
      return true;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async getCurrentUserProfile(): Promise<CurrentUserProfile> {
    const organization = await this.getCurrentOrganizationOrThrow();
    const currentUserId = await this.getCurrentUserId(organization.id);
    if (!currentUserId) {
      throw new ApiError('Current user not found', 404);
    }
    const user = await this.userRepository.findOneBy({ id: currentUserId });
    if (!user) {
      throw new ApiError('Current user not found', 404);
    }
    return this.serializeCurrentUserProfile(user);
  }

  public async updateCurrentUserProfile(
    input: UpdateCurrentUserProfileInput,
  ): Promise<CurrentUserProfile> {
    const organization = await this.getCurrentOrganizationOrThrow();
    const currentUserId = await this.getCurrentUserId(organization.id);
    if (!currentUserId) {
      throw new ApiError('Current user not found', 404);
    }

    const name = `${input.name || ''}`.trim();
    if (!name) {
      throw new ApiError('Name is required', 400);
    }
    if (name.length > 160) {
      throw new ApiError('Name must be 160 characters or fewer', 400);
    }

    const user = await this.userRepository.updateOne(currentUserId, {
      name,
      updatedAt: new Date().toISOString(),
    });
    return this.serializeCurrentUserProfile(user);
  }

  public async deleteCurrentUserAccount(): Promise<boolean> {
    const organization = await this.getCurrentOrganizationOrThrow();
    const currentUserId = await this.getCurrentUserId(organization.id);
    if (!currentUserId) {
      throw new ApiError('Current user not found', 404);
    }

    await this.assertCurrentUserCanDeleteAccount(currentUserId);
    await this.userRepository.deleteOne(currentUserId);
    return true;
  }

  public async listCurrentProjectAccess() {
    const organization = await this.getCurrentOrganizationOrThrow();
    const project = await this.projectRepository.getCurrentProject();
    const currentUserId = await this.getCurrentUserId(organization.id);
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organization.id,
      );

    const serializedMembers = await Promise.all(
      members.map(async (member) => {
        const projects =
          await this.organizationMemberProjectRepository.findByOrganizationMemberId(
            member.id,
          );
        const assignment = projects.find(
          (mappedProject) => mappedProject.projectId === project.id,
        );
        const isOrganizationAdmin = member.organizationRole === 'Admin';
        const isCurrentUser = member.userId === currentUserId;
        const permission = isOrganizationAdmin
          ? 'Owner'
          : assignment
            ? this.presentProjectPermission(assignment.permission)
            : null;

        return permission
          ? {
              id: member.id,
              userId: member.userId,
              name: member.user.name,
              email: member.user.email,
              organizationRole:
                member.organizationRole as OrganizationMemberRole,
              permission,
              isCurrentUser,
              canEditPermission: !isOrganizationAdmin && !isCurrentUser,
              canRemove: !isOrganizationAdmin && !isCurrentUser,
            }
          : null;
      }),
    );

    const availableMembers = members
      .filter(
        (member) =>
          member.organizationRole !== 'Admin' &&
          !serializedMembers.some(
            (serializedMember) => serializedMember?.id === member.id,
          ),
      )
      .map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
        organizationRole: member.organizationRole as OrganizationMemberRole,
      }));

    const currentUserMember = serializedMembers.find(
      (member) => member?.userId === currentUserId,
    );
    return {
      members: serializedMembers.filter(Boolean),
      availableMembers,
      currentUserId,
      canManageAccess:
        currentUserMember?.permission === 'Owner' ||
        currentUserMember?.organizationRole === 'Admin',
    };
  }

  public async addProjectMember(input: AddProjectMemberInput) {
    const organization = await this.getCurrentOrganizationOrThrow();
    const project = await this.projectRepository.getCurrentProject();
    await this.assertCanManageCurrentProject(organization.id, project.id);

    const member = await this.organizationMemberRepository.findOneBy({
      id: input.organizationMemberId,
    });
    if (!member || member.organizationId !== organization.id) {
      throw new ApiError('Member not found', 404);
    }
    if (member.organizationRole === 'Admin') {
      throw new ApiError(
        'Organization admins are owners of all projects by default',
        400,
      );
    }

    const existingAssignment = await this.findProjectAssignment(member.id, project.id);
    if (existingAssignment) {
      throw new ApiError('Member already has access to this project', 409);
    }

    const now = new Date().toISOString();
    await this.organizationMemberProjectRepository.createOne({
      organizationMemberId: member.id,
      projectId: project.id,
      permission: this.storeProjectPermission(input.permission),
      createdAt: now,
      updatedAt: now,
    });

    return this.serializeProjectAccessMember(member.id, project.id, organization.id);
  }

  public async updateProjectMemberPermission(
    id: number,
    input: UpdateProjectMemberPermissionInput,
  ) {
    const organization = await this.getCurrentOrganizationOrThrow();
    const project = await this.projectRepository.getCurrentProject();
    const currentUserId = await this.getCurrentUserId(organization.id);
    await this.assertCanManageCurrentProject(organization.id, project.id);

    const member = await this.organizationMemberRepository.findOneBy({ id });
    if (!member || member.organizationId !== organization.id) {
      throw new ApiError('Member not found', 404);
    }
    if (member.userId === currentUserId) {
      throw new ApiError('You cannot modify your own role', 400);
    }
    if (member.organizationRole === 'Admin') {
      throw new ApiError(
        'You cannot change the role of the organization admin',
        400,
      );
    }

    const assignment = await this.findProjectAssignment(member.id, project.id);
    if (!assignment) {
      throw new ApiError('Project member not found', 404);
    }

    await this.organizationMemberProjectRepository.updateOne(assignment.id, {
      permission: this.storeProjectPermission(input.permission),
      updatedAt: new Date().toISOString(),
    });

    return this.serializeProjectAccessMember(member.id, project.id, organization.id);
  }

  public async removeProjectMember(id: number) {
    const organization = await this.getCurrentOrganizationOrThrow();
    const project = await this.projectRepository.getCurrentProject();
    const currentUserId = await this.getCurrentUserId(organization.id);
    await this.assertCanManageCurrentProject(organization.id, project.id);

    const member = await this.organizationMemberRepository.findOneBy({ id });
    if (!member || member.organizationId !== organization.id) {
      throw new ApiError('Member not found', 404);
    }
    if (member.userId === currentUserId) {
      throw new ApiError('You cannot remove yourself from the project', 400);
    }
    if (member.organizationRole === 'Admin') {
      throw new ApiError(
        'You cannot remove the organization admin from the project',
        400,
      );
    }

    const assignment = await this.findProjectAssignment(member.id, project.id);
    if (!assignment) {
      throw new ApiError('Project member not found', 404);
    }
    await this.organizationMemberProjectRepository.deleteOne(assignment.id);
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

  private serializeCurrentUserProfile(user: RbacUser): CurrentUserProfile {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: Boolean(user.isActive),
    };
  }

  private async assertCurrentUserAdmin(organizationId: number) {
    const currentUserId = await this.getCurrentUserId(organizationId);
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organizationId,
      );
    const currentMember = members.find(
      (member) => member.userId === currentUserId,
    );
    if (!currentMember || currentMember.organizationRole !== 'Admin') {
      throw new ApiError(
        'Only Organization admins can delete the organization',
        403,
      );
    }
  }

  private async assertCurrentUserCanDeleteAccount(userId: number) {
    const organizations = await this.organizationRepository.findAll({
      order: 'id',
    });

    for (const organization of organizations) {
      const members =
        await this.organizationMemberRepository.findMappingsByOrganizationId(
          organization.id,
        );
      const currentMember = members.find((member) => member.userId === userId);
      if (!currentMember || currentMember.organizationRole !== 'Admin') {
        continue;
      }

      const adminCount = members.filter(
        (member) => member.organizationRole === 'Admin',
      ).length;
      if (adminCount <= 1) {
        throw new ApiError(
          'If you are the last Organization admin, you cannot delete your account. Assign another Organization admin or delete the organization first.',
          400,
        );
      }
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

  private async serializeProjectAccessMember(
    organizationMemberId: number,
    projectId: number,
    organizationId: number,
  ): Promise<ProjectAccessMemberSummary> {
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organizationId,
      );
    const member = members.find((item) => item.id === organizationMemberId);
    if (!member) {
      throw new ApiError('Member not found', 404);
    }
    const currentUserId = await this.getCurrentUserId(organizationId);
    const assignment =
      await this.organizationMemberProjectRepository.findByOrganizationMemberId(
        organizationMemberId,
      );
    const projectAssignment = assignment.find(
      (item) => item.projectId === projectId,
    );
    const isOrganizationAdmin = member.organizationRole === 'Admin';
    const permission = isOrganizationAdmin
      ? 'Owner'
      : projectAssignment
        ? this.presentProjectPermission(projectAssignment.permission)
        : null;

    if (!permission) {
      throw new ApiError('Project member not found', 404);
    }

    return {
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      organizationRole: member.organizationRole as OrganizationMemberRole,
      permission,
      isCurrentUser: member.userId === currentUserId,
      canEditPermission: !isOrganizationAdmin && member.userId !== currentUserId,
      canRemove: !isOrganizationAdmin && member.userId !== currentUserId,
    };
  }

  private async assertCanManageCurrentProject(
    organizationId: number,
    projectId: number,
  ) {
    const currentUserId = await this.getCurrentUserId(organizationId);
    const members =
      await this.organizationMemberRepository.findMappingsByOrganizationId(
        organizationId,
      );
    const currentMember = members.find(
      (member) => member.userId === currentUserId,
    );
    if (!currentMember) {
      throw new ApiError('Current user not found', 404);
    }
    if (currentMember.organizationRole === 'Admin') {
      return;
    }

    const assignments =
      await this.organizationMemberProjectRepository.findByOrganizationMemberId(
        currentMember.id,
      );
    const currentProjectAssignment = assignments.find(
      (assignment) => assignment.projectId === projectId,
    );
    const currentPermission = currentProjectAssignment
      ? this.presentProjectPermission(currentProjectAssignment.permission)
      : null;

    if (currentPermission !== 'Owner') {
      throw new ApiError(
        'Only project owners can manage project access',
        403,
      );
    }
  }

  private async findProjectAssignment(
    organizationMemberId: number,
    projectId: number,
  ) {
    const assignments =
      await this.organizationMemberProjectRepository.findByOrganizationMemberId(
        organizationMemberId,
      );
    return assignments.find((assignment) => assignment.projectId === projectId);
  }

  private presentProjectPermission(permission: string):
    | 'Owner'
    | 'Contributor'
    | 'Viewer' {
    if (permission === 'Editor') {
      return 'Contributor';
    }
    if (permission === 'Owner' || permission === 'Viewer') {
      return permission;
    }
    return 'Contributor';
  }

  private storeProjectPermission(permission: string): ProjectPermissionRole {
    if (permission === 'Contributor') {
      return 'Editor';
    }
    return this.validateProjectPermission(permission);
  }
}
