import {
  normalizeKnowledgeListPayload,
  resolveWorkspaceConnectorSelector,
  resolveKnowledgeLoadErrorMessage,
} from './useKnowledgeDataLoaders';

describe('useKnowledgeDataLoaders helpers', () => {
  it('normalizes non-array payloads to empty array', () => {
    expect(normalizeKnowledgeListPayload({})).toEqual([]);
    expect(normalizeKnowledgeListPayload(null)).toEqual([]);
  });

  it('returns payload directly when payload is an array', () => {
    expect(normalizeKnowledgeListPayload([{ id: 'kb-1' }])).toEqual([
      { id: 'kb-1' },
    ]);
  });

  it('prefers explicit error messages', () => {
    expect(
      resolveKnowledgeLoadErrorMessage(new Error('custom-error'), 'fallback'),
    ).toBe('custom-error');
  });

  it('falls back to default message when error is not Error', () => {
    expect(resolveKnowledgeLoadErrorMessage('boom', 'fallback')).toBe(
      'fallback',
    );
  });

  it('shrinks connector selector to workspace scope only', () => {
    expect(
      resolveWorkspaceConnectorSelector({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toEqual({ workspaceId: 'workspace-1' });

    expect(
      resolveWorkspaceConnectorSelector({
        knowledgeBaseId: 'kb-1',
      }),
    ).toBeUndefined();
  });
});
