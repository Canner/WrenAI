import { getLogger } from '@server/utils';
import {
  AuthResult,
  AuthServiceDependencies,
  BootstrapOwnerInput,
  DEFAULT_SESSION_TTL_MS,
  IAuthService,
  LoginInput,
  RegisterLocalUserInput,
  ValidateSessionResult,
} from './authServiceTypes';
import {
  bootstrapOwner,
  changeLocalPassword,
  issueSessionForIdentity,
  login,
  logout,
  registerLocalUser,
  validateSession,
} from './authServiceSessionSupport';
import { resolveActorClaims } from './authServiceActorClaimsSupport';

const logger = getLogger('AuthService');
logger.level = 'debug';

export type {
  ActorClaims,
  AuthResult,
  BootstrapOwnerInput,
  LoginInput,
  RegisterLocalUserInput,
  ValidateSessionResult,
  IAuthService,
} from './authServiceTypes';

export class AuthService implements IAuthService {
  private readonly deps: AuthServiceDependencies;

  constructor(deps: AuthServiceDependencies) {
    this.deps = {
      ...deps,
      sessionTtlMs: deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    };
  }

  public async bootstrapOwner(input: BootstrapOwnerInput): Promise<AuthResult> {
    return await bootstrapOwner(input, this.deps);
  }

  public async registerLocalUser(
    input: RegisterLocalUserInput,
  ): Promise<AuthResult> {
    return await registerLocalUser(input, this.deps);
  }

  public async login(input: LoginInput): Promise<AuthResult> {
    return await login(input, this.deps);
  }

  public async changeLocalPassword(input: {
    userId: string;
    currentPassword: string;
    nextPassword: string;
  }): Promise<void> {
    return await changeLocalPassword(input, this.deps);
  }

  public async issueSessionForIdentity(input: {
    userId: string;
    authIdentityId: string;
    workspaceId?: string;
    impersonatorUserId?: string | null;
    impersonationReason?: string | null;
  }): Promise<AuthResult> {
    return await issueSessionForIdentity(input, this.deps);
  }

  public async validateSession(
    sessionToken: string,
    workspaceId?: string,
  ): Promise<ValidateSessionResult | null> {
    return await validateSession(sessionToken, workspaceId, this.deps);
  }

  public async logout(sessionToken: string): Promise<void> {
    return await logout(sessionToken, this.deps);
  }

  public async resolveActorClaims(user: any, workspaceId?: string) {
    return await resolveActorClaims({
      userOrId: user,
      workspaceId,
      deps: this.deps,
    });
  }
}
