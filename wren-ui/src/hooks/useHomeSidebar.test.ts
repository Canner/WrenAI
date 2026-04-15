import {
  buildHomeSidebarThreadDetailUrl,
  buildHomeSidebarThreadsUrl,
  getCachedHomeSidebarThreads,
  getCachedHomeSidebarQueryEnabled,
  normalizeHomeSidebarThreads,
  resolveHomeSidebarHeaderSelector,
  resolveHomeSidebarScopeKey,
  resolveHomeSidebarThreadSelector,
  shouldFetchHomeSidebarThreads,
  shouldEagerLoadHomeSidebarOnIntent,
  shouldEnableSidebarQueryOnIntent,
  shouldScheduleDeferredSidebarLoad,
} from './useHomeSidebar';

describe('useHomeSidebar helpers', () => {
  it('resolves sidebar cache scope by workspace first, then runtime scope', () => {
    expect(
      resolveHomeSidebarScopeKey({
        workspaceId: 'workspace-1',
        runtimeScopeId: 'runtime-1',
      }),
    ).toBe('workspace-1');

    expect(
      resolveHomeSidebarScopeKey({
        runtimeScopeId: 'runtime-1',
      }),
    ).toBe('runtime-1');

    expect(resolveHomeSidebarScopeKey({})).toBe('__default__');
  });

  it('resolves sidebar request headers by workspace first, then runtime scope', () => {
    expect(
      resolveHomeSidebarHeaderSelector({
        workspaceId: 'workspace-1',
        runtimeScopeId: 'runtime-1',
      }),
    ).toEqual({ workspaceId: 'workspace-1' });

    expect(
      resolveHomeSidebarHeaderSelector({
        runtimeScopeId: 'runtime-1',
      }),
    ).toEqual({ runtimeScopeId: 'runtime-1' });

    expect(resolveHomeSidebarHeaderSelector({})).toEqual({});
  });

  it('builds the sidebar threads rest url with runtime scope query params', () => {
    expect(
      buildHomeSidebarThreadsUrl({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      }),
    ).toBe('/api/v1/threads?workspaceId=workspace-1&knowledgeBaseId=kb-1');
  });

  it('builds the sidebar thread detail rest url with runtime scope query params', () => {
    expect(
      buildHomeSidebarThreadDetailUrl('thread-1', {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      }),
    ).toBe(
      '/api/v1/threads/thread-1?workspaceId=workspace-1&knowledgeBaseId=kb-1',
    );
  });

  it('restores thread navigation selector from persisted runtime identity fields', () => {
    expect(
      resolveHomeSidebarThreadSelector({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
    });

    expect(
      resolveHomeSidebarThreadSelector({
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
    });
  });

  it('normalizes invalid sidebar thread payloads to an empty list', () => {
    expect(normalizeHomeSidebarThreads(null)).toEqual([]);
    expect(normalizeHomeSidebarThreads({ threads: [] })).toEqual([]);
  });

  it('starts with sidebar query cache disabled for a fresh scope', () => {
    expect(getCachedHomeSidebarQueryEnabled('fresh-scope')).toBe(false);
  });

  it('starts with no cached sidebar threads for a fresh scope', () => {
    expect(getCachedHomeSidebarThreads('fresh-scope')).toEqual([]);
  });

  it('reuses the same empty sidebar thread cache reference for a fresh scope', () => {
    expect(getCachedHomeSidebarThreads('fresh-scope')).toBe(
      getCachedHomeSidebarThreads('fresh-scope'),
    );
  });

  it('only auto-schedules deferred loading when not waiting for explicit intent', () => {
    expect(
      shouldScheduleDeferredSidebarLoad({
        deferInitialLoad: true,
        hasRuntimeScope: true,
        loadOnIntent: false,
        queryEnabled: false,
      }),
    ).toBe(true);

    expect(
      shouldScheduleDeferredSidebarLoad({
        deferInitialLoad: true,
        hasRuntimeScope: true,
        loadOnIntent: true,
        queryEnabled: false,
      }),
    ).toBe(false);
  });

  it('only enables query on intent when runtime scope exists and query is still disabled', () => {
    expect(
      shouldEnableSidebarQueryOnIntent({
        disabled: false,
        hasRuntimeScope: true,
        queryEnabled: false,
      }),
    ).toBe(true);

    expect(
      shouldEnableSidebarQueryOnIntent({
        disabled: false,
        hasRuntimeScope: true,
        queryEnabled: true,
      }),
    ).toBe(false);

    expect(
      shouldEnableSidebarQueryOnIntent({
        disabled: false,
        hasRuntimeScope: false,
        queryEnabled: false,
      }),
    ).toBe(false);

    expect(
      shouldEnableSidebarQueryOnIntent({
        disabled: true,
        hasRuntimeScope: true,
        queryEnabled: false,
      }),
    ).toBe(false);
  });

  it('only fetches sidebar threads from network when cache is empty and query is enabled', () => {
    expect(
      shouldFetchHomeSidebarThreads({
        disabled: false,
        hasRuntimeScope: true,
        queryEnabled: true,
        cachedThreadCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldFetchHomeSidebarThreads({
        disabled: false,
        hasRuntimeScope: true,
        queryEnabled: true,
        cachedThreadCount: 2,
      }),
    ).toBe(false);

    expect(
      shouldFetchHomeSidebarThreads({
        disabled: false,
        hasRuntimeScope: false,
        queryEnabled: true,
        cachedThreadCount: 0,
      }),
    ).toBe(false);
  });

  it('eager loads sidebar threads on intent only when cache is empty', () => {
    expect(
      shouldEagerLoadHomeSidebarOnIntent({
        disabled: false,
        hasRuntimeScope: true,
        cachedThreadCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldEagerLoadHomeSidebarOnIntent({
        disabled: false,
        hasRuntimeScope: true,
        cachedThreadCount: 2,
      }),
    ).toBe(false);

    expect(
      shouldEagerLoadHomeSidebarOnIntent({
        disabled: false,
        hasRuntimeScope: false,
        cachedThreadCount: 0,
      }),
    ).toBe(false);
  });
});
