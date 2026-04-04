import { ApiHistoryResolver } from '../apiHistoryResolver';
import { ApiType } from '../../repositories/apiHistoryRepository';

describe('ApiHistoryResolver', () => {
  describe('getApiHistory', () => {
    it('always scopes history lookup to the active runtime project', async () => {
      const resolver = new ApiHistoryResolver();
      const count = jest.fn().mockResolvedValue(1);
      const findAllWithPagination = jest
        .fn()
        .mockResolvedValue([{ id: 'history-1' }]);

      const result = await resolver.getApiHistory(
        null,
        {
          filter: {
            apiType: ApiType.ASK,
            threadId: 'thread-1',
          },
          pagination: { offset: 0, limit: 20 },
        },
        {
          runtimeScope: {
            project: { id: 42 },
          },
          apiHistoryRepository: {
            count,
            findAllWithPagination,
          },
        } as any,
      );

      expect(count).toHaveBeenCalledWith(
        {
          projectId: 42,
          apiType: ApiType.ASK,
          threadId: 'thread-1',
        },
        {},
      );
      expect(findAllWithPagination).toHaveBeenCalledWith(
        {
          projectId: 42,
          apiType: ApiType.ASK,
          threadId: 'thread-1',
        },
        {},
        {
          offset: 0,
          limit: 20,
          orderBy: { createdAt: 'desc' },
        },
      );
      expect(result).toEqual({
        items: [{ id: 'history-1' }],
        total: 1,
        hasMore: false,
      });
    });

    it('rejects projectId filters that try to switch out of the active runtime scope', async () => {
      const resolver = new ApiHistoryResolver();

      await expect(
        resolver.getApiHistory(
          null,
          {
            filter: {
              projectId: 7,
            },
            pagination: { offset: 0, limit: 20 },
          },
          {
            runtimeScope: {
              project: { id: 42 },
            },
            apiHistoryRepository: {
              count: jest.fn(),
              findAllWithPagination: jest.fn(),
            },
          } as any,
        ),
      ).rejects.toThrow(
        'apiHistory projectId filter does not match active runtime scope',
      );
    });
  });

  describe('getAskShadowCompareStats', () => {
    it('delegates ask shadow compare aggregation to the repository with runtime-scoped filters', async () => {
      const resolver = new ApiHistoryResolver();
      const getAskShadowCompareStats = jest.fn().mockResolvedValue({
        total: 4,
        withDiagnostics: 3,
        enabled: 2,
        executed: 2,
        comparable: 2,
        matched: 1,
        mismatched: 1,
        errorCount: 1,
        byAskPath: [
          { key: 'general', count: 1 },
          { key: 'nl2sql', count: 1 },
          { key: 'skill', count: 1 },
        ],
        byShadowErrorType: [{ key: 'timeout', count: 1 }],
        trends: [
          {
            date: '2026-04-01',
            total: 2,
            executed: 1,
            comparable: 1,
            matched: 1,
            mismatched: 0,
            errorCount: 0,
          },
          {
            date: '2026-04-02',
            total: 2,
            executed: 1,
            comparable: 1,
            matched: 0,
            mismatched: 1,
            errorCount: 1,
          },
        ],
      });

      const result = await resolver.getAskShadowCompareStats(
        null,
        {
          filter: {
            threadId: 'thread-1',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-04-03T00:00:00.000Z',
          },
        },
        {
          runtimeScope: {
            project: { id: 42 },
          },
          apiHistoryRepository: {
            getAskShadowCompareStats,
          },
        } as any,
      );

      expect(getAskShadowCompareStats).toHaveBeenCalledWith(
        {
          projectId: 42,
          threadId: 'thread-1',
        },
        {
          startDate: new Date('2026-04-01T00:00:00.000Z'),
          endDate: new Date('2026-04-03T00:00:00.000Z'),
        },
        [ApiType.ASK, ApiType.STREAM_ASK],
      );
      expect(result).toEqual({
        total: 4,
        withDiagnostics: 3,
        enabled: 2,
        executed: 2,
        comparable: 2,
        matched: 1,
        mismatched: 1,
        errorCount: 1,
        byAskPath: [
          { key: 'general', count: 1 },
          { key: 'nl2sql', count: 1 },
          { key: 'skill', count: 1 },
        ],
        byShadowErrorType: [{ key: 'timeout', count: 1 }],
        trends: [
          {
            date: '2026-04-01',
            total: 2,
            executed: 1,
            comparable: 1,
            matched: 1,
            mismatched: 0,
            errorCount: 0,
          },
          {
            date: '2026-04-02',
            total: 2,
            executed: 1,
            comparable: 1,
            matched: 0,
            mismatched: 1,
            errorCount: 1,
          },
        ],
      });
    });

    it('rejects non-ask apiType filters', async () => {
      const resolver = new ApiHistoryResolver();

      await expect(
        resolver.getAskShadowCompareStats(
          null,
          {
            filter: {
              apiType: ApiType.RUN_SQL,
            },
          },
          {
            runtimeScope: {
              project: { id: 42 },
            },
            apiHistoryRepository: {
              getAskShadowCompareStats: jest.fn(),
            },
          } as any,
        ),
      ).rejects.toThrow(
        'askShadowCompareStats only supports ASK or STREAM_ASK apiType filters',
      );
    });
  });

  describe('nested responsePayload resolver', () => {
    it('sanitizes RUN_SQL records and chart payload values but leaves arrays untouched', () => {
      const resolver = new ApiHistoryResolver();
      const nested = resolver.getApiHistoryNestedResolver();

      expect(
        nested.responsePayload({
          apiType: ApiType.RUN_SQL,
          responsePayload: {
            records: [{ id: 1 }, { id: 2 }],
            columns: ['id'],
          },
        } as any),
      ).toEqual({
        records: ['2 records omitted'],
        columns: ['id'],
      });

      expect(
        nested.responsePayload({
          apiType: ApiType.GENERATE_VEGA_CHART,
          responsePayload: {
            vegaSpec: {
              data: {
                values: [{ x: 1 }, { x: 2 }, { x: 3 }],
              },
            },
          },
        } as any),
      ).toEqual({
        vegaSpec: {
          data: {
            values: ['3 data points omitted'],
          },
        },
      });

      expect(
        nested.responsePayload({
          apiType: ApiType.ASK,
          responsePayload: [{ answer: 'ok' }],
        } as any),
      ).toEqual([{ answer: 'ok' }]);
    });
  });
});
