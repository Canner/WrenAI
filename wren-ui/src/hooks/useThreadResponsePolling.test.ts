import {
  buildThreadResponseDetailUrl,
  loadThreadResponsePayload,
  normalizeThreadResponsePayload,
} from './useThreadResponsePolling';

describe('useThreadResponsePolling helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the REST thread response url with runtime scope query params', () => {
    expect(
      buildThreadResponseDetailUrl({
        responseId: 84,
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(
      '/api/v1/thread-responses/84?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('normalizes invalid payloads to null', () => {
    expect(normalizeThreadResponsePayload(null)).toBeNull();
    expect(normalizeThreadResponsePayload({ id: '84' })).toBeNull();
    expect(
      normalizeThreadResponsePayload({ id: 84, threadId: '42' }),
    ).toBeNull();
  });

  it('loads and normalizes the REST thread response payload', async () => {
    const responsePayload = {
      id: 84,
      threadId: 42,
      question: '最新销售额是多少？',
      sql: 'select 1',
      view: null,
      askingTask: null,
      breakdownDetail: null,
      answerDetail: null,
      chartDetail: null,
      adjustment: null,
      adjustmentTask: null,
    };
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload,
    });

    await expect(
      loadThreadResponsePayload({
        responseId: 84,
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
        },
        fetcher,
      }),
    ).resolves.toEqual(responsePayload);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/thread-responses/84?workspaceId=ws-1',
      { cache: 'no-store' },
    );
  });
});
