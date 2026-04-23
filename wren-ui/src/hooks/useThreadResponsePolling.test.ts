import {
  buildThreadResponseDetailUrl,
  ThreadResponseRequestError,
  loadThreadResponsePayload,
  normalizeThreadResponsePayload,
  shouldRetryThreadResponsePollingError,
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

  it('stops retrying when the response belongs to another runtime scope', () => {
    expect(
      shouldRetryThreadResponsePollingError(
        new ThreadResponseRequestError(
          'Thread response 70 does not belong to the current runtime scope',
          {
            statusCode: 500,
          },
        ),
      ),
    ).toBe(false);
  });

  it('stops retrying on client-side terminal response errors', () => {
    expect(
      shouldRetryThreadResponsePollingError(
        new ThreadResponseRequestError('Thread response 70 not found', {
          statusCode: 404,
        }),
      ),
    ).toBe(false);
  });

  it('keeps retrying transient polling failures', () => {
    expect(
      shouldRetryThreadResponsePollingError(
        new ThreadResponseRequestError('upstream temporarily unavailable', {
          statusCode: 503,
        }),
      ),
    ).toBe(true);
  });

  it('preserves response metadata on request failures', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error:
          'Thread response 70 does not belong to the current runtime scope',
        code: 'RUNTIME_SCOPE_MISMATCH',
      }),
    } as Response);

    await expect(
      loadThreadResponsePayload({
        responseId: 70,
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
        },
        fetcher,
      }),
    ).rejects.toMatchObject({
      message:
        'Thread response 70 does not belong to the current runtime scope',
      statusCode: 409,
      code: 'RUNTIME_SCOPE_MISMATCH',
    });
  });
});
