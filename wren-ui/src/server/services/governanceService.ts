import crypto from 'crypto';
import {
  AccessReview,
  AccessReviewItem,
  BreakGlassGrant,
  DirectoryGroup,
  DirectoryGroupMember,
  IAccessReviewItemRepository,
  IAccessReviewRepository,
  IAuthIdentityRepository,
  IAuthSessionRepository,
  IBreakGlassGrantRepository,
  IDirectoryGroupMemberRepository,
  IDirectoryGroupRepository,
  IPrincipalRoleBindingRepository,
  IRoleRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
} from '@server/repositories';
import type {
  AuthResult,
  IAuthService,
  ValidateSessionResult,
} from './authService';
import { IWorkspaceService } from './workspaceService';
import {
  PLATFORM_SCOPE_ID,
  removeWorkspacePrincipalRoleBindings,
  syncWorkspaceScopedRoleBinding,
} from '@server/authz';
import { canManageWorkspaceJoinFlow } from '@/utils/workspaceGovernance';

export interface AccessReviewWithItems extends AccessReview {
  items: AccessReviewItem[];
}

export interface DirectoryGroupWithMembers extends DirectoryGroup {
  members: DirectoryGroupMember[];
  roleKeys: string[];
}

export interface BreakGlassGrantWithUser extends BreakGlassGrant {
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
    status: string;
  } | null;
}

export interface IGovernanceService {
  listAccessReviews(workspaceId: string): Promise<AccessReviewWithItems[]>;
  createAccessReview(input: {
    validatedSession: ValidateSessionResult;
    title: string;
    dueAt?: Date | string | null;
    notes?: string | null;
  }): Promise<AccessReviewWithItems>;
  reviewAccessReviewItem(input: {
    validatedSession: ValidateSessionResult;
    accessReviewId: string;
    itemId: string;
    decision: 'keep' | 'remove';
    notes?: string | null;
  }): Promise<AccessReviewWithItems>;
  startImpersonation(input: {
    validatedSession: ValidateSessionResult;
    targetUserId: string;
    workspaceId?: string;
    reason: string;
  }): Promise<AuthResult>;
  stopImpersonation(
    validatedSession: ValidateSessionResult,
  ): Promise<AuthResult>;
  listDirectoryGroups(
    workspaceId: string,
  ): Promise<DirectoryGroupWithMembers[]>;
  createDirectoryGroup(input: {
    workspaceId: string;
    displayName: string;
    roleKey: string;
    memberIds?: string[];
    source?: string;
    createdBy?: string | null;
    identityProviderConfigId?: string | null;
    externalId?: string | null;
    metadata?: Record<string, any> | null;
  }): Promise<DirectoryGroupWithMembers>;
  updateDirectoryGroup(input: {
    workspaceId: string;
    id: string;
    displayName?: string;
    roleKey?: string | null;
    memberIds?: string[];
    status?: string;
    metadata?: Record<string, any> | null;
  }): Promise<DirectoryGroupWithMembers>;
  deleteDirectoryGroup(workspaceId: string, id: string): Promise<void>;
  upsertIdentityDirectoryGroup(input: {
    workspaceId: string;
    identityProviderConfigId?: string | null;
    externalId?: string | null;
    displayName: string;
    roleKey?: string | null;
    memberIds?: string[];
    source: string;
    metadata?: Record<string, any> | null;
  }): Promise<DirectoryGroupWithMembers>;
  listBreakGlassGrants(workspaceId: string): Promise<BreakGlassGrantWithUser[]>;
  createBreakGlassGrant(input: {
    validatedSession: ValidateSessionResult;
    userId: string;
    roleKey?: string;
    reason: string;
    expiresAt: Date | string;
  }): Promise<BreakGlassGrantWithUser>;
  revokeBreakGlassGrant(input: {
    validatedSession: ValidateSessionResult;
    id: string;
  }): Promise<BreakGlassGrantWithUser>;
}

export class GovernanceService implements IGovernanceService {
  constructor(
    private readonly accessReviewRepository: IAccessReviewRepository,
    private readonly accessReviewItemRepository: IAccessReviewItemRepository,
    private readonly workspaceMemberRepository: IWorkspaceMemberRepository,
    private readonly userRepository: IUserRepository,
    private readonly authIdentityRepository: IAuthIdentityRepository,
    private readonly authSessionRepository: IAuthSessionRepository,
    private readonly workspaceService: IWorkspaceService,
    private readonly authService: IAuthService,
    private readonly directoryGroupRepository?: IDirectoryGroupRepository,
    private readonly directoryGroupMemberRepository?: IDirectoryGroupMemberRepository,
    private readonly breakGlassGrantRepository?: IBreakGlassGrantRepository,
    private readonly roleRepository?: IRoleRepository,
    private readonly principalRoleBindingRepository?: IPrincipalRoleBindingRepository,
  ) {}

  public async listAccessReviews(workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    const [reviews, items] = await Promise.all([
      this.accessReviewRepository.findAllBy(
        { workspaceId },
        { order: 'created_at desc' },
      ),
      this.accessReviewItemRepository.findAllBy(
        { workspaceId },
        { order: 'created_at asc' },
      ),
    ]);

    const itemsByReviewId = items.reduce<Record<string, AccessReviewItem[]>>(
      (acc, item) => {
        const reviewId = item.accessReviewId;
        acc[reviewId] = acc[reviewId] || [];
        acc[reviewId].push(item);
        return acc;
      },
      {},
    );

    return reviews.map((review) => ({
      ...review,
      items: itemsByReviewId[review.id] || [],
    }));
  }

  public async createAccessReview(input: {
    validatedSession: ValidateSessionResult;
    title: string;
    dueAt?: Date | string | null;
    notes?: string | null;
  }) {
    const workspaceId = input.validatedSession.workspace.id;
    const actorUserId = input.validatedSession.user.id;
    await this.requireGovernanceWorkspace(workspaceId);
    const members = await this.workspaceMemberRepository.findAllBy({
      workspaceId,
      status: 'active',
    });
    const review = await this.accessReviewRepository.createOne({
      id: crypto.randomUUID(),
      workspaceId,
      title: input.title.trim(),
      status: 'open',
      createdBy: actorUserId,
      startedAt: new Date(),
      dueAt: input.dueAt || null,
      notes: input.notes || null,
    });

    const items = await this.accessReviewItemRepository.createMany(
      members.map((member) => ({
        id: crypto.randomUUID(),
        accessReviewId: review.id,
        workspaceId,
        workspaceMemberId: member.id,
        userId: member.userId,
        roleKey: member.roleKey,
        status: 'pending',
      })),
    );

    return {
      ...review,
      items,
    };
  }

  public async reviewAccessReviewItem(input: {
    validatedSession: ValidateSessionResult;
    accessReviewId: string;
    itemId: string;
    decision: 'keep' | 'remove';
    notes?: string | null;
  }) {
    const workspaceId = input.validatedSession.workspace.id;
    const actorUserId = input.validatedSession.user.id;
    await this.requireGovernanceWorkspace(workspaceId);
    const review = await this.accessReviewRepository.findOneBy({
      id: input.accessReviewId,
    });
    if (!review || review.workspaceId !== workspaceId) {
      throw new Error('Access review not found');
    }

    const item = await this.accessReviewItemRepository.findOneBy({
      id: input.itemId,
    });
    if (
      !item ||
      item.accessReviewId !== review.id ||
      item.workspaceId !== workspaceId
    ) {
      throw new Error('Access review item not found');
    }

    const updatedItem = await this.accessReviewItemRepository.updateOne(
      item.id,
      {
        decision: input.decision,
        status: 'reviewed',
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
        notes: input.notes || null,
      },
    );

    if (input.decision === 'remove' && item.workspaceMemberId) {
      const membership = await this.workspaceMemberRepository.findOneBy({
        id: item.workspaceMemberId,
      });
      if (membership && membership.workspaceId === workspaceId) {
        await this.workspaceService.updateMember({
          workspaceId,
          memberId: membership.id,
          status: 'inactive',
        });
      }
    }

    const reviewItems = await this.accessReviewItemRepository.findAllBy({
      accessReviewId: review.id,
    });
    const allReviewed = reviewItems.every((reviewItem) =>
      reviewItem.id === updatedItem.id
        ? true
        : reviewItem.status === 'reviewed',
    );
    const normalizedItems = reviewItems.map((reviewItem) =>
      reviewItem.id === updatedItem.id ? updatedItem : reviewItem,
    );

    const nextReview = allReviewed
      ? await this.accessReviewRepository.updateOne(review.id, {
          status: 'completed',
          completedBy: actorUserId,
          completedAt: new Date(),
        })
      : review;

    return {
      ...nextReview,
      items: normalizedItems,
    };
  }

  public async startImpersonation(input: {
    validatedSession: ValidateSessionResult;
    targetUserId: string;
    workspaceId?: string;
    reason: string;
  }) {
    const adminUserId = input.validatedSession.user.id;
    const [adminUser, targetUser] = await Promise.all([
      this.userRepository.findOneBy({ id: adminUserId }),
      this.userRepository.findOneBy({ id: input.targetUserId }),
    ]);
    if (!adminUser || !(await this.hasPlatformAdminAuthority(adminUser))) {
      throw new Error('Platform admin permission required');
    }
    if (!targetUser || targetUser.status !== 'active') {
      throw new Error('Target user not found');
    }

    const identity = await this.findPreferredAuthIdentity(targetUser.id);
    if (!identity) {
      throw new Error('Target user has no login identity');
    }

    return this.authService.issueSessionForIdentity({
      userId: targetUser.id,
      authIdentityId: identity.id,
      workspaceId: input.workspaceId,
      impersonatorUserId: adminUserId,
      impersonationReason: input.reason,
    });
  }

  public async stopImpersonation(validatedSession: ValidateSessionResult) {
    const impersonatorUserId = validatedSession.session.impersonatorUserId;
    if (!impersonatorUserId) {
      throw new Error('Current session is not impersonated');
    }

    const identity = await this.findPreferredAuthIdentity(impersonatorUserId);
    if (!identity) {
      throw new Error('Unable to restore impersonator session');
    }

    await this.authSessionRepository.updateOne(validatedSession.session.id, {
      revokedAt: new Date(),
    });

    return this.authService.issueSessionForIdentity({
      userId: impersonatorUserId,
      authIdentityId: identity.id,
    });
  }

  public async listDirectoryGroups(workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    const [groups, members] = await Promise.all([
      this.requireDirectoryGroupRepository().findAllBy(
        { workspaceId },
        { order: 'created_at desc' },
      ),
      this.requireDirectoryGroupMemberRepository().findAllBy(
        { workspaceId },
        { order: 'created_at asc' },
      ),
    ]);

    const membersByGroupId = members.reduce<
      Record<string, DirectoryGroupMember[]>
    >((acc, item) => {
      acc[item.directoryGroupId] = acc[item.directoryGroupId] || [];
      acc[item.directoryGroupId].push(item);
      return acc;
    }, {});

    const roleKeysByGroupId = await this.listDirectoryGroupRoleKeys(groups);

    return groups.map((group) => ({
      ...group,
      members: membersByGroupId[group.id] || [],
      roleKeys: roleKeysByGroupId[group.id] || [],
    }));
  }

  public async createDirectoryGroup(input: {
    workspaceId: string;
    displayName: string;
    roleKey: string;
    memberIds?: string[];
    source?: string;
    createdBy?: string | null;
    identityProviderConfigId?: string | null;
    externalId?: string | null;
    metadata?: Record<string, any> | null;
  }) {
    await this.requireGovernanceWorkspace(input.workspaceId);
    const repository = this.requireDirectoryGroupRepository();
    const tx = await repository.transaction();
    try {
      const group = await repository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          identityProviderConfigId: input.identityProviderConfigId || null,
          externalId: input.externalId || null,
          displayName: input.displayName.trim(),
          source: input.source || 'manual',
          status: 'active',
          metadata: input.metadata || null,
          createdBy: input.createdBy || null,
        },
        { tx },
      );

      await this.syncDirectoryGroupRoleBinding({
        group,
        roleKey: input.roleKey,
        tx,
        createdBy: input.createdBy || null,
      });
      await this.syncDirectoryGroupMembers({
        group,
        memberIds: input.memberIds || [],
        source: input.source || 'manual',
        tx,
      });

      await repository.commit(tx);
      return await this.getDirectoryGroupWithMembers(
        group.id,
        input.workspaceId,
      );
    } catch (error) {
      await repository.rollback(tx);
      throw error;
    }
  }

  public async updateDirectoryGroup(input: {
    workspaceId: string;
    id: string;
    displayName?: string;
    roleKey?: string | null;
    memberIds?: string[];
    status?: string;
    metadata?: Record<string, any> | null;
  }) {
    await this.requireGovernanceWorkspace(input.workspaceId);
    const repository = this.requireDirectoryGroupRepository();
    const tx = await repository.transaction();
    try {
      const existing = await this.requireDirectoryGroup(
        input.workspaceId,
        input.id,
        tx,
      );
      const updated = await repository.updateOne(
        existing.id,
        {
          displayName: input.displayName?.trim() || existing.displayName,
          status: input.status || existing.status,
          metadata:
            input.metadata === undefined
              ? existing.metadata || null
              : input.metadata,
        },
        { tx },
      );

      if (input.roleKey !== undefined) {
        await this.syncDirectoryGroupRoleBinding({
          group: updated,
          roleKey: input.roleKey,
          tx,
        });
      }
      if (input.memberIds) {
        await this.syncDirectoryGroupMembers({
          group: updated,
          memberIds: input.memberIds,
          source: updated.source || 'manual',
          tx,
        });
      }

      await repository.commit(tx);
      return await this.getDirectoryGroupWithMembers(
        updated.id,
        input.workspaceId,
      );
    } catch (error) {
      await repository.rollback(tx);
      throw error;
    }
  }

  public async deleteDirectoryGroup(workspaceId: string, id: string) {
    await this.requireGovernanceWorkspace(workspaceId);
    const repository = this.requireDirectoryGroupRepository();
    const existing = await this.requireDirectoryGroup(workspaceId, id);
    await this.requireDirectoryGroupMemberRepository().deleteByGroupId(
      existing.id,
    );
    await this.removeDirectoryGroupRoleBindings(
      existing.id,
      existing.workspaceId,
    );
    await repository.deleteOne(existing.id);
  }

  public async upsertIdentityDirectoryGroup(input: {
    workspaceId: string;
    identityProviderConfigId?: string | null;
    externalId?: string | null;
    displayName: string;
    roleKey?: string | null;
    memberIds?: string[];
    source: string;
    metadata?: Record<string, any> | null;
  }) {
    await this.requireGovernanceWorkspace(input.workspaceId);
    const repository = this.requireDirectoryGroupRepository();
    const tx = await repository.transaction();
    try {
      let group =
        (input.externalId
          ? await repository.findOneBy(
              {
                workspaceId: input.workspaceId,
                identityProviderConfigId:
                  input.identityProviderConfigId || null,
                externalId: input.externalId,
              },
              { tx },
            )
          : null) ||
        (await repository.findOneBy(
          {
            workspaceId: input.workspaceId,
            displayName: input.displayName.trim(),
          },
          { tx },
        ));

      if (!group) {
        group = await repository.createOne(
          {
            id: crypto.randomUUID(),
            workspaceId: input.workspaceId,
            identityProviderConfigId: input.identityProviderConfigId || null,
            externalId: input.externalId || null,
            displayName: input.displayName.trim(),
            source: input.source,
            status: 'active',
            metadata: input.metadata || null,
          },
          { tx },
        );
      } else {
        group = await repository.updateOne(
          group.id,
          {
            identityProviderConfigId:
              input.identityProviderConfigId ||
              group.identityProviderConfigId ||
              null,
            externalId: input.externalId || group.externalId || null,
            displayName: input.displayName.trim(),
            source: input.source,
            status: 'active',
            metadata:
              input.metadata === undefined
                ? group.metadata || null
                : input.metadata,
          },
          { tx },
        );
      }

      await this.syncDirectoryGroupRoleBinding({
        group,
        roleKey: input.roleKey,
        tx,
      });
      await this.syncDirectoryGroupMembers({
        group,
        memberIds: input.memberIds || [],
        source: input.source,
        tx,
      });

      await repository.commit(tx);
      return await this.getDirectoryGroupWithMembers(
        group.id,
        input.workspaceId,
      );
    } catch (error) {
      await repository.rollback(tx);
      throw error;
    }
  }

  public async listBreakGlassGrants(workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    const grants = await this.requireBreakGlassGrantRepository().findAllBy(
      { workspaceId },
      { order: 'created_at desc' },
    );
    const users = await Promise.all(
      grants.map((grant) =>
        this.userRepository.findOneBy({ id: grant.userId }),
      ),
    );

    return grants.map((grant, index) => ({
      ...grant,
      user: users[index]
        ? {
            id: users[index]!.id,
            email: users[index]!.email,
            displayName: users[index]!.displayName ?? null,
            status: users[index]!.status,
          }
        : null,
    }));
  }

  public async createBreakGlassGrant(input: {
    validatedSession: ValidateSessionResult;
    userId: string;
    roleKey?: string;
    reason: string;
    expiresAt: Date | string;
  }) {
    const workspaceId = input.validatedSession.workspace.id;
    const actorUserId = input.validatedSession.user.id;
    await this.requireWorkspace(workspaceId);
    const repository = this.requireBreakGlassGrantRepository();
    const user = await this.userRepository.findOneBy({ id: input.userId });
    if (!user) {
      throw new Error('Target user not found');
    }

    const tx = await repository.transaction();
    try {
      const existing = await repository.findActiveGrantForUser(
        workspaceId,
        input.userId,
        { tx },
      );
      if (existing) {
        await repository.updateOne(
          existing.id,
          {
            status: 'revoked',
            revokedAt: new Date(),
            revokedBy: actorUserId,
          },
          { tx },
        );
      }

      const grant = await repository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId,
          userId: input.userId,
          roleKey: input.roleKey || 'owner',
          status: 'active',
          reason: input.reason.trim(),
          expiresAt: input.expiresAt,
          createdBy: actorUserId,
        },
        { tx },
      );

      await repository.commit(tx);
      return {
        ...grant,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName ?? null,
          status: user.status,
        },
      };
    } catch (error) {
      await repository.rollback(tx);
      throw error;
    }
  }

  public async revokeBreakGlassGrant(input: {
    validatedSession: ValidateSessionResult;
    id: string;
  }) {
    const workspaceId = input.validatedSession.workspace.id;
    const actorUserId = input.validatedSession.user.id;
    await this.requireWorkspace(workspaceId);
    const repository = this.requireBreakGlassGrantRepository();
    const grant = await repository.findOneBy({ id: input.id });
    if (!grant || grant.workspaceId !== workspaceId) {
      throw new Error('Break-glass grant not found');
    }

    const updated = await repository.updateOne(grant.id, {
      status: 'revoked',
      revokedAt: new Date(),
      revokedBy: actorUserId,
    });
    const user = await this.userRepository.findOneBy({ id: updated.userId });
    return {
      ...updated,
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.displayName ?? null,
            status: user.status,
          }
        : null,
    };
  }

  private async getDirectoryGroupWithMembers(id: string, workspaceId: string) {
    const groups = await this.listDirectoryGroups(workspaceId);
    const group = groups.find((item) => item.id === id);
    if (!group) {
      throw new Error('Directory group not found');
    }
    return group;
  }

  private async listDirectoryGroupRoleKeys(groups: DirectoryGroup[]) {
    if (!this.principalRoleBindingRepository) {
      return {} as Record<string, string[]>;
    }

    const entries = await Promise.all(
      groups.map(async (group) => {
        const bindings =
          await this.principalRoleBindingRepository!.findResolvedRoleBindings({
            principalType: 'group',
            principalId: group.id,
            scopeType: 'workspace',
            scopeId: group.workspaceId,
          });
        return [
          group.id,
          Array.from(
            new Set(
              bindings
                .map((binding) =>
                  String(binding.roleName || '')
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          ),
        ] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  private async syncDirectoryGroupRoleBinding({
    group,
    roleKey,
    tx,
    createdBy,
  }: {
    group: DirectoryGroup;
    roleKey?: string | null;
    tx: any;
    createdBy?: string | null;
  }) {
    if (!this.roleRepository || !this.principalRoleBindingRepository) {
      return;
    }

    if (!roleKey) {
      await this.removeDirectoryGroupRoleBindings(
        group.id,
        group.workspaceId,
        tx,
      );
      return;
    }

    await syncWorkspaceScopedRoleBinding({
      principalType: 'group' as 'user' | 'service_account',
      principalId: group.id,
      workspaceId: group.workspaceId,
      roleKey,
      roleRepository: this.roleRepository,
      principalRoleBindingRepository: this.principalRoleBindingRepository,
      tx,
      createdBy: createdBy || null,
    });
  }

  private async removeDirectoryGroupRoleBindings(
    directoryGroupId: string,
    workspaceId: string,
    tx?: any,
  ) {
    if (!this.principalRoleBindingRepository) {
      return;
    }

    await removeWorkspacePrincipalRoleBindings({
      workspaceId,
      principalId: directoryGroupId,
      principalType: 'group' as 'user' | 'service_account',
      principalRoleBindingRepository: this.principalRoleBindingRepository,
      tx,
    });
  }

  private async syncDirectoryGroupMembers({
    group,
    memberIds,
    source,
    tx,
  }: {
    group: DirectoryGroup;
    memberIds: string[];
    source: string;
    tx: any;
  }) {
    const memberRepository = this.requireDirectoryGroupMemberRepository();
    const normalizedIds = Array.from(
      new Set(
        (memberIds || [])
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    );

    const memberships = await Promise.all(
      normalizedIds.map((userId) =>
        this.workspaceService.getMembership(group.workspaceId, userId),
      ),
    );
    const invalidUserId = memberships.findIndex((membership) => !membership);
    if (invalidUserId >= 0) {
      throw new Error('Directory group members must belong to the workspace');
    }

    await memberRepository.deleteByGroupId(group.id, { tx });
    if (normalizedIds.length === 0) {
      return;
    }

    await memberRepository.createMany(
      normalizedIds.map((userId) => ({
        id: crypto.randomUUID(),
        directoryGroupId: group.id,
        workspaceId: group.workspaceId,
        userId,
        source,
      })),
      { tx },
    );
  }

  private async requireDirectoryGroup(
    workspaceId: string,
    id: string,
    tx?: any,
  ) {
    const group = await this.requireDirectoryGroupRepository().findOneBy(
      { id },
      tx ? { tx } : undefined,
    );
    if (!group || group.workspaceId !== workspaceId) {
      throw new Error('Directory group not found');
    }
    return group;
  }

  private requireDirectoryGroupRepository() {
    if (!this.directoryGroupRepository) {
      throw new Error('Directory group repository is not configured');
    }
    return this.directoryGroupRepository;
  }

  private requireDirectoryGroupMemberRepository() {
    if (!this.directoryGroupMemberRepository) {
      throw new Error('Directory group member repository is not configured');
    }
    return this.directoryGroupMemberRepository;
  }

  private requireBreakGlassGrantRepository() {
    if (!this.breakGlassGrantRepository) {
      throw new Error('Break-glass grant repository is not configured');
    }
    return this.breakGlassGrantRepository;
  }

  private async findPreferredAuthIdentity(userId: string) {
    const identities = await this.authIdentityRepository.findAllBy({ userId });
    const activeIdentity =
      identities.find((identity) => identity.providerType === 'local') ||
      identities[0] ||
      null;
    return activeIdentity;
  }

  private async requireWorkspace(workspaceId: string) {
    const workspace = await this.workspaceService.getWorkspaceById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return workspace;
  }

  private async requireGovernanceWorkspace(workspaceId: string) {
    const workspace = await this.requireWorkspace(workspaceId);
    if (!canManageWorkspaceJoinFlow(workspace.kind)) {
      throw new Error(
        'Default workspace does not support this governance action',
      );
    }
    return workspace;
  }

  private async hasPlatformAdminAuthority(user: {
    id: string;
    isPlatformAdmin?: boolean | null;
  }) {
    if (!this.principalRoleBindingRepository) {
      return false;
    }

    const bindings =
      await this.principalRoleBindingRepository.findResolvedRoleBindings({
        principalType: 'user',
        principalId: user.id,
        scopeType: 'platform',
        scopeId: PLATFORM_SCOPE_ID,
      });

    return bindings.some(
      (binding) =>
        String(binding.roleName || '')
          .trim()
          .toLowerCase() === 'platform_admin',
    );
  }
}
