import {
  resolveKnowledgeBaseListSelector,
  resolveCachedKnowledgeBaseList,
  resolveKnowledgeBasesUrl,
} from './useKnowledgeBaseListCache';

jest.mock('@/utils/runtimePagePrefetch', () => ({
  peekKnowledgeBaseList: jest.fn(() => [{ id: 'kb-1' }]),
}));

describe('useKnowledgeBaseListCache helpers', () => {
  it('returns null url when runtime scope or workspace id is missing', () => {
    expect(
      resolveKnowledgeBasesUrl({
        hasRuntimeScope: false,
        workspaceId: 'ws-1',
      }),
    ).toBeNull();
    expect(
      resolveKnowledgeBasesUrl({
        hasRuntimeScope: true,
        workspaceId: null,
      }),
    ).toBeNull();
  });

  it('builds knowledge base url when runtime scope and workspace exist', () => {
    const url = resolveKnowledgeBasesUrl({
      hasRuntimeScope: true,
      workspaceId: 'ws-1',
    });
    expect(url).toContain('/api/v1/knowledge/bases');
    expect(url).toContain('workspaceId=ws-1');
    expect(url).not.toContain('knowledgeBaseId=');
  });

  it('resolves knowledge list selector at workspace scope only', () => {
    expect(resolveKnowledgeBaseListSelector({ workspaceId: 'ws-1' })).toEqual({
      workspaceId: 'ws-1',
    });
    expect(resolveKnowledgeBaseListSelector({ workspaceId: null })).toEqual({});
  });

  it('returns cached list when url exists', () => {
    expect(resolveCachedKnowledgeBaseList('mock-url')).toEqual([
      { id: 'kb-1' },
    ]);
    expect(resolveCachedKnowledgeBaseList(null)).toBeNull();
  });
});
