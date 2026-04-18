import crypto from 'crypto';
import {
  IPrincipalRoleBindingRepository,
  IRoleRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  IUserRepository,
  Workspace,
  WorkspaceMember,
} from '../repositories';
import {
  canManageWorkspaceJoinFlow,
  WORKSPACE_KINDS,
} from '@/utils/workspaceGovernance';
import {
  AuthorizationActor,
  AuthorizationAction,
  PLATFORM_SCOPE_ID,
  authorize,
  isAuthorizationBindingOnlyEnabled,
  isPlatformAdminRoleName,
  removeWorkspacePrincipalRoleBindings,
  syncWorkspaceMemberRoleBinding,
} from '@server/authz';
import type { ValidateSessionResult } from './authService';

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
  settings?: Record<string, any>;
  createdBy?: string;
  initialOwnerUserId?: string;
  actor?: AuthorizationActor | null;
}

export interface AddWorkspaceMemberInput {
  workspaceId: string;
  userId: string;
  roleKey?: string;
  status?: string;
}

export interface InviteWorkspaceMemberInput {
  workspaceId: string;
  email: string;
  roleKey?: string;
  status?: string;
  actor?: AuthorizationActor | null;
}

export interface UpdateWorkspaceMemberInput {
  workspaceId: string;
  memberId: string;
  roleKey?: string;
  status?: string;
  actor?: AuthorizationActor | null;
}

export interface UpdateWorkspaceSettingsInput {
  workspaceId: string;
  settings: Record<string, any>;
}

export interface UpdateDefaultWorkspaceInput {
  validatedSession: ValidateSessionResult;
  defaultWorkspaceId: string;
}

export interface IWorkspaceService {
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspaceById(workspaceId: string): Promise<Workspace | null>;
  listWorkspacesForUser(userId: string): Promise<Workspace[]>;
  addMember(input: AddWorkspaceMemberInput): Promise<WorkspaceMember>;
  inviteMemberByEmail(
    input: InviteWorkspaceMemberInput,
  ): Promise<WorkspaceMember>;
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null>;
  updateMember(input: UpdateWorkspaceMemberInput): Promise<WorkspaceMember>;
  removeMember(input: { workspaceId: string; memberId: string }): Promise<void>;
  updateWorkspaceSettings(
    input: UpdateWorkspaceSettingsInput,
  ): Promise<Workspace>;
  applyToWorkspace(input: {
    workspaceId: string;
    userId: string;
  }): Promise<WorkspaceMember>;
  acceptInvitation(input: {
    workspaceId: string;
    userId: string;
  }): Promise<WorkspaceMember>;
  updateDefaultWorkspace(input: UpdateDefaultWorkspaceInput): Promise<void>;
}

export class WorkspaceService implements IWorkspaceService {
  private workspaceRepository: IWorkspaceRepository;
  private workspaceMemberRepository: IWorkspaceMemberRepository;
  private userRepository: IUserRepository;
  private roleRepository?: IRoleRepository;
  private principalRoleBindingRepository?: IPrincipalRoleBindingRepository;

  constructor({
    workspaceRepository,
    workspaceMemberRepository,
    userRepository,
    roleRepository,
    principalRoleBindingRepository,
  }: {
    workspaceRepository: IWorkspaceRepository;
    workspaceMemberRepository: IWorkspaceMemberRepository;
    userRepository: IUserRepository;
    roleRepository?: IRoleRepository;
    principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
  }) {
    this.workspaceRepository = workspaceRepository;
    this.workspaceMemberRepository = workspaceMemberRepository;
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.principalRoleBindingRepository = principalRoleBindingRepository;
  }

  private assertActorAllowed({
    actor,
    action,
    workspaceId,
    resourceType,
    resourceId,
    ownerUserId,
    attributes,
  }: {
    actor?: AuthorizationActor | null;
    action: AuthorizationAction;
    workspaceId: string;
    resourceType: string;
    resourceId?: string | null;
    ownerUserId?: string | null;
    attributes?: Record<string, any>;
  }) {
    if (!actor) {
      throw new Error('Service authorization actor is required');
    }
    const decision = authorize({
      actor,
      action,
      resource: {
        resourceType,
        resourceId: resourceId || workspaceId,
        workspaceId,
        ownerUserId: ownerUserId || null,
        attributes,
      },
    });
    if (!decision.allowed) {
      const error = new Error(
        decision.reason || 'Permission denied',
      ) as Error & {
        statusCode?: number;
      };
      error.statusCode = decision.statusCode;
      throw error;
    }
  }

  private async hasPlatformAdminAccess(userId: string) {
    if (this.principalRoleBindingRepository) {
      const bindings =
        (await this.principalRoleBindingRepository.findResolvedRoleBindings({
          principalType: 'user',
          principalId: userId,
          scopeType: 'platform',
          scopeId: PLATFORM_SCOPE_ID,
        })) || [];
      if (
        bindings.some((binding) => isPlatformAdminRoleName(binding.roleName))
      ) {
        return true;
      }
      if (isAuthorizationBindingOnlyEnabled()) {
        return false;
      }
    }

    const user = await this.userRepository.findOneBy({ id: userId });
    return Boolean(user?.isPlatformAdmin);
  }

  public async createWorkspace(
    input: CreateWorkspaceInput,
  ): Promise<Workspace> {
    if (input.actor) {
      this.assertActorAllowed({
        actor: input.actor,
        action: 'workspace.create',
        workspaceId: input.actor.workspaceId || 'platform',
        resourceType: 'workspace',
        resourceId: 'new',
      });
    }
    if (input.initialOwnerUserId) {
      const owner = await this.userRepository.findOneBy({
        id: input.initialOwnerUserId,
      });
      if (!owner) {
        throw new Error(`User ${input.initialOwnerUserId} not found`);
      }
    }

    const tx = await this.workspaceRepository.transaction();
    try {
      const workspace = await this.workspaceRepository.createOne(
        {
          id: crypto.randomUUID(),
          name: input.name,
          slug: await this.ensureUniqueSlug(input.slug || input.name),
          kind: WORKSPACE_KINDS.REGULAR,
          settings: input.settings || null,
          createdBy: input.createdBy || input.initialOwnerUserId,
          status: 'active',
        },
        { tx },
      );

      if (input.initialOwnerUserId) {
        const membership = await this.workspaceMemberRepository.createOne(
          {
            id: crypto.randomUUID(),
            workspaceId: workspace.id,
            userId: input.initialOwnerUserId,
            roleKey: 'owner',
            status: 'active',
          },
          { tx },
        );

        await this.syncWorkspaceMemberBinding(membership, tx);
      }

      await this.workspaceRepository.commit(tx);
      return workspace;
    } catch (error) {
      await this.workspaceRepository.rollback(tx);
      throw error;
    }
  }

  public async getWorkspaceById(
    workspaceId: string,
  ): Promise<Workspace | null> {
    return await this.workspaceRepository.findOneBy({ id: workspaceId });
  }

  public async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    if (await this.hasPlatformAdminAccess(userId)) {
      return await this.workspaceRepository.findAllBy({
        status: 'active',
      });
    }

    const memberships = await this.workspaceMemberRepository.findAllBy({
      userId,
      status: 'active',
    });

    const workspaces = await Promise.all(
      memberships.map((membership) =>
        this.workspaceRepository.findOneBy({ id: membership.workspaceId }),
      ),
    );

    return workspaces.filter(Boolean) as Workspace[];
  }

  public async addMember(
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    const user = await this.userRepository.findOneBy({ id: input.userId });
    if (!user) {
      throw new Error(`User ${input.userId} not found`);
    }

    const workspace = await this.workspaceRepository.findOneBy({
      id: input.workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${input.workspaceId} not found`);
    }

    const tx = await this.workspaceRepository.transaction();
    try {
      const existingMembership = await this.workspaceMemberRepository.findOneBy(
        {
          workspaceId: input.workspaceId,
          userId: input.userId,
        },
        { tx },
      );
      if (existingMembership) {
        const patch: Partial<WorkspaceMember> = {};
        if (input.roleKey && input.roleKey !== existingMembership.roleKey) {
          patch.roleKey = input.roleKey;
        }
        if (input.status && input.status !== existingMembership.status) {
          patch.status = input.status;
        }

        if (Object.keys(patch).length === 0) {
          await this.syncWorkspaceMemberBinding(existingMembership, tx);
          await this.workspaceRepository.commit(tx);
          return existingMembership;
        }

        this.assertOwnerMembershipMutationAllowed(existingMembership, patch);

        const updatedMembership =
          await this.workspaceMemberRepository.updateOne(
            existingMembership.id,
            patch,
            { tx },
          );
        await this.syncWorkspaceMemberBinding(updatedMembership, tx);
        await this.workspaceRepository.commit(tx);
        return updatedMembership;
      }

      const createdMembership = await this.workspaceMemberRepository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          userId: input.userId,
          roleKey: input.roleKey || 'member',
          status: input.status || 'active',
        },
        { tx },
      );
      await this.syncWorkspaceMemberBinding(createdMembership, tx);
      await this.workspaceRepository.commit(tx);
      return createdMembership;
    } catch (error) {
      await this.workspaceRepository.rollback(tx);
      throw error;
    }
  }

  public async inviteMemberByEmail(
    input: InviteWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    const workspace = await this.requireRegularWorkspace(input.workspaceId);
    if (input.actor) {
      this.assertActorAllowed({
        actor: input.actor,
        action: 'workspace.member.invite',
        workspaceId: workspace.id,
        resourceType: 'workspace',
        attributes: {
          workspaceKind: workspace.kind || null,
          nextRoleKey: input.roleKey || 'member',
        },
      });
    }
    const normalizedEmail = input.email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error('Email is required');
    }

    const user = await this.userRepository.findOneBy({
      email: normalizedEmail,
    });
    if (!user) {
      throw new Error(`User ${normalizedEmail} not found`);
    }

    const existingMembership = await this.workspaceMemberRepository.findOneBy({
      workspaceId: input.workspaceId,
      userId: user.id,
    });
    if (existingMembership) {
      return await this.updateMemberByRecord({
        membership: existingMembership,
        patch: {
          roleKey: input.roleKey || existingMembership.roleKey || 'member',
          status: input.status || existingMembership.status || 'invited',
        },
      });
    }

    return await this.addMember({
      workspaceId: workspace.id,
      userId: user.id,
      roleKey: input.roleKey || 'member',
      status: input.status || 'invited',
    });
  }

  public async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return await this.workspaceMemberRepository.findAllBy({ workspaceId });
  }

  public async getMembership(workspaceId: string, userId: string) {
    return await this.workspaceMemberRepository.findOneBy({
      workspaceId,
      userId,
    });
  }

  public async updateMember(
    input: UpdateWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    const existingMembership = await this.workspaceMemberRepository.findOneBy({
      id: input.memberId,
    } as Partial<WorkspaceMember>);

    if (!existingMembership) {
      throw new Error(`Workspace member ${input.memberId} not found`);
    }
    if (existingMembership.workspaceId !== input.workspaceId) {
      throw new Error(`Workspace member ${input.memberId} not found`);
    }

    const patch: Partial<WorkspaceMember> = {};
    if (input.roleKey) {
      patch.roleKey = input.roleKey;
    }
    if (input.status) {
      patch.status = input.status;
    }

    if (Object.keys(patch).length === 0) {
      return existingMembership;
    }

    if (input.actor) {
      this.assertActorAllowed({
        actor: input.actor,
        action: input.roleKey
          ? 'workspace.member.role.update'
          : 'workspace.member.status.update',
        workspaceId: input.workspaceId,
        resourceType: 'workspace_member',
        resourceId: input.memberId,
        attributes: {
          targetRoleKey: existingMembership.roleKey,
          nextRoleKey: input.roleKey || existingMembership.roleKey,
          targetUserId: existingMembership.userId,
        },
      });
    }

    return await this.updateMemberByRecord({
      membership: existingMembership,
      patch,
    });
  }

  public async removeMember(input: {
    workspaceId: string;
    memberId: string;
    actor?: AuthorizationActor | null;
  }): Promise<void> {
    const existingMembership = await this.workspaceMemberRepository.findOneBy({
      id: input.memberId,
    } as Partial<WorkspaceMember>);

    if (!existingMembership) {
      throw new Error(`Workspace member ${input.memberId} not found`);
    }
    if (existingMembership.workspaceId !== input.workspaceId) {
      throw new Error(`Workspace member ${input.memberId} not found`);
    }

    if (input.actor) {
      this.assertActorAllowed({
        actor: input.actor,
        action: 'workspace.member.remove',
        workspaceId: input.workspaceId,
        resourceType: 'workspace_member',
        resourceId: input.memberId,
        attributes: {
          targetRoleKey: existingMembership.roleKey,
          targetUserId: existingMembership.userId,
        },
      });
    }

    this.assertOwnerMembershipMutationAllowed(existingMembership, {
      status: 'inactive',
    });

    const tx = await this.workspaceRepository.transaction();
    try {
      await this.workspaceMemberRepository.deleteOne(existingMembership.id, {
        tx,
      });
      await this.removeWorkspaceMemberBinding(existingMembership, tx);
      await this.workspaceRepository.commit(tx);
    } catch (error) {
      await this.workspaceRepository.rollback(tx);
      throw error;
    }
  }

  public async updateWorkspaceSettings(
    input: UpdateWorkspaceSettingsInput,
  ): Promise<Workspace> {
    const workspace = await this.workspaceRepository.findOneBy({
      id: input.workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${input.workspaceId} not found`);
    }

    return await this.workspaceRepository.updateOne(workspace.id, {
      settings: {
        ...(workspace.settings || {}),
        ...(input.settings || {}),
      },
    });
  }

  public async applyToWorkspace(input: {
    workspaceId: string;
    userId: string;
  }): Promise<WorkspaceMember> {
    await this.requireRegularWorkspace(input.workspaceId);
    const existingMembership = await this.workspaceMemberRepository.findOneBy({
      workspaceId: input.workspaceId,
      userId: input.userId,
    });

    if (existingMembership?.status === 'active') {
      return existingMembership;
    }

    if (existingMembership?.status === 'invited') {
      return existingMembership;
    }

    return await this.addMember({
      workspaceId: input.workspaceId,
      userId: input.userId,
      roleKey: existingMembership?.roleKey || 'member',
      status: 'pending',
    });
  }

  public async acceptInvitation(input: {
    workspaceId: string;
    userId: string;
  }): Promise<WorkspaceMember> {
    await this.requireRegularWorkspace(input.workspaceId);
    const membership = await this.workspaceMemberRepository.findOneBy({
      workspaceId: input.workspaceId,
      userId: input.userId,
    });

    if (!membership || membership.status !== 'invited') {
      throw new Error('Invited workspace membership is required');
    }

    return await this.updateMemberByRecord({
      membership,
      patch: {
        status: 'active',
      },
    });
  }

  public async updateDefaultWorkspace(
    input: UpdateDefaultWorkspaceInput,
  ): Promise<void> {
    const actor = {
      principalType: 'user',
      principalId: input.validatedSession.user.id,
      workspaceId: input.validatedSession.workspace.id,
      workspaceMemberId: input.validatedSession.membership.id,
      workspaceRoleKeys: input.validatedSession.actorClaims.roleKeys || [],
      permissionScopes:
        input.validatedSession.actorClaims.permissionScopes || [],
      isPlatformAdmin: Boolean(
        input.validatedSession.actorClaims.isPlatformAdmin,
      ),
      platformRoleKeys:
        input.validatedSession.actorClaims.platformRoleKeys || [],
      grantedActions: input.validatedSession.actorClaims.grantedActions || [],
      workspaceRoleSource:
        input.validatedSession.actorClaims.workspaceRoleSource,
      platformRoleSource: input.validatedSession.actorClaims.platformRoleSource,
      sessionId: input.validatedSession.session.id,
    } as AuthorizationActor;
    this.assertActorAllowed({
      actor,
      action: 'workspace.default.set',
      workspaceId:
        input.validatedSession.workspace.id || input.defaultWorkspaceId,
      resourceType: 'workspace',
      resourceId: input.defaultWorkspaceId,
      ownerUserId: input.validatedSession.user.id,
    });
    const userId = input.validatedSession.user.id;
    const membership = await this.workspaceMemberRepository.findOneBy({
      workspaceId: input.defaultWorkspaceId,
      userId,
      status: 'active',
    });
    if (!membership) {
      throw new Error('Active workspace membership is required');
    }

    await this.userRepository.updateOne(userId, {
      defaultWorkspaceId: input.defaultWorkspaceId,
    });
  }

  private async ensureUniqueSlug(candidate: string) {
    const baseSlug =
      candidate
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'workspace';

    let slug = baseSlug;
    let suffix = 2;
    while (await this.workspaceRepository.findOneBy({ slug })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private async requireRegularWorkspace(workspaceId: string) {
    const workspace = await this.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    if (!canManageWorkspaceJoinFlow(workspace.kind)) {
      throw new Error('Default workspace does not support this operation');
    }

    return workspace;
  }

  private async updateMemberByRecord({
    membership,
    patch,
  }: {
    membership: WorkspaceMember;
    patch: Partial<WorkspaceMember>;
  }) {
    this.assertOwnerMembershipMutationAllowed(membership, patch);
    const tx = await this.workspaceRepository.transaction();
    try {
      const updatedMembership = await this.workspaceMemberRepository.updateOne(
        membership.id,
        patch,
        { tx },
      );
      await this.syncWorkspaceMemberBinding(updatedMembership, tx);
      await this.workspaceRepository.commit(tx);
      return updatedMembership;
    } catch (error) {
      await this.workspaceRepository.rollback(tx);
      throw error;
    }
  }

  private async syncWorkspaceMemberBinding(
    membership: WorkspaceMember,
    tx: any,
  ) {
    if (!this.roleRepository || !this.principalRoleBindingRepository) {
      return;
    }

    await syncWorkspaceMemberRoleBinding({
      membership,
      roleRepository: this.roleRepository,
      principalRoleBindingRepository: this.principalRoleBindingRepository,
      tx,
      createdBy: membership.userId,
    });
  }

  private async removeWorkspaceMemberBinding(
    membership: WorkspaceMember,
    tx: any,
  ) {
    if (!this.principalRoleBindingRepository) {
      return;
    }

    await removeWorkspacePrincipalRoleBindings({
      workspaceId: membership.workspaceId,
      principalId: membership.userId,
      principalRoleBindingRepository: this.principalRoleBindingRepository,
      tx,
    });
  }

  private assertOwnerMembershipMutationAllowed(
    membership: WorkspaceMember,
    patch: Partial<WorkspaceMember>,
  ) {
    if (membership.roleKey !== 'owner') {
      return;
    }

    const nextRoleKey = patch.roleKey ?? membership.roleKey;
    const nextStatus = patch.status ?? membership.status;

    if (nextRoleKey !== 'owner' || nextStatus !== 'active') {
      throw new Error('Owner membership cannot be changed here');
    }
  }
}
