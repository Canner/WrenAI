import {
  buildApiHistoryListRequestKey,
  buildApiHistoryListUrl,
  normalizeApiHistoryListPayload,
} from './useApiHistoryList';
import { ApiType } from '@/types/apiHistory';

describe('useApiHistoryList helpers', () => {
  it('builds the REST api history url with pagination, filters, and runtime scope', () => {
    expect(
      buildApiHistoryListUrl({
        pagination: {
          offset: 20,
          limit: 10,
        },
        filter: {
          apiType: ApiType.STREAM_ASK,
          statusCode: 400,
          threadId: 'thread-123',
          startDate: '2026-04-01T00:00:00.000Z',
          endDate: '2026-04-03T23:59:59.999Z',
        },
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(
      '/api/v1/api-history?offset=20&limit=10&apiType=STREAM_ASK&statusCode=400&threadId=thread-123&startDate=2026-04-01T00%3A00%3A00.000Z&endDate=2026-04-03T23%3A59%3A59.999Z&workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('returns a null request key when api history loading is disabled', () => {
    expect(
      buildApiHistoryListRequestKey({
        enabled: false,
        pagination: {
          offset: 0,
          limit: 20,
        },
        filter: {
          apiType: ApiType.STREAM_ASK,
        },
        runtimeScopeSelector: { workspaceId: 'ws-1' },
      }),
    ).toBeNull();
  });

  it('normalizes invalid payloads to an empty response shape', () => {
    expect(normalizeApiHistoryListPayload(null)).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });

    expect(
      normalizeApiHistoryListPayload({
        items: 'invalid',
        total: 'invalid',
        hasMore: 'invalid',
      }),
    ).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
  });
});
