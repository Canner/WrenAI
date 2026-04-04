const mockCreateOne = jest.fn();

jest.mock('@/common', () => ({
  components: {
    apiHistoryRepository: {
      createOne: mockCreateOne,
    },
  },
}));

import { buildAskDiagnostics, getScopedThreadHistories } from '../apiUtils';
import { ApiType } from '../../repositories/apiHistoryRepository';
import { createApiHistoryRecord, handleApiError } from '../apiUtils';

describe('apiUtils', () => {
  beforeEach(() => {
    mockCreateOne.mockReset();
  });

  describe('getScopedThreadHistories', () => {
    it('returns empty history when thread id is not provided', async () => {
      const findAllBy = jest.fn();

      const histories = await getScopedThreadHistories({
        apiHistoryRepository: { findAllBy } as any,
        projectId: 42,
      });

      expect(histories).toEqual([]);
      expect(findAllBy).not.toHaveBeenCalled();
    });

    it('loads histories with both projectId and threadId to avoid cross-project pollution', async () => {
      const historyRows = [{ id: 'history-1' }];
      const findAllBy = jest.fn().mockResolvedValue(historyRows);

      const histories = await getScopedThreadHistories({
        apiHistoryRepository: { findAllBy } as any,
        projectId: 42,
        threadId: 'thread-123',
      });

      expect(findAllBy).toHaveBeenCalledWith({
        projectId: 42,
        threadId: 'thread-123',
      });
      expect(histories).toBe(historyRows);
    });

    it('filters histories by runtime identity to avoid cross-scope pollution', async () => {
      const historyRows = [
        {
          id: 'history-1',
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
        {
          id: 'history-2',
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        },
      ];
      const findAllBy = jest.fn().mockResolvedValue(historyRows);

      const histories = await getScopedThreadHistories({
        apiHistoryRepository: { findAllBy } as any,
        projectId: 42,
        threadId: 'thread-123',
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
        } as any,
      });

      expect(histories).toEqual([historyRows[0]]);
    });
  });

  describe('createApiHistoryRecord', () => {
    it('persists runtime identity from runtime scope when available', async () => {
      await createApiHistoryRecord({
        id: 'history-1',
        projectId: 42,
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        } as any,
        apiType: ApiType.ASK,
        statusCode: 200,
      });

      expect(mockCreateOne).toHaveBeenCalledWith({
        id: 'history-1',
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        apiType: ApiType.ASK,
        statusCode: 200,
      });
    });

    it('falls back to null runtime identity fields without runtime scope', async () => {
      await createApiHistoryRecord({
        id: 'history-2',
        projectId: 0,
        apiType: ApiType.RUN_SQL,
        statusCode: 500,
      });

      expect(mockCreateOne).toHaveBeenCalledWith({
        id: 'history-2',
        projectId: 0,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
        apiType: ApiType.RUN_SQL,
        statusCode: 500,
      });
    });
  });

  describe('handleApiError', () => {
    it('uses statusCode from non-ApiError errors when present', async () => {
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await handleApiError({
        error: {
          message: 'Runtime scope selector is required for this request',
          statusCode: 400,
        },
        res,
        projectId: 0,
        apiType: ApiType.ASK,
        startTime: Date.now(),
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Runtime scope selector is required for this request',
        }),
      );
    });
  });

  describe('buildAskDiagnostics', () => {
    it('returns undefined when no diagnostics are available', () => {
      expect(buildAskDiagnostics(null)).toBeUndefined();
      expect(buildAskDiagnostics({} as any)).toBeUndefined();
    });

    it('returns ask trace, path and shadow compare when present', () => {
      expect(
        buildAskDiagnostics({
          traceId: 'trace-1',
          askPath: 'skill',
          shadowCompare: {
            enabled: true,
            executed: true,
            matched: false,
            comparable: false,
            primaryType: 'SKILL',
            shadowType: 'TEXT_TO_SQL',
          },
        } as any),
      ).toEqual({
        traceId: 'trace-1',
        askPath: 'skill',
        shadowCompare: {
          enabled: true,
          executed: true,
          matched: false,
          comparable: false,
          primaryType: 'SKILL',
          shadowType: 'TEXT_TO_SQL',
        },
      });
    });
  });
});
