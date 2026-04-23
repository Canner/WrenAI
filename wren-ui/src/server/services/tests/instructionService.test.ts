import { InstructionService } from '../instructionService';

describe('InstructionService', () => {
  const createService = () => {
    const tx = { commit: jest.fn(), rollback: jest.fn() };
    const instructionRepository = {
      transaction: jest.fn().mockResolvedValue(tx),
      findAllByRuntimeIdentity: jest.fn(),
      findOneByIdWithRuntimeIdentity: jest.fn(),
      createOne: jest.fn(),
      createMany: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    } as any;
    const wrenAIAdaptor = {
      generateInstruction: jest.fn().mockResolvedValue({ queryId: 'query-1' }),
      deleteInstructions: jest.fn().mockResolvedValue(undefined),
      getInstructionResult: jest.fn(),
    } as any;
    const service = new InstructionService({
      instructionRepository,
      wrenAIAdaptor,
    }) as any;
    service.waitDeployInstruction = jest.fn().mockResolvedValue({});

    return { service, instructionRepository, wrenAIAdaptor, tx };
  };

  it('lists instructions with deployHash-only runtime identity', async () => {
    const { service, instructionRepository } = createService();
    instructionRepository.findAllByRuntimeIdentity.mockResolvedValue([]);

    await service.listInstructions({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });

    expect(instructionRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith(
      {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
    );
  });

  it('persists runtime identity fields when creating instructions without a project bridge', async () => {
    const { service, instructionRepository, wrenAIAdaptor, tx } =
      createService();
    instructionRepository.createOne.mockResolvedValue({
      id: 7,
      instruction: 'Prefer fiscal year wording',
      questions: ['How do we define ARR?'],
      isDefault: false,
    });

    const result = await service.createInstruction(
      {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      {
        instruction: 'Prefer fiscal year wording',
        questions: ['How do we define ARR?'],
        isDefault: false,
      },
    );

    expect(instructionRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      }),
      { tx },
    );
    expect(wrenAIAdaptor.generateInstruction).toHaveBeenCalledWith({
      instructions: [
        {
          id: 7,
          instruction: 'Prefer fiscal year wording',
          questions: ['How do we define ARR?'],
          isDefault: false,
        },
      ],
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
    });
    expect(tx.commit).toHaveBeenCalled();
    expect(result.id).toBe(7);
  });

  it('drops project bridge from persisted payload when canonical runtime identity exists', async () => {
    const { service, instructionRepository, wrenAIAdaptor, tx } =
      createService();
    instructionRepository.createOne.mockResolvedValue({
      id: 8,
      instruction: 'Use scoped copy',
      questions: ['Question'],
      isDefault: false,
    });

    await service.createInstruction(
      {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      {
        instruction: 'Use scoped copy',
        questions: ['Question'],
        isDefault: false,
      },
    );

    expect(instructionRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
      { tx },
    );
    expect(wrenAIAdaptor.generateInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
      }),
    );
  });
});
