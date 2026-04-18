import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getLogger } from '@server/utils';
import {
  AuthSession,
  IAuthIdentityRepository,
  IPrincipalRoleBindingRepository,
  IRoleRepository,
  IAuthSessionRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  IDirectoryGroupRepository,
  IDirectoryGroupMemberRepository,
  IBreakGlassGrantRepository,
  User,
  Workspace,
  WorkspaceMember,
} from '../repositories';
import {
  IWorkspaceBootstrapService,
  SampleRuntimeSeedMode,
} from './workspaceBootstrapService';
import { WORKSPACE_KINDS } from '@/utils/workspaceGovernance';
import {
  AuthorizationRoleSource,
  PLATFORM_SCOPE_ID,
  isAuthorizationBindingOnlyEnabled,
  isPlatformAdminRoleName,
  syncPlatformAdminRoleBinding,
  syncWorkspaceMemberRoleBinding,
  toLegacyWorkspaceRoleKey,
  toLegacyWorkspaceRoleKeys,
} from '@server/authz';

const logger = getLogger('AuthService');
logger.level = 'debug';

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LOGIN_SAMPLE_BOOTSTRAP_SEED_MODE =
  process.env.NODE_ENV === 'test' ? 'metadata_only' : 'background_all';

const ROLE_PERMISSION_SCOPES: Record<string, string[]> = {
  owner: ['workspace:*', 'knowledge_base:*'],
  admin: ['workspace:*', 'knowledge_base:*'],
  member: ['workspace:read', 'knowledge_base:read'],
};

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

export class AuthService implements IAuthService {
  private userRepository: IUserRepository;
  private authIdentityRepository: IAuthIdentityRepository;
  private authSessionRepository: IAuthSessionRepository;
  private workspaceRepository: IWorkspaceRepository;
  private workspaceMemberRepository: IWorkspaceMemberRepository;
  private roleRepository?: IRoleRepository;
  private principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
  private directoryGroupRepository?: IDirectoryGroupRepository;
  private directoryGroupMemberRepository?: IDirectoryGroupMemberRepository;
  private breakGlassGrantRepository?: IBreakGlassGrantRepository;
  private workspaceBootstrapService?: IWorkspaceBootstrapService;
  private sessionTtlMs: number;

  constructor({
    userRepository,
    authIdentityRepository,
    authSessionRepository,
    workspaceRepository,
    workspaceMemberRepository,
    roleRepository,
    principalRoleBindingRepository,
    directoryGroupRepository,
    directoryGroupMemberRepository,
    breakGlassGrantRepository,
    workspaceBootstrapService,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  }: {
    userRepository: IUserRepository;
    authIdentityRepository: IAuthIdentityRepository;
    authSessionRepository: IAuthSessionRepository;
    workspaceRepository: IWorkspaceRepository;
    workspaceMemberRepository: IWorkspaceMemberRepository;
    roleRepository?: IRoleRepository;
    principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
    directoryGroupRepository?: IDirectoryGroupRepository;
    directoryGroupMemberRepository?: IDirectoryGroupMemberRepository;
    breakGlassGrantRepository?: IBreakGlassGrantRepository;
    workspaceBootstrapService?: IWorkspaceBootstrapService;
    sessionTtlMs?: number;
  }) {
    this.userRepository = userRepository;
    this.authIdentityRepository = authIdentityRepository;
    this.authSessionRepository = authSessionRepository;
    this.workspaceRepository = workspaceRepository;
    this.workspaceMemberRepository = workspaceMemberRepository;
    this.roleRepository = roleRepository;
    this.principalRoleBindingRepository = principalRoleBindingRepository;
    this.directoryGroupRepository = directoryGroupRepository;
    this.directoryGroupMemberRepository = directoryGroupMemberRepository;
    this.breakGlassGrantRepository = breakGlassGrantRepository;
    this.workspaceBootstrapService = workspaceBootstrapService;
    this.sessionTtlMs = sessionTtlMs;
  }

  public async bootstrapOwner(input: BootstrapOwnerInput): Promise<AuthResult> {
    const existingUsers = await this.userRepository.findAll({ limit: 1 });
    if (existingUsers.length > 0) {
      throw new Error('Bootstrap is only allowed on a fresh instance');
    }

    const defaultWorkspace = await this.ensureDefaultWorkspaceWithSamples({
      runtimeSeedMode: 'all',
    });
    const normalizedEmail = this.normalizeEmail(input.email);
    const tx = await this.userRepository.transaction();
    try {
      const user = await this.userRepository.createOne(
        {
          id: crypto.randomUUID(),
          email: normalizedEmail,
          displayName: input.displayName,
          locale: input.locale || 'en-US',
          status: 'active',
          isPlatformAdmin: true,
          defaultWorkspaceId: null,
        },
        { tx },
      );

      const identity = await this.authIdentityRepository.createOne(
        {
          id: crypto.randomUUID(),
          userId: user.id,
          providerType: 'local',
          providerSubject: normalizedEmail,
          passwordHash: await bcrypt.hash(input.password, 10),
          passwordAlgo: 'bcrypt',
        },
        { tx },
      );

      const defaultMembership = await this.workspaceMemberRepository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId: defaultWorkspace.id,
          userId: user.id,
          roleKey: 'owner',
          status: 'active',
        },
        { tx },
      );

      await this.syncStructuredBindings({
        user,
        membership: defaultMembership,
        tx,
      });

      const updatedUser = await this.userRepository.updateOne(
        user.id,
        {
          defaultWorkspaceId: defaultWorkspace.id,
        },
        { tx },
      );

      const { session, sessionToken } = await this.createSession(
        updatedUser.id,
        identity.id,
        tx,
      );

      await this.userRepository.commit(tx);

      return {
        sessionToken,
        session,
        user: updatedUser,
        workspace: defaultWorkspace,
        membership: defaultMembership,
        actorClaims: await this.toActorClaims(
          updatedUser,
          defaultWorkspace,
          defaultMembership,
        ),
      };
    } catch (error) {
      await this.userRepository.rollback(tx);
      throw error;
    }
  }

  public async registerLocalUser(
    input: RegisterLocalUserInput,
  ): Promise<AuthResult> {
    const workspace = await this.ensureDefaultWorkspaceWithSamples({
      runtimeSeedMode: 'all',
    });
    if (!workspace) {
      throw new Error('Default workspace is not configured');
    }

    const normalizedEmail = this.normalizeEmail(input.email);
    const existingIdentity = await this.authIdentityRepository.findOneBy({
      providerType: 'local',
      providerSubject: normalizedEmail,
    });
    if (existingIdentity) {
      throw new Error(`User ${normalizedEmail} already exists`);
    }

    const tx = await this.userRepository.transaction();
    try {
      const user = await this.userRepository.createOne(
        {
          id: crypto.randomUUID(),
          email: normalizedEmail,
          displayName: input.displayName,
          locale: input.locale || 'en-US',
          status: 'active',
          isPlatformAdmin: false,
          defaultWorkspaceId: workspace.id,
        },
        { tx },
      );

      const identity = await this.authIdentityRepository.createOne(
        {
          id: crypto.randomUUID(),
          userId: user.id,
          providerType: 'local',
          providerSubject: normalizedEmail,
          passwordHash: await bcrypt.hash(input.password, 10),
          passwordAlgo: 'bcrypt',
        },
        { tx },
      );

      const membership = await this.workspaceMemberRepository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId: workspace.id,
          userId: user.id,
          roleKey: 'member',
          status: 'active',
        },
        { tx },
      );

      await this.syncStructuredBindings({
        user,
        membership,
        tx,
      });

      const { session, sessionToken } = await this.createSession(
        user.id,
        identity.id,
        tx,
      );

      await this.userRepository.commit(tx);

      return {
        sessionToken,
        session,
        user,
        workspace,
        membership,
        actorClaims: await this.toActorClaims(user, workspace, membership),
      };
    } catch (error) {
      await this.userRepository.rollback(tx);
      throw error;
    }
  }

  public async login(input: LoginInput): Promise<AuthResult> {
    const normalizedEmail = this.normalizeEmail(input.email);
    const identity = await this.authIdentityRepository.findOneBy({
      providerType: 'local',
      providerSubject: normalizedEmail,
    });
    if (!identity || !identity.passwordHash) {
      throw new Error('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(
      input.password,
      identity.passwordHash,
    );
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    const user = await this.userRepository.findOneBy({ id: identity.userId });
    if (!user || user.status !== 'active') {
      throw new Error('User is not active');
    }

    try {
      await this.ensureDefaultWorkspaceWithSamples({
        runtimeSeedMode: LOGIN_SAMPLE_BOOTSTRAP_SEED_MODE,
      });
    } catch (error: any) {
      logger.warn(
        `Default workspace sample bootstrap skipped during login: ${
          error?.message || error
        }`,
      );
    }

    const { workspace, membership, actorClaims } =
      await this.resolveActorClaims(user, input.workspaceId);
    const { session, sessionToken } = await this.createSession(
      user.id,
      identity.id,
    );

    return {
      sessionToken,
      session,
      user,
      workspace,
      membership,
      actorClaims,
    };
  }

  public async changeLocalPassword(input: {
    userId: string;
    currentPassword: string;
    nextPassword: string;
  }): Promise<void> {
    const currentPassword = input.currentPassword;
    const nextPassword = input.nextPassword;

    if (!currentPassword || !nextPassword) {
      throw new Error('Current password and new password are required');
    }

    if (nextPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long');
    }

    const identity = await this.authIdentityRepository.findOneBy({
      userId: input.userId,
      providerType: 'local',
    });
    if (!identity || !identity.passwordHash) {
      throw new Error('Current account does not support local password change');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      identity.passwordHash,
    );
    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    const isSamePassword = await bcrypt.compare(
      nextPassword,
      identity.passwordHash,
    );
    if (isSamePassword) {
      throw new Error(
        'New password must be different from the current password',
      );
    }

    await this.authIdentityRepository.updateOne(identity.id, {
      passwordHash: await bcrypt.hash(nextPassword, 10),
      passwordAlgo: 'bcrypt',
    });
  }

  public async issueSessionForIdentity(input: {
    userId: string;
    authIdentityId: string;
    workspaceId?: string;
    impersonatorUserId?: string | null;
    impersonationReason?: string | null;
  }): Promise<AuthResult> {
    const [user, identity] = await Promise.all([
      this.userRepository.findOneBy({ id: input.userId }),
      this.authIdentityRepository.findOneBy({ id: input.authIdentityId }),
    ]);

    if (!user || user.status !== 'active') {
      throw new Error('User is not active');
    }
    if (!identity || identity.userId !== user.id) {
      throw new Error('Auth identity not found');
    }

    const { workspace, membership, actorClaims } =
      await this.resolveActorClaims(user, input.workspaceId);
    const { session, sessionToken } = await this.createSession(
      user.id,
      identity.id,
      undefined,
      {
        impersonatorUserId: input.impersonatorUserId || null,
        impersonationReason: input.impersonationReason || null,
      },
    );

    return {
      sessionToken,
      session,
      user,
      workspace,
      membership,
      actorClaims,
    };
  }

  public async validateSession(
    sessionToken: string,
    workspaceId?: string,
  ): Promise<ValidateSessionResult | null> {
    const session = await this.authSessionRepository.findOneBy({
      sessionTokenHash: this.hashSessionToken(sessionToken),
    });
    if (!session) {
      return null;
    }

    if (session.revokedAt) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      logger.debug(`Session ${session.id} expired`);
      return null;
    }

    const user = await this.userRepository.findOneBy({ id: session.userId });
    if (!user || user.status !== 'active') {
      return null;
    }

    const { workspace, membership, actorClaims } =
      await this.resolveActorClaims(user, workspaceId);

    await this.authSessionRepository.updateOne(session.id, {
      lastSeenAt: new Date(),
    });

    return {
      session,
      user,
      workspace,
      membership,
      actorClaims,
    };
  }

  public async logout(sessionToken: string): Promise<void> {
    const session = await this.authSessionRepository.findOneBy({
      sessionTokenHash: this.hashSessionToken(sessionToken),
    });
    if (!session || session.revokedAt) {
      return;
    }

    await this.authSessionRepository.updateOne(session.id, {
      revokedAt: new Date(),
    });
  }

  public async resolveActorClaims(userId: User | string, workspaceId?: string) {
    const user =
      typeof userId === 'string'
        ? await this.userRepository.findOneBy({ id: userId })
        : userId;
    if (!user) {
      throw new Error('User not found');
    }

    let membership: WorkspaceMember | null = null;

    if (workspaceId) {
      membership = await this.workspaceMemberRepository.findOneBy({
        userId: user.id,
        workspaceId,
        status: 'active',
      });
      if (!membership && (await this.hasPlatformAdminCapability(user))) {
        const adminWorkspace = await this.workspaceRepository.findOneBy({
          id: workspaceId,
        });
        if (adminWorkspace?.status === 'active') {
          membership = this.buildSyntheticPlatformAdminMembership({
            userId: user.id,
            workspaceId: adminWorkspace.id,
          });
        }
      }
    } else {
      const memberships = await this.workspaceMemberRepository.findAllBy({
        userId: user.id,
        status: 'active',
      });
      if (user.defaultWorkspaceId) {
        membership =
          memberships.find(
            (candidate) => candidate.workspaceId === user.defaultWorkspaceId,
          ) || null;
      }

      if (!membership && memberships.length > 0) {
        const workspaces = await Promise.all(
          memberships.map((candidate) =>
            this.workspaceRepository.findOneBy({ id: candidate.workspaceId }),
          ),
        );

        membership =
          memberships.find(
            (_candidate, index) =>
              workspaces[index]?.kind === WORKSPACE_KINDS.DEFAULT,
          ) ||
          memberships[0] ||
          null;
      }

      if (!membership && (await this.hasPlatformAdminCapability(user))) {
        const adminWorkspace = await this.resolvePlatformAdminWorkspace(user);
        if (adminWorkspace) {
          membership = this.buildSyntheticPlatformAdminMembership({
            userId: user.id,
            workspaceId: adminWorkspace.id,
          });
        }
      }
    }

    if (!membership && workspaceId && this.breakGlassGrantRepository) {
      const grant = await this.breakGlassGrantRepository.findActiveGrantForUser(
        workspaceId,
        user.id,
      );
      if (grant) {
        membership = {
          id: `break_glass:${grant.id}`,
          workspaceId,
          userId: user.id,
          roleKey: grant.roleKey,
          status: 'active',
          createdAt: grant.createdAt || null,
          updatedAt: grant.updatedAt || null,
        } as WorkspaceMember;
      }
    }

    if (!membership) {
      throw new Error('Active workspace membership is required');
    }

    const workspace = await this.workspaceRepository.findOneBy({
      id: membership.workspaceId,
    });
    if (!workspace || workspace.status !== 'active') {
      throw new Error('Workspace is not active');
    }

    return {
      workspace,
      membership,
      actorClaims: await this.toActorClaims(user, workspace, membership),
    };
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private async findDefaultWorkspace() {
    return (
      (await this.workspaceBootstrapService?.findDefaultWorkspace?.()) ||
      (await this.workspaceRepository.findOneBy({
        kind: WORKSPACE_KINDS.DEFAULT,
      }))
    );
  }

  private async ensureDefaultWorkspaceWithSamples(options?: {
    tx?: any;
    runtimeSeedMode?: SampleRuntimeSeedMode;
  }) {
    if (this.workspaceBootstrapService?.ensureDefaultWorkspaceWithSamples) {
      return await this.workspaceBootstrapService.ensureDefaultWorkspaceWithSamples(
        options,
      );
    }

    const workspace = await this.findDefaultWorkspace();
    if (!workspace) {
      throw new Error('Default workspace bootstrap service is required');
    }

    return workspace;
  }

  private hashSessionToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async createSession(
    userId: string,
    authIdentityId: string,
    tx?: any,
    options?: {
      impersonatorUserId?: string | null;
      impersonationReason?: string | null;
    },
  ): Promise<{ session: AuthSession; sessionToken: string }> {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const session = await this.authSessionRepository.createOne(
      {
        id: crypto.randomUUID(),
        userId,
        authIdentityId,
        sessionTokenHash: this.hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + this.sessionTtlMs),
        lastSeenAt: new Date(),
        impersonatorUserId: options?.impersonatorUserId || null,
        impersonationReason: options?.impersonationReason || null,
      },
      tx ? { tx } : undefined,
    );

    return { session, sessionToken };
  }

  private async toActorClaims(
    user: User,
    workspace: Workspace,
    membership: WorkspaceMember,
  ): Promise<ActorClaims> {
    const structuredClaims = await this.resolveStructuredActorClaims({
      user,
      workspace,
      membership,
    });

    const roleKeys =
      structuredClaims.workspaceRoleKeys.length > 0
        ? structuredClaims.workspaceRoleKeys
        : isAuthorizationBindingOnlyEnabled()
          ? []
          : [toLegacyWorkspaceRoleKey(membership.roleKey) || 'member'];

    return {
      userId: membership.userId,
      workspaceId: workspace.id,
      workspaceMemberId: membership.id,
      roleKeys,
      permissionScopes:
        roleKeys.length > 0 ? this.toPermissionScopes(roleKeys) : [],
      grantedActions: structuredClaims.grantedActions || [],
      workspaceRoleSource: structuredClaims.workspaceRoleSource,
      platformRoleSource: structuredClaims.platformRoleSource,
      platformRoleKeys: structuredClaims.platformRoleKeys,
      isPlatformAdmin: structuredClaims.isPlatformAdmin,
    };
  }

  private async resolveStructuredActorClaims({
    user,
    workspace,
    membership,
  }: {
    user: User;
    workspace: Workspace;
    membership: WorkspaceMember;
  }) {
    if (!this.principalRoleBindingRepository) {
      const platformAdminFallback = !isAuthorizationBindingOnlyEnabled()
        ? Boolean(user.isPlatformAdmin)
        : false;
      return {
        workspaceRoleKeys: isAuthorizationBindingOnlyEnabled()
          ? ([] as string[])
          : [toLegacyWorkspaceRoleKey(membership.roleKey) || 'member'],
        grantedActions: [] as string[],
        workspaceRoleSource: 'legacy' as AuthorizationRoleSource,
        platformRoleSource: 'legacy' as AuthorizationRoleSource,
        platformRoleKeys: platformAdminFallback ? ['platform_admin'] : [],
        isPlatformAdmin: platformAdminFallback,
      };
    }

    let structuredClaims = await this.loadStructuredActorClaims({
      user,
      workspace,
    });

    const needsWorkspaceBackfill =
      !this.isSyntheticWorkspaceMembership(membership) &&
      membership.status === 'active' &&
      structuredClaims.workspaceBindings.length === 0;
    const needsPlatformBackfill =
      Boolean(user.isPlatformAdmin) &&
      structuredClaims.platformBindings.length === 0;

    if (
      (needsWorkspaceBackfill || needsPlatformBackfill) &&
      this.canSyncStructuredBindings()
    ) {
      const tx = await this.userRepository.transaction();
      try {
        if (needsPlatformBackfill) {
          await syncPlatformAdminRoleBinding({
            user,
            roleRepository: this.roleRepository!,
            principalRoleBindingRepository:
              this.principalRoleBindingRepository!,
            tx,
            createdBy: user.id,
          });
        }

        if (needsWorkspaceBackfill) {
          await syncWorkspaceMemberRoleBinding({
            membership,
            roleRepository: this.roleRepository!,
            principalRoleBindingRepository:
              this.principalRoleBindingRepository!,
            tx,
            createdBy: user.id,
          });
        }

        await this.userRepository.commit(tx);
        structuredClaims = await this.loadStructuredActorClaims({
          user,
          workspace,
        });
      } catch (error) {
        await this.userRepository.rollback(tx);
        logger.warn(
          `Failed to backfill structured authorization bindings for user ${user.id} in workspace ${workspace.id}: ${String(
            error,
          )}`,
        );
      }
    }

    const {
      workspaceBindings,
      workspacePermissions,
      platformBindings,
      platformPermissions,
      groupBindings,
      groupPermissions,
    } = structuredClaims;

    const workspaceRoleKeys = toLegacyWorkspaceRoleKeys(
      [...workspaceBindings, ...groupBindings].map(
        (binding) => binding.roleName,
      ),
    );
    const platformRoleKeys = Array.from(
      new Set(
        platformBindings
          .map((binding) => binding.roleName)
          .filter(Boolean)
          .map((roleKey) => String(roleKey).trim().toLowerCase()),
      ),
    );
    const grantedActions = Array.from(
      new Set([
        ...workspacePermissions,
        ...groupPermissions,
        ...platformPermissions,
      ]),
    );
    const hasStructuredWorkspaceBindings =
      workspaceBindings.length > 0 || groupBindings.length > 0;
    const hasStructuredPlatformBindings = platformBindings.length > 0;
    if (!hasStructuredWorkspaceBindings) {
      logger.warn(
        `AuthService missing structured workspace role binding for user ${user.id} in workspace ${workspace.id}`,
      );
    }

    if (Boolean(user.isPlatformAdmin) && !hasStructuredPlatformBindings) {
      logger.warn(
        `AuthService missing structured platform role binding for user ${user.id}`,
      );
    }

    return {
      workspaceRoleKeys:
        workspaceRoleKeys.length > 0
          ? workspaceRoleKeys
          : isAuthorizationBindingOnlyEnabled()
            ? []
            : [toLegacyWorkspaceRoleKey(membership.roleKey) || 'member'],
      grantedActions,
      workspaceRoleSource: hasStructuredWorkspaceBindings
        ? ('role_binding' as AuthorizationRoleSource)
        : ('legacy' as AuthorizationRoleSource),
      platformRoleSource: hasStructuredPlatformBindings
        ? ('role_binding' as AuthorizationRoleSource)
        : ('legacy' as AuthorizationRoleSource),
      platformRoleKeys:
        platformRoleKeys.length > 0
          ? platformRoleKeys
          : !isAuthorizationBindingOnlyEnabled() && user.isPlatformAdmin
            ? ['platform_admin']
            : [],
      isPlatformAdmin:
        platformRoleKeys.includes('platform_admin') ||
        (!isAuthorizationBindingOnlyEnabled() && Boolean(user.isPlatformAdmin)),
    };
  }

  private async hasPlatformAdminCapability(user: User) {
    if (this.principalRoleBindingRepository) {
      const bindings =
        (await this.principalRoleBindingRepository.findResolvedRoleBindings({
          principalType: 'user',
          principalId: user.id,
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

    return Boolean(user.isPlatformAdmin);
  }

  private buildSyntheticPlatformAdminMembership({
    userId,
    workspaceId,
  }: {
    userId: string;
    workspaceId: string;
  }): WorkspaceMember {
    return {
      id: `platform_admin:${workspaceId}:${userId}`,
      workspaceId,
      userId,
      roleKey: 'admin',
      status: 'active',
      createdAt: null,
      updatedAt: null,
    };
  }

  private async resolvePlatformAdminWorkspace(user: User) {
    if (user.defaultWorkspaceId) {
      const defaultWorkspace = await this.workspaceRepository.findOneBy({
        id: user.defaultWorkspaceId,
      });
      if (defaultWorkspace?.status === 'active') {
        return defaultWorkspace;
      }
    }

    const defaultWorkspace = await this.findDefaultWorkspace();
    if (defaultWorkspace?.status === 'active') {
      return defaultWorkspace;
    }

    const activeWorkspaces =
      (await this.workspaceRepository.findAllBy({
        status: 'active',
      })) || [];

    return activeWorkspaces[0] || null;
  }

  private canSyncStructuredBindings() {
    return Boolean(
      this.roleRepository &&
        this.principalRoleBindingRepository &&
        typeof (this.roleRepository as any).findByNames === 'function' &&
        typeof (this.principalRoleBindingRepository as any)
          .findResolvedRoleBindings === 'function',
    );
  }

  private isSyntheticWorkspaceMembership(membership: WorkspaceMember) {
    return String(membership.id || '').startsWith('break_glass:');
  }

  private async loadStructuredActorClaims({
    user,
    workspace,
  }: {
    user: User;
    workspace: Workspace;
  }) {
    const [
      workspaceBindings,
      workspacePermissions,
      platformBindings,
      platformPermissions,
    ] = await Promise.all([
      this.principalRoleBindingRepository!.findResolvedRoleBindings({
        principalType: 'user',
        principalId: user.id,
        scopeType: 'workspace',
        scopeId: workspace.id,
      }),
      this.principalRoleBindingRepository!.findPermissionNamesByScope({
        principalType: 'user',
        principalId: user.id,
        scopeType: 'workspace',
        scopeId: workspace.id,
      }),
      this.principalRoleBindingRepository!.findResolvedRoleBindings({
        principalType: 'user',
        principalId: user.id,
        scopeType: 'platform',
        scopeId: PLATFORM_SCOPE_ID,
      }),
      this.principalRoleBindingRepository!.findPermissionNamesByScope({
        principalType: 'user',
        principalId: user.id,
        scopeType: 'platform',
        scopeId: PLATFORM_SCOPE_ID,
      }),
    ]);

    let groupBindings: Array<{ roleName: string }> = [];
    let groupPermissions: string[] = [];
    if (this.directoryGroupMemberRepository && this.directoryGroupRepository) {
      const groupMembers =
        await this.directoryGroupMemberRepository.findAllByUser(
          workspace.id,
          user.id,
        );
      const groupIds = Array.from(
        new Set(
          groupMembers.map((member) => member.directoryGroupId).filter(Boolean),
        ),
      );
      if (groupIds.length > 0) {
        const groups = await Promise.all(
          groupIds.map((groupId) =>
            this.directoryGroupRepository!.findOneBy({ id: groupId }),
          ),
        );
        const activeGroups = groups.filter(
          (group): group is NonNullable<typeof group> =>
            Boolean(
              group &&
                group.workspaceId === workspace.id &&
                group.status === 'active',
            ),
        );
        const groupResults = await Promise.all(
          activeGroups.map(async (group) => {
            const [bindings, permissions] = await Promise.all([
              this.principalRoleBindingRepository!.findResolvedRoleBindings({
                principalType: 'group',
                principalId: group.id,
                scopeType: 'workspace',
                scopeId: workspace.id,
              }),
              this.principalRoleBindingRepository!.findPermissionNamesByScope({
                principalType: 'group',
                principalId: group.id,
                scopeType: 'workspace',
                scopeId: workspace.id,
              }),
            ]);
            return { bindings, permissions };
          }),
        );
        groupBindings = groupResults.flatMap((item) => item.bindings as any);
        groupPermissions = groupResults.flatMap((item) => item.permissions);
      }
    }

    return {
      workspaceBindings,
      workspacePermissions,
      platformBindings,
      platformPermissions,
      groupBindings,
      groupPermissions,
    };
  }

  private toPermissionScopes(roleKeys: string[]) {
    const normalizedRoleKeys = roleKeys.length > 0 ? roleKeys : ['member'];
    return Array.from(
      new Set(
        normalizedRoleKeys.flatMap(
          (roleKey) =>
            ROLE_PERMISSION_SCOPES[
              toLegacyWorkspaceRoleKey(roleKey) || 'member'
            ] || ROLE_PERMISSION_SCOPES.member,
        ),
      ),
    );
  }

  private async syncStructuredBindings({
    user,
    membership,
    tx,
  }: {
    user: User;
    membership: WorkspaceMember;
    tx: any;
  }) {
    if (!this.roleRepository || !this.principalRoleBindingRepository) {
      return;
    }

    await syncPlatformAdminRoleBinding({
      user,
      roleRepository: this.roleRepository,
      principalRoleBindingRepository: this.principalRoleBindingRepository,
      tx,
      createdBy: user.id,
    });

    await syncWorkspaceMemberRoleBinding({
      membership,
      roleRepository: this.roleRepository,
      principalRoleBindingRepository: this.principalRoleBindingRepository,
      tx,
      createdBy: user.id,
    });
  }
}
