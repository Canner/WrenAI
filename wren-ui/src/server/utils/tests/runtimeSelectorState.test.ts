import {
  resolveBootstrapKnowledgeBaseSelection,
  resolveKnowledgeBaseSnapshotSelection,
} from '../runtimeSelectorState';

describe('runtimeSelectorState', () => {
  it('ignores stale active snapshots without a deploy log when resolving current selection', async () => {
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'snap-stale',
          knowledgeBaseId: 'kb-1',
          snapshotKey: 'draft',
          displayName: 'Draft Snapshot',
          deployHash: 'deploy-stale',
          status: 'active',
        },
      ]),
      findOneBy: jest.fn().mockResolvedValue({
        id: 'snap-stale',
        knowledgeBaseId: 'kb-1',
        snapshotKey: 'draft',
        displayName: 'Draft Snapshot',
        deployHash: 'deploy-stale',
        status: 'active',
      }),
    };
    const deployLogRepository = {
      findLastRuntimeDeployLog: jest.fn().mockResolvedValue(null),
    };

    const result = await resolveKnowledgeBaseSnapshotSelection({
      knowledgeBase: {
        id: 'kb-1',
        workspaceId: 'ws-1',
        defaultKbSnapshotId: 'snap-stale',
      } as any,
      kbSnapshotRepository: kbSnapshotRepository as any,
      deployLogRepository: deployLogRepository as any,
    });

    expect(result.snapshot).toBeNull();
    expect(result.snapshots).toHaveLength(1);
    expect(deployLogRepository.findLastRuntimeDeployLog).toHaveBeenCalledWith({
      workspaceId: null,
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-stale',
      projectId: null,
      deployHash: null,
    });
  });

  it('falls back to the first knowledge base with an executable snapshot', async () => {
    const knowledgeBases = [
      {
        id: 'kb-stale',
        workspaceId: 'ws-1',
        name: 'A stale KB',
        slug: 'a-stale-kb',
        defaultKbSnapshotId: 'snap-stale',
      },
      {
        id: 'kb-ready',
        workspaceId: 'ws-1',
        name: 'B ready KB',
        slug: 'b-ready-kb',
        defaultKbSnapshotId: 'snap-ready',
      },
    ];
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockImplementation(({ knowledgeBaseId }) =>
        Promise.resolve(
          knowledgeBaseId === 'kb-stale'
            ? [
                {
                  id: 'snap-stale',
                  knowledgeBaseId: 'kb-stale',
                  snapshotKey: 'draft',
                  displayName: 'Draft Snapshot',
                  deployHash: 'deploy-stale',
                  status: 'active',
                },
              ]
            : [
                {
                  id: 'snap-ready',
                  knowledgeBaseId: 'kb-ready',
                  snapshotKey: 'prod',
                  displayName: 'Prod Snapshot',
                  deployHash: 'deploy-ready',
                  status: 'active',
                },
              ],
        ),
      ),
      findOneBy: jest.fn().mockImplementation(({ id }) =>
        Promise.resolve(
          id === 'snap-ready'
            ? {
                id: 'snap-ready',
                knowledgeBaseId: 'kb-ready',
                snapshotKey: 'prod',
                displayName: 'Prod Snapshot',
                deployHash: 'deploy-ready',
                status: 'active',
              }
            : {
                id: 'snap-stale',
                knowledgeBaseId: 'kb-stale',
                snapshotKey: 'draft',
                displayName: 'Draft Snapshot',
                deployHash: 'deploy-stale',
                status: 'active',
              },
        ),
      ),
    };
    const deployLogRepository = {
      findLastRuntimeDeployLog: jest
        .fn()
        .mockImplementation(({ kbSnapshotId }) =>
          Promise.resolve(
            kbSnapshotId === 'snap-ready'
              ? { id: 1, kbSnapshotId: 'snap-ready', hash: 'deploy-ready' }
              : null,
          ),
        ),
    };

    const result = await resolveBootstrapKnowledgeBaseSelection(
      knowledgeBases as any,
      kbSnapshotRepository as any,
      deployLogRepository as any,
    );

    expect(result.knowledgeBase?.id).toBe('kb-ready');
    expect(result.snapshot?.id).toBe('snap-ready');
  });
});
