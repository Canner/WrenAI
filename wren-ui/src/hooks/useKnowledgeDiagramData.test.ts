import {
  KNOWLEDGE_DIAGRAM_QUERY_FETCH_POLICY,
  resolveKnowledgeDiagramScopeKey,
  shouldFetchKnowledgeDiagram,
  shouldClearScopedDiagramData,
} from './useKnowledgeDiagramData';

describe('useKnowledgeDiagramData helpers', () => {
  it('returns true only when runtime scope and kb snapshot are ready', () => {
    expect(
      shouldFetchKnowledgeDiagram({
        hasRuntimeScope: true,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
      }),
    ).toBe(true);

    expect(
      shouldFetchKnowledgeDiagram({
        hasRuntimeScope: false,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
      }),
    ).toBe(false);

    expect(
      shouldFetchKnowledgeDiagram({
        hasRuntimeScope: true,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: undefined,
      }),
    ).toBe(false);
  });

  it('builds a stable diagram scope key only when runtime selector is ready', () => {
    expect(
      resolveKnowledgeDiagramScopeKey({
        hasRuntimeScope: true,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
        effectiveRuntimeSelector: {
          workspaceId: 'ws-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe('ws-1|kb-1|snap-1|deploy-1|');

    expect(
      resolveKnowledgeDiagramScopeKey({
        hasRuntimeScope: false,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
        effectiveRuntimeSelector: {
          workspaceId: 'ws-1',
        },
      }),
    ).toBeNull();
  });

  it('uses scope-local fetching instead of shared cache-first reuse', () => {
    expect(KNOWLEDGE_DIAGRAM_QUERY_FETCH_POLICY).toBe('no-cache');
  });

  it('clears stale diagram data when switching to a different scope without cache', () => {
    expect(
      shouldClearScopedDiagramData({
        previousScopeKey: 'ws-1|kb-1|snap-1|deploy-1|',
        nextScopeKey: 'ws-1|kb-2|snap-2|deploy-2|',
        hasCachedDiagramData: false,
      }),
    ).toBe(true);

    expect(
      shouldClearScopedDiagramData({
        previousScopeKey: 'ws-1|kb-1|snap-1|deploy-1|',
        nextScopeKey: 'ws-1|kb-1|snap-1|deploy-1|',
        hasCachedDiagramData: false,
      }),
    ).toBe(false);

    expect(
      shouldClearScopedDiagramData({
        previousScopeKey: 'ws-1|kb-1|snap-1|deploy-1|',
        nextScopeKey: 'ws-1|kb-2|snap-2|deploy-2|',
        hasCachedDiagramData: true,
      }),
    ).toBe(false);
  });
});
