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

export interface GovernanceServiceDependencies {
  accessReviewRepository: IAccessReviewRepository;
  accessReviewItemRepository: IAccessReviewItemRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  userRepository: IUserRepository;
  authIdentityRepository: IAuthIdentityRepository;
  authSessionRepository: IAuthSessionRepository;
  workspaceService: IWorkspaceService;
  authService: IAuthService;
  directoryGroupRepository?: IDirectoryGroupRepository;
  directoryGroupMemberRepository?: IDirectoryGroupMemberRepository;
  breakGlassGrantRepository?: IBreakGlassGrantRepository;
  roleRepository?: IRoleRepository;
  principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
}
