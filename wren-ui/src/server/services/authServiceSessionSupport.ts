import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getLogger } from '@server/utils';
import { AuthSession, Workspace } from '../repositories';
import {
  AuthResult,
  AuthServiceDependencies,
  BootstrapOwnerInput,
  DEFAULT_SESSION_TTL_MS,
  LOGIN_SAMPLE_BOOTSTRAP_SEED_MODE,
  LoginInput,
  RegisterLocalUserInput,
  ValidateSessionResult,
} from './authServiceTypes';
import type { SampleRuntimeSeedMode } from './workspaceBootstrapService';
import { resolveActorClaims } from './authServiceActorClaimsSupport';
import {
  syncStructuredBindings,
  toActorClaims,
} from './authServiceStructuredClaimsSupport';
import { WORKSPACE_KINDS } from '@/utils/workspaceGovernance';

const logger = getLogger('AuthService');
logger.level = 'debug';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const findDefaultWorkspace = async (
  deps: AuthServiceDependencies,
): Promise<Workspace | null> =>
  (await deps.workspaceBootstrapService?.findDefaultWorkspace?.()) ||
  (await deps.workspaceRepository.findOneBy({
    kind: WORKSPACE_KINDS.DEFAULT,
  }));

export const ensureDefaultWorkspaceWithSamples = async (
  deps: AuthServiceDependencies,
  options?: {
    tx?: any;
    runtimeSeedMode?: SampleRuntimeSeedMode;
  },
) => {
  if (deps.workspaceBootstrapService?.ensureDefaultWorkspaceWithSamples) {
    return await deps.workspaceBootstrapService.ensureDefaultWorkspaceWithSamples(
      options,
    );
  }

  const workspace = await findDefaultWorkspace(deps);
  if (!workspace) {
    throw new Error('Default workspace bootstrap service is required');
  }

  return workspace;
};

export const hashSessionToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const createSession = async ({
  userId,
  authIdentityId,
  deps,
  tx,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  options,
}: {
  userId: string;
  authIdentityId: string;
  deps: AuthServiceDependencies;
  tx?: any;
  sessionTtlMs?: number;
  options?: {
    impersonatorUserId?: string | null;
    impersonationReason?: string | null;
  };
}): Promise<{ session: AuthSession; sessionToken: string }> => {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const session = await deps.authSessionRepository.createOne(
    {
      id: crypto.randomUUID(),
      userId,
      authIdentityId,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + sessionTtlMs),
      lastSeenAt: new Date(),
      impersonatorUserId: options?.impersonatorUserId || null,
      impersonationReason: options?.impersonationReason || null,
    },
    tx ? { tx } : undefined,
  );

  return { session, sessionToken };
};

export const bootstrapOwner = async (
  input: BootstrapOwnerInput,
  deps: AuthServiceDependencies,
): Promise<AuthResult> => {
  const existingUsers = await deps.userRepository.findAll({ limit: 1 });
  if (existingUsers.length > 0) {
    throw new Error('Bootstrap is only allowed on a fresh instance');
  }

  const defaultWorkspace = await ensureDefaultWorkspaceWithSamples(deps, {
    runtimeSeedMode: 'all',
  });
  const normalizedEmail = normalizeEmail(input.email);
  const tx = await deps.userRepository.transaction();
  try {
    const user = await deps.userRepository.createOne(
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

    const identity = await deps.authIdentityRepository.createOne(
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

    const defaultMembership = await deps.workspaceMemberRepository.createOne(
      {
        id: crypto.randomUUID(),
        workspaceId: defaultWorkspace.id,
        userId: user.id,
        roleKey: 'owner',
        status: 'active',
      },
      { tx },
    );

    await syncStructuredBindings({
      user,
      membership: defaultMembership,
      tx,
      deps,
    });

    const updatedUser = await deps.userRepository.updateOne(
      user.id,
      {
        defaultWorkspaceId: defaultWorkspace.id,
      },
      { tx },
    );

    const { session, sessionToken } = await createSession({
      userId: updatedUser.id,
      authIdentityId: identity.id,
      deps,
      tx,
      sessionTtlMs: deps.sessionTtlMs,
    });

    await deps.userRepository.commit(tx);

    return {
      sessionToken,
      session,
      user: updatedUser,
      workspace: defaultWorkspace,
      membership: defaultMembership,
      actorClaims: await toActorClaims({
        user: updatedUser,
        workspace: defaultWorkspace,
        membership: defaultMembership,
        deps,
      }),
    };
  } catch (error) {
    await deps.userRepository.rollback(tx);
    throw error;
  }
};

export const registerLocalUser = async (
  input: RegisterLocalUserInput,
  deps: AuthServiceDependencies,
): Promise<AuthResult> => {
  const workspace = await ensureDefaultWorkspaceWithSamples(deps, {
    runtimeSeedMode: 'all',
  });
  if (!workspace) {
    throw new Error('Default workspace is not configured');
  }

  const normalizedEmail = normalizeEmail(input.email);
  const existingIdentity = await deps.authIdentityRepository.findOneBy({
    providerType: 'local',
    providerSubject: normalizedEmail,
  });
  if (existingIdentity) {
    throw new Error(`User ${normalizedEmail} already exists`);
  }

  const tx = await deps.userRepository.transaction();
  try {
    const user = await deps.userRepository.createOne(
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

    const identity = await deps.authIdentityRepository.createOne(
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

    const membership = await deps.workspaceMemberRepository.createOne(
      {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        userId: user.id,
        roleKey: 'member',
        status: 'active',
      },
      { tx },
    );

    await syncStructuredBindings({
      user,
      membership,
      tx,
      deps,
    });

    const { session, sessionToken } = await createSession({
      userId: user.id,
      authIdentityId: identity.id,
      deps,
      tx,
      sessionTtlMs: deps.sessionTtlMs,
    });

    await deps.userRepository.commit(tx);

    return {
      sessionToken,
      session,
      user,
      workspace,
      membership,
      actorClaims: await toActorClaims({
        user,
        workspace,
        membership,
        deps,
      }),
    };
  } catch (error) {
    await deps.userRepository.rollback(tx);
    throw error;
  }
};

export const login = async (
  input: LoginInput,
  deps: AuthServiceDependencies,
): Promise<AuthResult> => {
  const normalizedEmail = normalizeEmail(input.email);
  const identity = await deps.authIdentityRepository.findOneBy({
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

  const user = await deps.userRepository.findOneBy({ id: identity.userId });
  if (!user || user.status !== 'active') {
    throw new Error('User is not active');
  }

  try {
    await ensureDefaultWorkspaceWithSamples(deps, {
      runtimeSeedMode: LOGIN_SAMPLE_BOOTSTRAP_SEED_MODE,
    });
  } catch (error: any) {
    logger.warn(
      `Default workspace sample bootstrap skipped during login: ${
        error?.message || error
      }`,
    );
  }

  const { workspace, membership, actorClaims } = await resolveActorClaims({
    userOrId: user,
    workspaceId: input.workspaceId,
    deps,
  });
  const { session, sessionToken } = await createSession({
    userId: user.id,
    authIdentityId: identity.id,
    deps,
    sessionTtlMs: deps.sessionTtlMs,
  });

  return {
    sessionToken,
    session,
    user,
    workspace,
    membership,
    actorClaims,
  };
};

export const changeLocalPassword = async (
  input: {
    userId: string;
    currentPassword: string;
    nextPassword: string;
  },
  deps: AuthServiceDependencies,
): Promise<void> => {
  if (!input.currentPassword || !input.nextPassword) {
    throw new Error('Current password and new password are required');
  }
  if (input.nextPassword.length < 8) {
    throw new Error('New password must be at least 8 characters long');
  }

  const identity = await deps.authIdentityRepository.findOneBy({
    userId: input.userId,
    providerType: 'local',
  });
  if (!identity || !identity.passwordHash) {
    throw new Error('Current account does not support local password change');
  }

  const isCurrentPasswordValid = await bcrypt.compare(
    input.currentPassword,
    identity.passwordHash,
  );
  if (!isCurrentPasswordValid) {
    throw new Error('Current password is incorrect');
  }

  const isSamePassword = await bcrypt.compare(
    input.nextPassword,
    identity.passwordHash,
  );
  if (isSamePassword) {
    throw new Error('New password must be different from the current password');
  }

  await deps.authIdentityRepository.updateOne(identity.id, {
    passwordHash: await bcrypt.hash(input.nextPassword, 10),
    passwordAlgo: 'bcrypt',
  });
};

export const issueSessionForIdentity = async (
  input: {
    userId: string;
    authIdentityId: string;
    workspaceId?: string;
    impersonatorUserId?: string | null;
    impersonationReason?: string | null;
  },
  deps: AuthServiceDependencies,
): Promise<AuthResult> => {
  const [user, identity] = await Promise.all([
    deps.userRepository.findOneBy({ id: input.userId }),
    deps.authIdentityRepository.findOneBy({ id: input.authIdentityId }),
  ]);

  if (!user || user.status !== 'active') {
    throw new Error('User is not active');
  }
  if (!identity || identity.userId !== user.id) {
    throw new Error('Auth identity not found');
  }

  const { workspace, membership, actorClaims } = await resolveActorClaims({
    userOrId: user,
    workspaceId: input.workspaceId,
    deps,
  });
  const { session, sessionToken } = await createSession({
    userId: user.id,
    authIdentityId: identity.id,
    deps,
    sessionTtlMs: deps.sessionTtlMs,
    options: {
      impersonatorUserId: input.impersonatorUserId || null,
      impersonationReason: input.impersonationReason || null,
    },
  });

  return {
    sessionToken,
    session,
    user,
    workspace,
    membership,
    actorClaims,
  };
};

export const validateSession = async (
  sessionToken: string,
  workspaceId: string | undefined,
  deps: AuthServiceDependencies,
): Promise<ValidateSessionResult | null> => {
  const session = await deps.authSessionRepository.findOneBy({
    sessionTokenHash: hashSessionToken(sessionToken),
  });
  if (!session || session.revokedAt) {
    return null;
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    logger.debug(`Session ${session.id} expired`);
    return null;
  }

  const user = await deps.userRepository.findOneBy({ id: session.userId });
  if (!user || user.status !== 'active') {
    return null;
  }

  const { workspace, membership, actorClaims } = await resolveActorClaims({
    userOrId: user,
    workspaceId,
    deps,
  });

  await deps.authSessionRepository.updateOne(session.id, {
    lastSeenAt: new Date(),
  });

  return {
    session,
    user,
    workspace,
    membership,
    actorClaims,
  };
};

export const logout = async (
  sessionToken: string,
  deps: AuthServiceDependencies,
): Promise<void> => {
  const session = await deps.authSessionRepository.findOneBy({
    sessionTokenHash: hashSessionToken(sessionToken),
  });
  if (!session || session.revokedAt) {
    return;
  }

  await deps.authSessionRepository.updateOne(session.id, {
    revokedAt: new Date(),
  });
};
