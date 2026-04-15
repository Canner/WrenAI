import { SkillService } from '../skillService';

describe('SkillService', () => {
  let workspaceRepository: any;
  let connectorRepository: any;
  let secretService: any;
  let skillDefinitionRepository: any;
  let skillMarketplaceCatalogRepository: any;
  let service: SkillService;
  const tx = { id: 'tx' };

  beforeEach(() => {
    workspaceRepository = {
      findOneBy: jest.fn(),
    };
    connectorRepository = {
      findOneBy: jest.fn(),
    };
    secretService = {
      createSecretRecord: jest.fn().mockResolvedValue({ id: 'secret-1' }),
      updateSecretRecord: jest.fn().mockResolvedValue(undefined),
      deleteSecretRecord: jest.fn().mockResolvedValue(1),
      decryptSecretRecord: jest.fn().mockResolvedValue({ apiKey: 'resolved' }),
    };
    skillDefinitionRepository = {
      transaction: jest.fn().mockResolvedValue(tx),
      commit: jest.fn(),
      rollback: jest.fn(),
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn().mockImplementation(async (payload: any) => payload),
      updateOne: jest
        .fn()
        .mockImplementation(async (_id: string, payload: any) => payload),
      deleteOne: jest.fn().mockResolvedValue(1),
    };
    skillMarketplaceCatalogRepository = {
      findAll: jest.fn(),
      findOneBy: jest.fn(),
    };

    service = new SkillService({
      workspaceRepository,
      connectorRepository,
      secretService,
      skillDefinitionRepository,
      skillMarketplaceCatalogRepository,
    });
  });

  it('creates skill definition with defaults', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    skillDefinitionRepository.findOneBy.mockResolvedValue(null);

    const skillDefinition = await service.createSkillDefinition({
      workspaceId: 'workspace-1',
      name: 'weather_skill',
      manifest: { version: '1.0.0' },
      createdBy: 'user-1',
    });

    expect(skillDefinitionRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        name: 'weather_skill',
        runtimeKind: 'isolated_python',
        sourceType: 'inline',
        manifestJson: { version: '1.0.0' },
        isEnabled: true,
        executionMode: 'inject_only',
        installedFrom: 'custom',
        secretRecordId: null,
        createdBy: 'user-1',
      }),
      { tx },
    );
    expect(skillDefinition.runtimeKind).toBe('isolated_python');
    expect(skillDefinitionRepository.commit).toHaveBeenCalledWith(tx);
  });

  it('creates skill definition and persists secret reference when secret is provided', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    skillDefinitionRepository.findOneBy.mockResolvedValue(null);

    await service.createSkillDefinition({
      workspaceId: 'workspace-1',
      name: 'weather_skill',
      secret: { apiKey: 'secret-token' },
      createdBy: 'user-1',
    });

    expect(secretService.createSecretRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        scopeType: 'skill',
        payload: { apiKey: 'secret-token' },
        createdBy: 'user-1',
      }),
      { tx },
    );
    expect(skillDefinitionRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        secretRecordId: 'secret-1',
      }),
      { tx },
    );
  });

  it('rejects duplicate skill definition names inside workspace', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    skillDefinitionRepository.findOneBy.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'weather_skill',
    });

    await expect(
      service.createSkillDefinition({
        workspaceId: 'workspace-1',
        name: 'weather_skill',
      }),
    ).rejects.toThrow(
      'Skill definition weather_skill already exists in workspace workspace-1',
    );

    expect(skillDefinitionRepository.rollback).toHaveBeenCalledWith(tx);
  });

  it('updates a skill secret and can remove it explicitly', async () => {
    skillDefinitionRepository.findOneBy.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'weather_skill',
      runtimeKind: 'isolated_python',
      sourceType: 'inline',
      secretRecordId: 'secret-1',
      createdBy: 'user-1',
    });
    skillDefinitionRepository.updateOne.mockImplementation(
      async (_id: string, payload: any) => ({
        id: 'skill-1',
        workspaceId: 'workspace-1',
        name: 'weather_skill',
        runtimeKind: 'isolated_python',
        sourceType: 'inline',
        secretRecordId: 'secret-1',
        createdBy: 'user-1',
        ...payload,
      }),
    );

    await service.updateSkillDefinition('skill-1', {
      secret: { apiKey: 'rotated' },
    });
    expect(secretService.updateSecretRecord).toHaveBeenCalledWith(
      'secret-1',
      { payload: { apiKey: 'rotated' } },
      { tx },
    );

    await service.updateSkillDefinition('skill-1', {
      secret: null,
    });
    expect(secretService.deleteSecretRecord).toHaveBeenCalledWith('secret-1', {
      tx,
    });
  });

  it('resolves skill secret for execution context', async () => {
    skillDefinitionRepository.findOneBy.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'weather_skill',
      secretRecordId: 'secret-1',
    });

    const resolved = await service.getResolvedSkillDefinition('skill-1');

    expect(secretService.decryptSecretRecord).toHaveBeenCalledWith('secret-1');
    expect(resolved).toEqual(
      expect.objectContaining({
        id: 'skill-1',
        secret: { apiKey: 'resolved' },
      }),
    );
  });

  it('lists available workspace skills via the runtime repository helper', async () => {
    skillDefinitionRepository.listAvailableSkillsByWorkspace = jest
      .fn()
      .mockResolvedValue([{ id: 'skill-1', workspaceId: 'workspace-1' }]);

    const result = await service.listAvailableSkills('workspace-1');

    expect(
      skillDefinitionRepository.listAvailableSkillsByWorkspace,
    ).toHaveBeenCalledWith('workspace-1');
    expect(result).toEqual([{ id: 'skill-1', workspaceId: 'workspace-1' }]);
  });

  it('installs marketplace skill as a workspace-owned runtime skill', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    skillMarketplaceCatalogRepository.findOneBy.mockResolvedValue({
      id: 'catalog-1',
      slug: 'sales-copilot',
      name: 'Sales Copilot',
      runtimeKind: 'isolated_python',
      sourceType: 'marketplace',
      sourceRef: 'catalog/sales-copilot',
      entrypoint: 'main.py',
      manifestJson: { version: '1.0.0' },
      defaultInstruction: '仅统计已支付订单',
      defaultExecutionMode: 'inject_only',
      isBuiltin: false,
    });
    skillDefinitionRepository.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await service.installSkillFromMarketplace({
      workspaceId: 'workspace-1',
      catalogId: 'catalog-1',
      userId: 'user-1',
    });

    expect(skillDefinitionRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        catalogId: 'catalog-1',
        name: 'Sales Copilot',
        instruction: '仅统计已支付订单',
        executionMode: 'inject_only',
        installedFrom: 'marketplace',
      }),
      { tx },
    );
    expect(result.catalogId).toBe('catalog-1');
    expect(skillDefinitionRepository.commit).toHaveBeenCalledWith(tx);
  });

  it('toggles workspace skill enabled state', async () => {
    skillDefinitionRepository.findOneBy.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      isEnabled: true,
    });
    skillDefinitionRepository.updateOne.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      isEnabled: false,
    });

    const result = await service.toggleSkillEnabled(
      'workspace-1',
      'skill-1',
      false,
    );

    expect(skillDefinitionRepository.updateOne).toHaveBeenCalledWith(
      'skill-1',
      {
        isEnabled: false,
      },
    );
    expect(result.isEnabled).toBe(false);
  });

  it('updates runtime fields on a workspace skill', async () => {
    skillDefinitionRepository.findOneBy.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      connectorId: null,
      instruction: null,
      executionMode: 'inject_only',
      isEnabled: true,
    });
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
    });
    skillDefinitionRepository.updateOne.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      connectorId: 'connector-1',
      instruction: '仅统计已支付订单',
      executionMode: 'inject_only',
      isEnabled: false,
      runtimeConfigJson: { timeoutSec: 10 },
      kbSuggestionIds: ['kb-1'],
    });

    const result = await service.updateSkillDefinitionRuntime('skill-1', {
      instruction: '仅统计已支付订单',
      connectorId: 'connector-1',
      executionMode: 'inject_only',
      isEnabled: false,
      runtimeConfig: { timeoutSec: 10 },
      kbSuggestionIds: ['kb-1'],
    });

    expect(skillDefinitionRepository.updateOne).toHaveBeenCalledWith(
      'skill-1',
      {
        instruction: '仅统计已支付订单',
        connectorId: 'connector-1',
        executionMode: 'inject_only',
        isEnabled: false,
        runtimeConfigJson: { timeoutSec: 10 },
        kbSuggestionIds: ['kb-1'],
      },
      { tx },
    );
    expect(result.executionMode).toBe('inject_only');
  });
});
