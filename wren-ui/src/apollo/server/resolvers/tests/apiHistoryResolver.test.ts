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
});
