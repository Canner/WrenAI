import { toAskRuntimeIdentity } from '../projectControllerRuntimeSupport';

describe('projectControllerRuntimeSupport.toAskRuntimeIdentity', () => {
  it('drops stale project bridge when canonical runtime fields exist', () => {
    expect(
      toAskRuntimeIdentity({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('preserves project bridge for legacy-only runtime identities', () => {
    expect(
      toAskRuntimeIdentity({
        projectId: 42,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: 'user-1',
      }),
    ).toEqual({
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: 'user-1',
    });
  });
});
