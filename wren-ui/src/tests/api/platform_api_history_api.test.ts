import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  createReq,
  createRes,
  mockCountApiHistory,
  mockGetWorkspace,
  mockListApiHistoryWithPagination,
  resetPlatformApiTestEnv,
} from './platform_api.testSupport';

describe('platform api history api route', () => {
  beforeEach(() => {
    resetPlatformApiTestEnv();
  });

  it('GET /platform/api-history returns sanitized diagnostics records', async () => {
    const handler = (
      await import('../../pages/api/v1/platform/api-history/index')
    ).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
      query: {
        workspaceId: 'workspace-2',
        apiType: ApiType.RUN_SQL,
        offset: '0',
        limit: '10',
      },
    });
    const res = createRes();

    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
      kind: 'regular',
    });
    mockCountApiHistory.mockResolvedValue(1);
    mockListApiHistoryWithPagination.mockResolvedValue([
      {
        id: 'history-1',
        workspaceId: 'workspace-2',
        apiType: ApiType.RUN_SQL,
        threadId: 'thread-1',
        requestPayload: { sql: 'select 1' },
        responsePayload: { records: [{ id: 1 }, { id: 2 }] },
        statusCode: 200,
        durationMs: 123,
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:00:01.000Z',
      },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.workspace).toEqual({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
    });
    expect(res.body.total).toBe(1);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: 'history-1',
        responsePayload: { records: ['2 records omitted'] },
      }),
    ]);
  });
});
