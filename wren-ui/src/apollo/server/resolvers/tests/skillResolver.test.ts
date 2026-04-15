import { SkillResolver } from '../skillResolver';

describe('SkillResolver', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createAuthorizationActor = () => ({
    principalType: 'user',
    principalId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  it('lists skill definitions scoped to the active runtime workspace', async () => {
    const resolver = new SkillResolver();
    const listSkillDefinitionsByWorkspace = jest.fn().mockResolvedValue([
      {
        id: 'skill-1',
        workspaceId: 'workspace-1',
        name: 'Weather skill',
        runtimeKind: 'isolated_python',
        sourceType: 'inline',
        manifestJson: { entry: 'main' },
      },
    ]);
    const createOne = jest.fn();

    const result = await resolver.getSkillDefinitions(null, null, {
      runtimeScope: { workspace: { id: 'workspace-1' } },
      authorizationActor: createAuthorizationActor(),
      auditEventRepository: { createOne },
      skillService: { listSkillDefinitionsByWorkspace },
    } as any);

    expect(listSkillDefinitionsByWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skill.read',
        resourceType: 'workspace',
        resourceId: 'workspace-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_skill_definitions',
        },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'skill-1',
        name: 'Weather skill',
        manifest: { entry: 'main' },
      }),
    ]);
  });

  it('lists available skills scoped to the active runtime workspace', async () => {
    const resolver = new SkillResolver();
    const listAvailableSkills = jest.fn().mockResolvedValue([
      {
        id: 'skill-1',
        workspaceId: 'workspace-1',
        name: 'Sales Copilot',
        isEnabled: true,
      },
    ]);
    const createOne = jest.fn();

    const result = await resolver.getAvailableSkills(null, null, {
      runtimeScope: { workspace: { id: 'workspace-1' } },
      authorizationActor: createAuthorizationActor(),
      auditEventRepository: { createOne },
      skillService: { listAvailableSkills },
    } as any);

    expect(listAvailableSkills).toHaveBeenCalledWith('workspace-1');
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skill.read',
        resourceType: 'workspace',
        resourceId: 'workspace-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_available_skills',
        },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'skill-1',
        isEnabled: true,
      }),
    ]);
  });

  it('lists marketplace catalog skills', async () => {
    const resolver = new SkillResolver();
    const listMarketplaceCatalogSkills = jest.fn().mockResolvedValue([
      {
        id: 'catalog-1',
        slug: 'sales-copilot',
        name: 'Sales Copilot',
        manifestJson: { version: '1.0.0' },
      },
    ]);
    const createOne = jest.fn();

    const result = await resolver.getMarketplaceCatalogSkills(null, null, {
      runtimeScope: { workspace: { id: 'workspace-1' } },
      authorizationActor: createAuthorizationActor(),
      auditEventRepository: { createOne },
      skillService: { listMarketplaceCatalogSkills },
    } as any);

    expect(listMarketplaceCatalogSkills).toHaveBeenCalledTimes(1);
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skill.read',
        resourceType: 'workspace',
        resourceId: 'workspace-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_marketplace_catalog_skills',
        },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'catalog-1',
        manifest: { version: '1.0.0' },
      }),
    ]);
  });

  it('rejects marketplace catalog skill reads in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new SkillResolver();
    const listMarketplaceCatalogSkills = jest.fn();

    await expect(
      resolver.getMarketplaceCatalogSkills(null, null, {
        runtimeScope: { workspace: { id: 'workspace-1' } },
        authorizationActor: {
          ...createAuthorizationActor(),
          workspaceRoleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
        auditEventRepository: { createOne: jest.fn() },
        skillService: { listMarketplaceCatalogSkills },
      } as any),
    ).rejects.toThrow('Skill read permission required');

    expect(listMarketplaceCatalogSkills).not.toHaveBeenCalled();
  });

  it('rejects skill definition reads in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new SkillResolver();
    const listSkillDefinitionsByWorkspace = jest.fn();

    await expect(
      resolver.getSkillDefinitions(null, null, {
        runtimeScope: { workspace: { id: 'workspace-1' } },
        authorizationActor: {
          ...createAuthorizationActor(),
          workspaceRoleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
        auditEventRepository: { createOne: jest.fn() },
        skillService: { listSkillDefinitionsByWorkspace },
      } as any),
    ).rejects.toThrow('Skill read permission required');

    expect(listSkillDefinitionsByWorkspace).not.toHaveBeenCalled();
  });

  it('rejects updating a skill definition outside the active runtime workspace', async () => {
    const resolver = new SkillResolver();

    await expect(
      resolver.updateSkillDefinition(
        null,
        {
          where: { id: 'skill-1' },
          data: { name: 'Renamed' },
        },
        {
          runtimeScope: { workspace: { id: 'workspace-1' } },
          authorizationActor: createAuthorizationActor(),
          auditEventRepository: { createOne: jest.fn() },
          skillService: {
            getSkillDefinitionById: jest.fn().mockResolvedValue({
              id: 'skill-1',
              workspaceId: 'workspace-2',
            }),
            updateSkillDefinition: jest.fn(),
          },
        } as any,
      ),
    ).rejects.toThrow('Skill definition not found in active runtime workspace');
  });

  it('installs marketplace skill into the active runtime workspace', async () => {
    const resolver = new SkillResolver();
    const installSkillFromMarketplace = jest.fn().mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      catalogId: 'catalog-1',
      name: 'Sales Copilot',
      isEnabled: true,
    });

    const result = await resolver.installSkillFromMarketplace(
      null,
      { catalogId: 'catalog-1' },
      {
        runtimeScope: { workspace: { id: 'workspace-1' }, userId: 'user-1' },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: { createOne: jest.fn() },
        skillService: { installSkillFromMarketplace },
      } as any,
    );

    expect(installSkillFromMarketplace).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      catalogId: 'catalog-1',
      userId: 'user-1',
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'skill-1',
        catalogId: 'catalog-1',
      }),
    );
  });

  it('toggles a workspace skill enabled state', async () => {
    const resolver = new SkillResolver();
    const toggleSkillEnabled = jest.fn().mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      isEnabled: false,
    });

    const result = await resolver.toggleSkillEnabled(
      null,
      { skillDefinitionId: 'skill-1', enabled: false },
      {
        runtimeScope: { workspace: { id: 'workspace-1' } },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: { createOne: jest.fn() },
        skillService: { toggleSkillEnabled },
      } as any,
    );

    expect(toggleSkillEnabled).toHaveBeenCalledWith(
      'workspace-1',
      'skill-1',
      false,
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'skill-1',
        isEnabled: false,
      }),
    );
  });

  it('updates runtime fields for a skill in the active workspace', async () => {
    const resolver = new SkillResolver();
    const getSkillDefinitionById = jest.fn().mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
    });
    const updateSkillDefinitionRuntime = jest.fn().mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      instruction: '仅统计已支付订单',
      executionMode: 'inject_only',
      runtimeConfigJson: { timeoutSec: 10 },
    });

    const result = await resolver.updateSkillDefinitionRuntime(
      null,
      {
        where: { id: 'skill-1' },
        data: {
          instruction: '仅统计已支付订单',
          executionMode: 'inject_only',
          runtimeConfig: { timeoutSec: 10 },
        },
      },
      {
        runtimeScope: { workspace: { id: 'workspace-1' } },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: { createOne: jest.fn() },
        skillService: {
          getSkillDefinitionById,
          updateSkillDefinitionRuntime,
        },
      } as any,
    );

    expect(getSkillDefinitionById).toHaveBeenCalledWith('skill-1');
    expect(updateSkillDefinitionRuntime).toHaveBeenCalledWith('skill-1', {
      instruction: '仅统计已支付订单',
      executionMode: 'inject_only',
      runtimeConfig: { timeoutSec: 10 },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'skill-1',
        instruction: '仅统计已支付订单',
        executionMode: 'inject_only',
        runtimeConfig: { timeoutSec: 10 },
      }),
    );
  });
});
