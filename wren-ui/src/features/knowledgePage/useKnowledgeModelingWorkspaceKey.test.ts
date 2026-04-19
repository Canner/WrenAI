import {
  buildKnowledgeModelingWorkspaceKey,
  resolveCommittedKnowledgeModelingWorkspaceKey,
} from './useKnowledgeModelingWorkspaceKey';

describe('useKnowledgeModelingWorkspaceKey helpers', () => {
  it('builds a stable key from kb/snapshot/deploy identifiers', () => {
    expect(
      buildKnowledgeModelingWorkspaceKey({
        activeKnowledgeBaseId: 'kb-1',
        activeKnowledgeSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toBe('kb-1:snap-1:deploy-1');
  });

  it('falls back to sentinel segments when identifiers are missing', () => {
    expect(
      buildKnowledgeModelingWorkspaceKey({
        activeKnowledgeBaseId: null,
        activeKnowledgeSnapshotId: undefined,
        deployHash: '',
      }),
    ).toBe('none:default:deploy');
  });

  it('keeps the previous committed key while runtime data is still syncing', () => {
    expect(
      resolveCommittedKnowledgeModelingWorkspaceKey({
        currentKey: 'kb-2:snap-2:deploy-2',
        previousKey: 'kb-1:snap-1:deploy-1',
        routeRuntimeSyncing: true,
      }),
    ).toBe('kb-1:snap-1:deploy-1');
  });

  it('commits the new key once runtime syncing is complete', () => {
    expect(
      resolveCommittedKnowledgeModelingWorkspaceKey({
        currentKey: 'kb-2:snap-2:deploy-2',
        previousKey: 'kb-1:snap-1:deploy-1',
        routeRuntimeSyncing: false,
      }),
    ).toBe('kb-2:snap-2:deploy-2');
  });
});
