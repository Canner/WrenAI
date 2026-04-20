import crypto from 'crypto';
import { Workspace, WorkspaceMember } from '../repositories';
import {
  acceptWorkspaceInvitation,
  applyUserToWorkspace,
  assertOwnerWorkspaceMembershipMutationAllowed,
  assertWorkspaceActorAllowed,
  buildDefaultWorkspaceAuthorizationActor,
  ensureUniqueWorkspaceSlug,
  hasPlatformAdminWorkspaceAccess,
  removeWorkspaceMemberBindingForService,
  requireRegularWorkspaceForJoinFlow,
  syncWorkspaceMemberBindingForService,
  WORKSPACE_KINDS,
  updateWorkspaceMemberByRecord,
} from './workspaceServiceSupport';
import {
  AddWorkspaceMemberInput,
  CreateWorkspaceInput,
  InviteWorkspaceMemberInput,
  IWorkspaceService,
  UpdateDefaultWorkspaceInput,
  UpdateWorkspaceMemberInput,
  UpdateWorkspaceSettingsInput,
  WorkspaceServiceDependencies,
} from './workspaceServiceTypes';

export type {
  AddWorkspaceMemberInput,
  CreateWorkspaceInput,
  InviteWorkspaceMemberInput,
  IWorkspaceService,
  UpdateDefaultWorkspaceInput,
  UpdateWorkspaceMemberInput,
  UpdateWorkspaceSettingsInput,
  WorkspaceServiceDependencies,
} from './workspaceServiceTypes';

export class WorkspaceService implements IWorkspaceService {
  constructor({
    workspaceRepository,
    workspaceMemberRepository,
    userRepository,
    roleRepository,
    principalRoleBindingRepository,
  }: WorkspaceServiceDependencies) {
    this.workspaceRepository = workspaceRepository;
    this.workspaceMemberRepository = workspaceMemberRepository;
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.principalRoleBindingRepository = principalRoleBindingRepository;
  }

  private readonly workspaceRepository: WorkspaceServiceDependencies['workspaceRepository'];
  private readonly workspaceMemberRepository: WorkspaceServiceDependencies['workspaceMemberRepository'];
  private readonly userRepository: WorkspaceServiceDependencies['userRepository'];
  private readonly roleRepository?: WorkspaceServiceDependencies['roleRepository'];
  private readonly principalRoleBindingRepository?: WorkspaceServiceDependencies['principalRoleBindingRepository'];

  public async createWorkspace(
    input: CreateWorkspaceInput,
  ): Promise<Workspace> {
    if (input.actor) {
      assertWorkspaceActorAllowed({
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
          slug: await ensureUniqueWorkspaceSlug({
            candidate: input.slug || input.name,
            workspaceRepository: this.workspaceRepository,
          }),
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

        await syncWorkspaceMemberBindingForService({
          membership,
          tx,
          roleRepository: this.roleRepository,
          principalRoleBindingRepository: this.principalRoleBindingRepository,
        });
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
    if (
      await hasPlatformAdminWorkspaceAccess({
        userId,
        principalRoleBindingRepository: this.principalRoleBindingRepository,
        userRepository: this.userRepository,
      })
    ) {
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
          await syncWorkspaceMemberBindingForService({
            membership: existingMembership,
            tx,
            roleRepository: this.roleRepository,
            principalRoleBindingRepository: this.principalRoleBindingRepository,
          });
          await this.workspaceRepository.commit(tx);
          return existingMembership;
        }

        await assertOwnerWorkspaceMembershipMutationAllowed(
          existingMembership,
          patch,
          this.workspaceMemberRepository,
        );

        const updatedMembership =
          await this.workspaceMemberRepository.updateOne(
            existingMembership.id,
            patch,
            { tx },
          );
        await syncWorkspaceMemberBindingForService({
          membership: updatedMembership,
          tx,
          roleRepository: this.roleRepository,
          principalRoleBindingRepository: this.principalRoleBindingRepository,
        });
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
      await syncWorkspaceMemberBindingForService({
        membership: createdMembership,
        tx,
        roleRepository: this.roleRepository,
        principalRoleBindingRepository: this.principalRoleBindingRepository,
      });
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
    const workspace = await requireRegularWorkspaceForJoinFlow({
      workspaceId: input.workspaceId,
      workspaceRepository: this.workspaceRepository,
    });
    if (input.actor) {
      assertWorkspaceActorAllowed({
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
      return await updateWorkspaceMemberByRecord({
        membership: existingMembership,
        patch: {
          roleKey: input.roleKey || existingMembership.roleKey || 'member',
          status: input.status || existingMembership.status || 'invited',
        },
        workspaceRepository: this.workspaceRepository,
        workspaceMemberRepository: this.workspaceMemberRepository,
        roleRepository: this.roleRepository,
        principalRoleBindingRepository: this.principalRoleBindingRepository,
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
      assertWorkspaceActorAllowed({
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

    return await updateWorkspaceMemberByRecord({
      membership: existingMembership,
      patch,
      workspaceRepository: this.workspaceRepository,
      workspaceMemberRepository: this.workspaceMemberRepository,
      roleRepository: this.roleRepository,
      principalRoleBindingRepository: this.principalRoleBindingRepository,
    });
  }

  public async removeMember(input: {
    workspaceId: string;
    memberId: string;
    actor?: any;
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
      assertWorkspaceActorAllowed({
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

    await assertOwnerWorkspaceMembershipMutationAllowed(
      existingMembership,
      {
        status: 'inactive',
      },
      this.workspaceMemberRepository,
    );

    const tx = await this.workspaceRepository.transaction();
    try {
      await this.workspaceMemberRepository.deleteOne(existingMembership.id, {
        tx,
      });
      await removeWorkspaceMemberBindingForService({
        membership: existingMembership,
        tx,
        principalRoleBindingRepository: this.principalRoleBindingRepository,
      });
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
    return await applyUserToWorkspace({
      workspaceId: input.workspaceId,
      userId: input.userId,
      workspaceRepository: this.workspaceRepository,
      workspaceMemberRepository: this.workspaceMemberRepository,
      addMember: this.addMember.bind(this),
    });
  }

  public async acceptInvitation(input: {
    workspaceId: string;
    userId: string;
  }): Promise<WorkspaceMember> {
    return await acceptWorkspaceInvitation({
      workspaceId: input.workspaceId,
      userId: input.userId,
      workspaceRepository: this.workspaceRepository,
      workspaceMemberRepository: this.workspaceMemberRepository,
      workspaceServiceDeps: {
        roleRepository: this.roleRepository,
        principalRoleBindingRepository: this.principalRoleBindingRepository,
      },
    });
  }

  public async updateDefaultWorkspace(
    input: UpdateDefaultWorkspaceInput,
  ): Promise<void> {
    const actor = buildDefaultWorkspaceAuthorizationActor(
      input.validatedSession,
    );
    assertWorkspaceActorAllowed({
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
}
