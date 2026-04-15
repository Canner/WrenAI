import {
  buildThreadDetailUrl,
  clearThreadDetailRequestCache,
  loadThreadDetailPayload,
  loadThreadDetailPayloadWithRetry,
  normalizeThreadDetailPayload,
  shouldRefetchEmptyThreadDetail,
} from './useThreadDetail';
import {
  clearRuntimePagePrefetchCache,
  primeThreadOverview,
} from '@/utils/runtimePagePrefetch';

describe('useThreadDetail helpers', () => {
  beforeEach(() => {
    clearThreadDetailRequestCache();
    clearRuntimePagePrefetchCache();
    jest.clearAllMocks();
  });

  it('builds the REST thread detail url with runtime scope query params', () => {
    expect(
      buildThreadDetailUrl({
        threadId: 42,
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(
      '/api/v1/threads/42?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('normalizes invalid payloads to null', () => {
    expect(normalizeThreadDetailPayload(null)).toBeNull();
    expect(
      normalizeThreadDetailPayload({ id: '42', responses: [] }),
    ).toBeNull();
    expect(
      normalizeThreadDetailPayload({ id: 42, responses: 'invalid' }),
    ).toBeNull();
  });

  it('flags empty thread payloads for revalidation', () => {
    expect(
      shouldRefetchEmptyThreadDetail({
        id: 42,
        summary: '线程摘要',
        responses: [],
        knowledgeBaseIds: ['kb-1'],
        selectedSkillIds: [],
      } as any),
    ).toBe(true);
    expect(
      shouldRefetchEmptyThreadDetail({
        id: 42,
        summary: '线程摘要',
        responses: [{ id: 1 }],
        knowledgeBaseIds: ['kb-1'],
        selectedSkillIds: [],
      } as any),
    ).toBe(false);
  });

  it('reuses the prefetched thread detail payload before issuing a network request', async () => {
    const cachedThread = {
      id: 42,
      summary: '线程摘要',
      responses: [],
      knowledgeBaseIds: ['kb-1'],
      selectedSkillIds: [],
    };
    const fetcher = jest.fn();

    primeThreadOverview(42, {
      thread: cachedThread,
    });

    const payload = await loadThreadDetailPayload({
      threadId: 42,
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
      },
      fetcher,
    });

    expect(payload).toEqual(cachedThread);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('deduplicates in-flight thread detail requests and caches the response', async () => {
    const threadPayload = {
      id: 42,
      summary: '线程摘要',
      responses: [],
      knowledgeBaseIds: ['kb-1'],
      selectedSkillIds: [],
    };
    let resolveFetch:
      | ((value: {
          ok: boolean;
          json: () => Promise<typeof threadPayload>;
        }) => void)
      | undefined;
    const fetcher = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const firstRequest = loadThreadDetailPayload({
      threadId: 42,
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
      },
      fetcher,
    });
    const secondRequest = loadThreadDetailPayload({
      threadId: 42,
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
      },
      fetcher,
    });

    resolveFetch?.({
      ok: true,
      json: async () => threadPayload,
    });

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      threadPayload,
      threadPayload,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/threads/42?workspaceId=ws-1',
      { cache: 'no-store' },
    );

    const cachedPayload = await loadThreadDetailPayload({
      threadId: 42,
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
      },
      fetcher,
    });

    expect(cachedPayload).toEqual(threadPayload);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('can bypass prefetched data to refresh the latest thread detail', async () => {
    const prefetchedThread = {
      id: 42,
      summary: '旧线程摘要',
      responses: [],
      knowledgeBaseIds: ['kb-1'],
      selectedSkillIds: [],
    };
    const refreshedThread = {
      ...prefetchedThread,
      summary: '新线程摘要',
      responses: [{ id: 1 }],
    };
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => refreshedThread,
    });

    primeThreadOverview(42, {
      thread: prefetchedThread,
    });

    const payload = await loadThreadDetailPayload({
      threadId: 42,
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
      },
      fetcher,
      preferPrefetchedData: false,
    });

    expect(payload).toEqual(refreshedThread);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/threads/42?workspaceId=ws-1',
      { cache: 'no-store' },
    );
  });

  it('retries thread detail loading when the first payload has no responses yet', async () => {
    const emptyThread = {
      id: 42,
      summary: '线程摘要',
      responses: [],
      knowledgeBaseIds: ['kb-1'],
      selectedSkillIds: [],
    };
    const hydratedThread = {
      ...emptyThread,
      responses: [{ id: 1 }],
    };
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => emptyThread,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => hydratedThread,
      });
    const waitForRetry = jest.fn().mockResolvedValue(undefined);

    const payload = await loadThreadDetailPayloadWithRetry({
      threadId: 42,
      runtimeScopeSelector: {
        workspaceId: 'ws-1',
      },
      fetcher,
      preferPrefetchedData: false,
      maxRetries: 2,
      retryIntervalMs: 1,
      waitForRetry,
    });

    expect(payload).toEqual(hydratedThread);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });
});
