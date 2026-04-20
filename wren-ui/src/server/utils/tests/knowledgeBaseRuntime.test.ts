import {
  LATEST_EXECUTABLE_KB_SNAPSHOT_KEY,
  LATEST_EXECUTABLE_KB_SNAPSHOT_STATUS,
  syncLatestExecutableKnowledgeBaseSnapshot,
} from '../knowledgeBaseRuntime';

describe('knowledgeBaseRuntime', () => {
  it('creates a managed latest snapshot and backfills runtime-scoped artifacts', async () => {
    const knowledgeBase = {
      id: 'kb-1',
      workspaceId: 'ws-1',
      name: '销售分析',
      defaultKbSnapshotId: null,
    } as any;
    const deployment = {
      id: 9,
      projectId: 77,
      hash: 'deploy-77',
      kbSnapshotId: null,
    } as any;
    const createdSnapshot = {
      id: 'snap-1',
      knowledgeBaseId: 'kb-1',
      snapshotKey: LATEST_EXECUTABLE_KB_SNAPSHOT_KEY,
      displayName: '销售分析 默认快照',
      deployHash: 'deploy-77',
      status: LATEST_EXECUTABLE_KB_SNAPSHOT_STATUS,
    };

    const deployService = {
      getLastDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue(deployment),
    };
    const knowledgeBaseRepository = {
      updateOne: jest.fn(),
    };
    const kbSnapshotRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      createOne: jest.fn().mockResolvedValue(createdSnapshot),
      updateOne: jest.fn(),
    };
    const deployLogRepository = {
      updateOne: jest.fn(),
    };
    const modelRepository = {
      findAllBy: jest.fn().mockImplementation(async (filter) =>
        'projectId' in filter
          ? [
              {
                id: 101,
                projectId: 77,
                workspaceId: null,
                knowledgeBaseId: null,
                kbSnapshotId: null,
                deployHash: null,
              },
            ]
          : [
              {
                id: 102,
                projectId: null,
                workspaceId: 'ws-1',
                knowledgeBaseId: 'kb-1',
                kbSnapshotId: 'snap-old',
                deployHash: 'deploy-old',
              },
            ],
      ),
      updateOne: jest.fn(),
    };
    const relationRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 202,
          projectId: 77,
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-old',
          deployHash: 'deploy-old',
        },
      ]),
      updateOne: jest.fn(),
    };
    const viewRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    };

    await expect(
      syncLatestExecutableKnowledgeBaseSnapshot({
        knowledgeBase,
        knowledgeBaseRepository: knowledgeBaseRepository as any,
        kbSnapshotRepository: kbSnapshotRepository as any,
        deployLogRepository: deployLogRepository as any,
        deployService: deployService as any,
        modelRepository: modelRepository as any,
        relationRepository: relationRepository as any,
        viewRepository: viewRepository as any,
      }),
    ).resolves.toEqual(createdSnapshot);

    expect(
      deployService.getLastDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: null,
      deployHash: null,
    });
    expect(kbSnapshotRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        snapshotKey: LATEST_EXECUTABLE_KB_SNAPSHOT_KEY,
        deployHash: 'deploy-77',
        status: LATEST_EXECUTABLE_KB_SNAPSHOT_STATUS,
      }),
    );
    expect(deployLogRepository.updateOne).toHaveBeenCalledWith(9, {
      kbSnapshotId: 'snap-1',
    });
    expect(knowledgeBaseRepository.updateOne).toHaveBeenCalledWith('kb-1', {
      defaultKbSnapshotId: 'snap-1',
    });
    expect(modelRepository.updateOne).toHaveBeenCalledWith(101, {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-77',
    });
    expect(modelRepository.updateOne).toHaveBeenCalledWith(102, {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-77',
    });
    expect(relationRepository.updateOne).toHaveBeenCalledWith(202, {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-77',
    });
    expect(viewRepository.updateOne).not.toHaveBeenCalled();
  });

  it('returns null when the knowledge base has no executable deployment yet', async () => {
    const deployService = {
      getLastDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue(null),
    };

    await expect(
      syncLatestExecutableKnowledgeBaseSnapshot({
        knowledgeBase: {
          id: 'kb-empty',
          workspaceId: 'ws-1',
          name: 'Empty KB',
        } as any,
        knowledgeBaseRepository: { updateOne: jest.fn() } as any,
        kbSnapshotRepository: {
          findOneBy: jest.fn(),
          createOne: jest.fn(),
          updateOne: jest.fn(),
        } as any,
        deployLogRepository: { updateOne: jest.fn() } as any,
        deployService: deployService as any,
      }),
    ).resolves.toBeNull();
  });
});
