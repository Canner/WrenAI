import {
  buildKnowledgeRuleSqlCacheScopeKey,
  resolveKnowledgeActiveSnapshotId,
} from './useKnowledgeRuntimeBindings';

describe('useKnowledgeRuntimeBindings helpers', () => {
  it('prefers nested default snapshot id when present', () => {
    expect(
      resolveKnowledgeActiveSnapshotId({
        id: 'kb-1',
        name: 'KB',
        slug: 'kb',
        workspaceId: 'ws-1',
        defaultKbSnapshotId: 'snap-legacy',
        defaultKbSnapshot: {
          id: 'snap-current',
          displayName: 'Current',
          deployHash: 'deploy-1',
          status: 'READY',
        },
      }),
    ).toBe('snap-current');
  });

  it('falls back to legacy default snapshot id when nested snapshot is absent', () => {
    expect(
      resolveKnowledgeActiveSnapshotId({
        id: 'kb-1',
        name: 'KB',
        slug: 'kb',
        workspaceId: 'ws-1',
        defaultKbSnapshotId: 'snap-legacy',
      }),
    ).toBe('snap-legacy');
  });

  it('builds a stable rule/sql cache scope key', () => {
    expect(
      buildKnowledgeRuleSqlCacheScopeKey({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toBe('ws-1|kb-1|snap-1|deploy-1');
  });

  it('normalizes missing selector segments to empty strings', () => {
    expect(
      buildKnowledgeRuleSqlCacheScopeKey({
        workspaceId: 'ws-1',
        knowledgeBaseId: undefined,
        kbSnapshotId: null,
        deployHash: '',
      }),
    ).toBe('ws-1|||');
  });
});
