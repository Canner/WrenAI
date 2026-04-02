import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getLogger } from '@server/utils';
import {
  AuthIdentity,
  AuthSession,
  IAuthIdentityRepository,
  IAuthSessionRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  User,
  Workspace,
  WorkspaceMember,
} from '../repositories';

const logger = getLogger('AuthService');
logger.level = 'debug';

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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
  workspaceName: string;
  workspaceSlug?: string;
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
  workspaceId: string;
  roleKey?: string;
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
  validateSession(
    sessionToken: string,
    workspaceId?: string,
  ): Promise<ValidateSessionResult | null>;
  logout(sessionToken: string): Promise<void>;
  resolveActorClaims(
    userId: string,
    workspaceId?: string,
  ): Promise<Pick<AuthResult, 'workspace' | 'membership' | 'actorClaims'>>;
}

export class AuthService implements IAuthService {
  private userRepository: IUserRepository;
  private authIdentityRepository: IAuthIdentityRepository;
  private authSessionRepository: IAuthSessionRepository;
  private workspaceRepository: IWorkspaceRepository;
  private workspaceMemberRepository: IWorkspaceMemberRepository;
  private sessionTtlMs: number;

  constructor({
    userRepository,
    authIdentityRepository,
    authSessionRepository,
    workspaceRepository,
    workspaceMemberRepository,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  }: {
    userRepository: IUserRepository;
    authIdentityRepository: IAuthIdentityRepository;
    authSessionRepository: IAuthSessionRepository;
    workspaceRepository: IWorkspaceRepository;
    workspaceMemberRepository: IWorkspaceMemberRepository;
    sessionTtlMs?: number;
  }) {
    this.userRepository = userRepository;
    this.authIdentityRepository = authIdentityRepository;
    this.authSessionRepository = authSessionRepository;
    this.workspaceRepository = workspaceRepository;
    this.workspaceMemberRepository = workspaceMemberRepository;
    this.sessionTtlMs = sessionTtlMs;
  }

  public async bootstrapOwner(input: BootstrapOwnerInput): Promise<AuthResult> {
    const existingUsers = await this.userRepository.findAll({ limit: 1 });
    if (existingUsers.length > 0) {
      throw new Error('Bootstrap is only allowed on a fresh instance');
    }

    const normalizedEmail = this.normalizeEmail(input.email);
    const tx = await this.userRepository.transaction();
    try {
      const workspace = await this.workspaceRepository.createOne(
        {
          id: crypto.randomUUID(),
          slug: await this.ensureUniqueWorkspaceSlug(
            input.workspaceSlug || input.workspaceName,
            tx,
          ),
          name: input.workspaceName,
          status: 'active',
        },
        { tx },
      );

      const user = await this.userRepository.createOne(
        {
          id: crypto.randomUUID(),
          email: normalizedEmail,
          displayName: input.displayName,
          locale: input.locale || 'en-US',
          status: 'active',
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
          roleKey: 'owner',
          status: 'active',
        },
        { tx },
      );

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
        actorClaims: this.toActorClaims(workspace, membership),
      };
    } catch (error) {
      await this.userRepository.rollback(tx);
      throw error;
    }
  }

  public async registerLocalUser(
    input: RegisterLocalUserInput,
  ): Promise<AuthResult> {
    const workspace = await this.workspaceRepository.findOneBy({
      id: input.workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${input.workspaceId} not found`);
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
          roleKey: input.roleKey || 'member',
          status: 'active',
        },
        { tx },
      );

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
        actorClaims: this.toActorClaims(workspace, membership),
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

    const { workspace, membership, actorClaims } = await this.resolveActorClaims(
      user.id,
      input.workspaceId,
    );
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

    const { workspace, membership, actorClaims } = await this.resolveActorClaims(
      user.id,
      workspaceId,
    );

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

  public async resolveActorClaims(userId: string, workspaceId?: string) {
    let membership: WorkspaceMember | null = null;

    if (workspaceId) {
      membership = await this.workspaceMemberRepository.findOneBy({
        userId,
        workspaceId,
        status: 'active',
      });
    } else {
      const memberships = await this.workspaceMemberRepository.findAllBy({
        userId,
        status: 'active',
      });
      membership = memberships[0] || null;
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
      actorClaims: this.toActorClaims(workspace, membership),
    };
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private hashSessionToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async createSession(
    userId: string,
    authIdentityId: string,
    tx?: any,
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
      },
      tx ? { tx } : undefined,
    );

    return { session, sessionToken };
  }

  private async ensureUniqueWorkspaceSlug(candidate: string, tx?: any) {
    const baseSlug = candidate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace';

    let slug = baseSlug;
    let suffix = 2;
    while (
      await this.workspaceRepository.findOneBy(
        { slug },
        tx ? { tx } : undefined,
      )
    ) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private toActorClaims(
    workspace: Workspace,
    membership: WorkspaceMember,
  ): ActorClaims {
    const permissionScopes = ROLE_PERMISSION_SCOPES[membership.roleKey] ||
      ROLE_PERMISSION_SCOPES.member;

    return {
      userId: membership.userId,
      workspaceId: workspace.id,
      workspaceMemberId: membership.id,
      roleKeys: [membership.roleKey],
      permissionScopes,
    };
  }
}
