import { AutomationService } from '../automationService';

describe('AutomationService', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('builds a structured authorization actor with granted actions for active service accounts', async () => {
    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    const serviceAccountRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'sa-1',
        workspaceId: 'workspace-1',
        status: 'active',
        roleKey: 'member',
      }),
      updateOne: jest.fn(),
    };
    const apiTokenRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        tokenHash: 'hashed',
        status: 'active',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      updateOne: jest.fn(),
    };
    const principalRoleBindingRepository = {
      findResolvedRoleBindings: jest
        .fn()
        .mockResolvedValue([{ roleName: 'workspace_admin' }]),
      findPermissionNamesByScope: jest
        .fn()
        .mockResolvedValue(['knowledge_base.read', 'service_account.read']),
    };

    const service = new AutomationService(
      workspaceRepository as any,
      serviceAccountRepository as any,
      apiTokenRepository as any,
      undefined,
      principalRoleBindingRepository as any,
    );

    const result = await service.validateApiToken('plain-token', 'workspace-1');

    expect(result?.authorizationActor).toEqual(
      expect.objectContaining({
        principalType: 'service_account',
        principalId: 'sa-1',
        workspaceId: 'workspace-1',
        workspaceRoleKeys: ['admin', 'member'],
        workspaceRoleSource: 'role_binding',
        grantedActions: ['knowledge_base.read', 'service_account.read'],
        permissionScopes: ['workspace:workspace-1'],
      }),
    );
  });

  it('falls back to legacy permissions when structured bindings are unavailable', async () => {
    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    const serviceAccountRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'sa-1',
        workspaceId: 'workspace-1',
        status: 'active',
        roleKey: 'member',
      }),
      updateOne: jest.fn(),
    };
    const apiTokenRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        tokenHash: 'hashed',
        status: 'active',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      updateOne: jest.fn(),
    };

    const service = new AutomationService(
      workspaceRepository as any,
      serviceAccountRepository as any,
      apiTokenRepository as any,
      undefined,
      undefined,
    );

    const result = await service.validateApiToken('plain-token', 'workspace-1');

    expect(result?.authorizationActor).toEqual(
      expect.objectContaining({
        workspaceRoleKeys: ['member'],
        workspaceRoleSource: 'legacy',
        grantedActions: expect.arrayContaining([
          'workspace.read',
          'knowledge_base.read',
        ]),
      }),
    );
  });

  it('binding-only mode fails closed when service-account bindings are missing', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';

    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    const serviceAccountRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'sa-1',
        workspaceId: 'workspace-1',
        status: 'active',
        roleKey: 'member',
      }),
      updateOne: jest.fn(),
    };
    const apiTokenRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        tokenHash: 'hashed',
        status: 'active',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      updateOne: jest.fn(),
    };

    const service = new AutomationService(
      workspaceRepository as any,
      serviceAccountRepository as any,
      apiTokenRepository as any,
      undefined,
      undefined,
    );

    const result = await service.validateApiToken('plain-token', 'workspace-1');

    expect(result?.authorizationActor).toEqual(
      expect.objectContaining({
        workspaceRoleKeys: ['member'],
        workspaceRoleSource: 'role_binding',
        grantedActions: [],
      }),
    );
  });

  it('rejects API tokens bound to inactive service accounts', async () => {
    const workspaceRepository = {
      findOneBy: jest.fn(),
    };
    const serviceAccountRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'sa-1',
        workspaceId: 'workspace-1',
        status: 'inactive',
      }),
      updateOne: jest.fn(),
    };
    const apiTokenRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        tokenHash: 'hashed',
        status: 'active',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      updateOne: jest.fn(),
    };

    const service = new AutomationService(
      workspaceRepository as any,
      serviceAccountRepository as any,
      apiTokenRepository as any,
      undefined,
      undefined,
    );

    const result = await service.validateApiToken('plain-token', 'workspace-1');

    expect(result).toBeNull();
    expect(apiTokenRepository.updateOne).not.toHaveBeenCalled();
    expect(serviceAccountRepository.updateOne).not.toHaveBeenCalled();
  });

  it('rejects tokens whose stored scope does not match the workspace binding', async () => {
    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    const serviceAccountRepository = {
      findOneBy: jest.fn(),
      updateOne: jest.fn(),
    };
    const apiTokenRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        tokenHash: 'hashed',
        status: 'active',
        scopeType: 'workspace',
        scopeId: 'workspace-other',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      updateOne: jest.fn(),
    };

    const service = new AutomationService(
      workspaceRepository as any,
      serviceAccountRepository as any,
      apiTokenRepository as any,
      undefined,
      undefined,
    );

    const result = await service.validateApiToken('plain-token', 'workspace-1');

    expect(result).toBeNull();
    expect(serviceAccountRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('fails closed when structured bindings exist but resolve no permissions', async () => {
    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    const serviceAccountRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'sa-1',
        workspaceId: 'workspace-1',
        status: 'active',
        roleKey: 'admin',
      }),
      updateOne: jest.fn(),
    };
    const apiTokenRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        tokenHash: 'hashed',
        status: 'active',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      updateOne: jest.fn(),
    };
    const principalRoleBindingRepository = {
      findResolvedRoleBindings: jest
        .fn()
        .mockResolvedValue([{ roleName: 'workspace_admin' }]),
      findPermissionNamesByScope: jest.fn().mockResolvedValue([]),
    };

    const service = new AutomationService(
      workspaceRepository as any,
      serviceAccountRepository as any,
      apiTokenRepository as any,
      undefined,
      principalRoleBindingRepository as any,
    );

    const result = await service.validateApiToken('plain-token', 'workspace-1');

    expect(result?.authorizationActor).toEqual(
      expect.objectContaining({
        workspaceRoleSource: 'role_binding',
        grantedActions: [],
      }),
    );
  });

  it('rejects creating API tokens for inactive service accounts', async () => {
    const workspaceRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    };
    const serviceAccountRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'sa-1',
        workspaceId: 'workspace-1',
        status: 'inactive',
        roleKey: 'member',
      }),
      updateOne: jest.fn(),
    };
    const apiTokenRepository = {
      createOne: jest.fn(),
    };

    const service = new AutomationService(
      workspaceRepository as any,
      serviceAccountRepository as any,
      apiTokenRepository as any,
      undefined,
      undefined,
    );

    await expect(
      service.createApiToken({
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        name: 'bot token',
      }),
    ).rejects.toThrow('Service account is inactive');

    expect(apiTokenRepository.createOne).not.toHaveBeenCalled();
  });
});
