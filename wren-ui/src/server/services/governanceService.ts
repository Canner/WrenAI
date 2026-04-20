import {
  GovernanceServiceDependencies,
  IGovernanceService,
} from './governanceServiceTypes';
import type {
  AuthResult,
  IAuthService,
  ValidateSessionResult,
} from './authService';
import {
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
import { IWorkspaceService } from './workspaceService';
import {
  createAccessReview,
  createBreakGlassGrant,
  listAccessReviews,
  listBreakGlassGrants,
  reviewAccessReviewItem,
  revokeBreakGlassGrant,
  startImpersonation,
  stopImpersonation,
} from './governanceServiceSupport';
import {
  createDirectoryGroup,
  deleteDirectoryGroup,
  listDirectoryGroups,
  updateDirectoryGroup,
  upsertIdentityDirectoryGroup,
} from './governanceServiceDirectorySupport';

export type {
  AccessReviewWithItems,
  BreakGlassGrantWithUser,
  DirectoryGroupWithMembers,
  IGovernanceService,
} from './governanceServiceTypes';

export class GovernanceService implements IGovernanceService {
  private readonly deps: GovernanceServiceDependencies;

  constructor(
    accessReviewRepository: IAccessReviewRepository,
    accessReviewItemRepository: IAccessReviewItemRepository,
    workspaceMemberRepository: IWorkspaceMemberRepository,
    userRepository: IUserRepository,
    authIdentityRepository: IAuthIdentityRepository,
    authSessionRepository: IAuthSessionRepository,
    workspaceService: IWorkspaceService,
    authService: IAuthService,
    directoryGroupRepository?: IDirectoryGroupRepository,
    directoryGroupMemberRepository?: IDirectoryGroupMemberRepository,
    breakGlassGrantRepository?: IBreakGlassGrantRepository,
    roleRepository?: IRoleRepository,
    principalRoleBindingRepository?: IPrincipalRoleBindingRepository,
  ) {
    this.deps = {
      accessReviewRepository,
      accessReviewItemRepository,
      workspaceMemberRepository,
      userRepository,
      authIdentityRepository,
      authSessionRepository,
      workspaceService,
      authService,
      directoryGroupRepository,
      directoryGroupMemberRepository,
      breakGlassGrantRepository,
      roleRepository,
      principalRoleBindingRepository,
    };
  }

  public async listAccessReviews(workspaceId: string) {
    return await listAccessReviews(workspaceId, this.deps);
  }

  public async createAccessReview(input: {
    validatedSession: ValidateSessionResult;
    title: string;
    dueAt?: Date | string | null;
    notes?: string | null;
  }) {
    return await createAccessReview(input, this.deps);
  }

  public async reviewAccessReviewItem(input: {
    validatedSession: ValidateSessionResult;
    accessReviewId: string;
    itemId: string;
    decision: 'keep' | 'remove';
    notes?: string | null;
  }) {
    return await reviewAccessReviewItem(input, this.deps);
  }

  public async startImpersonation(input: {
    validatedSession: ValidateSessionResult;
    targetUserId: string;
    workspaceId?: string;
    reason: string;
  }): Promise<AuthResult> {
    return await startImpersonation(input, this.deps);
  }

  public async stopImpersonation(
    validatedSession: ValidateSessionResult,
  ): Promise<AuthResult> {
    return await stopImpersonation(validatedSession, this.deps);
  }

  public async listDirectoryGroups(workspaceId: string) {
    return await listDirectoryGroups(workspaceId, this.deps);
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
    return await createDirectoryGroup(input, this.deps);
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
    return await updateDirectoryGroup(input, this.deps);
  }

  public async deleteDirectoryGroup(workspaceId: string, id: string) {
    return await deleteDirectoryGroup(workspaceId, id, this.deps);
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
    return await upsertIdentityDirectoryGroup(input, this.deps);
  }

  public async listBreakGlassGrants(workspaceId: string) {
    return await listBreakGlassGrants(workspaceId, this.deps);
  }

  public async createBreakGlassGrant(input: {
    validatedSession: ValidateSessionResult;
    userId: string;
    roleKey?: string;
    reason: string;
    expiresAt: Date | string;
  }) {
    return await createBreakGlassGrant(input, this.deps);
  }

  public async revokeBreakGlassGrant(input: {
    validatedSession: ValidateSessionResult;
    id: string;
  }) {
    return await revokeBreakGlassGrant(input, this.deps);
  }
}
