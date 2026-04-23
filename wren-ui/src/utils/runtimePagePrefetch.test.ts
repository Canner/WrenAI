import {
  buildThreadOverviewUrl,
  clearRuntimePagePrefetchCache,
  invalidateKnowledgeBaseList,
  loadKnowledgeBaseList,
  loadKnowledgeConnectors,
  loadWorkspaceOverview,
  peekKnowledgeBaseList,
  peekPrefetchedFirstDashboardId,
  peekThreadOverview,
  peekWorkspaceOverview,
  primeKnowledgeBaseList,
  prefetchDashboardOverview,
  prefetchKnowledgeOverview,
  prefetchThreadOverview,
} from './runtimePagePrefetch';
import {
  clearDashboardRestCache,
  peekDashboardDetailPayload,
} from './dashboardRest';

describe('runtimePagePrefetch', () => {
  beforeEach(() => {
    clearRuntimePagePrefetchCache();
    clearDashboardRestCache();
    jest.clearAllMocks();
  });

  it('deduplicates in-flight workspace overview requests and reuses the cached payload', async () => {
    const payload = {
      workspace: {
        id: 'ws-1',
        name: '系统工作空间',
      },
    };
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    const url = '/api/v1/workspace/current?workspaceId=ws-1';
    const [first, second] = await Promise.all([
      loadWorkspaceOverview(url, { fetcher }),
      loadWorkspaceOverview(url, { fetcher }),
    ]);

    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const cached = await loadWorkspaceOverview(url, { fetcher });
    expect(cached).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(peekWorkspaceOverview(url)).toEqual(payload);
  });

  it('prefetches dashboard list and stores the first dashboard id for navigation', async () => {
    const fetcher = jest.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/api/v1/dashboards?')
          ? [
              {
                id: 7,
                name: '经营总览',
                cacheEnabled: true,
              },
            ]
          : {
              id: 7,
              name: '经营总览',
              cacheEnabled: true,
              items: [],
            },
    }));

    await prefetchDashboardOverview({
      selector: {
        workspaceId: 'ws-1',
      },
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith('/api/v1/dashboards?workspaceId=ws-1');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/dashboards/7?workspaceId=ws-1',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(peekPrefetchedFirstDashboardId()).toBe(7);
    expect(
      peekDashboardDetailPayload({
        selector: {
          workspaceId: 'ws-1',
        },
        dashboardId: 7,
      }),
    ).toEqual({
      id: 7,
      name: '经营总览',
      cacheEnabled: true,
      items: [],
    });
  });

  it('prefetches thread detail into the runtime cache through REST', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 19,
      }),
    } as Response);

    await prefetchThreadOverview(19, {
      selector: { workspaceId: 'ws-1' },
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      buildThreadOverviewUrl(19, {
        workspaceId: 'ws-1',
      }),
    );
    expect(
      peekThreadOverview(19, {
        workspaceId: 'ws-1',
      }),
    ).toEqual({
      thread: {
        id: 19,
      },
    });
    expect(
      peekThreadOverview(19, {
        workspaceId: 'ws-2',
      }),
    ).toBeNull();
  });

  it('deduplicates repeated thread detail prefetches', async () => {
    let resolveFetch:
      | ((value: { ok: boolean; json: () => Promise<{ id: number }> }) => void)
      | undefined;
    const fetcher = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const firstPrefetch = prefetchThreadOverview(19, {
      selector: { workspaceId: 'ws-1' },
      fetcher,
    });
    const secondPrefetch = prefetchThreadOverview(19, {
      selector: { workspaceId: 'ws-1' },
      fetcher,
    });
    resolveFetch?.({
      ok: true,
      json: async () => ({
        id: 19,
      }),
    });

    await Promise.all([firstPrefetch, secondPrefetch]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      peekThreadOverview(19, {
        workspaceId: 'ws-1',
      }),
    ).toEqual({
      thread: {
        id: 19,
      },
    });

    await prefetchThreadOverview(19, {
      selector: { workspaceId: 'ws-1' },
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stores thread detail prefetches separately for different runtime scopes', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 19,
          summary: 'scope-a',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 19,
          summary: 'scope-b',
        }),
      } as Response);

    await prefetchThreadOverview(19, {
      selector: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-a' },
      fetcher,
    });
    await prefetchThreadOverview(19, {
      selector: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-b' },
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      peekThreadOverview(19, {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-a',
      }),
    ).toEqual({
      thread: {
        id: 19,
        summary: 'scope-a',
      },
    });
    expect(
      peekThreadOverview(19, {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-b',
      }),
    ).toEqual({
      thread: {
        id: 19,
        summary: 'scope-b',
      },
    });
  });

  it('deduplicates in-flight knowledge overview fetches and reuses cached payloads', async () => {
    const fetcher = jest.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/knowledge/bases')
          ? [{ id: 'kb-1', name: '订单分析知识库' }]
          : [{ id: 'connector-1', displayName: 'Postgres' }],
    }));

    const [knowledgeBases, duplicateKnowledgeBases] = await Promise.all([
      loadKnowledgeBaseList('/api/v1/knowledge/bases?workspaceId=ws-1', {
        fetcher,
      }),
      loadKnowledgeBaseList('/api/v1/knowledge/bases?workspaceId=ws-1', {
        fetcher,
      }),
    ]);

    expect(knowledgeBases).toEqual([{ id: 'kb-1', name: '订单分析知识库' }]);
    expect(duplicateKnowledgeBases).toEqual(knowledgeBases);

    const connectors = await loadKnowledgeConnectors(
      '/api/v1/connectors?workspaceId=ws-1&knowledgeBaseId=kb-1',
      {
        fetcher,
      },
    );

    expect(connectors).toEqual([
      { id: 'connector-1', displayName: 'Postgres' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      peekKnowledgeBaseList('/api/v1/knowledge/bases?workspaceId=ws-1'),
    ).toEqual([{ id: 'kb-1', name: '订单分析知识库' }]);
  });

  it('invalidates a cached knowledge-base list so the next load refetches', async () => {
    const firstFetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'kb-1', name: '订单分析知识库' }],
    } as Response);
    const secondFetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'kb-2', name: '新知识库' }],
    } as Response);
    const url = '/api/v1/knowledge/bases?workspaceId=ws-1';

    await loadKnowledgeBaseList(url, { fetcher: firstFetcher });
    expect(peekKnowledgeBaseList(url)).toEqual([
      { id: 'kb-1', name: '订单分析知识库' },
    ]);

    invalidateKnowledgeBaseList(url);
    expect(peekKnowledgeBaseList(url)).toBeNull();

    const refreshed = await loadKnowledgeBaseList(url, {
      fetcher: secondFetcher,
    });
    expect(refreshed).toEqual([{ id: 'kb-2', name: '新知识库' }]);
    expect(secondFetcher).toHaveBeenCalledTimes(1);
  });

  it('can prime the knowledge-base cache from runtime selector state', () => {
    const url = '/api/v1/knowledge/bases?workspaceId=ws-1';
    const payload = [{ id: 'kb-1', name: '订单分析知识库' }];

    primeKnowledgeBaseList({
      url,
      payload,
    });

    expect(peekKnowledgeBaseList(url)).toEqual(payload);
  });

  it('prefetches knowledge list and connectors into caches', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    await prefetchKnowledgeOverview({
      knowledgeBasesUrl: '/api/v1/knowledge/bases?workspaceId=ws-1',
      connectorsUrl: '/api/v1/connectors?workspaceId=ws-1&knowledgeBaseId=kb-1',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).not.toHaveBeenCalledWith(
      '/api/v1/knowledge/diagram?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1',
    );
  });
});
