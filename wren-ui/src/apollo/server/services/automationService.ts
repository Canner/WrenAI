import crypto from 'crypto';
import {
  ApiToken,
  IApiTokenRepository,
  IPrincipalRoleBindingRepository,
  IRoleRepository,
  IServiceAccountRepository,
  IWorkspaceRepository,
  ServiceAccount,
} from '@server/repositories';
import {
  AuthorizationActor,
  syncWorkspaceScopedRoleBinding,
  toLegacyWorkspaceRoleKeys,
} from '@server/authz';

const DEFAULT_TOKEN_TTL_DAYS = 30;

export interface CreateServiceAccountInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  roleKey?: string;
  createdBy?: string | null;
}

export interface UpdateServiceAccountInput {
  workspaceId: string;
  serviceAccountId: string;
  name?: string;
  description?: string | null;
  roleKey?: string;
  status?: string;
  updatedBy?: string | null;
}

export interface CreateApiTokenInput {
  workspaceId: string;
  serviceAccountId: string;
  name: string;
  expiresAt?: Date | string | null;
  createdBy?: string | null;
}

export interface ValidatedApiToken {
  token: ApiToken;
  serviceAccount: ServiceAccount;
  workspaceId: string;
  authorizationActor: AuthorizationActor;
}

export interface IAutomationService {
  listServiceAccounts(workspaceId: string): Promise<ServiceAccount[]>;
  createServiceAccount(
    input: CreateServiceAccountInput,
  ): Promise<ServiceAccount>;
  updateServiceAccount(
    input: UpdateServiceAccountInput,
  ): Promise<ServiceAccount>;
  deleteServiceAccount(
    workspaceId: string,
    serviceAccountId: string,
  ): Promise<void>;
  listApiTokens(input: {
    workspaceId: string;
    serviceAccountId?: string;
  }): Promise<ApiToken[]>;
  createApiToken(input: CreateApiTokenInput): Promise<{
    token: ApiToken;
    plainTextToken: string;
  }>;
  revokeApiToken(input: {
    workspaceId: string;
    tokenId: string;
    revokedBy?: string | null;
  }): Promise<ApiToken>;
  validateApiToken(
    rawToken: string,
    workspaceId?: string | null,
  ): Promise<ValidatedApiToken | null>;
}

const normalizeRoleKey = (roleKey?: string | null) =>
  String(roleKey || 'admin')
    .trim()
    .toLowerCase();

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

const buildPlainTextToken = () => {
  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(24).toString('hex');
  return {
    prefix,
    token: `wren_pat_${prefix}${secret}`,
  };
};

const defaultExpiry = () =>
  new Date(Date.now() + DEFAULT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

export class AutomationService implements IAutomationService {
  constructor(
    private readonly workspaceRepository: IWorkspaceRepository,
    private readonly serviceAccountRepository: IServiceAccountRepository,
    private readonly apiTokenRepository: IApiTokenRepository,
    private readonly roleRepository?: IRoleRepository,
    private readonly principalRoleBindingRepository?: IPrincipalRoleBindingRepository,
  ) {}

  public async listServiceAccounts(workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    return this.serviceAccountRepository.findAllBy(
      { workspaceId },
      { order: 'created_at desc' },
    );
  }

  public async createServiceAccount(input: CreateServiceAccountInput) {
    await this.requireWorkspace(input.workspaceId);
    const tx = await this.serviceAccountRepository.transaction();

    try {
      const serviceAccount = await this.serviceAccountRepository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          name: input.name.trim(),
          description: input.description || null,
          roleKey: normalizeRoleKey(input.roleKey),
          status: 'active',
          createdBy: input.createdBy || null,
        },
        { tx },
      );

      await this.syncRoleBinding({
        serviceAccount,
        tx,
        createdBy: input.createdBy || null,
      });

      await this.serviceAccountRepository.commit(tx);
      return serviceAccount;
    } catch (error) {
      await this.serviceAccountRepository.rollback(tx);
      throw error;
    }
  }

  public async updateServiceAccount(input: UpdateServiceAccountInput) {
    const existing = await this.requireServiceAccount(
      input.workspaceId,
      input.serviceAccountId,
    );
    const tx = await this.serviceAccountRepository.transaction();

    try {
      const updated = await this.serviceAccountRepository.updateOne(
        existing.id,
        {
          name: input.name?.trim() || existing.name,
          description:
            input.description === undefined
              ? existing.description || null
              : input.description,
          roleKey:
            input.roleKey === undefined
              ? existing.roleKey
              : normalizeRoleKey(input.roleKey),
          status: input.status || existing.status,
        },
        { tx },
      );

      await this.syncRoleBinding({
        serviceAccount: updated,
        tx,
        createdBy: input.updatedBy || existing.createdBy || null,
      });

      await this.serviceAccountRepository.commit(tx);
      return updated;
    } catch (error) {
      await this.serviceAccountRepository.rollback(tx);
      throw error;
    }
  }

  public async deleteServiceAccount(
    workspaceId: string,
    serviceAccountId: string,
  ) {
    await this.requireServiceAccount(workspaceId, serviceAccountId);
    await this.serviceAccountRepository.deleteOne(serviceAccountId);
    if (this.principalRoleBindingRepository) {
      await this.principalRoleBindingRepository.deleteByScope({
        principalType: 'service_account',
        principalId: serviceAccountId,
        scopeType: 'workspace',
        scopeId: workspaceId,
      });
    }
  }

  public async listApiTokens(input: {
    workspaceId: string;
    serviceAccountId?: string;
  }) {
    await this.requireWorkspace(input.workspaceId);
    if (input.serviceAccountId) {
      await this.requireServiceAccount(
        input.workspaceId,
        input.serviceAccountId,
      );
    }
    return this.apiTokenRepository.findAllBy(
      {
        workspaceId: input.workspaceId,
        ...(input.serviceAccountId
          ? { serviceAccountId: input.serviceAccountId }
          : {}),
      },
      { order: 'created_at desc' },
    );
  }

  public async createApiToken(input: CreateApiTokenInput) {
    const serviceAccount = await this.requireServiceAccount(
      input.workspaceId,
      input.serviceAccountId,
    );
    if (serviceAccount.status !== 'active') {
      throw new Error('Service account is inactive');
    }
    const plainText = buildPlainTextToken();
    const token = await this.apiTokenRepository.createOne({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      serviceAccountId: serviceAccount.id,
      name: input.name.trim(),
      prefix: plainText.prefix,
      tokenHash: hashToken(plainText.token),
      scopeType: 'workspace',
      scopeId: input.workspaceId,
      expiresAt: input.expiresAt || defaultExpiry(),
      status: 'active',
      createdBy: input.createdBy || null,
    });

    return {
      token,
      plainTextToken: plainText.token,
    };
  }

  public async revokeApiToken(input: {
    workspaceId: string;
    tokenId: string;
    revokedBy?: string | null;
  }) {
    const token = await this.requireApiToken(input.workspaceId, input.tokenId);
    return this.apiTokenRepository.updateOne(token.id, {
      revokedAt: new Date(),
      status: 'revoked',
      metadata: {
        ...(token.metadata || {}),
        revokedBy: input.revokedBy || null,
      },
    });
  }

  public async validateApiToken(rawToken: string, workspaceId?: string | null) {
    if (!rawToken) {
      return null;
    }

    const token = await this.apiTokenRepository.findOneBy({
      tokenHash: hashToken(rawToken),
    });
    if (!token || token.revokedAt || token.status !== 'active') {
      return null;
    }

    if (
      token.scopeType !== 'workspace' ||
      !token.scopeId ||
      token.scopeId !== token.workspaceId
    ) {
      return null;
    }

    if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    if (workspaceId && token.workspaceId !== workspaceId) {
      return null;
    }

    if (!token.serviceAccountId) {
      return null;
    }

    const serviceAccount = await this.serviceAccountRepository.findOneBy({
      id: token.serviceAccountId,
    });
    if (
      !serviceAccount ||
      serviceAccount.workspaceId !== token.workspaceId ||
      serviceAccount.status !== 'active'
    ) {
      return null;
    }

    await Promise.all([
      this.apiTokenRepository.updateOne(token.id, {
        lastUsedAt: new Date(),
      }),
      this.serviceAccountRepository.updateOne(serviceAccount.id, {
        lastUsedAt: new Date(),
      }),
    ]);

    const scope = {
      principalType: 'service_account',
      principalId: serviceAccount.id,
      scopeType: 'workspace',
      scopeId: serviceAccount.workspaceId,
    } as const;
    const [bindings, permissions] = await Promise.all([
      this.principalRoleBindingRepository?.findResolvedRoleBindings(scope) ||
        [],
      this.principalRoleBindingRepository?.findPermissionNamesByScope(scope) ||
        [],
    ]);

    const boundRoleKeys = Array.from(
      new Set(
        bindings
          .map((binding) =>
            String(binding.roleName || '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    );
    const legacyRoleKeys = toLegacyWorkspaceRoleKeys(boundRoleKeys);
    const hasStructuredBindings = bindings.length > 0 || permissions.length > 0;
    const grantedActions = Array.from(new Set(permissions));

    const authorizationActor: AuthorizationActor = {
      principalType: 'service_account',
      principalId: serviceAccount.id,
      workspaceId: serviceAccount.workspaceId,
      workspaceMemberId: null,
      workspaceRoleKeys: legacyRoleKeys,
      permissionScopes: [`workspace:${serviceAccount.workspaceId}`],
      isPlatformAdmin: false,
      platformRoleKeys: [],
      grantedActions,
      workspaceRoleSource: hasStructuredBindings
        ? 'role_binding'
        : 'legacy',
      platformRoleSource: 'legacy',
      sessionId: null,
    };

    return {
      token,
      serviceAccount,
      workspaceId: serviceAccount.workspaceId,
      authorizationActor,
    };
  }

  private async requireWorkspace(workspaceId: string) {
    const workspace = await this.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    return workspace;
  }

  private async requireServiceAccount(
    workspaceId: string,
    serviceAccountId: string,
  ) {
    const serviceAccount = await this.serviceAccountRepository.findOneBy({
      id: serviceAccountId,
    });
    if (!serviceAccount || serviceAccount.workspaceId !== workspaceId) {
      throw new Error('Service account not found');
    }

    return serviceAccount;
  }

  private async requireApiToken(workspaceId: string, tokenId: string) {
    const token = await this.apiTokenRepository.findOneBy({ id: tokenId });
    if (!token || token.workspaceId !== workspaceId) {
      throw new Error('API token not found');
    }

    return token;
  }

  private async syncRoleBinding({
    serviceAccount,
    tx,
    createdBy,
  }: {
    serviceAccount: ServiceAccount;
    tx: any;
    createdBy?: string | null;
  }) {
    if (!this.roleRepository || !this.principalRoleBindingRepository) {
      return;
    }

    await syncWorkspaceScopedRoleBinding({
      principalType: 'service_account',
      principalId: serviceAccount.id,
      workspaceId: serviceAccount.workspaceId,
      roleKey: serviceAccount.roleKey,
      isActive: serviceAccount.status === 'active',
      roleRepository: this.roleRepository,
      principalRoleBindingRepository: this.principalRoleBindingRepository,
      tx,
      createdBy: createdBy || serviceAccount.createdBy || null,
    });
  }
}
