import { ApiHistoryController } from '../apiHistoryController';
import { ApiType } from '../../repositories/apiHistoryRepository';

describe('ApiHistoryController', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createAuthorizationActor = () => ({
    principalType: 'user',
    principalId: 'user_1',
    workspaceId: 'ws_1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  describe('getApiHistory', () => {
    it('always scopes history lookup to the active canonical runtime binding', async () => {
      const resolver = new ApiHistoryController();
      const count = jest.fn().mockResolvedValue(1);
      const findAllWithPagination = jest
        .fn()
        .mockResolvedValue([{ id: 'history-1' }]);
      const ctx = {
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'ws_1' },
          knowledgeBase: { id: 'kb_1' },
          kbSnapshot: { id: 'snapshot_1' },
          deployHash: 'deploy_hash_1',
          userId: 'user_1',
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: {
          createOne: jest.fn(),
        },
        apiHistoryRepository: {
          count,
          findAllWithPagination,
        },
      } as any;

      const result = await resolver.getApiHistory(
        null,
        {
          filter: {
            apiType: ApiType.ASK,
            threadId: 'thread-1',
          },
          pagination: { offset: 0, limit: 20 },
        },
        ctx,
      );

      expect(count).toHaveBeenCalledWith(
        {
          projectId: null,
          workspaceId: 'ws_1',
          knowledgeBaseId: 'kb_1',
          kbSnapshotId: 'snapshot_1',
          deployHash: 'deploy_hash_1',
          apiType: ApiType.ASK,
          threadId: 'thread-1',
        },
        {},
      );
      expect(findAllWithPagination).toHaveBeenCalledWith(
        {
          projectId: null,
          workspaceId: 'ws_1',
          knowledgeBaseId: 'kb_1',
          kbSnapshotId: 'snapshot_1',
          deployHash: 'deploy_hash_1',
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
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb_1',
          result: 'allowed',
          payloadJson: {
            operation: 'get_api_history',
          },
        }),
      );
    });

    it('keeps runtime scoping on workspace / knowledge base even when project bridge is null', async () => {
      const resolver = new ApiHistoryController();
      const count = jest.fn().mockResolvedValue(1);
      const findAllWithPagination = jest
        .fn()
        .mockResolvedValue([{ id: 'history-kb-only' }]);
      const ctx = {
        runtimeScope: {
          project: null,
          deployment: null,
          workspace: { id: 'ws_1' },
          knowledgeBase: { id: 'kb_1' },
          kbSnapshot: { id: 'snapshot_1' },
          deployHash: 'deploy_hash_1',
          userId: 'user_1',
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: {
          createOne: jest.fn(),
        },
        apiHistoryRepository: {
          count,
          findAllWithPagination,
        },
      } as any;

      const result = await resolver.getApiHistory(
        null,
        {
          filter: {
            apiType: ApiType.STREAM_ASK,
          },
          pagination: { offset: 0, limit: 20 },
        },
        ctx,
      );

      expect(count).toHaveBeenCalledWith(
        {
          projectId: null,
          workspaceId: 'ws_1',
          knowledgeBaseId: 'kb_1',
          kbSnapshotId: 'snapshot_1',
          deployHash: 'deploy_hash_1',
          apiType: ApiType.STREAM_ASK,
        },
        {},
      );
      expect(findAllWithPagination).toHaveBeenCalledWith(
        {
          projectId: null,
          workspaceId: 'ws_1',
          knowledgeBaseId: 'kb_1',
          kbSnapshotId: 'snapshot_1',
          deployHash: 'deploy_hash_1',
          apiType: ApiType.STREAM_ASK,
        },
        {},
        {
          offset: 0,
          limit: 20,
          orderBy: { createdAt: 'desc' },
        },
      );
      expect(result).toEqual({
        items: [{ id: 'history-kb-only' }],
        total: 1,
        hasMore: false,
      });
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb_1',
          result: 'allowed',
          payloadJson: {
            operation: 'get_api_history',
          },
        }),
      );
    });
  });

  describe('getAskShadowCompareStats', () => {
    it('delegates ask shadow compare aggregation to the repository with runtime-scoped filters', async () => {
      const resolver = new ApiHistoryController();
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
      const ctx = {
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'ws_1' },
          knowledgeBase: { id: 'kb_1' },
          kbSnapshot: { id: 'snapshot_1' },
          deployHash: 'deploy_hash_1',
          userId: 'user_1',
        },
        authorizationActor: createAuthorizationActor(),
        auditEventRepository: {
          createOne: jest.fn(),
        },
        apiHistoryRepository: {
          getAskShadowCompareStats,
        },
      } as any;

      const result = await resolver.getAskShadowCompareStats(
        null,
        {
          filter: {
            threadId: 'thread-1',
            startDate: '2026-04-01T00:00:00.000Z',
            endDate: '2026-04-03T00:00:00.000Z',
          },
        },
        ctx,
      );

      expect(getAskShadowCompareStats).toHaveBeenCalledWith(
        {
          projectId: null,
          workspaceId: 'ws_1',
          knowledgeBaseId: 'kb_1',
          kbSnapshotId: 'snapshot_1',
          deployHash: 'deploy_hash_1',
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
      expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_base.read',
          resourceType: 'knowledge_base',
          resourceId: 'kb_1',
          result: 'allowed',
          payloadJson: {
            operation: 'get_ask_shadow_compare_stats',
          },
        }),
      );
    });

    it('rejects non-ask apiType filters', async () => {
      const resolver = new ApiHistoryController();

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
              workspace: { id: 'ws_1' },
              knowledgeBase: { id: 'kb_1' },
              kbSnapshot: { id: 'snapshot_1' },
              deployHash: 'deploy_hash_1',
              userId: 'user_1',
            },
            authorizationActor: createAuthorizationActor(),
            auditEventRepository: {
              createOne: jest.fn(),
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

    it('rejects access without knowledge base read permission', async () => {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
      const resolver = new ApiHistoryController();

      await expect(
        resolver.getApiHistory(
          null,
          {
            pagination: { offset: 0, limit: 20 },
          },
          {
            runtimeScope: {
              project: { id: 42 },
              workspace: { id: 'ws_1' },
              knowledgeBase: { id: 'kb_1' },
              kbSnapshot: { id: 'snapshot_1' },
              deployHash: 'deploy_hash_1',
              userId: 'user_1',
            },
            authorizationActor: {
              ...createAuthorizationActor(),
              workspaceRoleKeys: ['owner'],
              permissionScopes: ['workspace:*'],
              grantedActions: [],
              workspaceRoleSource: 'legacy',
              platformRoleSource: 'legacy',
            },
            auditEventRepository: {
              createOne: jest.fn(),
            },
            apiHistoryRepository: {
              count: jest.fn(),
              findAllWithPagination: jest.fn(),
            },
          } as any,
        ),
      ).rejects.toThrow('Knowledge base read permission required');
    });
  });

  describe('nested responsePayload resolver', () => {
    it('sanitizes RUN_SQL records and chart payload values but leaves arrays untouched', () => {
      const resolver = new ApiHistoryController();
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
            canonicalizationVersion: 'chart-canonical-v1',
            renderHints: {
              preferredRenderer: 'canvas',
            },
            vegaSpec: {
              data: {
                values: [{ x: 1 }, { x: 2 }, { x: 3 }],
              },
            },
          },
        } as any),
      ).toEqual({
        canonicalizationVersion: 'chart-canonical-v1',
        renderHints: {
          preferredRenderer: 'canvas',
        },
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
