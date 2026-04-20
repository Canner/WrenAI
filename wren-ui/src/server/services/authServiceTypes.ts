import {
  AuthSession,
  IAuthIdentityRepository,
  IAuthSessionRepository,
  IBreakGlassGrantRepository,
  IDirectoryGroupMemberRepository,
  IDirectoryGroupRepository,
  IPermissionRepository,
  IPrincipalRoleBindingRepository,
  IRolePermissionRepository,
  IRoleRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  User,
  Workspace,
  WorkspaceMember,
} from '../repositories';
import { AuthorizationRoleSource } from '@server/authz';
import {
  IWorkspaceBootstrapService,
  SampleRuntimeSeedMode,
} from './workspaceBootstrapService';

export const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const LOGIN_SAMPLE_BOOTSTRAP_SEED_MODE: SampleRuntimeSeedMode =
  process.env.NODE_ENV === 'test' ? 'metadata_only' : 'background_all';

export interface ActorClaims {
  userId: string;
  workspaceId: string;
  workspaceMemberId: string;
  roleKeys: string[];
  permissionScopes: string[];
  grantedActions?: string[];
  workspaceRoleSource?: AuthorizationRoleSource;
  platformRoleSource?: AuthorizationRoleSource;
  platformRoleKeys?: string[];
  isPlatformAdmin?: boolean;
}

export interface AuthResult {
  sessionToken: string;
  session: AuthSession;
  user: User;
  workspace: Workspace;
  membership: WorkspaceMember;
  actorClaims: ActorClaims;
}

export interface BootstrapOwnerInput {
  email: string;
  password: string;
  displayName: string;
  locale?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  workspaceId?: string;
}

export interface RegisterLocalUserInput {
  email: string;
  password: string;
  displayName: string;
  locale?: string;
}

export interface ValidateSessionResult {
  session: AuthSession;
  user: User;
  workspace: Workspace;
  membership: WorkspaceMember;
  actorClaims: ActorClaims;
}

export interface IAuthService {
  bootstrapOwner(input: BootstrapOwnerInput): Promise<AuthResult>;
  registerLocalUser(input: RegisterLocalUserInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  changeLocalPassword(input: {
    userId: string;
    currentPassword: string;
    nextPassword: string;
  }): Promise<void>;
  issueSessionForIdentity(input: {
    userId: string;
    authIdentityId: string;
    workspaceId?: string;
    impersonatorUserId?: string | null;
    impersonationReason?: string | null;
  }): Promise<AuthResult>;
  validateSession(
    sessionToken: string,
    workspaceId?: string,
  ): Promise<ValidateSessionResult | null>;
  logout(sessionToken: string): Promise<void>;
  resolveActorClaims(
    user: User | string,
    workspaceId?: string,
  ): Promise<Pick<AuthResult, 'workspace' | 'membership' | 'actorClaims'>>;
}

export interface AuthServiceDependencies {
  userRepository: IUserRepository;
  authIdentityRepository: IAuthIdentityRepository;
  authSessionRepository: IAuthSessionRepository;
  workspaceRepository: IWorkspaceRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  roleRepository?: IRoleRepository;
  permissionRepository?: IPermissionRepository;
  rolePermissionRepository?: IRolePermissionRepository;
  principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
  directoryGroupRepository?: IDirectoryGroupRepository;
  directoryGroupMemberRepository?: IDirectoryGroupMemberRepository;
  breakGlassGrantRepository?: IBreakGlassGrantRepository;
  workspaceBootstrapService?: IWorkspaceBootstrapService;
  sessionTtlMs?: number;
}
