import { SkillService } from '../skillService';

describe('SkillService', () => {
  let workspaceRepository: any;
  let knowledgeBaseRepository: any;
  let kbSnapshotRepository: any;
  let connectorRepository: any;
  let skillDefinitionRepository: any;
  let skillBindingRepository: any;
  let service: SkillService;
  const tx = { id: 'tx' };

  beforeEach(() => {
    workspaceRepository = {
      findOneBy: jest.fn(),
    };
    knowledgeBaseRepository = {
      findOneBy: jest.fn(),
    };
    kbSnapshotRepository = {
      findOneBy: jest.fn(),
    };
    connectorRepository = {
      findOneBy: jest.fn(),
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
    skillBindingRepository = {
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

    service = new SkillService({
      workspaceRepository,
      knowledgeBaseRepository,
      kbSnapshotRepository,
      connectorRepository,
      skillDefinitionRepository,
      skillBindingRepository,
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
        createdBy: 'user-1',
      }),
      { tx },
    );
    expect(skillDefinition.runtimeKind).toBe('isolated_python');
    expect(skillDefinitionRepository.commit).toHaveBeenCalledWith(tx);
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

  it('creates skill binding after validating workspace scope alignment', async () => {
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'workspace-1',
    });
    skillDefinitionRepository.findOneBy.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'weather_skill',
    });
    kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snap-1',
      knowledgeBaseId: 'kb-1',
    });
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
    });

    const skillBinding = await service.createSkillBinding({
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      skillDefinitionId: 'skill-1',
      connectorId: 'connector-1',
      bindingConfig: { timeoutSec: 30 },
      createdBy: 'user-1',
    });

    expect(skillBindingRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        skillDefinitionId: 'skill-1',
        connectorId: 'connector-1',
        bindingConfig: { timeoutSec: 30 },
        enabled: true,
        createdBy: 'user-1',
      }),
      { tx },
    );
    expect(skillBinding.enabled).toBe(true);
    expect(skillBindingRepository.commit).toHaveBeenCalledWith(tx);
  });

  it('updates skill binding and allows removing connector scope', async () => {
    skillBindingRepository.findOneBy.mockResolvedValue({
      id: 'binding-1',
      knowledgeBaseId: 'kb-1',
      skillDefinitionId: 'skill-1',
      connectorId: 'connector-1',
      enabled: true,
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'workspace-1',
    });
    skillBindingRepository.updateOne.mockImplementation(
      async (_id: string, payload: any) => ({
        id: 'binding-1',
        knowledgeBaseId: 'kb-1',
        skillDefinitionId: 'skill-1',
        ...payload,
      }),
    );

    const skillBinding = await service.updateSkillBinding('binding-1', {
      connectorId: null,
      bindingConfig: { timeoutSec: 10 },
      enabled: false,
    });

    expect(skillBindingRepository.updateOne).toHaveBeenCalledWith(
      'binding-1',
      expect.objectContaining({
        connectorId: null,
        bindingConfig: { timeoutSec: 10 },
        enabled: false,
      }),
      { tx },
    );
    expect(skillBinding.connectorId).toBeNull();
    expect(skillBinding.enabled).toBe(false);
    expect(skillBindingRepository.commit).toHaveBeenCalledWith(tx);
  });

  it('rejects binding when connector belongs to another knowledge base', async () => {
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'workspace-1',
    });
    skillDefinitionRepository.findOneBy.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
    });
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-2',
    });

    await expect(
      service.createSkillBinding({
        knowledgeBaseId: 'kb-1',
        skillDefinitionId: 'skill-1',
        connectorId: 'connector-1',
      }),
    ).rejects.toThrow(
      'Connector connector-1 does not belong to knowledge base kb-1',
    );

    expect(skillBindingRepository.rollback).toHaveBeenCalledWith(tx);
  });
});
