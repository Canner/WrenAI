import { RuntimeSelectorResolver } from '../runtimeSelectorResolver';

describe('RuntimeSelectorResolver', () => {
  it('returns null when runtime scope is unavailable', async () => {
    const resolver = new RuntimeSelectorResolver();

    await expect(
      resolver.getRuntimeSelectorState(
        null,
        null,
        {
          runtimeScope: null,
        } as any,
      ),
    ).resolves.toBeNull();
  });

  it('returns currentProjectId even when workspace scope is not available yet', async () => {
    const resolver = new RuntimeSelectorResolver();

    await expect(
      resolver.getRuntimeSelectorState(
        null,
        null,
        {
          runtimeScope: {
            project: {
              id: 42,
            },
            workspace: null,
          },
        } as any,
      ),
    ).resolves.toEqual({
      currentProjectId: 42,
      currentWorkspace: null,
      currentKnowledgeBase: null,
      currentKbSnapshot: null,
      knowledgeBases: [],
      kbSnapshots: [],
    });
  });

  it('returns the current workspace and visible KB/snapshot options', async () => {
    const resolver = new RuntimeSelectorResolver();
    const knowledgeBaseRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'kb-z',
          workspaceId: 'ws-1',
          slug: 'kb-z',
          name: 'Zeta KB',
        },
        {
          id: 'kb-a',
          workspaceId: 'ws-1',
          slug: 'kb-a',
          name: 'Alpha KB',
        },
        {
          id: 'kb-archived',
          workspaceId: 'ws-1',
          slug: 'kb-archived',
          name: 'Archived KB',
          archivedAt: new Date('2026-04-01T00:00:00Z'),
        },
      ]),
    };
    const kbSnapshotRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 'snap-z',
          knowledgeBaseId: 'kb-current',
          snapshotKey: 'zeta',
          displayName: 'Zeta Snapshot',
          deployHash: 'deploy-z',
          status: 'active',
        },
        {
          id: 'snap-disabled',
          knowledgeBaseId: 'kb-current',
          snapshotKey: 'disabled',
          displayName: 'Disabled Snapshot',
          deployHash: 'deploy-disabled',
          status: 'disabled',
        },
      ]),
    };

    const result = await resolver.getRuntimeSelectorState(
      null,
      null,
      {
        runtimeScope: {
          project: {
            id: 99,
          },
          workspace: {
            id: 'ws-1',
            slug: 'workspace-1',
            name: 'Workspace 1',
          },
          knowledgeBase: {
            id: 'kb-current',
            workspaceId: 'ws-1',
            slug: 'kb-current',
            name: 'Current KB',
            defaultKbSnapshotId: 'snap-current',
          },
          kbSnapshot: {
            id: 'snap-current',
            knowledgeBaseId: 'kb-current',
            snapshotKey: 'current',
            displayName: 'Current Snapshot',
            deployHash: 'deploy-current',
            status: 'draft',
          },
        },
        knowledgeBaseRepository,
        kbSnapshotRepository,
      } as any,
    );

    expect(knowledgeBaseRepository.findAllBy).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
    });
    expect(kbSnapshotRepository.findAllBy).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-current',
    });
    expect(result).toEqual({
      currentProjectId: 99,
      currentWorkspace: {
        id: 'ws-1',
        slug: 'workspace-1',
        name: 'Workspace 1',
      },
      currentKnowledgeBase: {
        id: 'kb-current',
        slug: 'kb-current',
        name: 'Current KB',
        defaultKbSnapshotId: 'snap-current',
      },
      currentKbSnapshot: {
        id: 'snap-current',
        snapshotKey: 'current',
        displayName: 'Current Snapshot',
        deployHash: 'deploy-current',
        status: 'draft',
      },
      knowledgeBases: [
        {
          id: 'kb-a',
          slug: 'kb-a',
          name: 'Alpha KB',
          defaultKbSnapshotId: null,
        },
        {
          id: 'kb-current',
          slug: 'kb-current',
          name: 'Current KB',
          defaultKbSnapshotId: 'snap-current',
        },
        {
          id: 'kb-z',
          slug: 'kb-z',
          name: 'Zeta KB',
          defaultKbSnapshotId: null,
        },
      ],
      kbSnapshots: [
        {
          id: 'snap-current',
          snapshotKey: 'current',
          displayName: 'Current Snapshot',
          deployHash: 'deploy-current',
          status: 'draft',
        },
        {
          id: 'snap-z',
          snapshotKey: 'zeta',
          displayName: 'Zeta Snapshot',
          deployHash: 'deploy-z',
          status: 'active',
        },
      ],
    });
  });
});
