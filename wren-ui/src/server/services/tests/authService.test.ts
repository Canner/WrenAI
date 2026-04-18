import bcrypt from 'bcryptjs';
import { AuthService } from '../authService';

describe('AuthService', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;
  let service: AuthService;
  let userRepository: any;
  let authIdentityRepository: any;
  let authSessionRepository: any;
  let workspaceRepository: any;
  let workspaceMemberRepository: any;
  let workspaceBootstrapService: any;
  const tx = { id: 'tx' };

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    userRepository = {
      findAll: jest.fn(),
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      transaction: jest.fn().mockResolvedValue(tx),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    authIdentityRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    authSessionRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    workspaceRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
    };
    workspaceMemberRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn(),
    };
    workspaceBootstrapService = {
      findDefaultWorkspace: jest.fn(),
      ensureDefaultWorkspaceWithSamples: jest.fn(),
    };

    service = new AuthService({
      userRepository,
      authIdentityRepository,
      authSessionRepository,
      workspaceRepository,
      workspaceMemberRepository,
      workspaceBootstrapService,
      sessionTtlMs: 60_000,
    });
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('prefers structured role bindings when resolving actor claims', async () => {
    const principalRoleBindingRepository = {
      findResolvedRoleBindings: jest
        .fn()
        .mockResolvedValueOnce([
          {
            roleName: 'workspace_admin',
          },
        ])
        .mockResolvedValueOnce([
          {
            roleName: 'platform_admin',
          },
        ]),
      findPermissionNamesByScope: jest
        .fn()
        .mockResolvedValueOnce([
          'workspace.read',
          'knowledge_base.read',
          'knowledge_base.update',
        ])
        .mockResolvedValueOnce(['workspace.create']),
    };
    const structuredService = new AuthService({
      userRepository,
      authIdentityRepository,
      authSessionRepository,
      workspaceRepository,
      workspaceMemberRepository,
      workspaceBootstrapService,
      principalRoleBindingRepository: principalRoleBindingRepository as any,
      roleRepository: {} as any,
      sessionTtlMs: 60_000,
    });

    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      email: 'member@example.com',
      displayName: 'Member',
      status: 'active',
      isPlatformAdmin: false,
    });
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'active',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-1',
      name: 'Demo',
      status: 'active',
    });

    const result = await structuredService.resolveActorClaims(
      'user-1',
      'workspace-1',
    );

    expect(result.actorClaims.roleKeys).toEqual(['admin']);
    expect(result.actorClaims.workspaceRoleSource).toBe('role_binding');
    expect(result.actorClaims.platformRoleSource).toBe('role_binding');
    expect(result.actorClaims.platformRoleKeys).toEqual(['platform_admin']);
    expect(result.actorClaims.isPlatformAdmin).toBe(true);
    expect(result.actorClaims.grantedActions).toEqual(
      expect.arrayContaining([
        'workspace.read',
        'knowledge_base.update',
        'workspace.create',
      ]),
    );
  });

  it('backfills missing structured bindings before falling back to legacy claims', async () => {
    const principalRoleBindingRepository = {
      findResolvedRoleBindings: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            roleName: 'workspace_owner',
          },
        ])
        .mockResolvedValueOnce([
          {
            roleName: 'platform_admin',
          },
        ]),
      findPermissionNamesByScope: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['workspace.read', 'workspace.member.invite'])
        .mockResolvedValueOnce(['workspace.create']),
      deleteByScope: jest.fn().mockResolvedValue(1),
      createOne: jest.fn().mockImplementation(async (payload: any) => payload),
    };
    const roleRepository = {
      findByNames: jest.fn().mockImplementation(async (names: string[]) =>
        names.map((name) => ({
          id: `role-${name}`,
          name,
          scopeType: name === 'platform_admin' ? 'platform' : 'workspace',
        })),
      ),
    };
    const structuredService = new AuthService({
      userRepository,
      authIdentityRepository,
      authSessionRepository,
      workspaceRepository,
      workspaceMemberRepository,
      workspaceBootstrapService,
      principalRoleBindingRepository: principalRoleBindingRepository as any,
      roleRepository: roleRepository as any,
      sessionTtlMs: 60_000,
    });

    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      status: 'active',
      isPlatformAdmin: true,
    });
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-1',
      name: 'Demo',
      status: 'active',
    });

    const result = await structuredService.resolveActorClaims(
      'user-1',
      'workspace-1',
    );

    expect(principalRoleBindingRepository.deleteByScope).toHaveBeenCalledTimes(
      2,
    );
    expect(principalRoleBindingRepository.createOne).toHaveBeenCalledTimes(2);
    expect(roleRepository.findByNames).toHaveBeenCalledTimes(2);
    expect(result.actorClaims.workspaceRoleSource).toBe('role_binding');
    expect(result.actorClaims.platformRoleSource).toBe('role_binding');
    expect(result.actorClaims.roleKeys).toEqual(['owner']);
    expect(result.actorClaims.platformRoleKeys).toEqual(['platform_admin']);
    expect(result.actorClaims.grantedActions).toEqual(
      expect.arrayContaining(['workspace.member.invite', 'workspace.create']),
    );
  });

  it('binding-only mode stops granting legacy session claims when bindings are missing', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';

    const principalRoleBindingRepository = {
      findResolvedRoleBindings: jest.fn().mockResolvedValue([]),
      findPermissionNamesByScope: jest.fn().mockResolvedValue([]),
      deleteByScope: jest.fn().mockResolvedValue(0),
      createOne: jest.fn(),
    };
    const roleRepository = {
      findByNames: jest.fn().mockResolvedValue([
        {
          id: 'role-platform-admin',
          name: 'platform_admin',
          scopeType: 'platform',
        },
      ]),
    };
    const bindingOnlyService = new AuthService({
      userRepository,
      authIdentityRepository,
      authSessionRepository,
      workspaceRepository,
      workspaceMemberRepository,
      workspaceBootstrapService,
      principalRoleBindingRepository: principalRoleBindingRepository as any,
      roleRepository: roleRepository as any,
      sessionTtlMs: 60_000,
    });

    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      status: 'active',
      isPlatformAdmin: true,
    });
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-1',
      name: 'Demo',
      status: 'active',
    });

    const result = await bindingOnlyService.resolveActorClaims(
      'user-1',
      'workspace-1',
    );

    expect(result.actorClaims.roleKeys).toEqual([]);
    expect(result.actorClaims.workspaceRoleSource).toBe('legacy');
    expect(result.actorClaims.platformRoleSource).toBe('legacy');
    expect(result.actorClaims.platformRoleKeys).toEqual([]);
    expect(result.actorClaims.isPlatformAdmin).toBe(false);
    expect(result.actorClaims.permissionScopes).toEqual([]);
    expect(result.actorClaims.grantedActions).toEqual([]);
    expect(principalRoleBindingRepository.deleteByScope).toHaveBeenCalledWith(
      {
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'platform',
        scopeId: '',
      },
      { tx },
    );
    expect(principalRoleBindingRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'platform',
        scopeId: '',
      }),
      { tx },
    );
    expect(roleRepository.findByNames).toHaveBeenCalledWith(
      ['platform_admin'],
      { tx },
    );
  });

  it('bootstraps owner on a fresh instance', async () => {
    userRepository.findAll.mockResolvedValue([]);
    workspaceBootstrapService.ensureDefaultWorkspaceWithSamples.mockResolvedValue(
      {
        id: 'workspace-default',
        slug: 'system-samples',
        name: '系统样例空间',
        kind: 'default',
        status: 'active',
      },
    );
    userRepository.createOne.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      status: 'active',
      isPlatformAdmin: true,
      defaultWorkspaceId: null,
    });
    userRepository.updateOne = jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      status: 'active',
      isPlatformAdmin: true,
      defaultWorkspaceId: 'workspace-default',
    });
    authIdentityRepository.createOne.mockImplementation(
      async (payload: any) => ({
        ...payload,
      }),
    );
    workspaceMemberRepository.createOne.mockResolvedValueOnce({
      id: 'member-1',
      workspaceId: 'workspace-default',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
    });
    authSessionRepository.createOne.mockImplementation(
      async (payload: any) => ({
        ...payload,
      }),
    );

    const result = await service.bootstrapOwner({
      email: 'Owner@Example.com',
      password: 's3cret',
      displayName: 'Owner',
    });

    expect(result.user.email).toBe('owner@example.com');
    expect(result.user.defaultWorkspaceId).toBe('workspace-default');
    expect(result.workspace.id).toBe('workspace-default');
    expect(result.membership.workspaceId).toBe('workspace-default');
    expect(result.actorClaims.roleKeys).toEqual(['owner']);
    expect(result.actorClaims.workspaceId).toBe('workspace-default');
    expect(result.sessionToken).toHaveLength(64);
    expect(userRepository.commit).toHaveBeenCalledWith(tx);
    expect(
      workspaceBootstrapService.ensureDefaultWorkspaceWithSamples,
    ).toHaveBeenCalledWith({ runtimeSeedMode: 'all' });
    expect(workspaceRepository.createOne).not.toHaveBeenCalled();
    const identityPayload = authIdentityRepository.createOne.mock.calls[0][0];
    await expect(
      bcrypt.compare('s3cret', identityPayload.passwordHash),
    ).resolves.toBe(true);
  });

  it('logs in a local user and returns actor claims', async () => {
    const passwordHash = await bcrypt.hash('passw0rd', 10);
    workspaceBootstrapService.ensureDefaultWorkspaceWithSamples.mockResolvedValue(
      {
        id: 'workspace-default',
        name: '系统样例空间',
        kind: 'default',
        status: 'active',
      },
    );
    authIdentityRepository.findOneBy.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      providerType: 'local',
      providerSubject: 'member@example.com',
      passwordHash,
    });
    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      email: 'member@example.com',
      displayName: 'Member',
      status: 'active',
    });
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'active',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-1',
      slug: 'demo',
      name: 'Demo',
      status: 'active',
    });
    authSessionRepository.createOne.mockImplementation(
      async (payload: any) => ({
        ...payload,
      }),
    );

    const result = await service.login({
      email: 'member@example.com',
      password: 'passw0rd',
      workspaceId: 'workspace-1',
    });

    expect(result.user.id).toBe('user-1');
    expect(result.workspace.id).toBe('workspace-1');
    expect(result.actorClaims.permissionScopes).toContain(
      'knowledge_base:read',
    );
    expect(
      workspaceBootstrapService.ensureDefaultWorkspaceWithSamples,
    ).toHaveBeenCalledWith({ runtimeSeedMode: 'all' });
  });

  it('registers a local user into the default workspace', async () => {
    workspaceBootstrapService.ensureDefaultWorkspaceWithSamples.mockResolvedValue(
      {
        id: 'workspace-default',
        name: '系统样例空间',
        kind: 'default',
        status: 'active',
      },
    );
    authIdentityRepository.findOneBy.mockResolvedValue(null);
    userRepository.createOne.mockResolvedValue({
      id: 'user-2',
      email: 'member@example.com',
      displayName: 'Member',
      status: 'active',
      defaultWorkspaceId: 'workspace-default',
    });
    authIdentityRepository.createOne.mockImplementation(
      async (payload: any) => ({
        ...payload,
      }),
    );
    workspaceMemberRepository.createOne.mockResolvedValue({
      id: 'member-2',
      workspaceId: 'workspace-default',
      userId: 'user-2',
      roleKey: 'member',
      status: 'active',
    });
    authSessionRepository.createOne.mockImplementation(
      async (payload: any) => ({
        ...payload,
      }),
    );

    const result = await service.registerLocalUser({
      email: 'member@example.com',
      password: 'passw0rd',
      displayName: 'Member',
    });

    expect(result.workspace.id).toBe('workspace-default');
    expect(result.membership.roleKey).toBe('member');
    expect(result.user.defaultWorkspaceId).toBe('workspace-default');
    expect(
      workspaceBootstrapService.ensureDefaultWorkspaceWithSamples,
    ).toHaveBeenCalledWith({ runtimeSeedMode: 'all' });
  });

  it('revokes a session on logout', async () => {
    authSessionRepository.findOneBy.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
    });

    await service.logout('plain-session-token');

    expect(authSessionRepository.updateOne).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  it('changes local password after verifying the current password', async () => {
    authIdentityRepository.findOneBy.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      providerType: 'local',
      passwordHash: await bcrypt.hash('passw0rd', 10),
    });
    authIdentityRepository.updateOne.mockImplementation(
      async (_id: string, payload: any) => payload,
    );

    await service.changeLocalPassword({
      userId: 'user-1',
      currentPassword: 'passw0rd',
      nextPassword: 'new-secret-1',
    });

    expect(authIdentityRepository.updateOne).toHaveBeenCalledWith(
      'identity-1',
      expect.objectContaining({
        passwordAlgo: 'bcrypt',
        passwordHash: expect.any(String),
      }),
    );
    await expect(
      bcrypt.compare(
        'new-secret-1',
        authIdentityRepository.updateOne.mock.calls[0][1].passwordHash,
      ),
    ).resolves.toBe(true);
  });

  it('rejects password change when current password is incorrect', async () => {
    authIdentityRepository.findOneBy.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      providerType: 'local',
      passwordHash: await bcrypt.hash('passw0rd', 10),
    });

    await expect(
      service.changeLocalPassword({
        userId: 'user-1',
        currentPassword: 'wrong-password',
        nextPassword: 'new-secret-1',
      }),
    ).rejects.toThrow('Current password is incorrect');
    expect(authIdentityRepository.updateOne).not.toHaveBeenCalled();
  });

  it('builds a synthetic workspace membership for platform admin', async () => {
    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      status: 'active',
      isPlatformAdmin: true,
      defaultWorkspaceId: 'workspace-1',
    });
    workspaceMemberRepository.findOneBy.mockResolvedValue(null);
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-2',
      name: 'Tenant Workspace',
      status: 'active',
    });

    const result = await service.resolveActorClaims('user-1', 'workspace-2');

    expect(result.workspace.id).toBe('workspace-2');
    expect(result.membership).toEqual(
      expect.objectContaining({
        id: 'platform_admin:workspace-2:user-1',
        workspaceId: 'workspace-2',
        roleKey: 'admin',
        status: 'active',
      }),
    );
  });
});
