import { resolveThreadResponseRuntimeSelector } from './threadResponseRuntime';

describe('threadResponseRuntime', () => {
  it('prefers the persisted response runtime selector when present', () => {
    expect(
      resolveThreadResponseRuntimeSelector({
        response: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        fallbackSelector: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snap-2',
          deployHash: 'deploy-2',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  it('falls back to the active runtime selector when the response has no persisted scope', () => {
    expect(
      resolveThreadResponseRuntimeSelector({
        response: {
          workspaceId: null,
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: null,
        },
        fallbackSelector: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snap-2',
          deployHash: 'deploy-2',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });
  });
});
